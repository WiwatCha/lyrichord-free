"""Backend on the synthetic ballad (run tests/ballad.js first). PYTHONPATH=backend python3 tests/ballad_backend.py"""
import json, sys, tempfile
from pathlib import Path
import numpy as np
from app import pipeline as PL
HERE = Path(__file__).parent
truth = json.load(open(HERE / "ballad_truth.json"))
def fam(c):
    if not c or c["root"] < 0: return "N"
    q = c.get("q", "")
    return f'{c["root"]}{"m" if (q.startswith("m") and not q.startswith("maj")) or q in ("dim", "m7b5") else ""}'
def score(r):
    b = np.array(r["beats"]); ch = r["chords"]
    at = lambda t: ch[max(0, int(np.searchsorted(b, t, side="right") - 1))]
    ok = sum(fam(at((h["t0"] + h["t1"]) / 2)) == fam({**h, "q": "m" if h["q"] == "m" else ""}) for h in truth)
    chg = [k for k in range(1, len(truth)) if fam(truth[k - 1]) != fam(truth[k])]
    found = sum(fam(at(truth[k]["t0"] - .3)) != fam(at(truth[k]["t0"] + .3)) for k in chg)
    return {"bpm": r["bpm"], "chordOk": f"{ok}/{len(truth)}", "changesFound": f"{found}/{len(chg)}", "pct": round(100 * ok / len(truth))}
if __name__ == "__main__":
    for tag in ("", "_hats"):
        r = PL.analyze_file(HERE / f"ballad{tag}.wav", Path(tempfile.mkdtemp()), lambda s, p: None)
        print(f"backend{tag}:", score(r), "key", r["key"])


def doubled_grid_check():
    """A grid counted in eighths (~180 BPM) must come back as the real quarter-note beats, on the chord changes."""
    y = PL.load_mono(HERE / "ballad.wav")
    post, _ = PL.basic_pitch(y, Path(tempfile.mkdtemp()), "g")
    sb = 60 / 90
    true = 1.5 + sb * np.arange(0, 220)
    for start in (0, 1):  # eighth-note grid starting on the beat, or on the 'and'
        eighths = 1.5 - sb / 2 * start + sb / 2 * np.arange(0, 440)
        g = PL.refine_grid(eighths, post, 1.0, len(y) / PL.SR)
        bpm = 60 / np.median(np.diff(g))
        off = np.median(np.abs(g[:40, None] - true[None, :]).min(1))
        print(f"eighth grid (start {'and' if start else 'beat'}): -> {bpm:.0f} BPM, median distance to true beats {off:.3f}s")
        assert 85 < bpm < 95 and off < 0.05


if __name__ == "__main__":
    doubled_grid_check()
