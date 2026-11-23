"""Bar-aware chord decoding on First Love-style test songs.
PYTHONPATH=backend python3 tests/bar_eval.py  (run node tests/ballad.js && node tests/sheet_song.js && node tests/make_wavs.js first)"""
import json, sys, tempfile
from pathlib import Path
import numpy as np
from app import pipeline as PL, chords as CH

HERE = Path(__file__).parent
_cache = {}
_bp = PL.basic_pitch
def cached_bp(y, wd, tag, **kw):  # same audio -> same Basic Pitch output: run it once per song
    k = (len(y), round(float(np.abs(y[::97]).sum()), 4), tag)
    if k not in _cache:
        _cache[k] = _bp(y, wd, tag, **kw)
    return _cache[k]
PL.basic_pitch = cached_bp

fam = lambda c: "N" if not c or c["root"] < 0 else f'{c["root"]}{CH.base_q(c["q"])}'

def score(r, truth, bar_every=2):
    b = np.array(r["beats"]); ch = r["chords"]
    at = lambda t: ch[max(0, int(np.searchsorted(b, t, side="right") - 1))]
    ok = sum(fam(at(h["t0"] + 0.75 * (h["t1"] - h["t0"]))) == fam(h) for h in truth)
    tchg = [h["t0"] for k, h in enumerate(truth) if k and fam(truth[k - 1]) != fam(h)]
    found = sum(fam(at(t - .3)) != fam(at(t + .3)) for t in tchg)
    achg = [b[i] for i in range(1, len(ch)) if fam(ch[i]) != fam(ch[i - 1]) and ch[i]["root"] >= 0]
    false = sum(1 for t in achg if not any(abs(t - x) < 0.3 for x in tchg) and truth[0]["t0"] < t < truth[-1]["t1"])
    # bar lines: the beat nearest to every bar start of the truth should be beat 1 of the app's bars
    m = r["meter"]; bars = [h["t0"] for k, h in enumerate(truth) if k % bar_every == 0]
    bar_ok = np.mean([((int(np.argmin(np.abs(b - t))) - m["phase"]) % m["bpb"]) == 0 for t in bars])
    return {"chords": f"{ok}/{len(truth)}", "changes": f"{found}/{len(tchg)}", "false": false, "bars": f"{bar_ok:.0%}", "bpm": r["bpm"], "meter": f'{m["num"]}/{m["den"]}', "pct": ok / len(truth)}

def run(wav, truth_file, inject=False):
    truth = json.load(open(HERE / truth_file))
    if inject:  # emulate a perfect downbeat model (what Beat This! aims at)
        sb = truth[0]["t1"] - truth[0]["t0"]; beats = np.arange(truth[0]["t0"] - 4 * sb / 2, truth[-1]["t1"], sb / 2)
        beats = beats[beats >= 0]; downs = [h["t0"] for k, h in enumerate(truth) if k % 2 == 0]
        PL.beat_this_beats = lambda y: (beats, np.array(downs))
    else:
        PL.beat_this_beats = lambda y: None
    r = PL.analyze_file(HERE / wav, Path(tempfile.mkdtemp()), lambda s, p: None)
    return score(r, truth)

def vocab_exact():
    tr = json.load(open(HERE / "vocab_truth.json"))
    PL.beat_this_beats = lambda y: None
    r = PL.analyze_file(HERE / "vocab.wav", Path(tempfile.mkdtemp()), lambda s, p: None)
    b = np.array(r["beats"])
    return sum((lambda c: c["root"] == x["root"] and c["q"] == x["q"])(r["chords"][int(np.searchsorted(b, x["t"], side="right") - 1)]) for x in tr)

SONGS = [("ballad.wav", "ballad_truth.json"), ("ballad_hats.wav", "ballad_truth.json"), ("sheet_song.wav", "sheet_song_truth.json")]
if __name__ == "__main__":
    grid = [("off", False, None, False)] + [(f"W={w}", True, w, False) for w in (1.0, 2.0, 3.0)] + [(f"W={w}+repeat", True, w, True) for w in (1.0, 2.0, 3.0)]
    if len(sys.argv) > 1 and sys.argv[1] == "final":
        grid = [("before", False, None, False), ("now", True, None, True)]
    for name, bar, w, rep in grid:
        PL.BAR_AWARE, PL.REPEAT_VOTE = bar, rep
        if w is not None: CH.P["chgWeak"] = w
        else: CH.P.pop("chgWeak", None) if name == "now" else None
        res = [run(wv, tf) for wv, tf in SONGS]
        inj = run("sheet_song.wav", "sheet_song_truth.json", inject=True)
        print(f"{name:12} " + " | ".join(f'{r["chords"]} chg {r["changes"]} false {r["false"]} bars {r["bars"]} {r["bpm"]}bpm {r["meter"]}' for r in res)
              + f" || with downbeat model: {inj['chords']} false {inj['false']} bars {inj['bars']} || vocab {vocab_exact()}/42")
