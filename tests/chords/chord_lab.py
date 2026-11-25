"""Chord lab: try chord-decoding ideas on real songs in seconds, without analysing them again.

    PYTHONPATH=backend python3 tests/chords/chord_lab.py capture [song ...]   # analyse once, keep what the chord stage sees
    PYTHONPATH=backend python3 tests/chords/chord_lab.py errors <song>        # where the app's chords differ from the sheet

capture keeps, per song (backend/data/chordlab/<song>.npz): beats, the change costs, note profiles per beat (pcs, bss,
low), BTC log-probabilities on the full mix (as the app) and on the band without voice and drums (bass + other stems).
Reference per beat: the sheet's chord order laid over the audio with the notes heard (eval_real.forced_reference),
which does not use BTC, so BTC variants are scored fairly. Songs with a sheet: manifest.json "sheet"."""
import json, sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests/real"), str(ROOT / "tests/bench")]
DATA = ROOT / "tests/real"
LAB = ROOT / "backend/data/chordlab"
MANIFEST = {k: v for k, v in json.loads((ROOT / "tests/bench/manifest.json").read_text()).items() if not k.startswith("_")}


def capture(song: str) -> None:
    import tempfile
    import librosa
    from app import pipeline as PL, chords as CH, chordnet as CN

    got = {}
    real_btc = CH.decode_btc

    def spy(small, large, bss, low, chg=None, bonus24=None, pcs=None):
        got.update(small=small, large=large, bss=bss, low=low, chg=chg, pcs=pcs)
        return real_btc(small, large, bss, low, chg, bonus24, pcs)

    class Ready(Exception):
        pass

    def partial(r):
        got["res"] = r
        raise Ready

    CH.decode_btc = spy
    wd = Path(tempfile.mkdtemp(prefix=f"lab-{song}-"))
    audio = next(DATA / f"{song}{e}" for e in (".mp3", ".wav", ".m4a") if (DATA / f"{song}{e}").exists())
    try:
        res = PL.analyze_file(audio, wd, lambda m, p: None, on_partial=partial)
        got["res"] = res
    except Ready:
        pass
    finally:
        CH.decode_btc = real_btc
    res = got["res"]
    beats = np.array(res["beats"])
    st = wd / "stems"
    stem = lambda n: librosa.load(next(st.glob(f"*/*/{n}.wav")), sr=PL.SR, mono=True)[0]
    harm = stem("bass") + stem("other")
    s_h, l_h = CN.beat_log_probs(harm, PL.SR, beats, res["duration"])
    LAB.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(LAB / f"{song}.npz", beats=beats, small=got["small"], large=got["large"], bss=got["bss"],
                        low=got["low"], chg=got["chg"] if got["chg"] is not None else np.zeros(len(beats)), pcs=got["pcs"],
                        small_harm=s_h, large_harm=l_h)
    (LAB / f"{song}.json").write_text(json.dumps(res, ensure_ascii=False))
    print(f"{song}: {len(beats)} beats, captured")


def load(song: str) -> tuple[dict, dict]:
    z = np.load(LAB / f"{song}.npz")
    res = json.loads((LAB / f"{song}.json").read_text())
    return {**{k: z[k] for k in z.files}, "bar_starts": res.get("bar_starts")}, res


def reference(song: str, d: dict) -> tuple[list, list]:
    import eval_real as ER
    sheet = ER.sheet_chords_full(DATA / MANIFEST[song]["sheet"])
    return ER.forced_reference(d["pcs"], d["bss"], d["low"], sheet), [(r, m) for r, m, _ in sheet]


NO_THIRD = {"sus2", "sus4", "7sus4", "5", "9sus4", "11"}  # no 3rd: fits a major or a minor sheet chord alike


def fair_ref(ref: list, bar_starts: list | None) -> list:
    """The sheet writes a change on the bar; bands often push it (the bass moves on the beat before). A reference
    change one beat before a bar start is moved to the bar start (phobrak: 21 of 28 such beats had the new bass)."""
    if not bar_starts:
        return ref
    out, bs = list(ref), set(bar_starts)
    for k in range(1, len(ref) - 1):
        if ref[k] != ref[k - 1] and ref[k] is not None and ref[k - 1] is not None and k + 1 in bs and ref[k + 1] == ref[k]:
            out[k] = ref[k - 1]
    return out


