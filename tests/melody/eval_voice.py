"""Sung melody check without a score: pYIN (a monophonic pitch tracker) on the separated vocal stem is the
reference where it is confident; compares melody lines frame by frame (20 ms) and counts fragmentation.
    PYTHONPATH=backend python3 tests/melody/eval_voice.py NOTES.json PYIN.json [key_root,q]"""
import json
import sys

import numpy as np

sys.path.insert(0, "backend")
from app import pipeline as PL  # noqa: E402
from app import chords as CH  # noqa: E402


def frames(mel, n, dt=0.02):
    est = np.full(n, -1)
    for m in mel:
        est[int(m["t0"] / dt):int(m["t1"] / dt)] = m["midi"]
    return est


def evaluate(mel, ref, key=None):
    est = frames(mel, len(ref))
    v = ref >= 0
    durs = np.array([m["t1"] - m["t0"] for m in mel]) if mel else np.zeros(1)
    r = {"pitch": round(float(((est == ref) & v).sum() / v.sum()), 3),
         "within1": round(float(((np.abs(est - ref) <= 1) & (est >= 0) & v).sum() / v.sum()), 3),
         "chroma": round(float((((est - ref) % 12 == 0) & (est >= 0) & v).sum() / v.sum()), 3),
         "voiced": round(float(((est >= 0) & v).sum() / v.sum()), 3),
         "false_voiced": round(float(((est >= 0) & ~v).sum() / max(1, (~v).sum())), 3),
         "notes_per_s": round(len(mel) / (len(ref) * 0.02), 2), "short<0.15s": round(float((durs < 0.15).mean()), 3)}
    if key:
        mask = CH.scale_mask((key["root"] + (3 if key["q"] == "m" else 0)) % 12)
        w = sum((m["t1"] - m["t0"]) for m in mel)
        r["in_key"] = round(sum((m["t1"] - m["t0"]) for m in mel if (mask >> (m["midi"] % 12)) & 1) / max(1e-9, w), 3)
    return r


if __name__ == "__main__":
    notes = [tuple(n) for n in json.load(open(sys.argv[1]))]
    py = json.load(open(sys.argv[2]))
    ref = np.array([int(round(69 + 12 * np.log2(f / 440))) if f and p > 0.6 else -1 for f, p in zip(py["f0"], py["p"])])
    key = None
    if len(sys.argv) > 3:
        r, q = (sys.argv[3].split(",") + [""])[:2]
        key = {"root": int(r), "q": q}
    print("reference voiced share", round(float((ref >= 0).mean()), 3))
    print("current ", evaluate(PL.melody_line(notes), ref, key))
    if hasattr(PL, "melody_track"):
        print("new     ", evaluate(PL.melody_track(notes, mode="voice", key=key), ref, key))
        print("new-nokey", evaluate(PL.melody_track(notes, mode="voice"), ref, key))
