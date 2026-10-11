#!/usr/bin/env python3
"""Independent reference vectors for accuracy-claim-kit.

Standard library only (math, decimal, fractions, random, statistics.NormalDist).
Nothing here is shared with the TypeScript implementation.

Formulas (all in exact or 60-digit decimal arithmetic, never the TS code path):

  z (two-sided confidence c):
      c <= 0.5 : z = x solving erf(x/sqrt 2) = c  (Newton on the erf Taylor series,
                 60-digit decimal; avoids the 0.5 + c/2 cancellation)
      c  > 0.5 : z = -NormalDist().inv_cdf((1 - c)/2)
  Wilson score interval (Wilson 1927), successes s, trials n:
      centre  = (s + z^2/2) / (n + z^2)
      margin  = z * sqrt(s(n-s)/n + z^2/4) / (n + z^2)
      low, high = centre -/+ margin      (evaluated with decimal, 60 digits,
                                          using the double z above)
  Agreement for two raters over N items, a_k / b_k = category counts of rater A / B,
  agree = items where the two labels are equal:
      po      = agree / N
      Cohen:  pe = sum_k (a_k/N)(b_k/N);        kappa = (po - pe)/(1 - pe), undefined if pe == 1
      Gwet:   pi_k = (a_k + b_k)/(2N);  pe = sum_k pi_k (1 - pi_k)/(Q - 1);
              AC1 = (po - pe)/(1 - pe), undefined if Q < 2
              (Q = number of categories; observed ones unless a list is given)
      all with fractions.Fraction (exact rationals), converted to float once at the end.
"""
import json
import math
import random
import sys
from decimal import Decimal, getcontext
from fractions import Fraction
from statistics import NormalDist

getcontext().prec = 60
ND = NormalDist()


def _atan_inv(k):
    """atan(1/k) as a Decimal, from its Taylor series."""
    k = Decimal(k)
    x = 1 / k
    total, term, n = x, x, 1
    while abs(term) > Decimal(10) ** -(getcontext().prec + 5):
        term = -term * x * x
        n += 2
        total += term / n
    return total


def _pi():
    """Machin: pi = 16 atan(1/5) - 4 atan(1/239)."""
    return 16 * _atan_inv(5) - 4 * _atan_inv(239)


def z_central(c):
    """x with erf(x/sqrt 2) = c (so P(|Z| <= x) = c), in 60-digit decimal.

    Newton on f(x) = erf(x/sqrt 2) - c, with erf from its Taylor series
    2/sqrt(pi) * sum (-1)^n y^(2n+1) / (n! (2n+1)). Needs no cancellation-prone
    0.5 + c/2 step, so it stays exact for c as small as 1e-16 and below.
    Used for c <= 0.5, where NormalDist.inv_cdf(0.5 + c/2) loses digits.
    """
    pi = _pi()
    sqrt2 = Decimal(2).sqrt()
    c = Decimal(c)

    def erf(y):
        total, term, n = Decimal(0), y, 0
        while True:
            total += term / (2 * n + 1)
            n += 1
            term = -term * y * y / n
            if abs(term) < Decimal(10) ** -(getcontext().prec + 5):
                break
        return 2 / pi.sqrt() * total

    x = c * (pi / 2).sqrt()
    for _ in range(40):
        f = erf(x / sqrt2) - c
        d = (2 / pi).sqrt() * (-(x * x) / 2).exp()
        step = f / d
        x -= step
        if abs(step) < Decimal(10) ** -50 * max(abs(x), Decimal(10) ** -40):
            break
    return float(x)


def z_for(c):
    if c <= 0.5:
        return z_central(c)
    return -ND.inv_cdf((1 - c) / 2)


def wilson(s, n, c):
    z = Decimal(z_for(c))
    s_, n_ = Decimal(s), Decimal(n)
    z2 = z * z
    den = n_ + z2
    centre = (s_ + z2 / 2) / den
    margin = z * (s_ * (n_ - s_) / n_ + z2 / 4).sqrt() / den
    lo, hi = centre - margin, centre + margin
    return float(lo), float(hi), float(Decimal(s) / Decimal(n))


