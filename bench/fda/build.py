"""Build bench/fda/cases.jsonl from the derived field data, with oracle verdicts.

Inputs (all derived numbers, no source text):
  items.jsonl         one row per printed rate: counts, printed percent, printed interval
  strata.json         per-site counts from tables that also print a total
  declarations.json   per document: sampling and label source read from its text by fixed rules

Every expected verdict comes from ../oracle.py, which is independent of src/.
Run before the kit sees the cases:   python3 -I bench/fda/build.py
Check that the committed file is current:   python3 -I bench/fda/build.py --check
Write the small regression subset used by the test suite:
    python3 -I bench/fda/build.py --subset      (writes test/fixtures/field-regression.json)
"""
import json
import math
import os
import sys
from decimal import Decimal
from statistics import NormalDist

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import oracle as O  # noqa: E402

OUT = os.path.join(HERE, 'cases.jsonl')
SUBSET_OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'test', 'fixtures', 'field-regression.json')
PER_GROUP = {'variants-default': 6, 'variants-strictPrecision': 3, 'variants-conservative': 3, 'declared': 3, 'complete-set': 2, 'strata': 4}
HI = ('accuracy', 'precision', 'recall')


def rd(name):
    with open(os.path.join(HERE, name)) as f:
        return [json.loads(line) for line in f]


def lit(x):
    """Exact double for a printed percent: the shortest decimal for x/100."""
    return float(str(x) + 'e-2')


def metric_hi(t):
    return 'precision' if t == 'ppv' else ('recall' if t == 'pos' else 'accuracy')


def metric_lo(t):
    return {'pos': 'false-negative-rate', 'neg': 'false-positive-rate'}.get(t, 'error-rate')


def variants_of(item):
    k, n, s, d = item['k'], item['n'], item['printed_pct'], item['printed_decimals']
    ci = item['printed_ci']
    t = item['type_cue']
    hi = metric_hi(t)
    out = []

    def add(name, metric, form, disp, value, succ, truth):
        o = O.oracle(metric, succ, n, truth[0], truth[1])
        o.update(item=item['id'], variant=name, metric=metric, form=form, display=disp, value=value, n=n,
                 correct=(succ if metric in HI else None), errors=(None if metric in HI else succ))
        out.append(o)

    pct = 100.0 * k / n
    add('as-printed', hi, 'percent', f'{s}%', lit(s), k, (s, 'percent'))
    if lit(s) != float(s) / 100:
        add('as-printed-div100', hi, 'percent', f'{s}%', float(s) / 100, k, (s, 'percent'))
    up = math.ceil(pct - 1e-9)
    if up != pct and up <= 100 and abs(up - float(s)) > 1e-9:
        add('round-up-whole', hi, 'percent', f'{up}%', lit(up), k, (str(up), 'percent'))
    p3 = min(100, round(pct) + 3)
    add('plus-3-points', hi, 'percent', f'{p3}%', lit(p3), k, (str(p3), 'percent'))
    if k < n:
        add('claim-100', hi, 'percent', '100%', 1.0, k, ('100', 'percent'))
    m5 = max(0, math.floor(pct) - 5)
    add('minus-5-points', hi, 'percent', f'{m5}%', lit(m5), k, (str(m5), 'percent'))
    add('floor-published-lower', hi, 'floor', f'{ci[0]}%+', lit(ci[0]), k, (ci[0], 'floor'))
    if float(ci[1]) < 100:
        add('floor-published-upper', hi, 'floor', f'{ci[1]}%+', lit(ci[1]), k, (ci[1], 'floor'))
    comp = Decimal(100) - Decimal(s)
    comp_s = format(comp, f'.{d}f')
    add('error-complement', metric_lo(t), 'percent', f'{comp_s}%', lit(comp_s), n - k, (comp_s, 'percent'))
    x = Decimal(100) - Decimal(ci[0])
    xs = format(x, f".{len(ci[0].split('.')[1]) if '.' in ci[0] else 0}f")
    add('error-ceiling-from-published', metric_lo(t), 'ceiling', f'at most {xs}%', lit(xs), n - k, (xs, 'ceiling'))
    add('error-strict-ceiling-published', metric_lo(t), 'ceiling_strict', f'under {xs}%', lit(xs), n - k, (xs, 'ceiling_strict'))
    return out


