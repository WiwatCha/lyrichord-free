"""When is the de-reverb pass worth its time? For each sung song: Demucs stem -> de-reverb (timed) -> Whisper on the plain
and on the de-reverbed stem (timed), which one the app picks (_pick_score), LCS recall / precision against <song>_ref.txt,
and cheap reverb measures of the plain stem that could decide beforehand.

    PYTHONPATH=backend python3 tests/lyrics/dereverb_study.py [song ...]     (songs in tests/real, not in git)
Results: backend/data/study/dereverb.jsonl (one line per song)."""
import json, sys, time
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests/lyrics")]
from app import pipeline as PL  # noqa: E402
from lcs import lcs_recall  # noqa: E402

DATA = ROOT / "tests/real"
OUT = ROOT / "backend/data/study"
quiet = lambda *a, **k: None


def reverb_features(v: np.ndarray, sr: int) -> dict:
    """Cheap measures of how wet the vocal stem is (no model): reverb fills the gaps between sung notes."""
    hop = 512
    rms = librosa.feature.rms(y=v, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    top = np.percentile(db, 95)
    act = db > top - 40  # frames where anything of the voice is heard
    # share of heard frames that sit 15-35 dB under the loud ones (tails, not notes)
    tail = float(np.mean((db[act] < top - 15))) if act.any() else 0.0
    # how fast the level falls after a drop: median dB per 100 ms over falling stretches
    d = np.diff(db) / (hop / sr) * 0.1
    fall = d[(d < -1) & act[1:]]
    decay = float(-np.median(fall)) if len(fall) else 0.0
    flat = librosa.feature.spectral_flatness(y=v, hop_length=hop)[0]
    return {"tail_share": round(tail, 3), "decay_db_per_100ms": round(decay, 2),
            "flatness_med": round(float(np.median(flat[act[:len(flat)]])), 4)}


def score(words, ref: str | None):
    hyp = "".join(w["text"] for w in words).replace(" ", "")
    if not ref:
        return {}
    return {"recall": lcs_recall(ref, hyp), "precision": lcs_recall(hyp, ref) if hyp else 0}


def study(song: str) -> dict:
    audio = next(DATA / f"{song}{e}" for e in (".mp3", ".wav", ".m4a") if (DATA / f"{song}{e}").exists())
    wd = OUT / song
    wd.mkdir(parents=True, exist_ok=True)
    t = time.time()
    stems = PL.separate(audio, wd, quiet)
    row = {"song": song, "demucs_s": round(time.time() - t, 1)}
    voice = stems["vocals"]
    y = PL.load_mono(audio)
    harm = stems["bass"] + stems["other"]
    spoken = PL.spoken_passages(voice, harm)
    share = float(np.sum(voice ** 2) / max(1e-9, np.sum(y ** 2)))
    row.update(reverb_features(voice, PL.SR), voice_share=round(share, 3))
    model = PL._whisper_model()
    y16 = librosa.resample(np.asarray(voice, np.float32), orig_sr=PL.SR, target_sr=16000)
    pres = PL.vocal_presence(model, y16, share)
    row["lang"] = pres.get("lang")
    if not pres["sung"]:
        row["instrumental"] = True
        return row
    reff = DATA / f"{song}_ref.txt"
    ref = reff.read_text().replace(" ", "").replace("\n", "") if reff.exists() else None
    (wd / "vocals_dry.wav").unlink(missing_ok=True)
    t = time.time()
    dry = PL.dereverb_vocals(voice, wd, quiet)
    row["dereverb_s"] = round(time.time() - t, 1)
    row["removed_share"] = round(1 - float(np.sum(dry ** 2) / max(1e-9, np.sum(voice[:len(dry)] ** 2))), 3)
    for name, v16 in (("plain", y16), ("dry", librosa.resample(np.asarray(dry, np.float32), orig_sr=PL.SR, target_sr=16000))):
        t = time.time()
        r = PL._transcribe(model, v16, pres.get("lang"), name, quiet)
        words = PL.clean_words(r["words"], None, spoken)
        row[name] = {"s": round(time.time() - t, 1), "pick": list(PL._pick_score(r)), "loops": round(r["loops"], 3),
                     "cut": r["cut"], "words": len(words), **score(words, ref)}
    row["winner"] = "dry" if _pick(row) else "plain"
    return row


def _pick(row):  # same rule as transcribe_lyrics
    return tuple(row["dry"]["pick"]) > tuple(row["plain"]["pick"])


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    songs = sys.argv[1:] or ["todao", "phobrak", "anthem", "imok", "kukkhao"]
    with open(OUT / "dereverb.jsonl", "a") as f:
        for s in songs:
            row = study(s)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
