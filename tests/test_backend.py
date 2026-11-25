"""Backend tests on synthetic audio with known answers.  Run from the project root:
    node tests/make_wavs.js && PYTHONPATH=backend python3 tests/test_backend.py
"""
import json, tempfile, time
from pathlib import Path
import numpy as np
from app import pipeline as PL, chords as CH

HERE = Path(__file__).parent

def demo():
    r = PL.analyze_file(HERE / "demo.wav", Path(tempfile.mkdtemp()), lambda s, p: None)
    bars = []
    for i, c in enumerate(r["chords"]):
        if (i - r["phase"]) % 4 == 0: bars.append([])
        if bars: bars[-1].append(CH.name(c, r["flats"]))
    print("demo  bpm", r["bpm"], "key", CH.name({**r["key"], "bass": -1}), "separated", r["separated"])
    print("      " + " | ".join(" ".join(b) for b in bars[:8]))
    assert abs(r["bpm"] - 100) <= 2

def vocab():
    r = PL.analyze_file(HERE / "vocab.wav", Path(tempfile.mkdtemp()), lambda s, p: None)
    truth = json.loads((HERE / "vocab_truth.json").read_text()); b = np.array(r["beats"]); ok = okb = 0
    for x in truth:
        c = r["chords"][int(np.searchsorted(b, x["t"], side="right") - 1)]
        ok += c["root"] == x["root"] and c["q"] == x["q"]
        okb += c["root"] == x["root"] and CH.QS[CH.QI[c["q"]]]["base"] == CH.QS[CH.QI[x["q"]]]["base"]
    print(f"vocab advance {ok}/{len(truth)}  basic {okb}/{len(truth)}")
    assert okb >= len(truth) - 2

def api():
    import os; os.environ["DATA_DIR"] = tempfile.mkdtemp()
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app, client=("127.0.0.1", 50000))  # the app opened on this computer (another device needs the key)
    assert c.get("/api/health").json()["ok"]
    far = TestClient(app, client=("192.168.1.20", 50000))  # a phone on the Wi-Fi without the key
    assert far.get("/api/library").status_code == 401 and far.get("/api/health").status_code == 200
    j = c.post("/api/jobs/upload", files={"file": ("demo.wav", (HERE / "demo.wav").open("rb"), "audio/wav")}).json()
    for _ in range(240):
        j = c.get(f"/api/jobs/{j['id']}").json()
        if j["status"] in ("done", "error"): break
        time.sleep(0.5)
    assert j["status"] == "done", j
    assert c.get(j["audio_url"]).status_code == 200
    print("api   upload -> done, audio served")

if __name__ == "__main__":
    demo(); vocab(); api(); print("all backend tests passed")
