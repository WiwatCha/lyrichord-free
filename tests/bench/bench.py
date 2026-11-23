"""Accuracy benchmark for what the sheet shows: key, BPM, chords, melody, and the time until the sheet is ready.

    PYTHONPATH=backend python3 tests/bench/bench.py [song ...] [--label NAME] [--compare OLD_LABEL]

Songs and references: tests/bench/manifest.json; audio, scores and chord sheets in tests/real (not in git).
The analysis stops once the sheet is ready (lyrics are not part of this benchmark: Whisper would add minutes).
Scores
  key      MIREX weighted: same 1.0, a fifth away 0.5, relative 0.3, parallel 0.2, else 0
  bpm      the app's tempo / the score's (1.0 = same; 0.5 / 2.0 = counted half / double)
  chords   against the sheet's chord order (root + major/minor, tests/real/eval_real.py):
           palette = share of chord beats whose chord is in the sheet, seq_recall / seq_precision = the sheet's chord
           changes found in the same order / the app's changes that are in the sheet (partial sheets: recall only)
  melody   sung songs: frames where the app's melody note = the singer's pitch (pYIN on the vocal stem, confident
           frames); instrumental: against the score MIDI (times matched with DTW), as in tests/melody
Results: backend/data/bench/<label>/ (one JSON per song + summary.json)."""
import argparse, json, os, sys, tempfile, time
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests/real"), str(ROOT / "tests/melody")]
from app import pipeline as PL  # noqa: E402
from app.chords import NAMES  # noqa: E402
import eval_real as ER  # noqa: E402
import eval_voice as EV  # noqa: E402

DATA = Path(os.environ.get("LYRICORD_TESTDATA", ROOT / "tests/real"))
OUT = ROOT / "backend/data/bench"
CACHE = OUT / "cache"


class SheetReady(Exception):
    pass


def audio_of(song: str) -> Path:
    return next(DATA / f"{song}{e}" for e in (".mp3", ".wav", ".m4a", ".flac") if (DATA / f"{song}{e}").exists())


def analyze(song: str) -> tuple[dict, float, Path]:
    audio = audio_of(song)
    wd = Path(tempfile.mkdtemp(prefix=f"bench-{song}-"))
    got = {}

    def partial(r):
        got["r"] = r
        raise SheetReady

    t = time.time()
    try:
        got["r"] = PL.analyze_file(audio, wd, lambda m, p: None, on_partial=partial)
    except SheetReady:
        pass
    return got["r"], time.time() - t, wd


def key_score(app: dict, ref: list) -> float:
    a, am, r, rm = app["root"], app["q"] == "m", ref[0], ref[1] == "m"
    if a == r and am == rm:
        return 1.0
    if am == rm and (a - r) % 12 in (5, 7):
        return 0.5
    if am != rm and (a - r) % 12 == ((9 if rm is False else 3)):  # relative minor / major
        return 0.3
    if a == r:
        return 0.2
    return 0.0


def key_name(k) -> str:
    return NAMES[k[0] if isinstance(k, list) else k["root"]] + ("m" if (k[1] if isinstance(k, list) else k["q"]) == "m" else "")


def voice_ref(song: str, wd: Path) -> np.ndarray | None:
    """Singer's pitch every 20 ms (pYIN on the vocal stem, -1 where unsure), cached per song (the stem is the same every run)."""
    cf = CACHE / f"{song}_pyin.json"
    if not cf.exists():
        stem = next(wd.glob("stems/*/*/vocals.wav"), None)
        if stem is None:
            return None
        y, _ = librosa.load(stem, sr=PL.SR, mono=True)
        f0, _, p = librosa.pyin(y, fmin=70, fmax=1100, sr=PL.SR, hop_length=int(PL.SR * 0.02))
        CACHE.mkdir(parents=True, exist_ok=True)
        cf.write_text(json.dumps({"f0": [None if np.isnan(f) else float(f) for f in f0], "p": [float(x) for x in p]}))
    py = json.loads(cf.read_text())
    return np.array([int(round(69 + 12 * np.log2(f / 440))) if f and p > 0.6 else -1 for f, p in zip(py["f0"], py["p"])])


def midi_melody(song: str, midi: str, notes: list[dict]) -> dict:
    import pretty_midi
    import eval_melody as EM

    y, sr = librosa.load(audio_of(song), sr=PL.SR, mono=True)
    pm = pretty_midi.PrettyMIDI(str(DATA / midi))
    ref, ref_notes = EM.reference(pm, "upper", EM.warp_fn(y, sr, pm))
    return EM.score(notes, ref, ref_notes)


