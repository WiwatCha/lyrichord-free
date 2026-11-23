"""Score chord results on real recordings against chord sheets from the web (no time stamps):
 palette  = share of chord beats whose chord (root + major/minor) appears in the sheet
 seq      = share of the sheet's chord changes found in the same order (LCS of collapsed sequences)
 aligned  = share of beats matching the sheet chord when the sheet is laid over the audio in order (DP)
Run:  PYTHONPATH=backend python3 tests/real/eval_real.py <result.json> <sheet.txt> [--shift auto]"""
import json, re, sys
import numpy as np
NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
TOK = re.compile(r'^([A-G][#b]?)(maj7|maj9|m7b5|m7|m9|m6|m|dim7|dim|aug|sus2|sus4|7sus4|add9|2|6|7|9|11|13)?(?:/([A-G][#b]?))?$')

def minor(q): return q is not None and q.startswith('m') and not q.startswith('maj') or q in ('dim', 'dim7', 'm7b5')

def sheet_chords(path):
    out = []
    for line in open(path, encoding='utf-8'):
        toks = line.replace('|', ' ').split()
        if not toks: continue
        ok = [TOK.match(t) for t in toks]
        if all(ok):
            out += [(NOTE[m.group(1)], minor(m.group(2) or '')) for m in ok]
    return out

def sheet_chords_full(path):
    """(root, minor, bass) per chord token; bass = root unless written as a slash chord."""
    out = []
    for line in open(path, encoding='utf-8'):
        toks = line.replace('|', ' ').replace('/', ' / ').replace(' / ', '/').split()
        if not toks: continue
        ok = [TOK.match(t) for t in toks]
        if all(ok):
            out += [(NOTE[m.group(1)], minor(m.group(2) or ''), NOTE[m.group(3)] if m.group(3) else NOTE[m.group(1)]) for m in ok]
    return out


def fam_of(c):
    if c['root'] < 0: return None
    q = c.get('q', '')
    return (c['root'], minor(q))

def collapse(seq):
    out = []
    for x in seq:
        if x is not None and (not out or out[-1] != x): out.append(x)
    return out

def lcs(a, b):
    dp = np.zeros((len(a) + 1, len(b) + 1), int)
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i, j] = dp[i - 1, j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1, j], dp[i, j - 1])
    return int(dp[-1, -1])

def aligned(beats_fam, sheet):
    """Monotonic alignment of sheet chords over beats; beats before/after the sheet are free (intro talk, fade)."""
    T, E = len(beats_fam), len(sheet)
    NEG = -1e9
    dp = np.full(E + 2, NEG); dp[0] = 0
    match = lambda i, e: 1.0 if beats_fam[i] == sheet[e] else (0.0 if beats_fam[i] is None else -0.5)
    for i in range(T):
        nd = np.full(E + 2, NEG)
        nd[0] = dp[0]
        for st in range(1, E + 1):
            best = max(dp[st], dp[st - 1] - 0.3)
            if st >= 2: best = max(best, dp[st - 2] - 2.0)  # skip a sheet chord (sheet may not match the recording)
            nd[st] = best + match(i, st - 1)
        nd[E + 1] = max(dp[E + 1], dp[E] - 0.3)
        dp = nd
    score = max(dp[E], dp[E + 1])
    return score

def evaluate(res, sheet, shift=0):
    sheet = [((r + shift) % 12, m) for r, m in sheet]
    beats = res['chords']; fams = [fam_of(c) for c in beats]
    pal = set(sheet)
    chord_beats = [f for f in fams if f is not None]
    palette = sum(f in pal for f in chord_beats) / max(1, len(chord_beats))
    # runs of >= 2 beats only (one-beat flickers are noise in a lead sheet)
    runs, i = [], 0
    while i < len(fams):
        j = i
        while j < len(fams) and fams[j] == fams[i]: j += 1
        if fams[i] is not None and j - i >= 2: runs.append(fams[i])
        i = j
    app_seq, sh_seq = collapse(runs), collapse(sheet)
    L = lcs(app_seq, sh_seq)
    changes = sum(1 for k in range(1, len(fams)) if fams[k] != fams[k - 1] and fams[k] is not None)
    return {'palette': round(palette, 3), 'seq_recall': round(L / len(sh_seq), 3), 'seq_precision': round(L / max(1, len(app_seq)), 3),
            'changes': changes, 'app_runs': len(app_seq), 'sheet_chords': len(sh_seq)}

def best_shift(res, sheet):
    return max(range(12), key=lambda s: evaluate(res, sheet, s)['palette'])

if __name__ == '__main__':
    res = json.load(open(sys.argv[1])); sheet = sheet_chords(sys.argv[2])
    sh = best_shift(res, sheet) if '--shift' in sys.argv else 0
    print('shift', sh, evaluate(res, sheet, sh))


