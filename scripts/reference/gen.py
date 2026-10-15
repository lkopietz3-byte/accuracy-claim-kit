#!/usr/bin/env python3
"""Reference cross-check data for accuracy-claim-kit (developer tool, not shipped).

Writes test/fixtures/reference.json: the same Wilson intervals and agreement
statistics the kit computes, as computed by widely used libraries, so anyone can
see that the kit's numbers are not just its own.

  Wilson score interval (no continuity correction)
      statsmodels.stats.proportion.proportion_confint(method="wilson")
      scipy.stats.binomtest(...).proportion_ci(method="wilson")
  Percent agreement, Cohen's kappa
      sklearn.metrics.accuracy_score, sklearn.metrics.cohen_kappa_score
      irrCAC (table and raw CAC classes): pa2 / cohen / conger
  Gwet's AC1
      irrCAC (table and raw CAC classes), weights="identity"
  Inverse normal quantile
      scipy.stats.norm.isf

Everything is deterministic (fixed seed, fixed grid). The library versions are
written into the file. The libraries are only needed to regenerate; the test
(test/reference.test.ts) reads the JSON and needs none of them.

Setup (any Python 3.10 or newer; irrCAC pins an old pandas, so it goes in last
and without its dependencies):

    python3 -m venv .venv-reference        # or: uv venv .venv-reference
    .venv-reference/bin/pip install -r scripts/reference/requirements.txt
    .venv-reference/bin/pip install --no-deps irrCAC==0.4.4
    .venv-reference/bin/python -I scripts/reference/gen.py

With no argument the output goes to test/fixtures/reference.json next to the
repository root. Run it from any directory.
"""
import json
import math
import os
import sys
import warnings
from importlib import metadata

import numpy as np
import pandas as pd
import scipy
import sklearn
import statsmodels
from scipy import stats
from sklearn.metrics import accuracy_score, cohen_kappa_score
from statsmodels.stats.proportion import proportion_confint

import irrCAC
from irrCAC import datasets as irr_datasets
from irrCAC import raw as irr_raw
from irrCAC import table as irr_table

