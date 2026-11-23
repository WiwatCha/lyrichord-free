"""Backend auto-tuning must never make chords worse (run: PYTHONPATH=backend python3 tests/tuning_backend_test.py)."""
import tempfile
from pathlib import Path
import numpy as np, soundfile as sf
from scipy.signal import resample
from app import pipeline as PL, chords as CH

HERE = Path(__file__).parent
TRUTH = "C2 G/B Am7 Fmaj7 C Gsus4 G7 C".split()
y, sr = sf.read(HERE / "demo.wav")
if y.ndim > 1:
    y = y.mean(1)
det = lambda c, a: resample(a, int(len(a) / 2 ** (c / 1200)))
drift = det(0, y).copy(); third = det(45, y)[: len(y) // 3]; drift[: len(third)] = third
cases = {"in tune": y, "+40c": det(40, y), "-48c": det(-48, y), "drift": drift}

def score(r):
    ch, ok, n = r["chords"], 0, 0
    for b in range(16):
        i = 1 + b * 4
        if i + 3 >= len(ch):
            break
        n += 1
        ok += any(CH.name(ch[k], False, "advance") == TRUTH[b % 8] for k in (i, i + 1))
    return ok, n

for name, a in cases.items():
    p = Path(tempfile.mkdtemp()) / "x.wav"; sf.write(p, a, sr)
    off = PL.analyze_file(p, Path(tempfile.mkdtemp()), lambda s, q: None, tune="off")
    auto = PL.analyze_file(p, Path(tempfile.mkdtemp()), lambda s, q: None)
    so, sa = score(off), score(auto)
    print(f"{name:8} est {auto['tuning_est']:4}c -> applied {auto['tuning']:4}c ({auto['tune_note']:8}) | bars correct: off {so[0]}/{so[1]}  auto {sa[0]}/{sa[1]}")
    assert sa[0] >= so[0], name
print("backend tuning safety ok")