def fair_beat(chords: list[dict], ref: list) -> tuple[float, float]:
    """Share of reference beats right: root + major/minor, a chord without a 3rd counts for either; and root only."""
    ok = rok = n = 0
    for c, r in zip(chords, ref):
        if r is None:
            continue
        n += 1
        if c["root"] == r[0]:
            rok += 1
            q = c.get("q", "")
            import eval_real as ER
            ok += q in NO_THIRD or ER.minor(q) == r[1]
    return round(ok / max(1, n), 3), round(rok / max(1, n), 3)


def score(song: str, chords: list[dict], d: dict, ref=None) -> dict:
    import eval_real as ER
    ref, sheet = ref or reference(song, d)
    res = {"chords": chords}
    ev = ER.evaluate(res, sheet)
    acc = ER.ref_accuracy(res, ref)
    fb, fr = fair_beat(chords, fair_ref(ref, d.get("bar_starts")))
    out = {"fair": fb, "fair_root": fr, "beat": acc["ref_fam"], "palette": ev["palette"], "seq_rec": ev["seq_recall"]}
    if not MANIFEST[song].get("partial"):
        out["seq_pre"] = ev["seq_precision"]
    else:  # partial sheet: beats after the sheet ends have no reference; precision is meaningless
        pass
    return out


def errors(song: str) -> None:
    from app.chords import NAMES
    import eval_real as ER
    d, res = load(song)
    ref, _ = reference(song, d)
    if "--fair" in sys.argv:
        ref = fair_ref(ref, res.get("bar_starts"))
    fam = [ER.fam_of(c) for c in res["chords"]]
    nm = lambda f: "-" if f is None else NAMES[f[0]] + ("m" if f[1] else "")
    kinds, i, rows = {}, 0, []
    for k, (a, r) in enumerate(zip(fam, ref)):
        if r is None or a == r or ("--fair" in sys.argv and a and a[0] == r[0] and res["chords"][k]["q"] in NO_THIRD):
            continue
        if a is None:
            kind = "N (no chord)"
        elif a[0] == r[0]:
            kind = "major/minor"
        else:
            iv = (a[0] - r[0]) % 12
            kind = {9: "relative minor/major (down a 3rd)", 3: "up a minor 3rd", 4: "up a major 3rd (3rd in bass?)",
                    8: "down a major 3rd", 7: "a fifth up (V)", 5: "a fourth up (IV)", 2: "a tone up", 10: "a tone down"}.get(iv, f"root +{iv}")
        # timing: the right chord is next door (change early or late)
        near = any(fam[j] == r for j in range(max(0, k - 2), min(len(fam), k + 3)))
        kinds.setdefault(kind, [0, 0])
        kinds[kind][0] += 1
        kinds[kind][1] += near
        rows.append((k, res["beats"][k], nm(r), nm(a), "near" if near else ""))
    n = sum(r is not None for r in ref)
    print(f"{song}: {n} reference beats, {len(rows)} differ ({len(rows) / max(1, n):.1%})")
    for kind, (c, near) in sorted(kinds.items(), key=lambda x: -x[1][0]):
        print(f"  {kind:36} {c:4}  ({near} within 2 beats of the right chord)")
    if "-v" in sys.argv:
        for k, t, r, a, near in rows:
            print(f"   beat {k:4} {t:7.1f}s  sheet {r:4} app {a:4} {near}")


if __name__ == "__main__":
    cmd, songs = sys.argv[1], [s for s in sys.argv[2:] if not s.startswith("-")]
    if cmd == "capture":
        for s in songs or [s for s in MANIFEST if MANIFEST[s].get("sheet")]:
            capture(s)
    elif cmd == "errors":
        for s in songs or [s for s in MANIFEST if MANIFEST[s].get("sheet")]:
            errors(s)