def run_song(song: str, ref: dict) -> dict:
    res, sec, wd = analyze(song)
    row = {"song": song, "sheet_sec": round(sec), "bpm": res["bpm"], "key": key_name(res["key"]),
           "melody_src": res.get("melody_src"), "melody_engine": res.get("melody_engine"), "chord_engine": res.get("chord_engine")}
    if ref.get("key"):
        row["key_ref"] = key_name(ref["key"])
        row["key_score"] = key_score(res["key"], ref["key"])
    if ref.get("bpm"):
        row["bpm_ratio"] = round(res["bpm"] / ref["bpm"], 2)
    if ref.get("sheet"):
        sheet = ER.sheet_chords(DATA / ref["sheet"])
        ev = ER.evaluate(res, sheet)
        row.update(chord_palette=ev["palette"], chord_seq_recall=ev["seq_recall"])
        if not ref.get("partial"):
            row["chord_seq_precision"] = ev["seq_precision"]
    if ref.get("midi"):
        m = midi_melody(song, ref["midi"], res["notes"])
        row.update(melody_pitch=m["pitch"], melody_chroma=m["chroma"], melody_ref="score")
    elif res.get("melody_src") == "vocals":
        vr = voice_ref(song, wd)
        if vr is not None:
            for a, b in res.get("spoken") or []:  # speech (the anthem's announcer) is not the tune: the app leaves it out on purpose
                vr[int(a / 0.02):int(b / 0.02)] = -1
            m = EV.evaluate(res["notes"], vr)
            row.update(melody_pitch=m["pitch"], melody_chroma=m["chroma"], melody_voiced=m["voiced"], melody_ref="voice")
    return {"row": row, "result": res}


COLS = [("sheet_sec", "s"), ("bpm", "BPM"), ("bpm_ratio", "×ref"), ("key", "key"), ("key_ref", "ref"), ("key_score", "key✓"),
        ("chord_palette", "palette"), ("chord_seq_recall", "seq_rec"), ("chord_seq_precision", "seq_pre"),
        ("melody_pitch", "mel_pitch"), ("melody_chroma", "mel_chroma")]


def table(rows: list[dict], old: dict | None = None) -> str:
    out = ["song       " + " ".join(f"{h:>9s}" for _, h in COLS)]
    for r in rows:
        cells = []
        for k, _ in COLS:
            v = r.get(k, "")
            o = (old or {}).get(r["song"], {}).get(k)
            s = f"{v:.2f}" if isinstance(v, float) else str(v)
            if o is not None and o != v and isinstance(v, (int, float)) and isinstance(o, (int, float)):
                s += f"({v - o:+.2f})" if isinstance(v, float) else f"({v - o:+d})"
            cells.append(f"{s:>9s}")
        out.append(f"{r['song']:10s} " + " ".join(cells))
    num = lambda k: [r[k] for r in rows if isinstance(r.get(k), (int, float))]
    mean = {k: round(float(np.mean(num(k))), 3) for k, _ in COLS if num(k) and k not in ("bpm", "key")}
    out.append("mean       " + " ".join(f"{(f'{mean[k]:.2f}' if k in mean else ''):>9s}" for k, _ in COLS))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("songs", nargs="*")
    ap.add_argument("--label", default=time.strftime("%Y%m%d-%H%M"))
    ap.add_argument("--compare", default="")
    a = ap.parse_args()
    manifest = {k: v for k, v in json.loads((Path(__file__).parent / "manifest.json").read_text()).items() if not k.startswith("_")}
    songs = a.songs or [s for s in manifest if any((DATA / f"{s}{e}").exists() for e in (".mp3", ".wav", ".m4a", ".flac"))]
    out = OUT / a.label
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for s in songs:
        r = run_song(s, manifest.get(s, {}))
        (out / f"{s}.json").write_text(json.dumps(r, ensure_ascii=False))
        rows.append(r["row"])
        print(json.dumps(r["row"], ensure_ascii=False), flush=True)
    (out / "summary.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    old = None
    if a.compare and (OUT / a.compare / "summary.json").exists():
        old = {r["song"]: r for r in json.loads((OUT / a.compare / "summary.json").read_text())}
    print("\n" + table(rows, old))
    print(f"\nsaved {out}")


if __name__ == "__main__":
    main()
