"""Chord decoding shared with the browser engine (web/analysis.js).

Input: one pitch-class profile (12) and one bass profile (12) per beat.
Output: one chord per beat {root, q, bass}. Vocabulary and weights live in chord_vocab.json
so both engines always agree.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

VOCAB = json.loads((Path(__file__).with_name("chord_vocab.json")).read_text())
P = VOCAB["params"]
QS = VOCAB["qualities"]
NQ = len(QS)
NS = 12 * NQ + 1  # last state = no chord
QI = {x["q"]: i for i, x in enumerate(QS)}

KMAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KMIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# templates: (NS-1, 12) weights, mask of chord tones, size penalty
_W = np.zeros((12 * NQ, 12))
_IN = np.zeros((12 * NQ, 12), dtype=bool)
_SIZE = np.zeros(12 * NQ)
_ROOT = np.zeros(12 * NQ, dtype=int)
_CORE = np.zeros((12 * NQ, 12), dtype=bool)  # root, third (or sus note) and fifth: the notes a bass usually plays
for r in range(12):
    for qi, qd in enumerate(QS):
        for iv, _w in qd["ivs"][:3]:
            _CORE[r * NQ + qi, (r + iv) % 12] = True
        s = r * NQ + qi
        for iv, w in qd["ivs"]:
            _W[s, (r + iv) % 12] = w
            _IN[s, (r + iv) % 12] = True
        _SIZE[s] = len(qd["ivs"]) - 3
        _ROOT[s] = r


def _norm(a: np.ndarray) -> np.ndarray:
    mx = float(np.max(a)) if len(a) else 0.0
    return a / mx if mx > 0 else np.zeros_like(a, dtype=float)


def score_all(pc: np.ndarray, bs: np.ndarray) -> np.ndarray:
    p, b = _norm(np.asarray(pc, float)), _norm(np.asarray(bs, float))
    s = (_W * (p[None, :] - P["tau"])).sum(1)
    s -= P["beta"] * ((~_IN) * p[None, :]).sum(1)
    s -= P["gamma"] * _SIZE
    s += P["bassBonus"] * b[_ROOT]
    # the bass note should be a chord tone: a little credit as another chord tone (slash chord), a penalty if not
    b2 = b * b
    s += P.get("bassTone", 0.0) * ((_IN * b2[None, :]).sum(1) - b2[_ROOT])
    s -= P.get("bassOut", 0.0) * ((~_CORE) * b2[None, :]).sum(1)
    return s


def viterbi(emis: np.ndarray, chg: np.ndarray | None = None) -> list[int]:
    """chg[i]: extra cost of a chord change landing on beat i (harmonic rhythm: changes prefer the downbeat)."""
    T = emis.shape[0]
    roots = np.append(_ROOT, 12)
    dp = emis[0].copy()
    back = np.zeros((T, NS), dtype=int)
    for i in range(1, T):
        am = int(np.argmax(dp))
        mx = dp[am]
        rbest = np.full(13, -np.inf)
        rarg = np.zeros(13, dtype=int)
        for r in range(13):
            idx = np.where(roots == r)[0]
            j = idx[np.argmax(dp[idx])]
            rbest[r], rarg[r] = dp[j], j
        stay = dp
        extra = float(chg[i]) if chg is not None else 0.0
        same = rbest[roots] - P["penSame"] - extra
        jump = mx - P["penRoot"] - extra
        best = np.maximum(np.maximum(stay, same), jump)
        frm = np.where(stay >= np.maximum(same, jump), np.arange(NS), np.where(same >= jump, rarg[roots], am))
        dp = best + emis[i]
        back[i] = frm
    st = [0] * T
    st[-1] = int(np.argmax(dp))
    for i in range(T - 1, 0, -1):
        st[i - 1] = int(back[i][st[i]])
    return st


def change_costs(T: int, bpb: int, phase: int, w: float | None = None) -> np.ndarray:
    """Cost of a chord change on each beat: free on beat 1, small at mid-bar, larger elsewhere."""
    w = P.get("chgWeak", 2.0) if w is None else w
    half = P.get("chgHalf", 0.5) * w
    out = np.empty(T)
    for i in range(T):
        pos = (i - phase) % bpb
        out[i] = 0.0 if pos == 0 else half if (bpb % 2 == 0 and pos == bpb // 2) else w
    return out


def meter_from_chords(chords: list[dict], accent: np.ndarray | None, bpm: float) -> dict:
    """Same rule as the browser (MA.detectMeter): bar lines where chords change and accents fall."""
    base = ["N" if c["root"] < 0 else f'{c["root"]}{base_q(c["q"])}' for c in chords]
    ch = [1 if i and base[i] != base[i - 1] and base[i] != "N" else 0 for i in range(len(base))]
    acc = np.asarray(accent, float) if accent is not None and len(accent) == len(chords) else None
    am, sd = (float(acc.mean()), float(acc.std()) or 1.0) if acc is not None else (0.0, 1.0)
    cands = [(4, 4, 4, 0.08), (3, 4, 3, 0.0)] + ([(6, 8, 6, 0.0)] if bpm >= 140 else [])
    best = None
    for num, den, bpb, prior in cands:
        for ph in range(bpb):
            d = nd = o = no = 0
            ad = ao = 0.0
            for i in range(1, len(ch)):
                if (i - ph) % bpb == 0:
                    d += ch[i]; nd += 1
                    if acc is not None: ad += (acc[i] - am) / sd
                else:
                    o += ch[i]; no += 1
                    if acc is not None: ao += (acc[i] - am) / sd
            sc = (d / nd if nd else 0) - (o / no if no else 0) + (0.3 * ((ad / nd if nd else 0) - (ao / no if no else 0)) if acc is not None else 0) + prior
            if best is None or sc > best["score"]:
                best = {"num": num, "den": den, "bpb": bpb, "phase": ph, "score": sc}
    return best


REPEAT = {"block": 4, "thr": 0.9, "lam": 1.0}


def repeat_vote(pcs: np.ndarray, bpb: int, phase: int) -> np.ndarray:
    """Let repeated passages vote: a chorus played three times is heard three times.

    Bars are compared as two half-bar note profiles (so 'G D' and 'D G' differ). Two bars are partners
    when a run of `block` consecutive bars around them matches (cosine >= thr bar by bar). Each beat
    then mixes its own notes with the mean of its partners' notes at the same beat of the bar.
    """
    T = len(pcs)
    if T < bpb * 8:
        return pcs
    nrm = pcs / np.maximum(pcs.max(1, keepdims=True), 1e-9)
    starts = list(range(phase % bpb, T - bpb + 1, bpb))
    nb, L = len(starts), REPEAT["block"]
    h = max(1, bpb // 2)
    feat = np.array([np.concatenate([nrm[b:b + h].sum(0), nrm[b + h:b + bpb].sum(0)]) for b in starts])
    feat /= np.maximum(np.linalg.norm(feat, axis=1, keepdims=True), 1e-9)
    sim = feat @ feat.T
    ok = sim >= REPEAT["thr"]
    # run[k, l] = bars k..k+L-1 all match bars l..l+L-1
    run = np.zeros((nb, nb), dtype=bool)
    if nb >= L:
        r = ok[: nb - L + 1, : nb - L + 1].copy()
        for m in range(1, L):
            r &= ok[m: nb - L + 1 + m, m: nb - L + 1 + m]
        run[: nb - L + 1, : nb - L + 1] = r
    partner = np.zeros((nb, nb), dtype=bool)
    for m in range(L):  # bar k belongs to a matching block that starts m bars earlier
        a = run[: nb - m, : nb - m] if m == 0 else run[: nb - m, : nb - m]
        partner[m:, m:] |= a
    np.fill_diagonal(partner, False)
    for k in range(nb):  # neighbours inside the same block are not repeats of each other
        partner[k, max(0, k - L + 1): k + L] = False
    out = nrm.copy()
    lam = REPEAT["lam"]
    for k in range(nb):
        ps = np.where(partner[k])[0]
        if not len(ps):
            continue
        for j in range(bpb):
            i = starts[k] + j
            others = nrm[[starts[p] + j for p in ps]].mean(0)
            out[i] = (nrm[i] + lam * others) / (1 + lam)
    return out


def base_q(q: str) -> str:
    """Basic family of a quality, from the shared vocabulary (as MA.baseOf)."""
    return QS[QI.get(q, 0)].get("base", "")


MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
# chord tones of every state, as a 12-bit mask
_TONES = np.array([sum(1 << ((_ROOT[s] + iv) % 12) for iv, _ in QS[s % NQ]["ivs"]) for s in range(12 * NQ)])
_MAJ_TRIAD = np.array([QS[s % NQ]["base"] == "" and 4 in [iv for iv, _ in QS[s % NQ]["ivs"]] for s in range(12 * NQ)])


def scale_mask(tonic: int) -> int:
    return sum(1 << ((tonic + d) % 12) for d in MAJOR_SCALE)


def local_scales(chords: list[dict], bpb: int, phase: int) -> np.ndarray:
    """Major scale (0-11 = tonic of the major key, minor keys share the relative major's scale) in force at every
    beat, from the chords of a first pass: bar-wise fit to each scale, smoothed with a high switch cost so only
    real key changes (e.g. a last-chorus modulation) move it."""
    T = len(chords)
    if T == 0:
        return np.zeros(0, int)
    starts = list(range(phase % bpb, T, bpb)) or [0]
    if starts[0] > 0:
        starts = [0] + starts
    fit = np.zeros((len(starts), 12))
    for k, b in enumerate(starts):
        e = starts[k + 1] if k + 1 < len(starts) else T
        h = np.zeros(12)
        for c in chords[b:e]:
            if c["root"] >= 0:
                for iv, w in QS[QI[c["q"]]]["ivs"]:
                    h[(c["root"] + iv) % 12] += w
        for t in range(12):
            m = scale_mask(t)
            inside = sum(h[p] for p in range(12) if m >> p & 1)
            fit[k, t] = inside - 1.5 * (h.sum() - inside)
    sw = P.get("keySwitch", 12.0)
    dp, back = fit[0].copy(), np.zeros((len(starts), 12), int)
    for k in range(1, len(starts)):
        best = int(np.argmax(dp))
        stay = dp
        nd = np.where(stay >= dp[best] - sw, stay, dp[best] - sw)
        back[k] = np.where(stay >= dp[best] - sw, np.arange(12), best)
        dp = nd + fit[k]
    path = [int(np.argmax(dp))]
    for k in range(len(starts) - 1, 0, -1):
        path.append(int(back[k][path[-1]]))
    path = path[::-1]
    out = np.zeros(T, int)
    for k, b in enumerate(starts):
        out[b:(starts[k + 1] if k + 1 < len(starts) else T)] = path[k]
    return out


def key_bonus(scales: np.ndarray, w: float | None = None) -> np.ndarray:
    """(beats, states) bonus for chords that belong to the key in force: all tones in the scale = full bonus;
    secondary dominants (a major chord whose root is a fifth above a diatonic chord) and iv / bVII = half."""
    w = P.get("keyBonus", 0.0) if w is None else w
    out = np.zeros((len(scales), 12 * NQ))
    if w <= 0:
        return out
    cache = {}
    for i, t in enumerate(scales):
        if t not in cache:
            m = scale_mask(t)
            full = (_TONES & ~m) == 0
            roots_in = np.array([(m >> ((r + 7) % 12)) & 1 for r in _ROOT], bool)  # V of a diatonic root
            sec = _MAJ_TRIAD & roots_in & ~full
            borrowed = np.isin(_ROOT, [(t + 5) % 12, (t + 10) % 12]) & ~full  # iv, bVII
            cache[t] = w * (full + 0.5 * (sec | borrowed))
        out[i] = cache[t]
    return out


def decode_chords(pcs: np.ndarray, bss: np.ndarray, low: np.ndarray, chg: np.ndarray | None = None, bonus: np.ndarray | None = None) -> list[dict]:
    """pcs, bss: (beats, 12); low: (beats,) bool for silent beats."""
    T = len(pcs)
    if T == 0:
        return []
    emis = np.zeros((T, NS))
    for i in range(T):
        emis[i, :-1] = P["K"] * (score_all(pcs[i], bss[i]) + (bonus[i] if bonus is not None else 0))
        emis[i, -1] = P["K"] * (3 if low[i] else -0.6)
    st = viterbi(emis, chg)
    out = [{"root": -1, "q": "", "bass": -1} if s == NS - 1 else {"root": s // NQ, "q": QS[s % NQ]["q"], "bass": -1} for s in st]
    i = 0
    while i < T:
        j = i
        while j < T and out[j]["root"] == out[i]["root"] and out[j]["q"] == out[i]["q"]:
            j += 1
        c = out[i]
        if c["root"] >= 0:
            bs = bss[i:j].sum(0)
            bp = int(np.argmax(bs))
            tones = [(c["root"] + iv) % 12 for iv, _ in QS[QI[c["q"]]]["ivs"]]
            if bp != c["root"] and bp in tones and bs[bp] > 1.6 * bs[c["root"]]:
                for k in range(i, j):
                    out[k]["bass"] = bp
        i = j
    return out


def detect_key(pc: np.ndarray) -> dict:
    best = (-2.0, 0, "")
    for r in range(12):
        for q, prof in (("", KMAJ), ("m", KMIN)):
            s = float(np.corrcoef(pc, np.roll(prof, r))[0, 1])
            if s > best[0]:
                best = (s, r, q)
    return {"root": best[1], "q": best[2]}


def relative_choice(key: dict, chords: list[dict]) -> dict:
    """Major key or its relative minor (same notes): time spent on each tonic, V-I cadences into it,
    and the closing chord can overturn the note profile's choice when they clearly disagree with it."""
    M = key["root"] if key["q"] == "" else (key["root"] + 3) % 12
    m = (M + 9) % 12
    # a minor chord over the major tonic in the bass (Em7/G) is the major tonic
    fam = [(-1, "x") if c["root"] < 0 else (M, "") if (c["root"] == m and c.get("bass", -1) == M)
           else (c["root"], "m" if base_q(c["q"]) == "m" else "") for c in chords]
    sc = {"": 0.0, "m": 0.0}
    firm = {"": False, "m": False}
    for r, f in fam:
        if (r, f) == (M, ""): sc[""] += 1
        elif (r, f) == (m, "m"): sc["m"] += 1
    seq = [x for i, x in enumerate(fam) if x[0] >= 0 and (i == 0 or x != fam[i - 1])]
    for a, b in zip(seq, seq[1:]):
        if a[0] == (M + 7) % 12 and b == (M, ""):
            sc[""] += 4; firm[""] = True
        if a == ((m + 7) % 12, "") and b == (m, "m"):
            sc["m"] += 4; firm["m"] = True
    if seq:
        n = max(4.0, 0.05 * len(chords))
        for f, r in (("", M), ("m", m)):
            if seq[-1] == (r, f):
                sc[f] += n; firm[f] = True
    # the note profile already chose one; switch to the other only on clear evidence (cadence or ending, and much more time)
    cur = "m" if key["q"] == "m" else ""
    oth = "" if cur else "m"
    pick = oth if firm[oth] and sc[oth] > 1.5 * sc[cur] + 4 else cur
    return {"root": m, "q": "m"} if pick == "m" else {"root": M, "q": ""}


def key_from_chords(chords: list[dict]) -> dict:
    h = np.zeros(12)
    for c in chords:
        if c["root"] >= 0:
            for iv, w in QS[QI[c["q"]]]["ivs"]:
                h[(c["root"] + iv) % 12] += w
            h[c["root"]] += 0.5
    return relative_choice(detect_key(h if h.any() else np.ones(12)), chords)


def use_flats(key: dict) -> bool:
    return key["root"] in ([2, 7, 0, 5, 10, 3] if key["q"] else [5, 10, 3, 8, 1, 6])


def bar_phase(chords: list[dict], onset: np.ndarray | None = None) -> int:
    best, phase = -1.0, 0
    for ph in range(4):
        c = o = 0.0
        for i in range(1, len(chords)):
            if (i - ph) % 4 == 0:
                if chords[i]["root"] != chords[i - 1]["root"]:
                    c += 1
                elif chords[i]["q"] != chords[i - 1]["q"]:
                    c += 0.4
                if onset is not None and i < len(onset):
                    o += float(onset[i])
        sc = c + 0.01 * o
        if sc > best:
            best, phase = sc, ph
    return phase


# fixed spelling used everywhere: Eb and Bb, the other black keys as sharps
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
SHARP = FLAT = NAMES


def name(c: dict, flats: bool = False, mode: str = "advance") -> str:
    if c["root"] < 0:
        return "N"
    L = FLAT if flats else SHARP
    q = QS[QI[c["q"]]]["base"] if mode == "basic" else c["q"]
    s = L[c["root"]] + q
    if mode != "basic" and c.get("bass", -1) >= 0 and c["bass"] != c["root"]:
        s += "/" + L[c["bass"]]
    return s


# ---------------------------------------------------------------- BTC (learned chord model) decoding
# family of each BTC large-vocabulary quality (used so the detail level never changes the root or major/minor)
_BTC_MAJ = ["maj", "maj6", "7", "maj7", "sus2", "sus4", "aug"]
_BTC_MIN = ["min", "min6", "min7", "minmaj7", "dim", "dim7", "hdim7"]
_BTC_Q = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4"]
_BTC_APP = {"maj": "", "min": "m", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6", "min7": "m7", "minmaj7": "m",
            "maj7": "maj7", "7": "7", "dim7": "dim7", "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4"}


# chords BTC's maj/min call can't see: sus (no third) and dim / dim7 / m7b5 (BTC hears them as major: without them
# 3 of 42 test chords were lost). Not aug: it has a major third, and a minor chord with a strong b6 (F#m + D) was
# written F#aug (F# A# D) though no A# sounded (พบรัก, 2026-11-22)
_NO_THIRD = ("sus2", "sus4", "7sus4", "dim", "dim7", "m7b5")


def _template_detail(pcs, bss, low, root: int, fam: str, fallback: str) -> str:
    """Colour of a chord whose root and major/minor family are already known: the template scorer reads extensions
    (9, 11, 13, add2 ...) that BTC's vocabulary lacks, and sus / dim chords, which BTC's maj/min call can't see. Stays with the triad unless a richer chord clearly fits."""
    keep = [k for k in range(len(pcs)) if not low[k]]
    if not keep:
        return fallback
    sc = np.mean([score_all(pcs[k], bss[k])[root * NQ:(root + 1) * NQ] for k in keep], axis=0)
    # sus and dim chords are open to both families: BTC's maj/min call can't see them
    cand = [k for k, q in enumerate(QS) if q["base"] == fam or q["q"] in _NO_THIRD]
    tri = QI[fam]
    best = max(cand, key=lambda k: sc[k])
    return QS[best]["q"] if sc[best] > sc[tri] + P.get("btcTmplMargin", 0.0) else fam


def decode_btc(small: np.ndarray, large: np.ndarray, bss: np.ndarray, low: np.ndarray, chg: np.ndarray | None = None,
               bonus24: np.ndarray | None = None, pcs: np.ndarray | None = None) -> list[dict]:
    """small (B,25) / large (B,170): per-beat BTC log-probabilities.
    1) root + major/minor per beat from the maj/min model, smoothed with the bar-aware change costs;
    2) per chord, the detail (7, maj7, m7, sus, dim ...) from the large model, only among qualities of that family;
    3) slash bass from the bass notes, as for the template decoder."""
    T = len(small)
    if T == 0:
        return []
    w = P.get("btcK", 2.0)
    em = w * small.copy()  # 24 chords + N
    if bonus24 is not None:
        em[:, :24] += bonus24
    em[low, 24] += 3.0
    # Viterbi over 25 states: staying is free, a change costs chg[i] (+ a base cost)
    base = P.get("btcChange", 1.5)
    dp, back = em[0].copy(), np.zeros((T, 25), int)
    for i in range(1, T):
        am = int(np.argmax(dp)); c = base + (float(chg[i]) if chg is not None else 0.0)
        stay = dp >= dp[am] - c
        back[i] = np.where(stay, np.arange(25), am)
        dp = np.where(stay, dp, dp[am] - c) + em[i]
    st = [int(np.argmax(dp))]
    for i in range(T - 1, 0, -1):
        st.append(int(back[i][st[-1]]))
    st = st[::-1]
    out = []
    i = 0
    margin = P.get("btcDetail", 0.15)
    while i < T:
        j = i
        while j < T and st[j] == st[i]:
            j += 1
        k = st[i]
        if k == 24:
            out += [{"root": -1, "q": "", "bass": -1} for _ in range(i, j)]
        else:
            root, minor = k // 2, k % 2 == 1
            seg = large[i:j].mean(0)
            fam = _BTC_MIN if minor else _BTC_MAJ
            triad = seg[root * 14 + _BTC_Q.index("min" if minor else "maj")]
            best, bq = triad, ("min" if minor else "maj")
            for q in fam:
                v = seg[root * 14 + _BTC_Q.index(q)]
                if v > best + margin:
                    best, bq = v, q
            q = _BTC_APP[bq]
            if pcs is not None and P.get("btcTmplDetail", 1):
                q = _template_detail(pcs[i:j], bss[i:j], low[i:j], root, "m" if minor else "", q)
            bs = bss[i:j].sum(0); bp = int(np.argmax(bs))
            tones = [(root + iv) % 12 for iv, _ in QS[QI[q]]["ivs"]]
            bass = bp if bp != root and bp in tones[:3] and bs[bp] > 1.6 * bs[root] else -1
            out += [{"root": root, "q": q, "bass": bass} for _ in range(i, j)]
        i = j
    return out


def key_bonus24(scales: np.ndarray, w: float | None = None) -> np.ndarray:
    """key_bonus for the 24 maj/min chords (BTC state order: C, Cm, C#, C#m, ...)."""
    full = key_bonus(scales, w)
    out = np.zeros((len(scales), 24))
    for r in range(12):
        out[:, 2 * r] = full[:, r * NQ + QI[""]]
        out[:, 2 * r + 1] = full[:, r * NQ + QI["m"]]
    return out
