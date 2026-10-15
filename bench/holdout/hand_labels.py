"""Writes labels.jsonl from claims.jsonl: the verdict each claim should get under the README rules.

These are the hand labels. They were written down, and committed, before the kit was run on the
claims (see README.md). The kit is not imported here. Judgement went into the declarations in
claims.jsonl (who labeled, how items were picked, whether the sentence names the set); this
script applies the README's rules to them, in the README's order, with exact fractions.

    python3 -I bench/holdout/hand_labels.py            writes labels.jsonl
    python3 -I bench/holdout/hand_labels.py --check    exits 1 if labels.jsonl differs
"""
import json
import os
import re
import sys
from decimal import Decimal
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import oracle as ORC  # noqa: E402  (Wilson interval in 60-digit decimal, independent of src/)

HIGHER = ('accuracy', 'precision', 'recall', 'sensitivity', 'specificity')
PCT = re.compile(r'^(?:~|about |approximately |around )?(\d+(?:\.\d+)?)%$')


def printed_figure(display):
    m = PCT.match(display)
    if not m:
        return None
    digits = m.group(1)
    return Fraction(Decimal(digits)), (len(digits.split('.')[1]) if '.' in digits else 0)


def hand_label(c):
    d = c['declared']
    if c['counts'] is None:
        return 'refused', ['n-undisclosed']
    if d['labelSource'] == 'unknown':
        return 'refused', ['unknown-label-source']
    if d['labelSource'] == 'model':
        return 'refused', ['no-human-labels']
    if d['sampling'] == 'convenience':
        return 'refused', ['convenience-sample']
    if d['sampling'] == 'unknown':
        return 'refused', ['unknown-sampling']
    k = c['counts'].get('correct', c['counts'].get('errors'))
    n = c['counts']['n']
    display = c['claim']['display']
    exact = Fraction(k, n) * 100
    if d['sampling'] == 'random':
        if n < 30:
            return 'refused', ['sample-too-small']
        printed, dec = printed_figure(display)
        if printed not in (0, 100) and abs(printed - exact) <= Fraction(1, 2) * Fraction(1, 10 ** dec):
            return 'supported', ['matches-observed-rate']
        lo, hi = ORC.wilson(k, n)
        v = printed / 100
        if c['claim']['metric'] in HIGHER:
            verdict = 'contradicted' if v > Fraction(hi) else 'overstated' if v > Fraction(lo) else 'supported'
        else:
            verdict = 'contradicted' if v < Fraction(lo) else 'overstated' if v < Fraction(hi) else 'supported'
        return verdict, ['claim-beyond-conservative-bound']
    if d['sampling'] in ('complete', 'held-out-split'):
        if not d['namesSet']:
            return 'refused', ['claim-not-scoped-to-benchmark']
        fig = printed_figure(display)
        if fig is not None:
            printed, dec = fig
            ok = (exact == printed) if printed in (0, 100) else abs(printed - exact) <= Fraction(1, 2) * Fraction(1, 10 ** dec)
        else:
            m = re.match(r'^1 in ([\d,]+)$', display)
            ok = abs(Fraction(int(m.group(1).replace(',', ''))) - Fraction(n, k)) <= Fraction(1, 2)
        return ('supported', ['census-matches-count']) if ok else ('contradicted', ['claim-differs-from-count'])
    raise ValueError(c['id'])


def main():
    with open(os.path.join(HERE, 'claims.jsonl')) as f:
        claims = [json.loads(line) for line in f]
    text = ''
    for c in claims:
        verdict, reasons = hand_label(c)
        text += json.dumps({'id': c['id'], 'verdict': verdict, 'reasons': reasons}) + '\n'
    out = os.path.join(HERE, 'labels.jsonl')
    if '--check' in sys.argv:
        if not os.path.exists(out) or open(out).read() != text:
            print('labels.jsonl differs from hand_labels.py output', file=sys.stderr)
            sys.exit(1)
        print('labels.jsonl is current:', len(claims), 'labels')
        return
    with open(out, 'w') as f:
        f.write(text)
    print(len(claims), 'labels written')


if __name__ == '__main__':
    main()