def expand(matrix):
    """matrix[i][j] = items rater A said label i, rater B said label j."""
    pairs = []
    for i, row in enumerate(matrix):
        for j, cnt in enumerate(row):
            pairs.extend([(i, j)] * cnt)
    return pairs


def agreement(matrix, categories=None):
    k = len(matrix)
    N = sum(sum(r) for r in matrix)
    agree = sum(matrix[i][i] for i in range(k))
    a = [sum(matrix[i]) for i in range(k)]
    b = [sum(matrix[i][j] for i in range(k)) for j in range(k)]
    observed = sum(1 for i in range(k) if a[i] + b[i] > 0)
    out = {"n": N, "agreements": agree}
    if N == 0:
        return {"n": 0, "agreements": 0, "percent": None, "kappa": None, "ac1": None}
    po = Fraction(agree, N)
    out["percent"] = float(po)
    pe_c = sum(Fraction(a[i], N) * Fraction(b[i], N) for i in range(k))
    out["kappa"] = None if pe_c == 1 else float((po - pe_c) / (1 - pe_c))
    Q = categories if categories is not None else observed
    if Q < 2:
        out["ac1"] = None
    else:
        pe_g = sum(Fraction(a[i] + b[i], 2 * N) * (1 - Fraction(a[i] + b[i], 2 * N)) for i in range(k)) / (Q - 1)
        out["ac1"] = float((po - pe_g) / (1 - pe_g))
    out["categories"] = Q
    return out


