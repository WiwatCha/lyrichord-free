"""RMVPE vs the current sung-melody step (Basic Pitch on the vocal stem + melody_track), on the benchmark's sung songs.
Reference: the singer's pitch (pYIN on the vocal stem, confident frames), same as tests/bench.
    bash tools/mac_dev.sh python tests/melody/rmvpe_bench.py      (or with the env from CLAUDE.md)
Writes backend/data/bench/rmvpe/summary.json"""
import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests/melody")]
from app import pipeline as PL  # noqa: E402
from app import rmvpe as RM  # noqa: E402
import eval_voice as EV  # noqa: E402

DATA, OUT = ROOT / "tests/real", ROOT / "backend/data/bench/rmvpe"
CACHE = ROOT / "backend/data/bench/cache"
SONGS = ["phobrak", "imok", "firstlove", "todao", "kukkhao", "anthem"]


class Ready(Exception):
    pass


def sheet_first(song: str, wd: Path) -> dict:
    got = {}

    def partial(r):
        got["r"] = r
        raise Ready

    try:
        got["r"] = PL.analyze_file(DATA / f"{song}.mp3", wd, lambda m, p: None, on_partial=partial)
    except Ready:
        pass
    return got["r"]


def pyin_ref(song: str, stem: Path) -> np.ndarray:
    cf = CACHE / f"{song}_pyin.json"
    if not cf.exists():
        y, _ = librosa.load(stem, sr=PL.SR, mono=True)
        f0, _, p = librosa.pyin(y, fmin=70, fmax=1100, sr=PL.SR, hop_length=int(PL.SR * 0.02))
        CACHE.mkdir(parents=True, exist_ok=True)
        cf.write_text(json.dumps({"f0": [None if np.isnan(f) else float(f) for f in f0], "p": [float(x) for x in p]}))
    py = json.loads(cf.read_text())
    return np.array([int(round(69 + 12 * np.log2(f / 440))) if f and p > 0.6 else -1 for f, p in zip(py["f0"], py["p"])])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    RM._model()  # load once, not timed
    for song in SONGS:
        wd = OUT / "work" / song
        wd.mkdir(parents=True, exist_ok=True)
        res = sheet_first(song, wd)
        stem = next(wd.glob("stems/*/*/vocals.wav"), None)
        if res.get("melody_src") != "vocals" or stem is None:
            print(song, "skipped:", res.get("melody_src")); continue
        beats, key, tune = np.array(res["beats"]), res["key"], float(res.get("tuning") or 0)
        y, _ = librosa.load(stem, sr=PL.SR, mono=True)
        t = time.time()
        _, vnotes = PL.basic_pitch(y, wd, "vocals_again")
        cur = PL.melody_track(vnotes, beats, mode="voice", key=key)
        t_cur = time.time() - t
        t = time.time()
        tt, f0, _ = RM.pitch(y, PL.SR)
        raw = RM.notes(tt, f0, tune)
        t_rm = time.time() - t
        r1 = PL.tidy_melody(raw, beats, voice=True)
        r2 = PL.melody_track([(n["t0"], n["t1"], n["midi"], 1.0) for n in raw], beats, mode="voice", key=key)
        ref = pyin_ref(song, stem)
        row = {"song": song, "sec_current": round(t_cur, 1), "sec_rmvpe": round(t_rm, 1)}
        for name, mel in (("app", res["notes"]), ("current", cur), ("rmvpe", r1), ("rmvpe_track", r2)):
            e = EV.evaluate(mel, ref)
            row[name] = {k: e[k] for k in ("pitch", "chroma", "voiced", "false_voiced", "notes_per_s", "short<0.15s")}
        rows.append(row)
        print(json.dumps(row), flush=True)
        (OUT / f"{song}_notes.json").write_text(json.dumps({"current": cur, "rmvpe": r1, "rmvpe_track": r2}))
    (OUT / "summary.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
