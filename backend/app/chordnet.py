"""Chord probabilities from BTC (Bi-directional Transformer for Chord recognition, Park et al., ISMIR 2019, MIT licence).

Two trained models: maj/min (25 classes) and a large vocabulary (170: maj, min, dim, aug, 6, m6, 7, maj7, m7, mmaj7,
dim7, m7b5, sus2, sus4 on 12 roots + N + X). Returns frame log-probabilities that the pipeline averages per beat.
Optional: without torch or the weights the app keeps its own Basic Pitch + template decoder.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np

MODEL_DIR = Path(os.environ.get("BTC_DIR", "/opt/models/btc"))
SR, INST_LEN, NBINS, BPO, HOP, STEPS = 22050, 10.0, 144, 24, 2048, 108
FRAME = INST_LEN / STEPS  # seconds per output frame (~0.093 s)
_CFG = dict(feature_size=144, timestep=108, input_dropout=0.2, layer_dropout=0.2, attention_dropout=0.2,
            relu_dropout=0.2, num_layers=8, num_heads=4, hidden_size=128, total_key_depth=128,
            total_value_depth=128, filter_size=128, loss="ce", probs_out=True)
ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
LARGE_Q = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4"]
# BTC quality -> the app's quality names (chord_vocab.json)
APP_Q = {"maj": "", "min": "m", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6", "min7": "m7", "minmaj7": "m",
         "maj7": "maj7", "7": "7", "dim7": "dim7", "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4"}
_M = {}


def available() -> bool:
    return (os.environ.get("USE_BTC", "1") != "0" and importlib.util.find_spec("torch") is not None
            and (MODEL_DIR / "btc_model.pt").exists() and (MODEL_DIR / "btc_model_large_voca.pt").exists())


def _load(large: bool):
    if large not in _M:
        import torch
        from .btc.btc_model import BTC_model
        n = 170 if large else 25
        m = BTC_model(config=dict(_CFG, num_chords=n))
        ck = torch.load(str(MODEL_DIR / ("btc_model_large_voca.pt" if large else "btc_model.pt")), map_location="cpu", weights_only=False)
        m.load_state_dict(ck["model"]); m.eval()
        _M[large] = (m, ck["mean"], ck["std"])
    return _M[large]


def features(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    win, parts, cur = int(SR * INST_LEN), [], 0
    while len(y) > cur + win:
        parts.append(librosa.cqt(y[cur:cur + win], sr=SR, n_bins=NBINS, bins_per_octave=BPO, hop_length=HOP)); cur += win
    parts.append(librosa.cqt(y[cur:], sr=SR, n_bins=NBINS, bins_per_octave=BPO, hop_length=HOP))
    return np.log(np.abs(np.concatenate(parts, axis=1)) + 1e-6).T  # (frames, 144)


def log_probs(feat: np.ndarray, large: bool) -> np.ndarray:
    """(frames, classes) log-probabilities."""
    import torch
    m, mean, std = _load(large)
    x = (feat - mean) / std
    T = len(x); pad = (-T) % STEPS
    x = np.pad(x, ((0, pad), (0, 0)))
    out = []
    with torch.no_grad():
        t = torch.tensor(x, dtype=torch.float32).unsqueeze(0)
        for k in range(len(x) // STEPS):
            h, _ = m.self_attn_layers(t[:, k * STEPS:(k + 1) * STEPS, :])
            out.append(torch.log_softmax(m.output_layer(h), -1)[0].numpy())
    return np.concatenate(out)[:T]


def frame_log_probs(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Log-probabilities of both models per frame (no beats needed: the app works these out while Demucs runs)."""
    feat = features(y, sr)
    return log_probs(feat, False), log_probs(feat, True)


def beat_log_probs(y: np.ndarray, sr: int, beats: np.ndarray, dur: float, frames=None):
    """Per-beat mean log-probabilities of both models: (majmin (B,25), large (B,170)).
    frames: frame_log_probs(y, sr) worked out before (the same numbers)."""
    lp_s, lp_l = frames if frames is not None else frame_log_probs(y, sr)
    t = (np.arange(len(lp_s)) + 0.5) * FRAME
    out_s, out_l = [], []
    for i, t0 in enumerate(beats):
        t1 = beats[i + 1] if i + 1 < len(beats) else min(dur, t0 + 0.6)
        sel = (t >= t0) & (t < t1)
        if not sel.any():
            sel = np.zeros(len(t), bool); sel[min(len(t) - 1, int(t0 / FRAME))] = True
        out_s.append(lp_s[sel].mean(0)); out_l.append(lp_l[sel].mean(0))
    return np.array(out_s), np.array(out_l)


def small_label(k: int) -> tuple[int, str] | None:
    """majmin class -> (root, 'm' or '') ; 24 = N."""
    return None if k == 24 else (k // 2, "m" if k % 2 else "")


def large_label(k: int) -> tuple[int, str] | None:
    """large class -> (root, app quality); 168 = X, 169 = N."""
    return None if k >= 168 else (k // 14, APP_Q[LARGE_Q[k % 14]])