def main():
    out = {}
    out["_comment"] = __doc__.strip().split("\n")
    out["_sources"] = {
        "wilson1927": "E. B. Wilson (1927), JASA 22:209-212, formula only (not retrievable here); values come from the independent decimal implementation above.",
        "newcombe1998": "R. G. Newcombe (1998), Stat Med 17:857-872, Table I Wilson rows (81/263, 15/148, 0/20). The paper could not be retrieved in this environment; these 4-decimal values are recalled, were NOT checked against the paper, and each agrees with the independent computation here to 4 decimals. Treat as unverified against the source.",
        "cohenKappaExamples": "Wikipedia 'Cohen's kappa' (fetched 2026-10-10): 50-proposal example kappa 0.40; 100-item examples 0.1304 and 0.2593; 16-item limitations example 0.0089 and -0.0667 (page rounds to 0.01 and -0.07; the unrounded values here are from the cell counts).",
        "gwetAC1": "Gwet (2008) BJMSP 61:29-48 could not be retrieved (preprint URL returned 404); AC1 relies on the independent exact-fraction implementation above.",
    }

    # inverse normal ------------------------------------------------------
    ps = []
    ps += [1e-300, 1e-200, 1e-100, 1e-50, 1e-30, 1e-20, 1e-15, 1e-12, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.02, 0.02425, 0.025, 0.03, 0.05, 0.1]
    ps += [0.2, 0.25, 0.3, 0.4, 0.45, 0.49, 0.499, 0.4999, 0.49999, 0.499999, 0.4999999, 0.49999999]
    ps += [0.5, 0.5 + 1e-12, 0.5 + 1e-9, 0.5 + 1e-6, 0.500001, 0.50001, 0.5001, 0.501]
    ps += [0.51, 0.55, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 0.975, 0.97575, 0.98, 0.99, 0.999, 0.9999, 0.99999]
    ps += [1 - 1e-6, 1 - 1e-7, 1 - 1e-8, 1 - 1e-9, 1 - 1e-10, 1 - 1e-12, 1 - 1e-15]
    rng = random.Random(20261010)
    ps += [rng.random() for _ in range(150)]
    ps += [10 ** (-rng.uniform(1, 25)) for _ in range(60)]
    ps = [p for p in ps if 0 < p < 1]
    out["normalQuantile"] = [[p, ND.inv_cdf(p)] for p in ps]

    confs = [5e-324, 1e-300, 1e-100, 1e-16, 1e-12, 1e-9, 1e-6, 0.01, 0.1, 0.25, 0.5, 0.5000001, 0.6827, 0.8, 0.9, 0.95, 0.975, 0.99, 0.999, 0.9999, 0.99999, 0.999999]
    out["zForConfidence"] = [[c, z_for(c)] for c in confs]

    # wilson --------------------------------------------------------------
    ns = [1, 2, 3, 5, 10, 20, 29, 30, 100, 263, 500, 1000, 10000, 1000000, 10 ** 9, 10 ** 12, 9007199254740991]
    cs = [0.8, 0.9, 0.95, 0.99, 0.999, 0.9999]
    cases = []
    for n in ns:
        for c in cs:
            ss = {0, 1, n - 1, n, n // 2, n // 10, (n * 9) // 10, (n * 999) // 1000}
            if n >= 2:
                ss |= {2, n - 2}
            for s in sorted(ss):
                if 0 <= s <= n:
                    lo, hi, pt = wilson(s, n, c)
                    cases.append({"successes": s, "n": n, "confidence": c, "low": lo, "high": hi, "point": pt})
    for c in [0.5, 0.6827, 0.975, 0.999999, 0.5000001, 0.0001, 1e-16, 1e-12, 1e-9]:
        for (s, n) in [(0, 50), (7, 50), (50, 50), (499, 500), (81, 263)]:
            lo, hi, pt = wilson(s, n, c)
            cases.append({"successes": s, "n": n, "confidence": c, "low": lo, "high": hi, "point": pt})
    out["wilson"] = cases

    out["wilsonPublished"] = []
    for (s, n, lo4, hi4) in [(81, 263, 0.2553, 0.3662), (15, 148, 0.0624, 0.1605), (0, 20, 0.0, 0.1611)]:
        lo, hi, _ = wilson(s, n, 0.95)
        assert round(lo, 4) == lo4 and round(hi, 4) == hi4, (s, n, lo, hi)
        out["wilsonPublished"].append({"successes": s, "n": n, "confidence": 0.95, "low4": lo4, "high4": hi4,
                                       "source": "Newcombe 1998 Table I (recalled, unverified against paper)"})
    # analytic: zero successes => [0, z^2/(n+z^2)], all successes => [n/(n+z^2), 1]
    out["wilsonAnalytic"] = []
    for n in [1, 5, 20, 29, 100]:
        z = Decimal(z_for(0.95))
        out["wilsonAnalytic"].append({"n": n, "confidence": 0.95, "zeroUpper": float(z * z / (n + z * z)), "allLower": float(Decimal(n) / (n + z * z))})

    # agreement -------------------------------------------------------------
    ag = []

    def add(name, labels, matrix, categories=None, published=None):
        rec = {"name": name, "labels": labels, "matrix": matrix}
        if categories is not None:
            rec["categories"] = categories
        if published:
            rec["published"] = published
        rec["expected"] = agreement(matrix, categories)
        ag.append(rec)

    add("wikipedia 50 proposals", ["yes", "no"], [[20, 5], [10, 15]], None, {"kappa": 0.4, "po": 0.7, "pe": 0.5})
    add("wikipedia 100 case 1", ["yes", "no"], [[45, 15], [25, 15]], None, {"kappa": 0.1304})
    add("wikipedia 100 case 2", ["yes", "no"], [[25, 35], [5, 35]], None, {"kappa": 0.2593})
    add("wikipedia 16 comparison 1", ["G", "R"], [[1, 14], [0, 1]], None, {"kappa": 0.0089})
    add("wikipedia 16 comparison 2", ["G", "R"], [[0, 1], [1, 14]], None, {"kappa": -0.0667})
    add("perfect agreement two categories", ["a", "b"], [[30, 0], [0, 20]])
    add("complete disagreement", ["a", "b"], [[0, 25], [25, 0]])
    add("single category, kappa undefined", ["a"], [[40]])
    add("single category with declared 2 categories", ["a", "b"], [[40, 0], [0, 0]], 2)
    add("high agreement, low kappa (own example)", ["y", "n"], [[118, 5], [2, 0]])
    add("three categories", ["x", "y", "z"], [[10, 2, 1], [3, 12, 4], [0, 5, 20]])
    add("three categories one unused, declared 4", ["x", "y", "z"], [[10, 2, 1], [3, 12, 4], [0, 5, 20]], 4)
    add("raters use different single categories", ["a", "b"], [[0, 12], [0, 0]])
    add("one item", ["a", "b"], [[1, 0], [0, 0]], 2)
    rng2 = random.Random(7)
    for t in range(40):
        k = rng2.randint(2, 5)
        m = [[rng2.choice([0, 0, 1, 2, 5, 17, 60]) for _ in range(k)] for _ in range(k)]
        if sum(map(sum, m)) == 0:
            m[0][0] = 3
        add("seeded matrix %d (k=%d)" % (t, k), ["L%d" % i for i in range(k)], m)
    out["agreement"] = ag

    # verdict cross-check grid ---------------------------------------------
    # Rules (independent restatement of the documented ones):
    #   accuracy:   interval on accuracy [lo,hi]; conservative bound = lo
    #               claim > hi        -> contradicted
    #               lo < claim <= hi  -> overstated
    #               claim <= lo       -> supported
    #   error-rate: interval on error rate [lo,hi]; conservative bound = hi
    #               claim < lo        -> contradicted
    #               lo <= claim < hi  -> overstated
    #               claim >= hi       -> supported
    # Claims are placed 1e-6 away from the bounds so floating tolerance never matters.
    grid = []
    for n in [30, 100, 500, 1000, 10000]:
        for frac in [Fraction(1, 1), Fraction(99, 100), Fraction(95, 100), Fraction(9, 10), Fraction(7, 10), Fraction(1, 2)]:
            correct = int(frac * n)
            for conf in [0.9, 0.95, 0.99]:
                lo, hi, _ = wilson(correct, n, conf)
                for tag, v in [("below-lo", lo - 1e-6), ("above-lo", lo + 1e-6), ("below-hi", hi - 1e-6), ("above-hi", hi + 1e-6)]:
                    if not (0 <= v <= 1):
                        continue
                    if v > hi:
                        ex = "contradicted"
                    elif v > lo:
                        ex = "overstated"
                    else:
                        ex = "supported"
                    grid.append({"metric": "accuracy", "n": n, "correct": correct, "confidence": conf, "claim": v, "expected": ex, "low": lo, "high": hi, "tag": tag})
                errors = n - correct
                elo, ehi, _ = wilson(errors, n, conf)
                for tag, v in [("below-lo", elo - 1e-6), ("above-lo", elo + 1e-6), ("below-hi", ehi - 1e-6), ("above-hi", ehi + 1e-6)]:
                    if not (0 <= v <= 1):
                        continue
                    if v < elo:
                        ex = "contradicted"
                    elif v < ehi:
                        ex = "overstated"
                    else:
                        ex = "supported"
                    grid.append({"metric": "error-rate", "n": n, "errors": errors, "confidence": conf, "claim": v, "expected": ex, "low": elo, "high": ehi, "tag": tag})
    out["verdictGrid"] = grid

    # complete-set (census) comparison ------------------------------------
    # A claimed figure matches a count k/n when, in exact rational arithmetic:
    #   * 0 (or 0%) matches only k = 0 and 1 (or 100%) matches only k = n;
    #   * a printed percent with `decimals` places matches when
    #     |digits/10^(decimals+2) - k/n| <= 1/2 * 10^-(decimals+2);
    #   * a value (a double) matches when |Fraction(value) - k/n| <=
    #     1/2 * 10^-scale + 1 ulp, where scale is the number of decimals of its
    #     SHORTEST round-trip text (repr), read from mantissa and exponent.
    # Every figure supplied (value, and display if any) must match. A matching
    # display with more decimals than the count resolves (10^(d+2) > 10 n) is
    # still 'supported' (the precision is only noted) and 'overstated' under
    # strictPrecision; otherwise a match is 'supported' and a miss 'contradicted'.
    def shortest(x):
        r = repr(x)
        m, e = (r.split("e") + ["0"])[:2] if "e" in r else (r, "0")
        e = int(e)
        whole, frac = (m.split(".") + [""])[:2]
        frac = frac.rstrip("0")
        return int(whole + frac), len(frac) - e

    def match_value(x, k, n):
        if x == 0:
            return k == 0
        if x == 1:
            return k == n
        _, scale = shortest(x)
        return abs(Fraction(x) - Fraction(k, n)) <= Fraction(1, 2 * 10 ** scale) + Fraction(math.ulp(x))

    def match_display(digits, decimals, k, n):
        scale = decimals + 2
        if digits == 0:
            return k == 0
        if digits == 10 ** scale:
            return k == n
        return abs(Fraction(digits, 10 ** scale) - Fraction(k, n)) <= Fraction(1, 2 * 10 ** scale)

    def count_decimals(n):
        d = 0
        while 10 * n >= 10 ** (d + 3):
            d += 1
        return d

    from decimal import ROUND_HALF_UP
    values = [0.0, 1.0, 0.1, 0.3, 0.5, 1 / 3, 0.3333, 0.33333333333333331, 2 / 3, 0.6667, 0.9, 0.99, 0.999,
              0.9999, 0.1229, 0.799, 5e-7, 1.5e-7, 1e-9, 1e-12, 0.12293, 282 / 2294, 39950 / 50000,
              1 - 1e-9, 0.004, 0.0021551724137931034, 0.976, 0.9849, 0.2963, 1e-5, 2.5e-5, 0.07]
    ns = [3, 10, 100, 464, 1000, 2294, 50000, 10 ** 7, 10 ** 9]
    rows = []
    for x in values:
        for n in ns:
            ks = {0, n, round(x * n), round(x * n) + 1, max(0, round(x * n) - 1)}
            for k in sorted(ks):
                if not 0 <= k <= n:
                    continue
                rows.append((x, None, k, n))
                pct = Decimal(repr(x)) * 100
                for d in (0, 1, 2, 3):
                    q = pct.quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
                    if q > 100 or q < 0:
                        continue
                    if abs(Fraction(x) - Fraction(q) / 100) > Fraction(1, 2 * 10 ** (d + 2)) + Fraction(math.ulp(x)):
                        continue
                    rows.append((x, format(q, "f") + "%", k, n))
    rng3 = random.Random(5)
    special = [r for r in rows if r[0] in (0.0, 1.0)]
    rest = [r for r in rows if r[0] not in (0.0, 1.0)]
    keep = special[:150] + rng3.sample(rest, 900)
    census = []
    for (x, disp, k, n) in keep:
        ok = match_value(x, k, n)
        decimals = None
        if disp is not None:
            body = disp[:-1]
            decimals = len(body.split(".")[1]) if "." in body else 0
            digits = int(body.replace(".", ""))
            ok = ok and match_display(digits, decimals, k, n)
        if not ok:
            exp = strict = "contradicted"
        elif decimals is not None and decimals > count_decimals(n):
            # excess printed precision is informational by default, and turns a
            # match into 'overstated' only with options.strictPrecision
            exp, strict = "supported", "overstated"
        else:
            exp = strict = "supported"
        rec = {"value": x, "k": k, "n": n, "expected": exp, "expectedStrict": strict}
        if disp is not None:
            rec["display"] = disp
        census.append(rec)
    out["censusGrid"] = census

    # printed-form grid (floors, ceilings strict and inclusive, ranges, "1 in N")
    # on the interval path and the census path ------------------------------
    # Python restates the documented rules in exact rationals, from the *structure*
    # of each display (not by parsing its text):
    #   figure f: the number; a range is judged at its favorable end (high end
    #     for higher-is-better metrics, low end otherwise); "1 in N" is 1/N.
    #   a value x (double) is 'more favorable' than f when x > f (higher) / x < f (lower).
    #   point match of f to k/n: 0 and 1 are exact (k == 0 / k == n), otherwise
    #     |f - k/n| <= 1/2 * 10^-(decimals+2); "1 in N": k/n within
    #     [1/(N+h), 1/(N-h)] with h = half of the unit of N's last significant digit.
    #   bound check on the census: floor f <= k/n (strict: <), ceiling f >= k/n (strict: >).
    #   census: ok = display_ok and value_ok where value_ok is a point match of the
    #     value when the value is more favorable than f or the display is a plain
    #     percent/approx figure, else True; supported if ok else contradicted.
    #   interval path (Wilson interval [lo, hi] for k of n, k counted in the metric's
    #     favorable direction): within-bound for a higher metric: assessed <= lo
    #     (strict bound: assessed < lo); else supported if the point match holds
    #     (never for a bound, never for 0 or 1); else contradicted if assessed > hi;
    #     else overstated. Lower metric mirrors with hi / lo. assessed = the more
    #     favorable of f and x.
    def match_point(digits, decimals, k, n):
        return match_display(digits, decimals, k, n)

    def match_one_in_n(N, k, n):
        digits = str(N)
        zeros = len(digits) - len(digits.rstrip("0"))
        h = Fraction(10 ** zeros, 2)
        return Fraction(1, 1) / (N + h) <= Fraction(k, n) <= Fraction(1, 1) / (N - h)

    words = {
        "floor_inc": ["{p}%+", "at least {p}%", "≥{p}%", ">={p}%"],
        "floor_strict": ["over {p}%", "above {p}%", ">{p}%", "more than {p}%"],
        "ceil_inc": ["at most {p}%", "no more than {p}%", "≤{p}%", "up to {p}%", "<={p}%"],
        "ceil_strict": ["<{p}%", "under {p}%", "below {p}%", "less than {p}%", "fewer than {p}%"],
        "point": ["{p}%"],
        "approx": ["about {p}%", "~{p}%"],
    }
    rng4 = random.Random(11)
    pvals = [("0", 0), ("0.5", 1), ("1", 0), ("1.0", 1), ("2.5", 1), ("5", 0), ("50", 0), ("95", 0), ("98", 0), ("98.9", 1), ("99", 0), ("99.5", 1), ("99.9", 1), ("100", 0)]
    ns2 = [100, 1000, 100000]
    drows = []
    for metric in ("accuracy", "error-rate"):
        higher = metric == "accuracy"
        for n in ns2:
            for ptxt, dec in pvals:
                f = Fraction(Decimal(ptxt)) / 100
                kc = f * n
                ks = {int(kc), int(kc) + 1, max(0, int(kc) - 1), 0, n}
                ks = {k for k in ks if 0 <= k <= n}
                forms = []
                for key, tmpls in words.items():
                    if key.startswith("floor") and not higher:
                        continue
                    if key.startswith("ceil") and higher:
                        continue
                    if key == "floor_strict" and ptxt == "100":
                        continue  # impossible bound
                    if key == "ceil_strict" and Decimal(ptxt) == 0:
                        continue
                    for t in tmpls:
                        forms.append((key, t.format(p=ptxt), dec, f))
                a, b = ("95", "98") if higher else ("1", "2")
                for key, txt in (("range", f"{a}-{b}%"), ("range", f"{a} to {b}%")):
                    end = Fraction(Decimal(b if higher else a)) / 100
                    forms.append((key, txt, 0, end))
                forms.append(("one_in_n", "1 in " + str(int(Fraction(1) / f)) if f != 0 and (Fraction(1) / f).denominator == 1 else "1 in 1000", 0, None))
                for (key, txt, d, fig) in forms:
                    if key == "one_in_n":
                        N = int(txt.split()[-1])
                        fig = Fraction(1, N)
                    for k in sorted(ks):
                        # value: the figure itself, or (for a point/bound) a more favorable value within half a unit
                        xs = {float(fig)}
                        if key in ("point", "approx", "floor_inc", "floor_strict", "ceil_inc", "ceil_strict"):
                            half = Fraction(1, 2 * 10 ** (d + 2))
                            xs.add(float(fig + (half * Fraction(4, 5) if higher else -half * Fraction(4, 5))))
                            xs.add(float(fig - (half * Fraction(4, 5) if higher else -half * Fraction(4, 5))))
                        for x in sorted(xs):
                            if not 0 <= x <= 1:
                                continue
                            drows.append((metric, higher, key, txt, d, fig, x, k, n))
    keep = rng4.sample(drows, 1800)
    grid2 = []
    for (metric, higher, key, txt, d, fig, x, k, n) in keep:
        # the count that favors the metric: accuracy counts correct, error-rate counts errors
        succ = k
        # --- consistency: the value must agree with the display, else JS throws; skip those rows
        half = Fraction(1, 2 * 10 ** (d + 2))
        if key == "range":
            lo = Fraction(Decimal(txt.replace(" to ", "-").replace("%", "").split("-")[0])) / 100
            hi = Fraction(Decimal(txt.replace(" to ", "-").replace("%", "").split("-")[1])) / 100
            ulp = Fraction(math.ulp(x))
            if not (lo - ulp <= Fraction(x) <= hi + ulp):
                continue
        elif key == "one_in_n":
            N = int(txt.split()[-1])
            digs = str(N); h = Fraction(10 ** (len(digs) - len(digs.rstrip("0"))), 2)
            ulp = Fraction(math.ulp(x))
            if not (Fraction(1, 1) / (N + h) - ulp <= Fraction(x) <= Fraction(1, 1) / (N - h) + ulp):
                continue
        else:
            if abs(Fraction(x) - fig) > half + Fraction(math.ulp(x)):
                continue
        # --- point match of the display
        if key == "one_in_n":
            dmatch = match_one_in_n(int(txt.split()[-1]), succ, n)
        elif key in ("point", "approx", "range"):
            digits = int(fig * 100 * 10 ** d)
            dmatch = match_display(digits, d, succ, n)
        else:  # bounds
            dmatch = None
        bound = key in ("floor_inc", "floor_strict", "ceil_inc", "ceil_strict")
        strict = key.endswith("strict")
        more_fav = (x > float(fig)) if higher else (x < float(fig))  # doubles, as a reader's two numbers compare
        # --- census path
        if bound:
            kf = Fraction(succ, n)
            if key.startswith("floor"):
                disp_ok = fig < kf if strict else fig <= kf
            else:
                disp_ok = fig > kf if strict else fig >= kf
        else:
            disp_ok = dmatch
        value_ok = match_value(x, succ, n) if (more_fav or key in ("point", "approx")) else True
        census_exp = "supported" if (disp_ok and value_ok) else "contradicted"
        # --- interval path
        lo_f, hi_f, _ = wilson(succ, n, 0.95)
        assessed = x if more_fav else float(fig)
        absolute = assessed in (0.0, 1.0)
        if bound:
            matches_obs = False
        elif absolute:
            matches_obs = False
        elif more_fav:
            matches_obs = match_value(x, succ, n)
        else:
            matches_obs = dmatch
        tol = 1e-12
        if higher:
            within = (assessed < lo_f - tol) if strict else (assessed <= lo_f + tol)
            beyond_hi = assessed > hi_f + tol
        else:
            within = (assessed > hi_f + tol) if strict else (assessed >= hi_f - tol)
            beyond_hi = assessed < lo_f - tol
        if within:
            iv_exp = "supported"
        elif matches_obs:
            iv_exp = "supported"
        elif beyond_hi:
            iv_exp = "contradicted"
        else:
            iv_exp = "overstated"
        near = min(abs(assessed - lo_f), abs(assessed - hi_f))
        grid2.append({"metric": metric, "display": txt, "value": x, "k": k, "n": n,
                      "census": census_exp, "interval": iv_exp, "nearLimit": near < 1e-9})
    out["displayGrid"] = grid2

    json.dump(out, sys.stdout, indent=1, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