def sample_of(v):
    s = {'n': v['n']}
    if v['correct'] is not None:
        s['correct'] = v['correct']
    else:
        s['errors'] = v['errors']
    return s


def group_key(r):
    """Rows that exercise the same rule: a variant (or mode, or refusal reasons) and the expected verdict."""
    tail = r['id'].split('::')
    if r['suite'].startswith('variants-'):
        kind = tail[1]
    elif r['suite'] == 'complete-set':
        kind = tail[1] + '::' + tail[2]
    elif r['suite'] == 'declared':
        kind = ','.join(r['expected'].get('reasons', []))
    else:
        kind = ','.join(r['expected'].get('reasons', []))
    return (r['suite'], kind, r['expected']['verdict'])


def write_subset(rows):
    """A small, fast regression subset: every rule keeps rows at both verdicts, evenly spaced through the corpus.
    All values spelled as printed percent / 100 stay (they pin field:F1)."""
    groups = {}
    for r in rows:
        groups.setdefault(group_key(r), []).append(r)
    picked = []
    for key, g in sorted(groups.items()):
        want = len(g) if key[1] == 'as-printed-div100' else min(len(g), PER_GROUP[key[0]])
        step = len(g) / want
        picked += [g[int(i * step)] for i in range(want)]
    with open(SUBSET_OUT, 'w') as f:
        f.write('[\n' + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in picked) + '\n]\n')
    print(len(picked), 'rows in', SUBSET_OUT)


