"""Regression check: did a code change alter what the app gives for real songs? (~2-3 min, lyrics +~3 min)

    PYTHONPATH=backend python3 tests/regress/regress.py              # compare with the saved results
    PYTHONPATH=backend python3 tests/regress/regress.py --accept     # save this run as the expected results
    PYTHONPATH=backend python3 tests/regress/regress.py --lyrics     # also the lyrics stage (Whisper, de-reverb)
    ... [song ...]                                                    # only these clips
(bash tools/mac_dev.sh regress [...] sets the model paths.)

Clips: a short part of each song in tests/real (not in git), cut once into backend/data/regress/clips/.
Expected results: backend/data/regress/expected/<song>.json (made with --accept; not in git: it holds sung words).
The analysis is repeatable (Demucs --shifts 0, Whisper seeded), so any difference comes from the code:
key, BPM, meter, beats, bars, chords (and the AI suggestions), melody notes, spoken passages, warnings, lyrics.
Time to the sheet is shown next to the expected one; it is a warning only (the machine's load moves it).
Exit status: 0 = same as expected, 1 = something changed, 2 = nothing to compare with."""
import argparse, json, os, sys, tempfile, time, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend")]
os.environ.setdefault("WARMUP", "1")

DATA = Path(os.environ.get("LYRICORD_TESTDATA", ROOT / "tests/real"))
BASE = ROOT / "backend/data/regress"
# song -> (start s, length s): a sung part with the band playing; the anthem's start has its spoken passage (11-27 s)
CLIPS = {"phobrak": (35, 40), "todao": (45, 40), "kukkhao": (40, 40), "anthem": (0, 45),
         "imok": (40, 40), "firstlove": (40, 40), "chopin": (0, 40)}
SLOWER = 1.25  # time warning: more than 25% (and 3 s) slower than expected


def audio_of(song: str) -> Path | None:
    return next((DATA / f"{song}{e}" for e in (".mp3", ".wav", ".m4a", ".flac") if (DATA / f"{song}{e}").exists()), None)


def clip(song: str) -> Path | None:
    out = BASE / "clips" / f"{song}.wav"
    if out.exists():
        return out
    src = audio_of(song)
    if src is None:
        return None
    import librosa
    import soundfile as sf

    a, n = CLIPS[song]
    y, sr = librosa.load(src, sr=44100, mono=False, offset=a, duration=n)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, y.T if y.ndim == 2 else y, sr, subtype="PCM_16")
    return out


def run(song: str, path: Path, lyrics: bool) -> dict:
    from app import pipeline as PL

    class SheetReady(Exception):
        pass

    wd = Path(tempfile.mkdtemp(prefix=f"regress-{song}-"))
    got, t = {}, time.time()

    def partial(r):
        got["sheet"], got["sheet_s"] = r, time.time() - t
        if not lyrics:
            raise SheetReady

    try:
        res = PL.analyze_file(path, wd, lambda m, p: None, on_partial=partial)
        got.setdefault("sheet", res)
        got.setdefault("sheet_s", time.time() - t)
        got["lyrics"] = res.get("lyrics")
        got["total_s"] = time.time() - t
    except SheetReady:
        pass
    finally:
        shutil.rmtree(wd, ignore_errors=True)
    r = {k: v for k, v in got["sheet"].items() if k not in ("lyrics", "lyrics_pending", "title")}
    out = {"song": song, "sheet_s": round(got["sheet_s"], 1), "result": r}
    if lyrics:
        out["lyrics"] = got.get("lyrics")
        out["total_s"] = round(got.get("total_s", got["sheet_s"]), 1)
    return out


def share_same(a: list, b: list) -> float:
    n = max(len(a), len(b))
    return 1.0 if n == 0 else sum(x == y for x, y in zip(a, b)) / n


