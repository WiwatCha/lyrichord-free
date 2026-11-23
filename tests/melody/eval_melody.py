"""Melody accuracy on a real piano recording against its score (MIDI).

    PYTHONPATH=backend python3 tests/melody/eval_melody.py AUDIO.wav SCORE.mid [--track upper] [--variant name]

Reference: the top note of the melody track (right hand) at each moment, its times warped onto the recording
with DTW on chroma (the pianist plays with rubato and a different tempo than the MIDI).
Metrics (every 20 ms where the reference has a note):
  pitch  = estimated MIDI note exactly right      chroma = right note name, any octave
  voiced = the estimate has a note at all
and note-level F1 (onset within 100 ms and same pitch), plus notes per second (fragmentation).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import pretty_midi

HOP = 0.05


def warp_fn(audio: np.ndarray, sr: int, pm: pretty_midi.PrettyMIDI):
    """midi time -> audio time, from DTW on chroma (both hands)."""
    ca = librosa.feature.chroma_cqt(y=audio, sr=sr, hop_length=int(sr * HOP))
    cm = pm.get_chroma(fs=1 / HOP)
    cm = cm / (cm.max(0, keepdims=True) + 1e-9) + 1e-3  # silence: no all-zero columns (cosine)
    ca = ca / (ca.max(0, keepdims=True) + 1e-9) + 1e-3
    _, wp = librosa.sequence.dtw(X=cm, Y=ca, metric="cosine")
    wp = wp[::-1]
    tm, ta = wp[:, 0] * HOP, wp[:, 1] * HOP
    # one audio time per midi time (median over the path's vertical runs), then monotone
    um = np.unique(tm)
    ua = np.array([np.median(ta[tm == u]) for u in um])
    ua = np.maximum.accumulate(ua)
    return lambda t: np.interp(t, um, ua)


def reference(pm: pretty_midi.PrettyMIDI, track: str, warp, dt=0.02):
    inst = next(i for i in pm.instruments if i.name == track)
    notes = [(warp(n.start), warp(n.end), n.pitch) for n in inst.notes]
    end = max(e for _, e, _ in notes)
    ref = np.full(int(end / dt) + 1, -1)
    for s, e, p in notes:
        a, b = int(s / dt), max(int(s / dt) + 1, int(e / dt))
        ref[a:b] = np.maximum(ref[a:b], p)
    onsets = sorted(notes)
    return ref, onsets


def frames_of(mel: list[dict], n: int, dt=0.02):
    est = np.full(n, -1)
    for m in mel:
        est[int(m["t0"] / dt):int(m["t1"] / dt)] = m["midi"]
    return est


def score(mel: list[dict], ref: np.ndarray, ref_notes, dt=0.02) -> dict:
    mel = [m for m in mel if m["t0"] < len(ref) * dt]
    est = frames_of(mel, len(ref), dt)
    v = ref >= 0
    hit = (est == ref) & v
    chroma = (est >= 0) & v & ((est - ref) % 12 == 0)
    # note level: each reference onset matched once by an estimated onset within 100 ms, same pitch
    used = set()
    tp = 0
    est_on = sorted((m["t0"], m["midi"]) for m in mel)
    times = np.array([t for t, _ in est_on]) if est_on else np.zeros(0)
    for s, _, p in ref_notes:
        lo, hi = np.searchsorted(times, s - 0.1), np.searchsorted(times, s + 0.1)
        for k in range(lo, hi):
            if k not in used and est_on[k][1] == p:
                used.add(k)
                tp += 1
                break
    prec = tp / max(1, len(mel))
    rec = tp / max(1, len(ref_notes))
    dur = len(ref) * dt
    return {"pitch": round(hit.sum() / v.sum(), 3), "chroma": round(chroma.sum() / v.sum(), 3),
            "voiced": round(((est >= 0) & v).sum() / v.sum(), 3), "false_voiced": round(((est >= 0) & ~v).sum() / max(1, (~v).sum()), 3),
            "noteF1": round(2 * prec * rec / max(1e-9, prec + rec), 3), "notes_per_s": round(len(mel) / dur, 2), "ref_notes_per_s": round(len(ref_notes) / dur, 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("midi")
    ap.add_argument("--track", default="upper")
    ap.add_argument("--cache", default="/tmp/mel/cache")
    ap.add_argument("--until", type=float, default=0, help="score only the first N seconds (where the alignment holds)")
    ap.add_argument("--key", default="", help="tonic,q e.g. 3, for Eb major; 4,m for E minor")
    a = ap.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
    from app import pipeline as PL

    y, sr = librosa.load(a.audio, sr=PL.SR, mono=True)
    pm = pretty_midi.PrettyMIDI(a.midi)
    warp = warp_fn(y, sr, pm)
    ref, ref_notes = reference(pm, a.track, warp)
    if a.until:
        ref = ref[:int(a.until / 0.02)]
        ref_notes = [r for r in ref_notes if r[0] < a.until]
    key = None
    if a.key:
        r, q = (a.key.split(",") + [""])[:2]
        key = {"root": int(r), "q": q}
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    cf = cache / (Path(a.audio).stem + ".notes.json")
    if cf.exists():
        notes = [tuple(n) for n in json.loads(cf.read_text())]
    else:
        _, notes = PL.basic_pitch(y, cache, "eval")
        notes = [(float(s), float(e), int(p), float(v)) for s, e, p, v, *_ in notes]
        cf.write_text(json.dumps(notes))
    beats, bpm, *_ = PL.track_beats(y)
    res = {}
    res["current"] = score(PL.melody_line(notes, lo=60, min_amp=0.3, prefer="high"), ref, ref_notes)
    if hasattr(PL, "melody_track"):
        res["new"] = score(PL.melody_track(notes, beats=beats, mode="inst", key=key), ref, ref_notes)
        res["new-nokey"] = score(PL.melody_track(notes, beats=beats, mode="inst"), ref, ref_notes)
        res["new-nogrid"] = score(PL.melody_track(notes, mode="inst", key=key), ref, ref_notes)
    for k, v in res.items():
        print(f"{k:8s} {v}")


if __name__ == "__main__":
    main()