def main():
    items = rd('items.jsonl')
    by_id = {i['id']: i for i in items}
    decl = json.load(open(os.path.join(HERE, 'declarations.json')))
    strata = json.load(open(os.path.join(HERE, 'strata.json')))
    variants = [v for i in items for v in variants_of(i)]
    rows = []

    def row(suite, rid, source, inp, options, verdict, reasons=None, note=None):
        r = {'suite': suite, 'id': rid, 'source': source, 'input': inp, 'options': options, 'expected': {'verdict': verdict}}
        if reasons is not None:
            r['expected']['reasons'] = reasons
        if note:
            r['note'] = note
        rows.append(r)

    # 1. judged claims: the printed figure and nine altered versions of it, three option sets
    for opt in ('default', 'strictPrecision', 'conservative'):
        for v in variants:
            if opt != 'default' and v['verdict'] != 'refused':
                ver = O.for_option(opt, v)
            else:
                ver = v['verdict']
            item = by_id[v['item']]
            inp = {'claim': {'metric': v['metric'], 'value': v['value'], 'display': v['display']}, 'sample': sample_of(v),
                   'provenance': {'source': 'human'}, 'sampling': 'random'}
            row('variants-' + opt, f"{v['item']}::{v['variant']}", item['url'], inp, {} if opt == 'default' else {opt: True}, ver,
                note='value computed as printed percent / 100' if v['variant'] == 'as-printed-div100' else None)

    # 2. the printed figure with the document's own declared sampling and label source
    for v in variants:
        if v['variant'] != 'as-printed':
            continue
        item = by_id[v['item']]
        d = decl[item['doc']]
        exp = []
        if d['sampling'] == 'convenience':
            exp.append('convenience-sample')
        if d['sampling'] == 'unknown':
            exp.append('unknown-sampling')
        if d['source'] == 'unknown':
            exp.append('unknown-label-source')
        if v['n'] < 30:
            exp.append('sample-too-small')
        inp = {'claim': {'metric': v['metric'], 'value': v['value'], 'display': v['display']}, 'sample': {'n': v['n'], 'correct': v['correct']},
               'provenance': {'source': d['source']}, 'sampling': d['sampling']}
        row('declared', v['item'], item['url'], inp, {}, 'refused' if exp else v['verdict'], sorted(exp) if exp else None)

    # 3. the same figures as claims about a whole fixed set, and as held-out-split claims
    for v in variants:
        if v['form'] != 'percent' or v['variant'] == 'as-printed-div100':
            continue
        item = by_id[v['item']]
        k = v['correct'] if v['correct'] is not None else v['errors']
        shown = Decimal(v['display'].rstrip('%'))
        d = len(v['display'].rstrip('%').split('.')[1]) if '.' in v['display'] else 0
        from fractions import Fraction
        exact = Fraction(k, v['n']) * 100
        if shown == 0:
            match = (k == 0)
        elif shown == 100:
            match = (k == v['n'])
        else:
            match = abs(Fraction(shown) - exact) <= Fraction(1, 2) * Fraction(1, 10 ** d)
        for mode in ('named', 'unnamed', 'held-out'):
            name = f"{item['doc']} clinical study"
            text = f"In the {name}, the figure was {v['display']}" if mode != 'unnamed' else f"Our device scores {v['display']}"
            exp = 'refused' if mode == 'unnamed' else ('supported' if match else 'contradicted')
            claim = {'metric': v['metric'], 'value': v['value'], 'display': v['display'], 'text': text}
            inp = {'claim': claim, 'sample': sample_of(v), 'provenance': {'source': 'human'},
                   'sampling': 'held-out-split' if mode == 'held-out' else 'complete', 'benchmark': {'name': name}}
            row('complete-set', f"{v['item']}::{v['variant']}::{mode}", item['url'], inp, {}, exp)

    # 4. site tables that print a total: pooled stratified claims
    for o in strata:
        st = o['strata']
        if len(st) < 3:
            continue
        K, N = o['total']
        k = len(st)
        z = Decimal(repr(NormalDist().inv_cdf(1 - 0.05 / k / 2)))
        ivs = [O.wilson(s['k'], s['n'], z) for s in st]
        sep = any(ivs[a][1] < ivs[b][0] for a in range(k) for b in range(k) if a != b)
        pct = round(100 * K / N, 1)
        printed = f'{pct:.1f}'
        if pct >= 100 or pct <= 0:
            printed = f'{round(100 * K / N)}'
        res = O.oracle('accuracy', K, N, printed, 'percent') if N >= 30 else dict(verdict='refused')
        verdict = 'refused' if (sep or N < 30) else res['verdict']
        reasons = sorted((['merged-strata-differ'] if sep else []) + (['sample-too-small'] if N < 30 else []))
        inp = {'claim': {'metric': 'accuracy', 'value': lit(printed), 'display': printed + '%'}, 'sample': {'n': N, 'correct': K},
               'provenance': {'source': 'human'}, 'sampling': 'stratified',
               'strata': [{'name': f's{i + 1}', 'n': s['n'], 'correct': s['k']} for i, s in enumerate(st)]}
        row('strata', o['id'], f"https://www.accessdata.fda.gov/cdrh_docs/pdf{o['doc'][1:3]}/{o['doc']}.pdf", inp, {}, verdict, reasons if verdict == 'refused' else None)

    if '--subset' in sys.argv:
        write_subset(rows)
        return
    text = ''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in rows)
    if '--check' in sys.argv:
        cur = open(OUT).read() if os.path.exists(OUT) else ''
        if cur != text:
            print('bench/fda/cases.jsonl is not what build.py produces', file=sys.stderr)
            sys.exit(1)
        print('cases.jsonl is current:', len(rows), 'rows')
        return
    with open(OUT, 'w') as f:
        f.write(text)
    from collections import Counter
    print(len(rows), 'rows', dict(Counter(r['suite'] for r in rows)))


if __name__ == '__main__':
    main()