def compare(new: dict, old: dict) -> list[str]:
    """What differs, in words (empty = the same)."""
    a, b, diff = new["result"], old["result"], []
    for k in ("bpm", "key", "meter", "tuning", "tempo_note", "separated", "melody_src", "melody_engine", "chord_engine",
              "spoken", "warnings", "duration"):
        if a.get(k) != b.get(k):
            diff.append(f"{k}: {b.get(k)} -> {a.get(k)}")
    ba, bb = a.get("beats", []), b.get("beats", [])
    if len(ba) != len(bb):
        diff.append(f"beats: {len(bb)} -> {len(ba)}")
    elif ba != bb:
        moved = [abs(x - y) for x, y in zip(ba, bb) if x != y]
        diff.append(f"beats moved: {len(moved)}/{len(ba)} (max {max(moved) * 1000:.0f} ms)")
    if a.get("bar_starts") != b.get("bar_starts"):
        diff.append(f"bar starts: {len(b.get('bar_starts', []))} -> {len(a.get('bar_starts', []))} differ")
    s = share_same(a.get("chords", []), b.get("chords", []))
    if s < 1:
        diff.append(f"chords: {s:.1%} of beats the same")
    if a.get("alts") != b.get("alts"):
        diff.append(f"chord suggestions: {share_same(a.get('alts') or [], b.get('alts') or []):.1%} of beats the same")
    na, nb = a.get("notes", []), b.get("notes", [])
    if na != nb:
        key = lambda n: (n.get("midi", n.get("pitch")), round(n["t0"], 2), round(n["t1"], 2))
        same = len(set(map(key, na)) & set(map(key, nb)))
        diff.append(f"melody: {len(nb)} -> {len(na)} notes, {same} the same")
    if "lyrics" in new and "lyrics" in old:
        la, lb = new["lyrics"] or {}, old["lyrics"] or {}
        wa = "".join(w["text"] for w in la.get("words", []))
        wb = "".join(w["text"] for w in lb.get("words", []))
        if wa != wb:
            diff.append(f"lyrics: {len(lb.get('words', []))} -> {len(la.get('words', []))} words (text differs)")
        elif [(w["t0"], w["t1"]) for w in la.get("words", [])] != [(w["t0"], w["t1"]) for w in lb.get("words", [])]:
            diff.append("lyrics: same words, times differ")
        if la.get("source") != lb.get("source"):
            diff.append(f"lyrics from: {lb.get('source')} -> {la.get('source')}")
    return diff


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("songs", nargs="*")
    ap.add_argument("--accept", action="store_true", help="save this run as the expected results")
    ap.add_argument("--lyrics", action="store_true", help="also run the lyrics stage")
    a = ap.parse_args()
    exp_dir = BASE / ("expected-lyrics" if a.lyrics else "expected")
    songs = [s for s in (a.songs or CLIPS) if s in CLIPS]
    have = [(s, clip(s)) for s in songs]
    have = [(s, p) for s, p in have if p is not None]
    if not have:
        print(f"no songs found in {DATA} (regress needs the songs in tests/real)")
        return 2
    from app import pipeline as PL

    t = time.time()
    PL.warm_up()
    print(f"models ready in {time.time() - t:.1f} s")
    changed, missing, slow = [], [], []
    print(f"\n{'song':10} {'sheet s':>8} {'expected':>9}  result")
    for s, p in have:
        new = run(s, p, a.lyrics)
        f = exp_dir / f"{s}.json"
        if a.accept:
            exp_dir.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(new, ensure_ascii=False))
            print(f"{s:10} {new['sheet_s']:8.1f} {'':>9}  saved as expected"
                  + (f" (total {new['total_s']:.0f} s)" if a.lyrics else ""), flush=True)
            continue
        if not f.exists():
            missing.append(s)
            print(f"{s:10} {new['sheet_s']:8.1f} {'-':>9}  no expected result (run with --accept)", flush=True)
            continue
        old = json.loads(f.read_text())
        diff = compare(new, old)
        tm = ""
        if new["sheet_s"] > old["sheet_s"] * SLOWER and new["sheet_s"] - old["sheet_s"] > 3:
            slow.append(s)
            tm = f"  (slower: {new['sheet_s'] - old['sheet_s']:+.1f} s)"
        if a.lyrics and "total_s" in old:
            tm += f"  total {new['total_s']:.0f} s (expected {old['total_s']:.0f})"
        print(f"{s:10} {new['sheet_s']:8.1f} {old['sheet_s']:9.1f}  {'CHANGED' if diff else 'same'}{tm}", flush=True)
        for d in diff:
            print(f"{'':31}- {d}")
        if diff:
            changed.append(s)
    print()
    if a.accept:
        print(f"saved {len(have)} expected results in {exp_dir}")
        return 0
    if slow:
        print(f"warning: slower than expected: {', '.join(slow)} (run again on a quiet machine before believing it)")
    if changed:
        print(f"CHANGED: {', '.join(changed)}  (if the change is intended: --accept)")
        return 1
    if missing and len(missing) == len(have):
        return 2
    print(f"all {len(have) - len(missing)} songs the same as expected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
