"""Independent oracle for accuracy-claim verdicts.

Written from the verdict table in the README, not from src/. It shares no code
with the kit: Wilson intervals in 60-digit decimal arithmetic, point-rate
equality in exact fractions. Standard library only.

What it is and is not: it restates the kit's documented policy (README
"How a claim is judged") in a second implementation. Agreement with it shows the
kit does what it documents. It does not show the policy is the right one.
"""
from decimal import Decimal, getcontext
from fractions import Fraction
import math

getcontext().prec = 60
Z95 = Decimal('1.959963984540054235524594430520551527955550')
TOL = Decimal('1e-12')
HIGHER = {'accuracy', 'precision', 'recall'}


def wilson(k, n, z=Z95):
    k = Decimal(k)
    n = Decimal(n)
    z2 = z * z
    centre = (k + z2 / 2) / (n + z2)
    margin = z * ((k * (n - k) / n + z2 / 4).sqrt()) / (n + z2)
    lo = max(Decimal(0), centre - margin)
    hi = min(Decimal(1), centre + margin)
    if k == 0:
        lo = Decimal(0)
    if k == n:
        hi = Decimal(1)
    return lo, hi


def _binom_cdf_log(k, n, p):
    # P(X <= k) by a float log-sum; adequate for the bisection below at the 4th decimal
    if p <= 0:
        return 1.0
    if p >= 1:
        return 1.0 if k >= n else 0.0
    lp, lq = math.log(p), math.log(1 - p)
    terms = [math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq for i in range(0, k + 1)]
    m = max(terms)
    return math.exp(m) * sum(math.exp(t - m) for t in terms)


def clopper_pearson(k, n, alpha=0.05):
    def bis(f, lo=0.0, hi=1.0):
        for _ in range(80):
            mid = (lo + hi) / 2
            if f(mid):
                hi = mid
            else:
                lo = mid
        return (lo + hi) / 2
    low = 0.0 if k == 0 else bis(lambda p: (1 - _binom_cdf_log(k - 1, n, p)) >= alpha / 2)
    high = 1.0 if k == n else bis(lambda p: _binom_cdf_log(k, n, p) <= alpha / 2)
    return low, high


def wald(k, n):
    p = k / n
    s = 1.959963984540054 * math.sqrt(p * (1 - p) / n)
    return max(0, p - s), min(1, p + s)


def maxdec(width_prop):
    """Largest D with 10^-D percentage points <= one tenth of the interval width."""
    w = float(width_prop) * 100
    if w <= 0:
        return 0
    d = 0
    while 10 ** (-(d + 1)) >= w / 10 and d < 20:
        d += 1
    return d


def oracle(metric, k, n, shown_pct_str, form='percent', min_n=30):
    """metric: a kit metric name; k = correct for a higher-is-better metric, errors otherwise.
    form: 'percent' (point), 'floor', 'ceiling', 'floor_strict', 'ceiling_strict'.
    Assumes human labels and random sampling (the judged path)."""
    if n < min_n:
        return dict(verdict='refused', reasons=['sample-too-small'])
    higher = metric in HIGHER
    lo, hi = wilson(k, n)
    d = len(shown_pct_str.split('.')[1]) if '.' in shown_pct_str else 0
    shown = Decimal(shown_pct_str) / 100
    reasons = []
    fr = Fraction(k, n)
    # an honest report: the printed figure is within half a unit of its last digit of the exact rate
    half = Fraction(1, 2) * Fraction(1, 10 ** d)
    pm = Fraction(Decimal(shown_pct_str))
    point_match = (form == 'percent' and Decimal(shown_pct_str) not in (0, 100) and abs(pm - fr * 100) <= half)
    if form == 'percent':
        if point_match:
            v = 'supported'
            reasons = ['matches-observed-rate']
        elif higher:
            if shown > hi + TOL:
                v = 'contradicted'
            elif shown > lo + TOL:
                v = 'overstated'
            else:
                v = 'supported'
        else:
            if shown < lo - TOL:
                v = 'contradicted'
            elif shown < hi - TOL:
                v = 'overstated'
            else:
                v = 'supported'
    elif form in ('floor', 'floor_strict'):
        assert higher
        if form == 'floor':
            if shown > hi + TOL:
                v = 'contradicted'
            elif shown > lo + TOL:
                v = 'overstated'
            else:
                v = 'supported'
        else:
            if shown >= hi - TOL:
                v = 'contradicted'
            elif shown >= lo - TOL:
                v = 'overstated'
            else:
                v = 'supported'
    elif form in ('ceiling', 'ceiling_strict'):
        assert not higher
        if form == 'ceiling':
            if shown < lo - TOL:
                v = 'contradicted'
            elif shown < hi - TOL:
                v = 'overstated'
            else:
                v = 'supported'
        else:
            if shown <= lo + TOL:
                v = 'contradicted'
            elif shown <= hi + TOL:
                v = 'overstated'
            else:
                v = 'supported'
    else:
        raise ValueError(form)
    return dict(verdict=v, reasons=reasons, lo=float(lo), hi=float(hi), maxdec=maxdec(hi - lo),
                too_fine=(form == 'percent' and d > maxdec(hi - lo)))


def for_option(option, rec):
    """Oracle verdict under options.strictPrecision or options.conservative.
    rec: a dict from oracle() plus metric, form, value (a float proportion) and the default verdict."""
    ov = rec['verdict']
    if option == 'default' or ov == 'refused':
        return ov
    lo, hi = rec['lo'], rec['hi']
    higher = rec['metric'] in HIGHER
    val = rec['value']
    tol = 1e-12
    if option == 'conservative' and rec['form'] in ('percent', 'floor', 'ceiling'):
        # no observed-rate allowance
        if higher:
            ov = 'contradicted' if val > hi + tol else ('supported' if val <= lo + tol else 'overstated')
        else:
            ov = 'contradicted' if val < lo - tol else ('supported' if val >= hi - tol else 'overstated')
    if rec['form'] == 'percent' and ov == 'supported' and rec['too_fine']:
        ov = 'overstated'
    return ov
