"""RMVPE: vocal pitch from polyphonic audio (Wei et al. 2023, "RMVPE: A Robust Model for Vocal Pitch Estimation
in Polyphonic Music"). Network and decoding follow RVC's infer/rmvpe.py (MIT, RVC-Project); weights rmvpe.pt from
huggingface.co/lj1995/VoiceConversionWebUI (MIT); original RMVPE code Apache-2.0.

    pitch(y, sr) -> (times every 10 ms, f0 in Hz, 0 = unvoiced)

Weights: RMVPE_CKPT, else rmvpe.pt next to the Beat This! checkpoint (the models folder).
SHA-256 6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193 (181 MB).
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SR, HOP = 16000, 160  # 10 ms frames


class BiGRU(nn.Module):
    def __init__(self, i, h, n):
        super().__init__()
        self.gru = nn.GRU(i, h, num_layers=n, batch_first=True, bidirectional=True)

    def forward(self, x):
        return self.gru(x)[0]


class ConvBlockRes(nn.Module):
    def __init__(self, cin, cout, momentum=0.01):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(cin, cout, (3, 3), (1, 1), (1, 1), bias=False), nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU(),
            nn.Conv2d(cout, cout, (3, 3), (1, 1), (1, 1), bias=False), nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU())
        if cin != cout:
            self.shortcut = nn.Conv2d(cin, cout, (1, 1))

    def forward(self, x):
        return self.conv(x) + (self.shortcut(x) if hasattr(self, "shortcut") else x)


class ResEncoderBlock(nn.Module):
    def __init__(self, cin, cout, kernel_size, n_blocks=1, momentum=0.01):
        super().__init__()
        self.conv = nn.ModuleList([ConvBlockRes(cin, cout, momentum)] + [ConvBlockRes(cout, cout, momentum) for _ in range(n_blocks - 1)])
        self.kernel_size = kernel_size
        if kernel_size is not None:
            self.pool = nn.AvgPool2d(kernel_size=kernel_size)

    def forward(self, x):
        for c in self.conv:
            x = c(x)
        return (x, self.pool(x)) if self.kernel_size is not None else x


class Encoder(nn.Module):
    def __init__(self, cin, in_size, n_enc, kernel_size, n_blocks, cout=16, momentum=0.01):
        super().__init__()
        self.bn = nn.BatchNorm2d(cin, momentum=momentum)
        self.layers = nn.ModuleList()
        for _ in range(n_enc):
            self.layers.append(ResEncoderBlock(cin, cout, kernel_size, n_blocks, momentum=momentum))
            cin, cout, in_size = cout, cout * 2, in_size // 2
        self.out_channel = cout

    def forward(self, x):
        skips = []
        x = self.bn(x)
        for layer in self.layers:
            t, x = layer(x)
            skips.append(t)
        return x, skips


class Intermediate(nn.Module):
    def __init__(self, cin, cout, n_inters, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList([ResEncoderBlock(cin, cout, None, n_blocks, momentum)] +
                                    [ResEncoderBlock(cout, cout, None, n_blocks, momentum) for _ in range(n_inters - 1)])

    def forward(self, x):
        for layer in self.layers:
            x = layer(x)
        return x


class ResDecoderBlock(nn.Module):
    def __init__(self, cin, cout, stride, n_blocks=1, momentum=0.01):
        super().__init__()
        pad = (0, 1) if stride == (1, 2) else (1, 1)
        self.conv1 = nn.Sequential(nn.ConvTranspose2d(cin, cout, (3, 3), stride, (1, 1), output_padding=pad, bias=False),
                                   nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU())
        self.conv2 = nn.ModuleList([ConvBlockRes(cout * 2, cout, momentum)] + [ConvBlockRes(cout, cout, momentum) for _ in range(n_blocks - 1)])

    def forward(self, x, skip):
        x = torch.cat((self.conv1(x), skip), dim=1)
        for c in self.conv2:
            x = c(x)
        return x


class Decoder(nn.Module):
    def __init__(self, cin, n_dec, stride, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList()
        for _ in range(n_dec):
            self.layers.append(ResDecoderBlock(cin, cin // 2, stride, n_blocks, momentum))
            cin //= 2

    def forward(self, x, skips):
        for i, layer in enumerate(self.layers):
            x = layer(x, skips[-1 - i])
        return x


class DeepUnet(nn.Module):
    def __init__(self, kernel_size, n_blocks, en_de_layers=5, inter_layers=4, cin=1, en_out=16):
        super().__init__()
        self.encoder = Encoder(cin, 128, en_de_layers, kernel_size, n_blocks, en_out)
        self.intermediate = Intermediate(self.encoder.out_channel // 2, self.encoder.out_channel, inter_layers, n_blocks)
        self.decoder = Decoder(self.encoder.out_channel, en_de_layers, kernel_size, n_blocks)

    def forward(self, x):
        x, skips = self.encoder(x)
        return self.decoder(self.intermediate(x), skips)


class E2E(nn.Module):
    def __init__(self, n_blocks=4, n_gru=1, kernel_size=(2, 2)):
        super().__init__()
        self.unet = DeepUnet(kernel_size, n_blocks)
        self.cnn = nn.Conv2d(16, 3, (3, 3), padding=(1, 1))
        self.fc = nn.Sequential(BiGRU(3 * 128, 256, n_gru), nn.Linear(512, 360), nn.Dropout(0.25), nn.Sigmoid())

    def forward(self, mel):
        x = self.cnn(self.unet(mel.transpose(-1, -2).unsqueeze(1))).transpose(1, 2).flatten(-2)
        return self.fc(x)


_MODEL = None
CENTS = np.pad(20 * np.arange(360) + 1997.3794084376191, (4, 4))


def ckpt_path() -> Path:
    if os.environ.get("RMVPE_CKPT"):
        return Path(os.environ["RMVPE_CKPT"])
    return Path(os.environ.get("BEAT_THIS_CKPT", "/opt/models/beat_this-final0.ckpt")).parent / "rmvpe.pt"


def device() -> str:
    d = os.environ.get("RMVPE_DEVICE")
    if d:
        return d
    return "cpu"  # M3 Max, 4.5-min stem: CPU 4.8 s, MPS 17.3 s (its GRU is slow there), same pitch


def _model():
    global _MODEL
    if _MODEL is None:
        import librosa

        m = E2E()
        m.load_state_dict(torch.load(ckpt_path(), map_location="cpu", weights_only=True))
        m.eval()
        mel = librosa.filters.mel(sr=SR, n_fft=1024, n_mels=128, fmin=30, fmax=8000, htk=True)
        _MODEL = (m.to(device()), torch.from_numpy(mel).float())
    return _MODEL


def _mel(y: np.ndarray, basis: torch.Tensor) -> torch.Tensor:
    a = torch.from_numpy(np.ascontiguousarray(y, dtype=np.float32))[None]
    spec = torch.stft(a, n_fft=1024, hop_length=HOP, win_length=1024, window=torch.hann_window(1024), center=True, return_complex=True).abs()
    return torch.log(torch.clamp(basis @ spec, min=1e-5))  # (1, 128, frames)


def _decode(sal: np.ndarray, thred: float = 0.03) -> np.ndarray:
    c = np.argmax(sal, axis=1)
    sp = np.pad(sal, ((0, 0), (4, 4)))
    idx = c[:, None] + np.arange(9)[None, :]
    w = np.take_along_axis(sp, idx, axis=1)
    cents = (w * CENTS[idx]).sum(1) / np.maximum(w.sum(1), 1e-9)
    cents[sal.max(1) <= thred] = 0
    f0 = 10 * 2 ** (cents / 1200)
    f0[cents == 0] = 0
    return f0


@torch.no_grad()
def pitch(y: np.ndarray, sr: int, thred: float = 0.03, chunk_s: float = 32.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """times, f0 (Hz, 0 = no voice) and the model's confidence (0-1), every 10 ms. Long audio goes through in overlapping chunks (memory stays flat)."""
    import librosa

    if sr != SR:
        y = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=SR)
    m, basis = _model()
    mel = _mel(y, basis)
    n = mel.shape[-1]
    step, ov = int(chunk_s * 100) // 32 * 32, 128  # frames
    sal = np.zeros((n, 360), np.float32)
    for a in range(0, n, step):
        lo, hi = max(0, a - ov), min(n, a + step + ov)
        x = mel[..., lo:hi]
        pad = 32 * ((x.shape[-1] - 1) // 32 + 1) - x.shape[-1]
        x = F.pad(x, (0, pad))
        out = m(x.to(device())).squeeze(0).float().cpu().numpy()
        sal[a:min(n, a + step)] = out[a - lo:a - lo + min(step, n - a)]
    f0 = _decode(sal, thred)
    return np.arange(n) * HOP / SR, f0, sal.max(1)


def notes(t: np.ndarray, f0: np.ndarray, tuning_cents: float = 0.0, min_len: float = 0.12, hold: int = 8) -> list[dict]:
    """f0 contour -> sung notes: a new note once another semitone holds for 80 ms (vibrato and slides stay inside),
    notes under 0.12 s dropped. Chosen on 6 sung songs (tests/melody/rmvpe_bench.py, 2026-11-23): agreement with
    the singer 87.7%, short notes 12% (Basic Pitch line: 84.9%, 13%); hold 5 / 0.08 s gave 88.6% but 21% blips."""
    from scipy.ndimage import median_filter

    voiced = f0 > 0
    m = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440) - tuning_cents / 100, np.nan)
    sm = m.copy()
    sm[voiced] = median_filter(m[voiced], size=5, mode="nearest") if voiced.any() else m[voiced]
    out, cur, start, cand, cnt = [], None, 0, None, 0
    dt = t[1] - t[0] if len(t) > 1 else 0.01

    def close(k):
        if cur is not None and (k - start) * dt >= min_len:
            out.append({"t0": float(t[start]), "t1": float(t[k - 1] + dt), "midi": int(cur)})

    for k in range(len(sm)):
        if np.isnan(sm[k]):
            close(k); cur, cand, cnt = None, None, 0
            continue
        r = int(round(sm[k]))
        if cur is None:
            cur, start, cand, cnt = r, k, None, 0
        elif abs(sm[k] - cur) < 0.7:
            cand, cnt = None, 0
        else:
            cnt = cnt + 1 if r == cand else 1
            cand = r
            if cnt >= hold:
                close(k - hold + 1); cur, start, cand, cnt = r, k - hold + 1, None, 0
    close(len(sm))
    return out
