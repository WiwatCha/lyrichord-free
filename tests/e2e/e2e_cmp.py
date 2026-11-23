"""End-to-end analyze_file on real songs, one backend version at a time, for before/after comparisons.

    PYTHONPATH=backend python3 tests/e2e/e2e_cmp.py <label> <song> [<song> ...]

Songs are audio files in $LYRICORD_TESTDATA (default tests/real), named <song>.wav / .mp3 / .m4a.
They are the user's own files and stay out of git (copyright).
Optional, in the same folder:
  <song>_ref.txt                    reference lyrics -> LCS recall of the transcript
  stems/<song>/{vocals,bass,drums,other}.wav  Demucs stems made earlier -> skips separation (saves minutes)
Writes e2e_<label>_<song>.json next to this script's output dir ($E2E_OUT, default /tmp) and prints one row per song.
Workdirs of songs with reference lyrics are kept (for tests/e2e/relisten_test.py); others are deleted.
Compare timings only between back-to-back runs: machine speed drifts 20-30% over an hour.
"""
import json, logging, os, shutil, sys, tempfile, time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lyrics"))
from app import pipeline as PL  # noqa: E402
from lcs import lcs_recall  # noqa: E402

DATA = Path(os.environ.get("LYRICORD_TESTDATA", Path(__file__).resolve().parents[1] / "real"))
OUT = Path(os.environ.get("E2E_OUT", "/tmp"))
label, songs = sys.argv[1], sys.argv[2:]


def audio_of(song):
    for ext in (".wav", ".mp3", ".m4a", ".flac"):
        if (DATA / f"{song}{ext}").exists():
            return DATA / f"{song}{ext}"
    raise SystemExit(f"no audio for {song} in {DATA}")


for song in songs:
    wd = Path(tempfile.mkdtemp(prefix=f"e2e-{label}-{song}-"))
    stems = DATA / "stems" / song
    if stems.exists():
        d = wd / "stems" / "htdemucs" / song
        d.mkdir(parents=True)
        for k in ("vocals", "bass", "drums", "other"):
            shutil.copy(stems / f"{k}.wav", d / f"{k}.wav")
    msgs = []
    t = time.time()
    r = PL.analyze_file(audio_of(song), wd, lambda m, p: msgs.append((round(time.time() - t), m)))
    ly = r.get("lyrics") or {}
    row = {"sec": round(time.time() - t), "bpm": r["bpm"], "key": r["key"], "meter": r["meter"]["num"],
           "melody_src": r.get("melody_src"), "notes": len(r["notes"]), "tempo_note": r.get("tempo_note"),
           "spoken": r.get("spoken"), "warnings": r.get("warnings"), "lyr_source": ly.get("source"),
           "lyr_words": len(ly.get("words") or []), "instrumental": ly.get("instrumental")}
    ref = DATA / f"{song}_ref.txt"
    hyp = "".join(w["text"] for w in ly.get("words") or []).replace(" ", "")
    if ref.exists():
        R = ref.read_text().replace(" ", "").replace("\n", "")
        row["lyrics_recall"] = lcs_recall(R, hyp)
        row["lyrics_precision"] = lcs_recall(hyp, R) if hyp else 0  # low = invented / looped text
    json.dump({"row": row, "workdir": str(wd), "chords": r["chords"], "beats": r["beats"], "notes": r["notes"],
               "words": ly.get("words"), "msgs": msgs}, open(OUT / f"e2e_{label}_{song}.json", "w"), ensure_ascii=False)
    print(label, song, json.dumps(row, ensure_ascii=False), "workdir", wd, flush=True)
    if not ref.exists():
        shutil.rmtree(wd, ignore_errors=True)
