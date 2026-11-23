"""Backend parameter sweep on real songs (+ synthetic regression songs). Basic Pitch is cached per song."""
import json, sys, tempfile, itertools
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent)); sys.path.insert(0, str(Path(__file__).parent.parent))
import eval_real as ER
import bar_eval as BE  # installs the Basic Pitch cache, scoring for synthetic songs
from app import pipeline as PL, chords as CH
REAL = [('fl', '/tmp/real/fl.mp3', 'first_love_sheet.txt', 0), ('fm', '/tmp/real/fm.mp3', 'fly_me_sheet.txt', 9)]
HERE = Path(__file__).parent
SHEETS = {n: ER.sheet_chords(HERE / s) for n, _, s, _ in REAL}

def real(name, path, sheet, shift):
    PL.beat_this_beats = lambda y: None
    r = PL.analyze_file(Path(path), Path(tempfile.mkdtemp()), lambda s, p: None)
    e = ER.evaluate(r, SHEETS[name], shift)
    return r, e

def row(tag):
    out = [tag]
    for n, p, s, sh in REAL:
        r, e = real(n, p, s, sh)
        extra = ''
        rf = Path(f'/tmp/real/out/{n}_ref2.json')
        if n == 'fl' and rf.exists():
            R = json.load(open(rf))
            if len(R['ref']) == len(r['chords']):  # verified stretch only (verse 1 + chorus 1, checked against the bass)
                ref = [tuple(x) if x and 17 < t < 100 else None for x, t in zip(R['ref'], R['beats'])]
                a = ER.ref_accuracy(r, ref); extra = f" REF {a['ref_fam']:.2f}/root {a['ref_root']:.2f}"
        out.append(f"{n}: bpm {r['bpm']} pal {e['palette']:.2f} rec {e['seq_recall']:.2f} prec {e['seq_precision']:.2f} chg {e['changes']}{extra}")
    syn = [BE.run(w, t) for w, t in BE.SONGS]
    out.append('syn ' + ' '.join(f"{x['chords']}/f{x['false']}" for x in syn))
    out.append(f'vocab {BE.vocab_exact()}/42')
    print(' | '.join(out), flush=True)

if __name__ == '__main__':
    import os
    grid = json.loads(os.environ.get('GRID', '[{}]'))
    for g in grid:
        for k, v in g.items():
            if k.isupper(): setattr(PL, k, v)
            else: CH.P[k] = v
        row(json.dumps(g))