warnings.simplefilter("ignore")
np.seterr(all="ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_OUT = os.path.join(ROOT, "test", "fixtures", "reference.json")
SEED = 20261014
DIGITS = 15  # irrCAC rounds its results; 15 places keeps rounding below 1e-15


def num(x):
    """JSON-safe float: nan and inf become null (a statistic the library leaves undefined)."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


# ---------------------------------------------------------------------------
# Wilson intervals
# ---------------------------------------------------------------------------

# Confidence levels whose complement is exact or nearly so in binary floating
# point, so the references' own 1 - c does not move z by more than rounding.
CONFIDENCES = [0.5, 0.75, 0.8, 0.9, 0.95, 0.99, 0.999, 0.9999]


def wilson_refs(k, n, c):
    sm_lo, sm_hi = proportion_confint(k, n, alpha=1.0 - c, method="wilson")
    ci = stats.binomtest(k, n).proportion_ci(confidence_level=c, method="wilson")
    return [num(sm_lo), num(sm_hi), num(ci.low), num(ci.high)]


def wilson_cases():
    cases = {}

    def add(k, n, ci):
        if 0 <= k <= n:
            cases[(k, n, ci)] = None

    # 1. every k for every n from 1 to 40, at four levels
    for n in range(1, 41):
        for k in range(0, n + 1):
            for ci in (0.8, 0.9, 0.95, 0.99):
                add(k, n, ci)
    # 2. landmark sizes with landmark counts at every level
    sizes = [50, 64, 99, 100, 127, 200, 250, 263, 500, 999, 1000, 2048, 5000, 10000, 12345,
             10**5, 10**6, 10**7, 10**9, 10**12]
    for n in sizes:
        ks = {0, 1, 2, 3, 5, n // 1000, n // 100, n // 20, n // 10, n // 4, n // 2,
              n - n // 4, n - n // 10, n - n // 20, n - n // 100, n - n // 1000, n - 5, n - 3, n - 2, n - 1, n}
        for k in sorted(ks):
            for ci in CONFIDENCES:
                add(k, n, ci)
    # named rows: the three Wilson rows of Newcombe (1998) Table I, and a clinical-sized count
    for k, n in ((81, 263), (15, 148), (0, 20), (589, 590), (755, 913)):
        add(k, n, 0.95)
    # 3. seeded random draws over six decades of n
    rng = np.random.default_rng(SEED)
    for _ in range(3000):
        n = int(10 ** rng.uniform(0, 7))
        n = max(n, 1)
        shape = rng.integers(0, 3)
        if shape == 0:
            k = int(rng.integers(0, n + 1))
        elif shape == 1:
            k = min(n, int(rng.binomial(n, float(10 ** rng.uniform(-4, -0.3)))))
        else:
            k = max(0, n - int(rng.binomial(n, float(10 ** rng.uniform(-4, -0.3)))))
        add(k, n, CONFIDENCES[int(rng.integers(0, len(CONFIDENCES)))])
    return sorted(cases)


# ---------------------------------------------------------------------------
# Agreement
# ---------------------------------------------------------------------------

def pairs_from_matrix(matrix):
    a, b = [], []
    for i, row in enumerate(matrix):
        for j, cnt in enumerate(row):
            a += [i] * cnt
            b += [j] * cnt
    return a, b


def agreement_refs(matrix, categories=None):
    """Reference statistics for one two-rater confusion matrix (rows rater A, columns rater B).

    Chance models need the number of categories. Without a declared count, the categories are
    the labels that appear in either rater's column (the kit's rule); a declared count adds
    unused categories on top. The libraries are given exactly that set."""
    k = len(matrix)
    a, b = pairs_from_matrix(matrix)
    n = len(a)
    observed = [i for i in range(k) if sum(matrix[i]) + sum(row[i] for row in matrix) > 0]
    q = categories if categories is not None else len(observed)
    cats = [f"c{i}" for i in observed] + [f"unused{j}" for j in range(q - len(observed))]
    out = {"n": n, "agreements": sum(matrix[i][i] for i in range(k))}
    out["sklearn_percent"] = num(accuracy_score(a, b))
    try:
        out["sklearn_kappa"] = num(cohen_kappa_score(a, b))
    except Exception:
        out["sklearn_kappa"] = None
    # irrCAC contingency-table classes: the observed submatrix, padded with empty rows and columns
    padded = pd.DataFrame(
        [[matrix[observed[i]][observed[j]] if i < len(observed) and j < len(observed) else 0 for j in range(q)] for i in range(q)],
        index=cats, columns=cats,
    )
    t = {}
    for name, method in (("percent", "pa2"), ("kappa", "cohen"), ("ac1", "gwet")):
        try:
            tab = irr_table.CAC(padded, weights="identity", digits=DIGITS)
            res = getattr(tab, method)()
            t[name] = num(res["est"]["pa" if name == "percent" else "coefficient_value"])
        except Exception:
            t[name] = None
    out["irrcac_table"] = t
    # irrCAC raw classes (one row per item, one column per rater)
    r = {"percent": None, "kappa": None, "ac1": None}
    if n > 0:
        df = pd.DataFrame({"A": [f"c{x}" for x in a], "B": [f"c{x}" for x in b]})
        try:
            raw = irr_raw.CAC(df, weights="identity", categories=cats, digits=DIGITS)
            res = raw.gwet()
            r["ac1"] = num(res["est"]["coefficient_value"])
            r["percent"] = num(res["est"]["pa"])
        except Exception:
            pass
        try:
            raw = irr_raw.CAC(df, weights="identity", categories=cats, digits=DIGITS)
            r["kappa"] = num(raw.conger()["est"]["coefficient_value"])  # Conger's kappa is Cohen's for two raters
        except Exception:
            pass
    out["irrcac_raw"] = r
    return out


def agreement_cases():
    rng = np.random.default_rng(SEED + 1)
    cases = []

    def add(name, matrix, categories=None):
        rec = {"name": name, "labels": [f"c{i}" for i in range(len(matrix))], "matrix": matrix}
        if categories is not None:
            rec["categories"] = categories
        rec.update(agreement_refs(matrix, categories))
        cases.append(rec)

    # named edge cases and the documentation examples
    add("two categories, perfect agreement", [[30, 0], [0, 20]])
    add("two categories, complete disagreement", [[0, 25], [25, 0]])
    add("single category", [[40]])
    add("single category, two declared", [[40, 0], [0, 0]], 2)
    add("raters each use a different single label", [[0, 12], [0, 0]])
    add("one item, two declared", [[1, 0], [0, 0]], 2)
    add("high agreement, low kappa", [[118, 5], [2, 0]])
    add("three categories, one unused, four declared", [[10, 2, 1], [3, 12, 4], [0, 5, 20]], 4)
    add("documentation: irrCAC 3x3 abstractors table", irr_datasets.table_cont3x3abstractors().values.tolist())
    add("documentation: irrCAC 4x4 diagnosis table", irr_datasets.table_cont4x4diagnosis().values.tolist())

    def draw(kind, k):
        if kind == "dirichlet":
            p = rng.dirichlet(np.ones(k * k) * float(10 ** rng.uniform(-0.7, 0.7)))
        elif kind == "diagonal":
            agree = float(rng.uniform(0.5, 0.99))
            marg = rng.dirichlet(np.ones(k) * float(10 ** rng.uniform(-0.5, 0.5)))
            p = np.full((k, k), (1 - agree) / max(1, k * k - k))
            for i in range(k):
                p[i, i] = agree * marg[i]
            p = p.flatten()
        elif kind == "skewed":
            prev = float(rng.uniform(0.85, 0.995))
            marg = np.full(k, (1 - prev) / max(1, k - 1))
            marg[0] = prev
            p = np.full((k, k), 0.0)
            for i in range(k):
                for j in range(k):
                    p[i, j] = marg[i] * marg[j] * (1.0 + (3.0 if i == j else 0.0))
            p = p.flatten()
        else:  # off-diagonal heavy
            p = rng.dirichlet(np.ones(k * k) * 0.8)
            q = p.reshape(k, k)
            q[np.diag_indices(k)] *= 0.1
            p = q.flatten()
        return p / p.sum()

    kinds = ["dirichlet", "diagonal", "skewed", "offdiagonal"]
    sizes = [2, 3, 5, 8, 13, 30, 60, 100, 250, 600, 1000]
    target = 1500
    while len(cases) < target:
        kind = kinds[len(cases) % 4]
        k = int(rng.integers(2, 9))
        n = sizes[int(rng.integers(0, len(sizes)))]
        counts = rng.multinomial(n, draw(kind, k)).reshape(k, k).tolist()
        extra = None
        if int(rng.integers(0, 5)) == 0:
            extra = k + int(rng.integers(1, 4))
        add(f"seeded {kind} k={k} n={n} #{len(cases)}", counts, extra)
    return cases


# ---------------------------------------------------------------------------
# Self-checks (the references must agree with each other before they are trusted)
# ---------------------------------------------------------------------------

def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT

    # irrCAC documents its table examples; they must still reproduce here.
    documented = irr_table.CAC(irr_datasets.table_cont3x3abstractors(), digits=5).gwet()["est"]
    assert round(float(documented["coefficient_value"]), 5) == 0.84933, "irrCAC doc example (AC1 0.84933) changed"
    assert round(float(documented["pa"]), 5) == 0.89 and round(float(documented["pe"]), 5) == 0.26992

    wil = []
    worst_libs = 0.0
    for k, n, ci in wilson_cases():
        refs = wilson_refs(k, n, ci)
        worst_libs = max(worst_libs, abs(refs[0] - refs[2]), abs(refs[1] - refs[3]))
        wil.append([k, n, ci] + refs)

    print(f"{len(wil)} Wilson rows done; computing agreement references (about 1,500 matrices)", flush=True)
    agr = agreement_cases()
    worst = {"kappa": 0.0, "ac1": 0.0, "percent": 0.0}
    for case in agr:
        t, r = case["irrcac_table"], case["irrcac_raw"]
        for name, other in (("percent", case["sklearn_percent"]), ("kappa", case["sklearn_kappa"]), ("ac1", None)):
            for pair in ((t[name], r[name]), (t[name], other)):
                x, y = pair
                if x is not None and y is not None:
                    worst[name] = max(worst[name], abs(x - y))

    z_levels = [0.5, 0.6827, 0.8, 0.9, 0.95, 0.975, 0.99, 0.999, 0.9999]
    z_rows = [[c, float(stats.norm.isf((1.0 - c) / 2.0))] for c in z_levels]

    def ver(pkg):
        return metadata.version(pkg)

    doc = {
        "_comment": [
            "Generated by scripts/reference/gen.py. Do not edit by hand; regenerate it.",
            "Each row is computed by independent, widely used libraries. test/reference.test.ts compares the kit with them.",
            "wilson rows: [successes, n, confidence, statsmodels low, statsmodels high, scipy low, scipy high].",
            "agreement rows: a two-rater confusion matrix (rows rater A, columns rater B) with the statistic from each library; null means the library leaves it undefined.",
            "irrCAC rounds its output; digits=15 keeps that below 1e-15.",
        ],
        "versions": {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scipy": scipy.__version__,
            "scikit-learn": sklearn.__version__,
            "statsmodels": statsmodels.__version__,
            "irrCAC": ver("irrCAC"),
        },
        "methods": {
            "wilson": "statsmodels.stats.proportion.proportion_confint(method='wilson'); scipy.stats.binomtest(k, n).proportion_ci(method='wilson'); no continuity correction",
            "percent": "sklearn.metrics.accuracy_score; irrCAC.table.CAC.pa2; irrCAC.raw.CAC.gwet()['est']['pa']",
            "kappa": "sklearn.metrics.cohen_kappa_score; irrCAC.table.CAC.cohen; irrCAC.raw.CAC.conger (Conger's kappa equals Cohen's kappa for two raters)",
            "ac1": "irrCAC.table.CAC.gwet and irrCAC.raw.CAC.gwet, weights='identity'",
            "z": "scipy.stats.norm.isf((1 - c) / 2)",
        },
        "seed": SEED,
        "referencesAgreeWithEachOther": {
            "wilsonMaxAbsDiffStatsmodelsVsScipy": worst_libs,
            "agreementMaxAbsDiff": worst,
        },
        "z": z_rows,
        "wilson": wil,
        "agreement": agr,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), allow_nan=False)
        f.write("\n")
    print(f"wrote {out_path}: {len(wil)} Wilson rows, {len(agr)} agreement matrices")
    print("libraries disagree with each other by at most", worst_libs, "(Wilson) and", worst, "(agreement)")


if __name__ == "__main__":
    main()
