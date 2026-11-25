"""Where the time to the sheet goes: wall time of each stage of analyze_file, per song, up to the sheet (no lyrics).

    PYTHONPATH=backend python3 tests/speed/profile_sheet.py [song ...]       (songs in tests/real, not in git)
Models are warmed up first (as the app does at start). Stages are timed by wrapping the pipeline's functions;
a stage running inside another is shown on its own line too (Demucs includes writing the WAV it reads)."""
import sys, tempfile, time, shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend")]
from app import pipeline as PL, chordnet as CN, chords as CH  # noqa: E402

DATA = ROOT / "tests/real"
T = defaultdict(float)
N = defaultdict(int)


def timed(mod, name, label=None):
    f = getattr(mod, name)

    def w(*a, **k):
        t = time.perf_counter()
        try:
            return f(*a, **k)
        finally:
            key = label or name
            if name == "basic_pitch":
                key = f"basic_pitch[{a[2]}]"
            T[key] += time.perf_counter() - t
            N[key] += 1
    setattr(mod, name, w)


for n in ("load_mono", "input_warnings", "separate", "spoken_passages", "track_beats", "beat_this_beats",
          "estimate_tuning_segments", "basic_pitch", "refine_grid", "beat_profiles", "lyrics_presence", "sung_melody",
          "melody_line", "tidy_melody", "chord_alternatives", "start_rmvpe", "_run_demucs"):
    if hasattr(PL, n):
        timed(PL, n)
timed(CN, "beat_log_probs", "btc")
timed(CH, "decode_chords")
timed(CH, "decode_btc")


class Ready(Exception):
    pass


def run(song):
    audio = next(DATA / f"{song}{e}" for e in (".mp3", ".wav", ".m4a") if (DATA / f"{song}{e}").exists())
    wd = Path(tempfile.mkdtemp(prefix=f"prof-{song}-"))
    T.clear(); N.clear()
    t = time.perf_counter()

    def partial(r):
        raise Ready
    try:
        PL.analyze_file(audio, wd, lambda m, p: None, on_partial=partial)
    except Ready:
        pass
    total = time.perf_counter() - t
    shutil.rmtree(wd, ignore_errors=True)
    return total, dict(T), dict(N)


if __name__ == "__main__":
    songs = sys.argv[1:] or ["phobrak", "todao", "kukkhao"]
    t = time.perf_counter(); PL.warm_up(); print(f"warm-up {time.perf_counter() - t:.1f} s")
    rows = {s: run(s) for s in songs}
    keys = sorted({k for _, d, _ in rows.values() for k in d}, key=lambda k: -sum(rows[s][1].get(k, 0) for s in songs))
    print(f"\n{'stage':28}" + "".join(f"{s:>10}" for s in songs))
    for k in keys:
        print(f"{k:28}" + "".join(f"{rows[s][1].get(k, 0):10.1f}" for s in songs))
    print(f"{'TOTAL to sheet':28}" + "".join(f"{rows[s][0]:10.1f}" for s in songs))