def forced_reference(pcs, bss, low, sheet, shift=0, min_len=2):
    """Lay the sheet's chord order over the audio using only the notes heard each beat (not the app's decoding):
    a left-to-right DP where every sheet chord lasts >= min_len beats; beats before/after the song are 'outside'.
    Returns one (root, minor) or None per beat."""
    from app import chords as CH
    sheet = [((x[0] + shift) % 12, x[1], ((x[2] if len(x) > 2 else x[0]) + shift) % 12) for x in sheet]
    T, E = len(pcs), len(sheet)
    st_of = [r * CH.NQ + CH.QI['m' if m else ''] for r, m, _ in sheet]
    em = np.zeros((T, E))
    for i in range(T):
        sc = CH.score_all(pcs[i], bss[i]); bn = bss[i] / max(1e-9, bss[i].max())
        em[i] = [sc[s] + 1.5 * bn[bs] for s, (_, _, bs) in zip(st_of, sheet)]
        if low[i]: em[i] = 0
    sheet = [(r, m) for r, m, _ in sheet]
    # states: (e, d) with d = beats spent so far capped at min_len; plus outside-before (0) and after (last)
    NEG = -1e18
    S = 2 + E * min_len
    idx = lambda e, d: 1 + e * min_len + (min(d, min_len) - 1)
    dp = np.full(S, NEG); dp[0] = 0.0; dp[idx(0, 1)] = em[0, 0]
    back = np.zeros((T, S), int)
    for i in range(1, T):
        nd = np.full(S, NEG); bk = np.zeros(S, int)
        nd[0] = dp[0] + 0.0; bk[0] = 0
        for e in range(E):
            for d in range(1, min_len + 1):
                s = idx(e, d)
                cands = []
                if d == 1:
                    cands.append((dp[0] if e == 0 else NEG, 0))
                    if e > 0: cands.append((dp[idx(e - 1, min_len)] - 0.2, idx(e - 1, min_len)))
                else:
                    cands.append((dp[idx(e, d - 1)], idx(e, d - 1)))
                    if d == min_len: cands.append((dp[s], s))
                v, f = max(cands)
                nd[s] = v + em[i, e]; bk[s] = f
        v1, f1 = max((dp[S - 1], S - 1), (dp[idx(E - 1, min_len)] - 0.2, idx(E - 1, min_len)))
        nd[S - 1] = v1; bk[S - 1] = f1
        dp = nd; back[i] = bk
    s = S - 1 if dp[S - 1] >= dp[idx(E - 1, min_len)] else idx(E - 1, min_len)
    ref = [None] * T
    for i in range(T - 1, -1, -1):
        if 0 < s < S - 1: ref[i] = sheet[(s - 1) // min_len]
        s = back[i][s] if i > 0 else s
    return ref


def ref_accuracy(res, ref):
    fams = [fam_of(c) for c in res['chords']]
    pairs = [(f, r) for f, r in zip(fams, ref) if r is not None]
    fam_ok = sum(f == r for f, r in pairs) / max(1, len(pairs))
    root_ok = sum(f is not None and f[0] == r[0] for f, r in pairs) / max(1, len(pairs))
    return {'ref_fam': round(fam_ok, 3), 'ref_root': round(root_ok, 3), 'ref_beats': len(pairs)}


def ref_accuracy_time(res, ref_json, t0, t1):
    """As ref_accuracy, but matched by time (the result may use another beat grid than the reference)."""
    b = np.array(res['beats']); ch = res['chords']; ok = rok = n = 0
    for x, t in zip(ref_json['ref'], ref_json['beats']):
        if not x or not (t0 < t < t1): continue
        c = ch[max(0, int(np.searchsorted(b, t + 0.1, side='right') - 1))]; f = fam_of(c); n += 1
        rok += f is not None and f[0] == x[0]; ok += f == tuple(x)
    return {'ref_fam': round(ok / max(1, n), 3), 'ref_root': round(rok / max(1, n), 3)}


def bar_hits_time(res, ref_json, t0, t1):
    """Reference chord changes by beat-in-bar of the result's own bars (bar_starts if given, else meter phase)."""
    b = np.array(res['beats']); bpb = res['meter']['bpb']
    starts = res.get('bar_starts') or list(range(res['meter']['phase'] % bpb, len(b), bpb))
    st = np.array(starts); R = ref_json['ref']; rb = ref_json['beats']; pos = []
    for i in range(1, len(R)):
        if R[i] and R[i - 1] and R[i] != R[i - 1] and t0 < rb[i] < t1:
            k = int(np.argmin(np.abs(b - rb[i]))); prev = st[st <= k]
            if len(prev): pos.append(min(bpb - 1, k - prev[-1]))
    return np.bincount(pos, minlength=bpb).tolist()
