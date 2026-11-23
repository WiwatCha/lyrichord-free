"""Per-beat accuracy on the bass-checked stretches (First Love 17-100 s, Fly Me to the Moon 31-175 s), for the current
template decoder and the BTC decoder, plus where the reference chord changes fall in the app's bars.
Needs /tmp/real/out/{fl,fm}_be.json, {fl,fm}_btc.npz, fl_ref2.json, fm_ref.json (see sweep scripts)."""
import json, sys, numpy as np
sys.path.insert(0, 'tests/real'); sys.path.insert(0, 'backend')
import eval_real as ER
from app import chords as CH
WIN = {'fl': ('fl_ref2.json', 17, 100), 'fm': ('fm_ref.json', 31, 175)}
def ref_of(n):
    f, a, b = WIN[n]; R = json.load(open('/tmp/real/out/' + f))
    return [tuple(x) if x and a < t < b else None for x, t in zip(R['ref'], R['beats'])], R['beats']
def bar_hits(ref, bpb, phase):
    pos = [(i - phase) % bpb for i in range(1, len(ref)) if ref[i] and ref[i - 1] and ref[i] != ref[i - 1]]
    return np.bincount(pos, minlength=bpb).tolist()
def btc_chords(n, meter):
    d = np.load(f'/tmp/real/out/{n}_btc.npz'); B = len(d['s'])
    return CH.decode_btc(d['s'], d['l'], np.zeros((B, 12)), np.zeros(B, bool), CH.change_costs(B, meter['bpb'], meter['phase']))
if __name__ == '__main__':
    for n in ('fl', 'fm'):
        ref, beats = ref_of(n); r = json.load(open(f'/tmp/real/out/{n}_be.json'))
        for name, ch in (('template', r['chords']), ('btc', btc_chords(n, r['meter']))):
            a = ER.ref_accuracy({'chords': ch}, ref)
            m2 = CH.meter_from_chords(ch, np.array(r['accent']), r['bpm'])
            print(f"{n} {name:8} REF {a['ref_fam']:.2f} root {a['ref_root']:.2f} | app bar phase {r['meter']['phase']} -> ref changes per beat-in-bar {bar_hits(ref, 4, r['meter']['phase'])} | phase from these chords {m2['phase']} -> {bar_hits(ref, 4, m2['phase'])}")
