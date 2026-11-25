"""Audio -> lead sheet JSON.

Stages (each reports progress through `report(stage, fraction)`):
  1. get audio      : the uploaded file
  2. separate       : Demucs htdemucs -> vocals / bass / drums / other (skipped if Demucs is not installed)
  3. beats          : librosa beat tracker on drums+bass (or the mix)
  4. harmony        : Basic Pitch note posteriors on bass+other -> per-beat pitch-class profiles -> chords
  5. melody         : Basic Pitch notes on the vocal stem (or the mix) -> one monophonic line
The output has the same shape as the browser engine's result, plus engine="server".
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import soundfile as sf

from . import chords as CH
from . import chordnet as CN

log = logging.getLogger("pipeline")
SR = 22050
Report = Callable[[str, float], None]

MAX_SECONDS = int(os.environ.get("MAX_SECONDS", 12 * 60))
DEMUCS_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
LYRICS_LANG = os.environ.get("LYRICS_LANG") or None  # "th", "en" or auto
GHOST = 1.0  # a note counts as an overtone ghost if quieter than GHOST x the lower note
TUNE = os.environ.get("AUTO_TUNE", "1") != "0"
TUNE_MIN = 0.15      # ignore offsets under 15 cents: chroma copes and estimates of real songs wobble this much
TUNE_SPREAD = 0.12   # start / middle / end estimates must agree within 12 cents
TUNE_GAIN = 0.02     # retuned audio must fit chord shapes at least 2% better


def estimate_tuning_segments(y: np.ndarray) -> tuple[float, float]:
    """Circular mean of the tuning offset (in semitones, -0.5..0.5) over three parts of the song, and their spread."""
    n = len(y); segs = [y[int(n * a):int(n * b)] for a, b in ((0, 1 / 3), (1 / 3, 2 / 3), (2 / 3, 1))]
    ts = [float(librosa.estimate_tuning(y=g, sr=SR)) for g in segs if len(g) > SR * 8]
    if not ts:
        return 0.0, 1.0
    z = np.exp(2j * np.pi * np.array(ts)); m = float(np.angle(z.mean()) / (2 * np.pi))
    spread = max(abs((t - m + 0.5) % 1 - 0.5) for t in ts)
    return m, float(spread)


def chord_fit(pcs: np.ndarray, bss: np.ndarray, low: np.ndarray) -> float:
    """How well beat profiles match the best chord shape (higher = notes sit cleanly on semitones)."""
    sc = [float(np.max(CH.score_all(p, b))) for p, b, l in zip(pcs, bss, low) if not l]
    return float(np.mean(sc)) if sc else 0.0
POST_FLOOR = 0.2  # Basic Pitch posteriors below this are treated as silence (tuned on tests/vocab.wav)


class PipelineError(Exception):
    """Error whose message is safe to show to the user (Thai)."""


def has_whisper() -> bool:
    return os.environ.get("USE_WHISPER", "1") != "0" and importlib.util.find_spec("faster_whisper") is not None


def has_demucs() -> bool:
    return os.environ.get("USE_DEMUCS", "1") != "0" and importlib.util.find_spec("demucs") is not None




def decode_audio(path: Path, sr: int, mono: bool) -> np.ndarray:
    """Decode any audio/video file with PyAV (bundled FFmpeg libraries, no ffmpeg program needed).
    Returns float32 (n,) when mono, else (2, n). Falls back to librosa if PyAV is missing."""
    try:
        import av
    except ImportError:
        y, _ = librosa.load(str(path), sr=sr, mono=mono)
        return y
    chunks = []
    with av.open(str(path)) as f:
        stream = next(s for s in f.streams if s.type == "audio")
        rs = av.AudioResampler(format="flt", layout="mono" if mono else "stereo", rate=sr)
        for frame in f.decode(stream):
            for out in rs.resample(frame):
                chunks.append(out.to_ndarray())
        for out in rs.resample(None):
            chunks.append(out.to_ndarray())
    if not chunks:
        raise ValueError("no audio")
    a = np.concatenate(chunks, axis=1)  # packed: (1, n*ch)
    return a.reshape(-1).astype(np.float32) if mono else a.reshape(-1, 2).T.astype(np.float32)


def load_mono(path: Path) -> np.ndarray:
    try:
        y = decode_audio(path, SR, True)
    except Exception as e:
        raise PipelineError("เปิดไฟล์เสียงนี้ไม่ได้ ลองไฟล์ mp3, wav หรือ m4a") from e
    if len(y) < SR * 3:
        raise PipelineError("เสียงสั้นเกินไป (ต้องยาวอย่างน้อย 3 วินาที)")
    if len(y) > SR * MAX_SECONDS:
        raise PipelineError(f"เพลงยาวเกิน {MAX_SECONDS // 60} นาที")
    return y


# ---------------------------------------------------------------- 2. separate
def separate(src: Path, workdir: Path, report: Report) -> dict[str, np.ndarray] | None:
    if not has_demucs():
        return None
    out = workdir / "stems"
    if not (out / DEMUCS_MODEL).exists():  # re-analysis reuses stems that are already on disk
        if not _run_demucs(src, workdir, out, report):
            return None
    d = next((out / DEMUCS_MODEL).glob("*"), None)
    if d is None:
        return None
    stems = {}
    for k in ("vocals", "bass", "drums", "other"):
        f = d / f"{k}.wav"
        if f.exists():
            stems[k], _ = librosa.load(str(f), sr=SR, mono=True)
    return stems if len(stems) == 4 else None


def _run_demucs(src: Path, workdir: Path, out: Path, report: Report) -> bool:
    report("กำลังแยกเสียงร้อง เบส กลอง ด้วย Demucs (อาจใช้ 1–3 นาที)", 0.2)
    wav = workdir / "demucs_in.wav"
    try:
        sf.write(str(wav), decode_audio(src, 44100, False).T, 44100)
    except Exception as e:
        log.warning("could not prepare audio for demucs: %s", e)
        return False
    # --shifts 0: Demucs' default (1) moves the song by a random 0-0.5 s before separating and does not average,
    # so each run gave a different vocal stem, and Whisper on a hard song gave 0, 45 or 49+ words (Mac, 2026-11-22)
    # app.demucs_run: the Demucs command line on the Mac's GPU when there is one (4x faster, same stems)
    cmd = [sys.executable, "-m", "app.demucs_run", "-n", DEMUCS_MODEL, "--shifts", os.environ.get("DEMUCS_SHIFTS", "0"),
           "-o", str(out), str(wav)]
    try:
        # the Mac GPU failing (memory, driver): once more on the CPU
        for env in ({}, {"DEMUCS_DEVICE": "cpu"}) if sys.platform == "darwin" else ({},):
            try:
                # no console window popping up on Windows (the desktop app runs without one)
                subprocess.run(cmd, check=True, capture_output=True, timeout=1800, env={**os.environ, **env},
                               cwd=str(Path(__file__).resolve().parent.parent),
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                return True
            except Exception as e:
                log.warning("demucs failed%s: %s", " on the default device" if not env else "",
                            (getattr(e, "stderr", None) or b"")[-400:] or e)
                shutil.rmtree(out, ignore_errors=True)
                if env or os.environ.get("DEMUCS_DEVICE"):
                    break
        log.warning("continuing on the mix")
        return False
    finally:
        wav.unlink(missing_ok=True)


# ---------------------------------------------------------------- 3. beats
def track_beats(y: np.ndarray) -> tuple[np.ndarray, float, np.ndarray]:
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=512, start_bpm=110, tightness=100)
    times = librosa.frames_to_time(frames, sr=SR, hop_length=512)
    dur = len(y) / SR
    if len(times) < 2:
        step = 60 / 100.0
        times = np.arange(0, dur, step)
    else:
        step = float(np.median(np.diff(times)))
        pre = np.arange(times[0] - step, 0, -step)[::-1]
        post = np.arange(times[-1] + step, dur, step)
        times = np.concatenate([pre, times, post])
    bpm = tempo_of(times)
    beat_onset = onset_at(onset, times)
    return times, bpm, beat_onset, onset


def tempo_of(beats: np.ndarray) -> int:
    """BPM from beat times: median of 8-beat spans. Single beat intervals are quantised to analysis frames
    (90 BPM came out as 89 or 92 from a median of intervals)."""
    b = np.asarray(beats, float)
    if len(b) < 10:
        return int(round(60 / float(np.median(np.diff(b))))) if len(b) > 1 else 0
    return int(round(60 / float(np.median((b[8:] - b[:-8]) / 8))))


def onset_at(onset: np.ndarray, times: np.ndarray) -> np.ndarray:
    return onset[np.clip(librosa.time_to_frames(times, sr=SR, hop_length=512), 0, len(onset) - 1)]


KEY_AWARE = os.environ.get("KEY_AWARE", "1") != "0"      # prefer chords of the key in force (local, follows modulations)
BAR_AWARE = os.environ.get("BAR_AWARE", "1") != "0"      # second chord pass that knows where bars start
REPEAT_VOTE = os.environ.get("REPEAT_VOTE", "1") != "0"  # repeated passages vote on their chords
BEAT_THIS_CKPT = os.environ.get("BEAT_THIS_CKPT", "/opt/models/beat_this-final0.ckpt")
_BT_MODEL = None


def has_beat_this() -> bool:
    return (os.environ.get("USE_BEAT_THIS", "1") != "0" and Path(BEAT_THIS_CKPT).exists()
            and importlib.util.find_spec("beat_this") is not None)


def _log_mel_50fps(y: np.ndarray) -> np.ndarray:
    """Beat This! input: 128-band log mel spectrogram at 50 frames/s, exactly as its torchaudio front end
    (hann 1024, hop 441, slaney mel 30-11000 Hz, magnitude normalised by the window, log1p(1000 x))."""
    S = np.abs(librosa.stft(y.astype(np.float32), n_fft=1024, hop_length=441, window="hann", center=True, pad_mode="reflect"))
    S /= np.sqrt((np.hanning(1025)[:-1] ** 2).sum())
    mel = librosa.filters.mel(sr=SR, n_fft=1024, n_mels=128, fmin=30, fmax=11000, htk=False, norm=None) @ S
    return np.log1p(1000 * mel).T.astype(np.float32)


def drop_double_beats(beats: np.ndarray, frac: float = 0.4) -> np.ndarray:
    """Remove a beat that sits right next to another (closer than frac of the usual gap): the model sometimes
    fires twice on one beat, which would add a beat to that bar. Keep the one that fits the steady grid."""
    if len(beats) < 4:
        return beats
    med = float(np.median(np.diff(beats)))
    out = [float(beats[0])]
    for t in beats[1:]:
        t = float(t)
        if t - out[-1] >= frac * med:
            out.append(t)
            continue
        want = out[-2] + med if len(out) > 1 else out[-1]
        if abs(t - want) < abs(out[-1] - want):
            out[-1] = t
    return np.asarray(out)


def steady_octave(beats: np.ndarray, min_run: int = 8) -> np.ndarray:
    """One tempo for the whole song: where the model counts twice as fast (or half as fast) as in most of the song
    for min_run beats or more, every other beat is dropped (or a beat added between two). A chorus with busy drums
    made Beat This! count double for 90 s (I'm OK // Not OK, 68 BPM: 78 BPM reported, the chorus bars half as long).
    The song's own tempo is the one that lasts longest; a short stretch can't change it."""
    b = np.asarray(beats, float)
    if len(b) < 3 * min_run:
        return b
    ib = np.diff(b)
    loc = np.array([np.median(ib[max(0, i - 3):i + 4]) for i in range(len(ib))])
    order = np.argsort(loc)
    cum = np.cumsum(ib[order])
    m = float(loc[order][np.searchsorted(cum, cum[-1] / 2)])  # median beat length, weighted by time
    ratio = loc / m
    zone = np.zeros(len(ib), int)  # 1: counted double, -1: counted half
    zone[(ratio > 0.4) & (ratio < 0.62)] = 1
    zone[(ratio > 1.6) & (ratio < 2.4)] = -1
    i, runs = 0, []
    while i < len(zone):  # keep only long stretches
        j = i
        while j < len(zone) and zone[j] == zone[i]:
            j += 1
        if zone[i] != 0 and (j - i) * (1 if zone[i] == 1 else 2) >= min_run:
            runs.append((i, j, int(zone[i])))
        i = j
    out, k = [], 0
    for i, j, z in runs:  # interval indices i..j-1 cover beats i..j
        out.extend(b[k:i + 1])
        if z == 1:  # double counting: from the last kept beat, keep the beat closest to one beat later
            last = out[-1]
            for t in b[i + 1:j + 1]:
                if t - last >= 0.7 * m:
                    out.append(t)
                    last = t
        else:  # half counting: a beat between each pair
            for a, c in zip(b[i:j], b[i + 1:j + 1]):
                out.extend([(a + c) / 2, c])
        k = j + 1
    out.extend(b[k:])
    out = sorted(set(np.round(out, 6)))
    # a single extra beat halfway between two (a fill): both gaps about half a beat, together about one, in a
    # steady stretch (3 beats either side within 15% of a beat: free-time playing, Chopin's rubato, is left alone)
    i, extra = 1, 0
    def merged(gs):  # gaps, with another such half-beat pair counted as the one beat it is (two fills close together)
        res, k = [], 0
        while k < len(gs):
            if k + 1 < len(gs) and gs[k] < 0.65 * m and gs[k + 1] < 0.65 * m and 0.8 * m < gs[k] + gs[k + 1] < 1.2 * m:
                res.append(gs[k] + gs[k + 1]); k += 2
            else:
                res.append(gs[k]); k += 1
        return res

    def steady(gs):
        return len(gs) >= 3 and all(0.85 * m < x < 1.15 * m for x in gs[:3])

    while i < len(out) - 1:
        g0, g1 = out[i] - out[i - 1], out[i + 1] - out[i]
        if (g0 < 0.65 * m and g1 < 0.65 * m and 0.8 * m < g0 + g1 < 1.2 * m
                and steady(merged(list(np.diff(out[max(0, i - 6):i])))[::-1])
                and steady(merged(list(np.diff(out[i + 1:i + 7]))))):
            del out[i]
            extra += 1
        else:
            i += 1
    out = np.asarray(out)
    if runs or extra:
        log.info("steady tempo: %d stretch(es) counted %s, %d extra beat(s), %d -> %d beats", len(runs),
                 "/".join("double" if z == 1 else "half" for *_, z in runs) or "-", extra, len(b), len(out))
    return out


def beat_this_beats(y: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Beats and downbeats (seconds) from the Beat This! model (ISMIR 2024), when it is installed."""
    global _BT_MODEL
    if not has_beat_this():
        return None
    try:
        import types
        import torch
        if "torchaudio" not in sys.modules and importlib.util.find_spec("torchaudio") is None:  # only its spectrogram needs it
            sys.modules.setdefault("torchaudio", types.ModuleType("torchaudio"))
        from beat_this.inference import Spect2Frames
        from beat_this.model.postprocessor import Postprocessor
        if _BT_MODEL is None:
            _BT_MODEL = (Spect2Frames(checkpoint_path=BEAT_THIS_CKPT, device="cpu"), Postprocessor(type="minimal"))
        net, post = _BT_MODEL
        with torch.no_grad():
            beat, down = net(torch.from_numpy(_log_mel_50fps(np.asarray(y))))
        beats, downbeats = post(beat, down)
        beats, downbeats = steady_octave(drop_double_beats(np.asarray(beats, float))), np.asarray(downbeats, float)
        return (beats, downbeats) if len(beats) >= 8 else None
    except Exception as e:  # never let the optional model break an analysis
        log.warning("beat_this failed, using the built-in beat tracker: %s", e)
        return None


def bar_starts_from_downbeats(beats: np.ndarray, downbeats: np.ndarray, bpb: int) -> list[int]:
    """Beat indices where bars start: follow the model's downbeats with bars of bpb beats, allowing the count to
    jump only where the downbeats clearly say so (a beat tracker can slip by a beat or two in syncopated music)."""
    T = len(beats)
    near = np.zeros(T, bool)
    for d in downbeats:
        k = int(np.argmin(np.abs(beats - d)))
        if abs(beats[k] - d) < 0.15:
            near[k] = True
    jump = 4.0
    dp = np.where(np.arange(bpb) == 0, np.where(near[0], 1.0, -0.5), np.where(near[0], -1.0, 0.0)).astype(float)
    back = np.zeros((T, bpb), int)
    for i in range(1, T):
        nd = np.full(bpb, -1e9); bk = np.zeros(bpb, int)
        for p in range(bpb):
            prev = (p - 1) % bpb
            best, frm = dp[prev], prev
            for q in range(bpb):
                if q != prev and dp[q] - jump > best:
                    best, frm = dp[q] - jump, q
            em = (1.0 if near[i] else -0.5) if p == 0 else (-1.0 if near[i] else 0.0)
            nd[p], bk[p] = best + em, frm
        dp, back[i] = nd, bk
    st = [int(np.argmax(dp))]
    for i in range(T - 1, 0, -1):
        st.append(int(back[i][st[-1]]))
    st = st[::-1]
    return [i for i in range(T) if st[i] == 0]


def change_costs_from_bars(T: int, starts: list[int]) -> np.ndarray:
    """change cost per beat from explicit bar starts: free on beat 1, half at mid-bar, full elsewhere."""
    w = CH.P.get("chgWeak", 2.0); half = CH.P.get("chgHalf", 0.5) * w
    out = np.full(T, w)
    bounds = list(starts) + [T]
    for a, b in zip(bounds[:-1], bounds[1:]):
        out[a] = 0.0
        L = b - a
        if L % 2 == 0 and L >= 4:
            out[a + L // 2] = half
    if starts and starts[0] > 0:
        out[:starts[0]] = w
    return out


def meter_from_downbeats(beats: np.ndarray, downbeats: np.ndarray) -> dict | None:
    """Beats per bar and bar phase from model downbeats (each downbeat snapped to its nearest beat)."""
    if downbeats is None or len(downbeats) < 3:
        return None
    idx = np.unique([int(np.argmin(np.abs(beats - d))) for d in downbeats])
    gaps = np.diff(idx)
    gaps = gaps[(gaps >= 2) & (gaps <= 7)]
    if not len(gaps):
        return None
    bpb = int(np.bincount(gaps).argmax())
    bpb = bpb if bpb in (3, 4, 6) else 4
    phase = int(np.bincount(idx % bpb, minlength=bpb).argmax())
    num, den = (6, 8) if bpb == 6 else (3, 4) if bpb == 3 else (4, 4)
    return {"num": num, "den": den, "bpb": bpb, "phase": phase, "score": 0.0, "source": "beat_this"}


HALF_TEMPO_BPM = 145  # above this a pop / ballad beat is almost always counted in eighth notes


def harmonic_novelty(post: np.ndarray, t: np.ndarray, at: np.ndarray, w: float) -> np.ndarray:
    """How much the notes change at each time in `at`: 1 - cosine(notes in the w seconds before, w seconds after)."""
    midi = np.arange(88) + 21
    pcf = np.zeros((len(post), 12))
    np.add.at(pcf.T, midi % 12, np.clip(post - POST_FLOOR, 0, None).T)
    cs = np.vstack([np.zeros(12), np.cumsum(pcf, 0)])
    idx = lambda x: np.clip(np.searchsorted(t, x), 0, len(t))
    a, m, b = idx(at - w), idx(at), idx(at + w)
    L, R = cs[m] - cs[a], cs[b] - cs[m]
    nl, nr = np.linalg.norm(L, axis=1), np.linalg.norm(R, axis=1)
    ok = (nl > 1e-6) & (nr > 1e-6)
    out = np.zeros(len(at))
    out[ok] = 1 - (L[ok] * R[ok]).sum(1) / (nl[ok] * nr[ok])
    return out


def refine_grid(beats: np.ndarray, post: np.ndarray, tscale: float, dur: float, tempo: str = "auto") -> np.ndarray:
    """Fix the two common beat-tracker slips using where the harmony actually changes:
    counting eighth notes as beats (ballads come out at ~180 BPM) and sitting on the 'and' between beats."""
    if len(beats) < 8:
        return beats
    t = frame_times(len(post)) * tscale
    p = float(np.median(np.diff(beats)))
    w = float(np.clip(0.7 * p, 0.25, 0.5))
    # score a grid by its strongest change points: chords change on only some beats, and arpeggios
    # make small note changes on every eighth, so an average would hide where the real changes sit
    nov = lambda g: float(np.quantile(harmonic_novelty(post, t, g, w), 0.85)) if len(g) else 0.0
    if 60 / p >= HALF_TEMPO_BPM:  # keep every other beat: the set where chords change
        beats = max((beats[0::2], beats[1::2]), key=nov)
        p *= 2
    if tempo == "half":  # asked by the user: count half as many beats
        beats = max((beats[0::2], beats[1::2]), key=nov)
        p *= 2
    elif tempo == "double":
        mid = beats[:-1] + np.diff(beats) / 2
        return np.sort(np.concatenate([beats, mid, [beats[-1] + p / 2] if beats[-1] + p / 2 < dur else []]))
    shifted = beats + p / 2
    shifted = shifted[shifted < dur]
    if nov(shifted) > 1.25 * nov(beats):
        beats = np.concatenate([[beats[0] - p / 2] if beats[0] - p / 2 >= 0 else [], shifted])
    return beats


# ---------------------------------------------------------------- 4/5. Basic Pitch
_BP_MODEL = None


def _bp_model():
    global _BP_MODEL
    if _BP_MODEL is None:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model

        suffix = FilenameSuffix.onnx if importlib.util.find_spec("onnxruntime") else FilenameSuffix.tf
        _BP_MODEL = Model(build_icassp_2022_model_path(suffix))
    return _BP_MODEL


ONSETS: dict[int, np.ndarray] = {}


def basic_pitch(y: np.ndarray, workdir: Path, tag: str, **kw):
    from basic_pitch.inference import predict

    f = workdir / f"bp_{tag}.wav"
    sf.write(str(f), y, SR)
    out, _midi, notes = predict(str(f), _bp_model(), **kw)
    ONSETS[id(out["note"])] = out["onset"]  # (frames, 88) note-start posteriors, used to favour notes struck in the beat
    return out["note"], notes  # (frames, 88) posteriors from MIDI 21, note events


def frame_times(n: int) -> np.ndarray:
    """Seconds of each Basic Pitch posterior frame, exactly as Basic Pitch times its own notes
    (frames come in 2-second windows with an offset; a plain n/86 drifts ~0.2 s per minute)."""
    from basic_pitch.note_creation import model_frames_to_time

    return model_frames_to_time(n)


def beat_profiles(post: np.ndarray, bass_post: np.ndarray | None, beats: np.ndarray, dur: float, rms_beats: np.ndarray, tscale: float = 1.0):
    onset = ONSETS.get(id(post))
    post = np.clip(post - POST_FLOOR, 0, None)
    onw = CH.P.get("onsetW", 0.0)
    if onw > 0 and onset is not None and len(onset) == len(post):
        # a note struck inside the beat counts more than one still ringing from the previous chord (sustain pedal)
        post = post + onw * np.clip(onset - POST_FLOOR, 0, None)
    if bass_post is not None:
        bass_post = np.clip(bass_post - POST_FLOOR, 0, None)
    t = frame_times(len(post)) * tscale
    midi = np.arange(88) + 21
    pc_mask = (midi >= 43) & (midi <= 96)
    bs_w = np.where(midi < 48, 1.0, 0.4) * ((midi >= 28) & (midi <= 54))
    tb = frame_times(len(bass_post)) * tscale if bass_post is not None else t
    pcs, bss = [], []
    for i, t0 in enumerate(beats):
        t1 = beats[i + 1] if i + 1 < len(beats) else min(dur, t0 + 0.6)
        sel = (t >= t0) & (t < t1)
        act = post[sel].mean(0) if sel.any() else np.zeros(88)
        pc = np.zeros(12)
        np.add.at(pc, midi[pc_mask] % 12, act[pc_mask])
        if bass_post is not None:
            selb = (tb >= t0) & (tb < t1)
            bact = bass_post[selb].mean(0) if selb.any() else np.zeros(88)
            bact = bact * (midi <= 60)
        else:
            bact = act * bs_w
        bs = np.zeros(12)
        np.add.at(bs, midi % 12, bact)
        pcs.append(pc)
        bss.append(bs)
    pcs, bss = np.array(pcs), np.array(bss)
    med = np.median(rms_beats) if len(rms_beats) else 0
    low = (rms_beats < 0.12 * med) | (pcs.max(1) < 0.02)
    return pcs, bss, low


def melody_line(notes, lo: int = 45, hi: int = 90, min_amp: float = 0.25, prefer: str = "loud") -> list[dict]:
    """Basic Pitch note events -> one monophonic line, decided every 20 ms.

    Notes 12/19/24 semitones above a louder sounding note are treated as overtone ghosts.
    prefer="loud": keep the strongest (vocal stem); prefer="high": keep the highest (full mix, melody on top).
    """
    ev = [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in notes
          if lo <= p <= hi and a >= min_amp and e - s >= 0.08]
    if not ev:
        return []
    dt = 0.02
    end = max(e for _, e, _, _ in ev)
    n = int(end / dt) + 1
    pick = np.full(n, -1)
    active: list[list[int]] = [[] for _ in range(n)]
    for i, (s, e, _, _) in enumerate(ev):
        for f in range(int(s / dt), min(n, int(e / dt))):
            active[f].append(i)
    for f in range(n):
        idx = active[f]
        if not idx:
            continue
        real = [i for i in idx if not any(ev[j][3] * GHOST > ev[i][3] and ev[i][2] - ev[j][2] in (12, 19, 24) for j in idx)]
        key = (lambda i: (ev[i][3], ev[i][2])) if prefer == "loud" else (lambda i: (ev[i][2], ev[i][3]))
        pick[f] = max(real, key=key)
    out = []
    f = 0
    while f < n:
        g = f
        while g < n and pick[g] == pick[f]:
            g += 1
        if pick[f] >= 0 and (g - f) * dt >= 0.08:
            out.append({"t0": round(f * dt, 3), "t1": round(g * dt, 3), "midi": ev[pick[f]][2]})
        f = g
    return out


MEL = {  # melody tracker weights (see melody_track)
    "inst": {"lo": 55, "hi": 100, "amp": 0.2, "height": 0.25, "loud": 1.0, "fresh": 0.8, "rest": 0.45},
    "voice": {"lo": 45, "hi": 84, "amp": 0.2, "height": 0.0, "loud": 1.6, "fresh": 0.3, "rest": 0.35},
    "key": 0.15, "switch": 0.25, "leap": 0.06, "bigleap": 0.6, "rest_in": 0.2,
}


def melody_track(notes, beats=None, mode: str = "inst", key: dict | None = None, dt: float = 0.02) -> list[dict]:
    """Basic Pitch note events -> one melody line, chosen as the best-connected path (Viterbi) rather than
    the loudest / highest note of each instant:
      * a candidate scores for loudness, for being freshly struck (a held accompaniment note fades), for height
        (instruments: the tune usually sits on top) and for belonging to the song's key;
      * moving to another note costs a little, more for wide leaps: real tunes mostly step;
      * overtone ghosts (octave / twelfth / two octaves above a louder note) are never candidates.
    Then (voice) fragments of one sung note (vibrato, slides) are merged, and very short notes dropped;
    note starts close to the beat grid (quarter / triplet subdivisions) are snapped onto it."""
    W = MEL[mode]
    ev = [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in notes
          if W["lo"] <= p <= W["hi"] and a >= W["amp"] and e - s >= 0.05]
    if not ev:
        return []
    inkey = None
    if key and key.get("root", -1) >= 0:
        tonic = (key["root"] + (3 if key.get("q") == "m" else 0)) % 12
        mask = CH.scale_mask(tonic)
        inkey = lambda p: (mask >> (p % 12)) & 1
    n = int(max(e for _, e, _, _ in ev) / dt) + 1
    active: list[list[int]] = [[] for _ in range(n)]
    for i, (s, e, _, _) in enumerate(ev):
        for f in range(int(s / dt), min(n, int(e / dt))):
            active[f].append(i)
    amax = max(a for *_, a in ev)
    # Viterbi: state = note event index or -1 (rest)
    prev_states = [-1]
    prev_score = np.zeros(1)
    back: list[tuple[list[int], np.ndarray]] = []
    for f in range(n):
        idx = active[f]
        real = [i for i in idx if not any(ev[j][3] * GHOST > ev[i][3] and ev[i][2] - ev[j][2] in (12, 19, 24) for j in idx)]
        states = real + [-1]
        t = f * dt
        top = max((ev[i][2] for i in real), default=0)
        em = np.empty(len(states))
        for k, i in enumerate(states):
            if i < 0:
                em[k] = W["rest"]
                continue
            s0, _, p, a = ev[i]
            em[k] = W["loud"] * a / amax + W["fresh"] * np.exp(-(t - s0) / 0.6) - W["height"] * (top - p) / 12.0
            if inkey is not None:
                em[k] += MEL["key"] * (1 if inkey(p) else -1)
        # transitions from every previous state
        ps = np.array([ev[j][2] if j >= 0 else -1 for j in prev_states])
        bp = np.empty(len(states), int)
        sc = np.empty(len(states))
        for k, i in enumerate(states):
            if i < 0:
                cost = np.where(ps < 0, 0.0, MEL["rest_in"])
            else:
                p = ev[i][2]
                d = np.abs(ps - p)
                cost = np.where(np.array(prev_states) == i, 0.0,
                                np.where(ps < 0, MEL["rest_in"], MEL["switch"] + MEL["leap"] * np.minimum(d, 12) + MEL["bigleap"] * (d > 12)))
            tot = prev_score - cost
            j = int(np.argmax(tot))
            bp[k], sc[k] = j, tot[j] + em[k]
        back.append((states, bp))
        prev_states, prev_score = states, sc
    # backtrack
    k = int(np.argmax(prev_score))
    path = [0] * n
    for f in range(n - 1, -1, -1):
        states, bp = back[f]
        path[f] = states[k]
        k = bp[k]
    out = []
    f = 0
    while f < n:
        g = f
        while g < n and path[g] == path[f]:
            g += 1
        if path[f] >= 0:
            out.append({"t0": f * dt, "t1": g * dt, "midi": ev[path[f]][2]})
        f = g
    return tidy_melody(out, beats, voice=mode == "voice")


MELODY_ENGINE = os.environ.get("MELODY_ENGINE", "rmvpe")  # "basic" = the Basic Pitch line (before r21)


def start_rmvpe(voice: np.ndarray):
    """Vocal pitch in the background while chords are worked out (it needs only the vocal stem): None if not used."""
    if MELODY_ENGINE != "rmvpe":
        return None
    try:
        from . import rmvpe as RM

        if not RM.ckpt_path().exists():
            log.info("rmvpe weights not found (%s): Basic Pitch melody", RM.ckpt_path())
            return None
        from concurrent.futures import ThreadPoolExecutor

        ex = ThreadPoolExecutor(1)
        job = ex.submit(RM.pitch, voice, SR)
        ex.shutdown(wait=False)
        return job
    except Exception as e:
        log.warning("rmvpe not started: %s", e)
        return None


def sung_melody(voice: np.ndarray, workdir: Path, beats, key: dict, rm_job=None) -> tuple[list[dict], str]:
    """The sung line from the vocal stem. RMVPE (a vocal pitch model) follows the singer more closely than Basic Pitch
    notes + melody_track: 84.9% -> 87.8% agreement on 6 sung songs (tests/bench, 2026-11-23). Its pitch pass runs
    beside the chord stage (start_rmvpe). Basic Pitch when the RMVPE weights are missing or it fails."""
    if rm_job is not None:
        try:
            from . import rmvpe as RM

            t, f0, _ = rm_job.result()
            return tidy_melody(RM.notes(t, f0), beats, voice=True), "rmvpe"
        except Exception as e:
            log.warning("rmvpe failed, Basic Pitch melody instead: %s", e)
    _, vnotes = basic_pitch(voice, workdir, "vocals")
    return melody_track(vnotes, beats, mode="voice", key=key), "basic-pitch"


def fix_octaves(mel: list[dict]) -> list[dict]:
    """Pitch trackers often land an octave off for a note or two (an overtone wins). A short note an octave away
    from both neighbours, or far (10+ semitones) from the line around it, is moved back by octaves."""
    m = [dict(x) for x in mel]
    for k in range(1, len(m) - 1):
        a, b, c = m[k - 1]["midi"], m[k]["midi"], m[k + 1]["midi"]
        if abs(b - a) == 12 and abs(c - a) <= 2 and m[k]["t1"] - m[k]["t0"] < 0.4:
            m[k]["midi"] = b - 12 * np.sign(b - a)
    for k in range(len(m)):
        around = [x["midi"] for x in m[max(0, k - 4):k] + m[k + 1:k + 5]]
        if len(around) >= 4:
            med = float(np.median(around))
            while m[k]["midi"] - med >= 10:
                m[k]["midi"] -= 12
            while med - m[k]["midi"] >= 10:
                m[k]["midi"] += 12
    for x in m:
        x["midi"] = int(x["midi"])
    return m


def tidy_melody(mel: list[dict], beats=None, voice: bool = False) -> list[dict]:
    """Merge fragments of one note, drop blips, snap starts onto the beat grid when they are close to it."""
    out: list[dict] = []
    for m in mel:
        # (instruments: a repeated note is really struck again, so only sung notes are joined)
        if voice and out and m["midi"] == out[-1]["midi"] and m["t0"] - out[-1]["t1"] < 0.12:
            out[-1]["t1"] = m["t1"]  # same pitch again right away: one note (a sung note split by vibrato)
        else:
            out.append(dict(m))
    if voice:  # a short note between two of the same pitch, within a semitone or two: a slide or vibrato
        k = 1
        while k + 1 < len(out):
            a, b, c = out[k - 1], out[k], out[k + 1]
            if b["t1"] - b["t0"] < 0.12 and a["midi"] == c["midi"] and abs(b["midi"] - a["midi"]) <= 2 and c["t0"] - a["t1"] < 0.3:
                a["t1"] = c["t1"]
                del out[k:k + 2]
            else:
                k += 1
    if voice:
        out = [m for m in out if m["t1"] - m["t0"] >= 0.1]
    out = fix_octaves(out)
    if beats is not None and len(beats) > 2:
        b = np.asarray(beats, float)
        grid = np.unique(np.concatenate([b[:-1] + (b[1:] - b[:-1]) * q for q in (0, 0.25, 0.5, 0.75, 1 / 3, 2 / 3)]))
        for m in out:
            j = int(np.argmin(np.abs(grid - m["t0"])))
            if abs(grid[j] - m["t0"]) < 0.035 and grid[j] < m["t1"] - 0.04:
                m["t0"] = float(grid[j])
    for m in out:
        m["t0"], m["t1"] = round(m["t0"], 3), round(m["t1"], 3)
    return out


# ---------------------------------------------------------------- 6. lyrics
_WHISPER = None


CPUS = os.cpu_count() or 2
# the lyrics stage (de-reverb + Whisper) beside the chord / beat stages: off unless PARALLEL_LYRICS=1. Slower on
# 2 cores (412 s -> 599 s) and on 14 cores too (M3 Max, 4 songs 1007 s -> 1086 s): what can run beside it after
# Demucs takes only 5-17 s, and splitting the threads slows Whisper + de-reverb, the bottleneck (tests 2026-11-22)
PARALLEL = os.environ.get("PARALLEL_LYRICS", "0") == "1"
SHEET_OVERLAP = os.environ.get("SHEET_OVERLAP", "auto") == "1" or (os.environ.get("SHEET_OVERLAP", "auto") == "auto" and CPUS >= 6)
WHISPER_THREADS = max(2, CPUS // 2) if PARALLEL else 0  # 0 = ctranslate2 default


_WHISPER_LOCK = __import__("threading").Lock()


def _whisper_model():
    global _WHISPER
    from faster_whisper import WhisperModel

    with _WHISPER_LOCK:  # two songs may reach Whisper together (sheet check of one, lyrics of another): load once
        return _whisper_load(WhisperModel)


def _whisper_load(WhisperModel):
    global _WHISPER
    if _WHISPER is None:
        _WHISPER = WhisperModel(WHISPER_MODEL, device="auto", compute_type="int8", cpu_threads=WHISPER_THREADS,
                                local_files_only=os.environ.get("HF_HUB_OFFLINE") == "1")
    return _WHISPER


VAD_MIN = float(os.environ.get("VOCAL_VAD_MIN", "0.02"))  # share of the song the voice detector must hear


def vocal_presence(model, y16: np.ndarray, voice_share: float | None) -> dict:
    """Is anyone singing? Instrumental pieces (piano / guitar covers, karaoke tracks) make Whisper invent words
    and can run for many minutes. Three cheap checks, in order:
    1. with a separated vocal stem: its share of the song's energy (a real voice carries far more than leakage);
    2. Silero voice activity on the (vocal) audio: how much of the song sounds like a voice at all;
    3. Whisper itself on up to three 30-second windows where a voice is most likely: sung words come with a
       confident language and confident tokens; instruments give a random rare language and low confidence."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    if voice_share is not None and voice_share < 0.01:
        return {"sung": False, "why": f"vocal stem {voice_share:.1%} of the energy"}
    ts = get_speech_timestamps(y16, VadOptions(min_silence_duration_ms=500))
    vad = sum(t["end"] - t["start"] for t in ts) / max(1, len(y16))
    if vad < VAD_MIN:
        return {"sung": False, "why": f"voice heard in {vad:.1%} of the song"}
    langs: dict[str, float] = {}
    W = 30 * 16000
    picks = sorted(ts, key=lambda t: t["start"] - t["end"])[:3]  # the three longest voiced stretches
    good = 0
    for t in picks:
        s = max(0, min(len(y16) - W, (t["start"] + t["end"]) // 2 - W // 2))
        segs, info = model.transcribe(y16[s:s + W], language=LYRICS_LANG, vad_filter=False, without_timestamps=True,
                                      beam_size=1, temperature=0.0, condition_on_previous_text=False, max_new_tokens=96)
        sure = LYRICS_LANG is not None or info.language_probability >= 0.6
        langs[info.language] = langs.get(info.language, 0.0) + info.language_probability
        for g in segs:
            txt = g.text.strip()
            if sure and g.avg_logprob > -0.6 and g.compression_ratio < 2.4 and len(txt) >= 6:
                good += 1
        if good >= 2:
            break
    lang = LYRICS_LANG or (max(langs, key=langs.get) if langs else None)
    # a voice heard through a large part of the song is singing even when Whisper is unsure of the words (rock, shouting)
    sung = good >= 1 or vad >= 0.15
    return {"sung": sung, "lang": lang, "why": f"voice {vad:.1%}, confident sung lines {good}",
            "speech": [(t["start"] / 16000, t["end"] / 16000) for t in ts],
            "probe": [max(0, min(len(y16) - W, (t["start"] + t["end"]) // 2 - W // 2)) / 16000 for t in picks]}


def dereverb_vocals(voice: np.ndarray, workdir: Path, report: Report) -> np.ndarray | None:
    """De-echo / de-reverb copy of the vocal stem for Whisper (UVR model, own process). None when not installed or failing."""
    from . import dereverb as DR

    if not DR.available():
        return None
    out = workdir / "vocals_dry.wav"
    if not out.exists():
        report("กำลังลบเสียงก้องจากเสียงร้อง" + ("" if DR.have_model() else " (ดาวน์โหลดโมเดลครั้งแรก ~220 MB)"), 0.02)
        # the separated stem as Demucs wrote it (44.1 kHz stereo) de-reverbs better than our 22 kHz mono copy
        stem = next((workdir / "stems").glob(f"*/*/vocals.wav"), None)
        src = workdir / "vocals_for_dereverb.wav"
        if stem is not None:
            shutil.copy(stem, src)
        else:
            sf.write(src, np.asarray(voice, np.float32), SR)
        try:
            env = {**os.environ, **({"DEREVERB_THREADS": str(max(1, CPUS - WHISPER_THREADS))} if PARALLEL else {})}
            subprocess.run([sys.executable, "-m", "app.dereverb", str(src), str(out)], check=True, capture_output=True, env=env,
                           timeout=1800, cwd=str(Path(__file__).resolve().parent.parent),
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception as e:
            code = getattr(e, "returncode", None)
            if code is not None and code < 0 or code == 137:  # killed: almost always out of memory on a long song
                log.warning("de-reverb stopped (signal %s, likely out of memory): using the plain vocal stem", code)
                report("ลบเสียงก้องไม่สำเร็จ (หน่วยความจำไม่พอ) ใช้เสียงร้องปกติแทน", None)
            else:
                log.warning("de-reverb failed (%s): %s", code, (getattr(e, "stderr", None) or b"")[-300:] or e)
            return None
        finally:
            src.unlink(missing_ok=True)
    y, _ = librosa.load(out, sr=SR, mono=True)
    return y


TH_WHISPER_REPO = os.environ.get("WHISPER_TH_REPO", "Thaweewat/whisper-th-medium-ct2")  # Thonburian Whisper medium (Apache-2.0)
_WHISPERS: dict[str, object] = {}


def thai_whisper_dir() -> Path:
    if os.environ.get("WHISPER_TH_MODEL"):
        return Path(os.environ["WHISPER_TH_MODEL"])
    if Path("/opt/models/whisper-th-medium/model.bin").exists():
        return Path("/opt/models/whisper-th-medium")
    return Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data")) / "models" / "whisper-th-medium"


def thai_whisper(report: Report) -> str | None:
    """Thonburian Whisper medium (fine-tuned for Thai by Mahidol University), fetched once (~1.5 GB) when the first
    Thai song needs it. None when switched off or not reachable: the general model is used instead."""
    # off by default: on sung Thai (tests/melody, 2026-11) it skipped whole verses (50% of the lyrics vs 84-92%
    # with Whisper small) and took 8x longer. USE_TH_WHISPER=1 to try it.
    if os.environ.get("USE_TH_WHISPER", "0") != "1":
        return None
    d = thai_whisper_dir()
    files = {"config.json": TH_WHISPER_REPO, "vocabulary.json": TH_WHISPER_REPO, "model.bin": TH_WHISPER_REPO,
             "tokenizer.json": "Systran/faster-whisper-medium", "preprocessor_config.json": "Systran/faster-whisper-medium"}
    if all((d / f).exists() for f in files):
        return str(d)
    if os.environ.get("HF_HUB_OFFLINE") == "1" and not os.environ.get("ALLOW_MODEL_FETCH"):
        return None
    try:
        import urllib.request

        d.mkdir(parents=True, exist_ok=True)
        for f, repo in files.items():
            if (d / f).exists():
                continue
            url = f"https://huggingface.co/{repo}/resolve/main/{f}"
            tmp = d / (f + ".part")
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as out:
                total, got = int(r.headers.get("Content-Length") or 0), 0
                while chunk := r.read(1 << 20):
                    out.write(chunk)
                    got += len(chunk)
                    if total > 50e6:
                        report(f"กำลังดาวน์โหลดโมเดลเนื้อร้องภาษาไทย (ครั้งแรกครั้งเดียว) {got * 100 // total}%", 0.9)
            tmp.replace(d / f)
        return str(d)
    except Exception as e:
        log.warning("Thai Whisper not available: %s", e)
        return None


def _whisper_at(path: str):
    from faster_whisper import WhisperModel

    if path not in _WHISPERS:
        _WHISPERS[path] = WhisperModel(path, device="auto", compute_type="int8", cpu_threads=WHISPER_THREADS,
                                       local_files_only=os.environ.get("HF_HUB_OFFLINE") == "1" or Path(path).is_dir())
    return _WHISPERS[path]


_LOOP = re.compile(r"(.{2,30}?)\1{3,}", re.S)


def loop_share(txt: str) -> float:
    """Share of the letters that only repeat the piece before them, 4+ times in a row: Whisper's failure mode on noisy
    vocals ("oh oh oh ..." x200, or a Thai phrase looped 50 times). Any period of 2-30 letters (the old 4-letter
    test missed a 10-letter Thai loop, and the loop was then picked as the best transcript)."""
    txt = re.sub(r"\s+", "", txt)
    return sum(m.end() - m.start() - len(m.group(1)) for m in _LOOP.finditer(txt)) / max(1, len(txt))


def _cut_char_loops(words: list[dict]) -> list[dict]:
    """The same loop, on the letters: Thai words come out of Whisper as letter fragments (one consonant or vowel mark each),
    so a phrase said 30 times is not a run of equal words. Any 2-30 letter piece repeated 4+ times in a row keeps three."""
    text, starts = "", []
    for w in words:
        starts.append(len(text))
        text += w["text"].strip()
    drop: list[tuple[int, int]] = []
    for m in _LOOP.finditer(text):
        drop.append((m.start() + 3 * len(m.group(1)), m.end()))
    if not drop:
        return words
    return [w for w, c in zip(words, starts) if not any(a <= c < b for a, b in drop)]


def clean_words(words: list[dict], speech: list[tuple[float, float]] | None = None, spoken: list[tuple[float, float]] | None = None) -> list[dict]:
    """Remove what Whisper invents: a word or short phrase repeated over and over (kept three times), words where the
    voice detector heard no voice at all (1 s of slack), and words inside spoken (not sung) passages."""
    out: list[dict] = []
    for w in words:
        out.append(w)
        for n in (1, 2, 3):  # a run of the same n words, 4+ times in a row -> keep three (songs repeat, but not forever)
            if len(out) >= 4 * n and all(out[-k - 1]["text"].strip() == out[-k - 1 - n]["text"].strip() for k in range(3 * n)):
                del out[-n:]
                break
    out = _cut_char_loops(out)
    if speech:
        sp = sorted(speech)
        inside = lambda t: any(a - 1.0 <= t <= b + 1.0 for a, b in sp)
        out = [w for w in out if inside((w["t0"] + w["t1"]) / 2)]
    if spoken:
        out = [w for w in out if not any(a <= (w["t0"] + w["t1"]) / 2 <= b for a, b in spoken)]
    return out


def _transcribe(model, y16: np.ndarray, lang: str | None, label: str, report: Report, offset: float = 0.0,
                hotwords: str | None = None, quick: bool = False, span: tuple[float, float] = (0.0, 1.0)) -> dict:
    """One Whisper pass -> words (times + offset), mean word confidence, loop share, whether the time budget cut it."""
    import time

    try:  # the temperature fallback samples at random: same song, same lyrics every time
        import ctranslate2

        ctranslate2.set_random_seed(0)
    except Exception:
        pass
    dur = len(y16) / 16000
    budget = max(120.0, float(os.environ.get("WHISPER_BUDGET", "3")) * dur)  # seconds of work allowed
    t0 = time.time()
    segments, info = model.transcribe(y16, language=lang, word_timestamps=True, vad_filter=True,
                                      condition_on_previous_text=False, temperature=[0.0, 0.2, 0.4],
                                      hallucination_silence_threshold=2.0, no_speech_threshold=0.6,
                                      hotwords=hotwords or None)
    words, probs, cut = [], [], False
    if not quick:  # say which pass runs now (its first words can take a while)
        report(f"กำลังฟังเนื้อร้อง ({label}) 0%", span[0])
    for seg in segments:
        for w in seg.words or []:
            if w.word.strip():
                words.append({"t0": round(float(w.start) + offset, 3), "t1": round(float(w.end) + offset, 3), "text": w.word})
                probs.append(float(w.probability))
        if not quick:
            f = min(1.0, seg.end / dur)  # share of the whole lyrics stage done (span: this pass's part of it)
            report(f"กำลังฟังเนื้อร้อง ({label}) {int(f * 100)}%", span[0] + (span[1] - span[0]) * f)
        if time.time() - t0 > budget:
            log.warning("whisper stopped at %.0f s of %.0f s (time budget)", seg.end, dur)
            cut = True
            break
    txt = "".join(w["text"] for w in words)
    return {"lang": info.language, "words": words, "conf": float(np.mean(probs)) if probs else 0.0, "cut": cut,
            "loops": loop_share(txt)}


def dereverb_for(lang: str | None) -> bool:
    """English songs skip the de-reverbed second pass: in tests (First Love, Fly Me to the Moon) its transcript never
    won, and it costs ~4 min a song. DEREVERB_EN=1 keeps it."""
    return lang != "en" or os.environ.get("DEREVERB_EN", "0") == "1"


def _pick_score(r: dict) -> tuple:
    # a transcript that loops is out; otherwise the surer one, then the longer one
    # (rock, de-reverbed: loops 25% and fewer right words; ballad, de-reverbed: same confidence, more words)
    # an empty transcript does not loop either, but it is no answer (anthem: a looping 199 words lost to 0 words)
    return (bool(r["words"]) and r["loops"] < 0.05, round(r["conf"], 3), len(r["words"]))


def lyrics_presence(y: np.ndarray, voice_share: float | None) -> dict | None:
    """vocal_presence alone (a few seconds): lets the melody be made, and the sheet shown, before the long Whisper pass."""
    if not has_whisper():
        return None
    try:
        return vocal_presence(_whisper_model(), librosa.resample(np.asarray(y, np.float32), orig_sr=SR, target_sr=16000), voice_share)
    except Exception as e:
        log.warning("vocal presence check failed: %s", e)
        return None


def transcribe_lyrics(y: np.ndarray, workdir: Path, report: Report, voice_share: float | None = None,
                      dry_fn: Callable[[], np.ndarray | None] | None = None, spoken: list[tuple[float, float]] | None = None,
                      hint: str | None = None, pres: dict | None = None) -> dict | None:
    """Whisper on the vocal stem -> word list [{t0, t1, text}].
    * instrumental pieces are skipped (vocal_presence);
    * Whisper small; Thonburian Whisper medium (Thai fine-tune) only when USE_TH_WHISPER=1 (it skipped verses in tests);
    * with a de-reverbed copy of the stem (dry_fn, made in its own process), it is transcribed too only when the
      plain stem's transcript loops or is empty, and the transcript that does not loop and is surer wins
      (DEREVERB_ALWAYS=1: always both, as up to r23);
    * invented words are cleaned out (clean_words); spoken passages are not lyrics;
    * hint: lyrics the user imported, given to Whisper as words to expect."""
    if not has_whisper():
        return None
    report(f"กำลังตรวจว่ามีเสียงร้องไหม (Whisper {Path(WHISPER_MODEL).name})", None)
    try:
        small = _whisper_model()
        y16 = librosa.resample(np.asarray(y, np.float32), orig_sr=SR, target_sr=16000)
        pres = pres or vocal_presence(small, y16, voice_share)
        log.info("vocal presence: %s", {k: v for k, v in pres.items() if k not in ("speech", "probe")})
        if not pres["sung"]:
            report("เพลงบรรเลง ไม่มีเสียงร้อง: ข้ามการฟังเนื้อร้อง", None)
            return {"lang": None, "words": [], "instrumental": True, "why": pres["why"]}
        lang = pres.get("lang")
        model, label = small, f"Whisper {Path(WHISPER_MODEL).name}"
        if lang == "th":
            th = thai_whisper(report)
            if th:
                model, label = _whisper_at(th), "Whisper ภาษาไทย"
        if dry_fn and not dereverb_for(lang):
            log.info("lyrics in %s: no de-reverb pass", lang)
            dry_fn = None
        # the plain vocal stem first; the de-reverbed one (de-reverb ~10-30 s + a second Whisper pass) only when that
        # transcript is no answer (it loops or is empty). Tests 2026-11-25, 5 Thai songs at full length
        # (tests/lyrics/dereverb_study.py): with a usable plain transcript the de-reverbed one was picked once
        # (kukkhao, recall 0.323 -> 0.301) and cost 51-284 s a song. DEREVERB_ALWAYS=1: both passes every time.
        always = dry_fn is not None and os.environ.get("DEREVERB_ALWAYS", "0") == "1"
        # progress of the lyrics stage (0-1): one Whisper pass per version of the stem
        best = _transcribe(model, y16, lang, f"{label} · เสียงร้อง", report, hotwords=hint,
                           span=(0.05, 0.55) if always else (0.05, 0.9) if dry_fn else (0.05, 0.98))
        best["source"] = "เสียงร้อง"
        y_dry = None
        if dry_fn and (always or not _pick_score(best)[0]):
            if not always:
                log.info("plain transcript is no answer %s: de-reverbed pass", _pick_score(best))
                report("ฟังอีกรอบจากเสียงร้องที่ลบเสียงก้อง (รอบแรกฟังไม่ชัด)", 0.9)
            y_dry = dry_fn()
        if y_dry is not None:
            d16 = librosa.resample(np.asarray(y_dry, np.float32), orig_sr=SR, target_sr=16000)
            r = _transcribe(model, d16, lang, f"{label} · ไม่มีเสียงก้อง", report, hotwords=hint,
                            span=(0.55, 0.98) if always else (0.92, 0.98))
            r["source"] = "ไม่มีเสียงก้อง"
            log.info("plain %s / de-reverbed %s", _pick_score(best), _pick_score(r))
            if _pick_score(r) > _pick_score(best):
                best = r
        src = best["source"]
        # (dropping words outside the voice detector's regions was tried: it removed real sung words, 90% -> 87%)
        words = clean_words(best["words"], None, spoken)
        log.info("lyrics from %s: %d words (%d after cleaning), confidence %.3f, loops %.3f",
                 src, len(best["words"]), len(words), best["conf"], best["loops"])
        out = {"lang": best["lang"], "words": words, "model": label, "source": src, "conf": round(best["conf"], 3)}
        if best["cut"]:
            out["cut"] = True
        return out
    except Exception as e:
        log.warning("whisper failed: %s", e)
        return None


def _char_alignment(a: str, b: str) -> list[int]:
    """For each character of b, the index of the character of a it lines up with in an optimal common subsequence
    (-1 when unmatched). Plain DP; a and b are a few thousand characters at most."""
    n, m = len(a), len(b)
    L = np.zeros((n + 1, m + 1), np.int32)
    av, bv = np.array([ord(c) for c in a]), np.array([ord(c) for c in b])
    for i in range(1, n + 1):
        eq = (bv == av[i - 1]).astype(np.int32)
        diag = L[i - 1, :-1] + eq
        L[i, 1:] = np.maximum.accumulate(np.maximum(L[i - 1, 1:], diag))
    out = [-1] * m
    i, j = n, m
    while i > 0 and j > 0:
        if a[i - 1] == b[j - 1] and L[i, j] == L[i - 1, j - 1] + 1:
            out[j - 1] = i - 1
            i, j = i - 1, j - 1
        elif L[i - 1, j] >= L[i, j - 1]:
            i -= 1
        else:
            j -= 1
    return out


def relisten_lyrics(workdir: Path, text: str, report: Report) -> dict | None:
    """Second Whisper pass when the user has the real lyrics (imported from a web page, a file or a picture):
    the first pass says roughly where each line is sung; each ~30 s window is then transcribed again with the
    lines expected there given to Whisper as words to expect, so it writes those words, with their timing."""
    cache = workdir / "lyrics.json"
    if not has_whisper() or not cache.exists():
        return None
    first = json.loads(cache.read_text("utf-8"))
    words1 = first.get("words") or []
    ref = re.sub(r"\s+", " ", text).strip()
    if not words1 or len(ref) < 10:
        return None
    stem = next((workdir / "stems").glob("*/*/vocals.wav"), None)
    dry = workdir / "vocals_dry.wav"
    src = dry if first.get("source") == "ไม่มีเสียงก้อง" and dry.exists() else stem
    y16, _ = librosa.load(src, sr=16000, mono=True) if src else (None, None)
    if y16 is None:
        return None
    # where in the lyrics each first-pass word sits
    hyp, owner = "", []
    for k, w in enumerate(words1):
        t = w["text"].replace(" ", "")
        hyp += t
        owner += [k] * len(t)
    refc = ref.replace(" ", "")
    pos_of_ref = [i for i, c in enumerate(ref) if c != " "]  # refc index -> ref index
    al = _char_alignment(refc, hyp)
    wpos: dict[int, list[int]] = {}
    for j, i in enumerate(al):
        if i >= 0:
            wpos.setdefault(owner[j], []).append(pos_of_ref[i])
    model = _whisper_model()
    if first.get("model") == "Whisper ภาษาไทย":
        th = thai_whisper(report)
        model = _whisper_at(th) if th else model
    words = []
    dur = len(y16) / 16000
    t = 0.0
    while t < dur:
        # window of at most 29 s, cut in the longest pause between first-pass words in its second half
        gaps = [((words1[k + 1]["t0"] - words1[k]["t1"]), (words1[k]["t1"] + words1[k + 1]["t0"]) / 2)
                for k in range(len(words1) - 1) if t + 12 <= words1[k]["t1"] and words1[k + 1]["t0"] <= t + 29]
        end = max(gaps)[1] if gaps and t + 29 < dur else min(dur, t + 29)
        W = end - t
        inwin = [k for k, w in enumerate(words1) if t <= w["t0"] < t + W and k in wpos]
        if inwin:
            lo = min(min(wpos[k]) for k in inwin)
            hi = max(max(wpos[k]) for k in inwin)
            hint = ref[max(0, lo - 20): hi + 40]
            hint = hint[:300]
            a = y16[int(t * 16000): int((t + W) * 16000)]
            r = _transcribe(model, a, first.get("lang"), "เทียบกับเนื้อร้องที่นำเข้า", report, offset=t, hotwords=hint, quick=True)
            words += [w for w in r["words"] if w["t0"] < t + W]
        else:  # no lyrics known for this window: keep what the first pass heard
            words += [w for w in words1 if t <= w["t0"] < t + W]
        report(f"กำลังฟังเนื้อร้องอีกรอบ โดยเทียบกับเนื้อที่นำเข้า {min(100, int((t + W) / dur * 100))}%", None)
        t = end
    words = clean_words(words)
    out = {**first, "words": words, "hinted": True}
    (workdir / "lyrics_hinted.json").write_text(json.dumps(out, ensure_ascii=False), "utf-8")
    return out


# ---------------------------------------------------------------- warm-up
def warm_up() -> dict[str, float]:
    """Load the models and compile librosa's numba code once, while the app waits for its first song, so that song
    does not pay for it (M3 Max, 60 s clip: first sheet 16.7 s, the next one 13.5 s). Each piece on its own: a model
    that is not installed or fails is skipped. Returns seconds per piece (for the log)."""
    import tempfile
    import time

    n = SR * 6
    t = np.arange(n) / SR
    y = (0.2 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.sin(2 * np.pi * 330 * t)
         + 0.01 * np.random.default_rng(0).standard_normal(n)).astype(np.float32)
    took: dict[str, float] = {}
    with tempfile.TemporaryDirectory() as tmp:
        steps = [
            ("beats", lambda: track_beats(y)),
            ("beat_this", lambda: beat_this_beats(y)),
            ("basic_pitch", lambda: basic_pitch(y, Path(tmp), "warm")),
            ("btc", lambda: CN.available() and CN.beat_log_probs(y, SR, np.arange(0.0, 6.0, 0.5), 6.0)),
            ("rmvpe", lambda: _warm_rmvpe(y)),
            ("whisper", lambda: lyrics_presence(y, None)),
        ]
        for name, fn in steps:
            t0 = time.perf_counter()
            try:
                fn()
            except Exception as e:
                log.info("warm-up %s skipped: %s", name, e)
            took[name] = round(time.perf_counter() - t0, 2)
    ONSETS.clear()
    return took


def _warm_rmvpe(y: np.ndarray) -> None:
    if MELODY_ENGINE == "basic":
        return
    from . import rmvpe as RM

    if RM.ckpt_path().exists():
        RM.pitch(y, SR)


# ---------------------------------------------------------------- run
class Progress:
    """One status line for two jobs running side by side: the main stages (chords, beats ...) and, after a dash,
    the lyrics stage. The fraction never goes back."""

    def __init__(self, report: Report):
        import threading

        self.report, self.lock = report, threading.Lock()
        self.main, self.p, self.side = "", 0.0, None

    def __call__(self, msg: str, p: float | None = None) -> None:
        with self.lock:
            self.main, self.p = msg, max(self.p, p if p is not None else self.p)
            self._emit()

    def lyrics(self, msg: str | None, p: float | None = None) -> None:
        """Lyrics-stage message; p = how much of the lyrics stage is done (0-1), shown as job progress 0.90-0.99
        (the page reads that range as the lyrics' own progress bar, web/parts/js_lyrics.js waitLyrics)."""
        with self.lock:
            self.side = msg
            if p is not None:
                self.p = max(self.p, LY_P0 + (LY_P1 - LY_P0) * min(1.0, max(0.0, p)))
            self._emit()

    def _emit(self) -> None:
        if self.side and self.side.startswith(self.main):  # "listening to lyrics · listening to lyrics (Whisper)" -> once
            self.report(self.side, self.p)
        else:
            self.report(self.main + (f" · {self.side}" if self.side else ""), self.p)


LY_P0, LY_P1 = 0.90, 0.99  # job progress while the words are heard after the sheet is out
SLOW_TEMPO_BPM = 50  # below this the beat tracker has counted half notes (or dotted halves): count twice as many


def spoken_passages(voice: np.ndarray, harm: np.ndarray, min_len: float = 5.0) -> list[tuple[float, float]]:
    """Stretches of 5 s or more where a voice is loud but the band is (almost) silent: a spoken introduction or
    announcement (the national anthem recording opens with 15 s of speech). Not lyrics, no chords, no melody."""
    hop = SR
    n = min(len(voice), len(harm)) // hop
    if n < min_len:
        return []
    rv = np.array([np.sqrt(np.mean(voice[i * hop:(i + 1) * hop] ** 2)) for i in range(n)]) + 1e-9
    rh = np.array([np.sqrt(np.mean(harm[i * hop:(i + 1) * hop] ** 2)) for i in range(n)]) + 1e-9
    v_db = 20 * np.log10(rv / np.percentile(rv, 90))
    h_db = 20 * np.log10(rh / np.percentile(rh, 90))
    flag = (v_db > -18) & (h_db < -22)
    flag = np.convolve(flag.astype(float), np.ones(3) / 3, "same") >= 0.6  # bridge single-second gaps
    out, i = [], 0
    while i < n:
        if flag[i]:
            j = i
            while j < n and flag[j]:
                j += 1
            if j - i >= min_len:
                out.append((float(i), float(j)))
            i = j
        else:
            i += 1
    return out


def input_warnings(y: np.ndarray, dur: float) -> list[str]:
    """Things about the file itself that will lower the result, said up front."""
    w = []
    if dur > 600:
        w.append("ไฟล์ยาวกว่า 10 นาที: ใช้เวลาแกะนาน และเพลงที่ต่อกันหลายเพลงจะได้คีย์/จังหวะปนกัน")
    if dur < 15:
        w.append("ไฟล์สั้นกว่า 15 วินาที: ข้อมูลไม่พอสำหรับคีย์และจังหวะ")
    rms = float(np.sqrt(np.mean(y ** 2))) + 1e-12
    if 20 * np.log10(rms) < -40:
        w.append("เสียงเบามาก: ผลอาจไม่แม่น ลองเพิ่มความดังของไฟล์")
    else:
        # a brick-wall cut between 2.5 and 7 kHz (heavy MP3 compression, phone or call recordings): the average
        # spectrum falls 12+ dB within 300 Hz. Real songs, solo piano included, fall at most ~8 dB there.
        S = np.abs(librosa.stft(y[: SR * 120], n_fft=2048)) ** 2
        ltas = 10 * np.log10(S.mean(1) + 1e-12)
        f = librosa.fft_frequencies(sr=SR, n_fft=2048)
        k = int(300 / (f[1] - f[0]))
        drop = max((ltas[i - k:i].mean() - ltas[i:i + k].mean() for i in range(k, len(f) - k) if 2500 <= f[i] <= 7000), default=0.0)
        if drop >= 12:
            w.append("คุณภาพเสียงต่ำ (เสียงแหลมหายไป เช่นไฟล์บีบอัดมากหรืออัดจากโทรศัพท์): คอร์ดและเนื้อร้องอาจคลาดเคลื่อน")
    return w


def chord_alternatives(small_lp: np.ndarray, n: int = 3, floor: float = 0.05) -> list[list[list]]:
    """Per beat, the chords BTC's major/minor model found most likely: [[root, minor 0/1, probability], ...] (up to n,
    at least `floor`). The page offers them when a chord is corrected (the right one is often BTC's second choice)."""
    pr = np.exp(small_lp[:, :24] - small_lp.max(axis=1, keepdims=True))
    pr = pr / np.maximum(1e-9, np.exp(small_lp - small_lp.max(axis=1, keepdims=True)).sum(axis=1, keepdims=True))
    out = []
    for row in pr:
        top = np.argsort(-row)[:n]
        out.append([[int(k // 2), int(k % 2), round(float(row[k]), 2)] for k in top if row[k] >= floor])
    return out


def analyze_file(src: Path, workdir: Path, report: Report, title: str = "", tune: str = "auto", tempo: str = "auto",
                 on_partial: Callable[[dict], None] | None = None) -> dict:
    """Whole analysis -> result. With on_partial, a song with singing first gets the sheet without words
    (lyrics: None, lyrics_pending: True) as soon as chords, key and melody are ready; the return value adds the words."""
    if not TUNE:
        tune = "off"
    report = Progress(report)
    report("กำลังเปิดไฟล์เสียง", 0.16)
    y = load_mono(src)
    dur = len(y) / SR
    warnings = input_warnings(y, dur)

    # Demucs runs in its own process (16-21 s a song): meanwhile this one works out what needs only the mix,
    # the beats (Beat This!) and BTC's chord probabilities per frame; once the stems are there, "is anyone singing?"
    # and the bass notes go beside the beat and chord stages. Same numbers (tests/regress); M3 Max, 3 songs, 2 rounds:
    # 115-122 s -> 107 s to the sheet (either half alone gained 0-4 s: the two together keep the cores busy).
    # Machines with 6+ cores (fewer: each stage would only slow the other); SHEET_OVERLAP=0/1 forces it.
    from concurrent.futures import ThreadPoolExecutor

    side = ThreadPoolExecutor(max_workers=3, thread_name_prefix="sheet")
    early_bt = side.submit(beat_this_beats, y) if SHEET_OVERLAP else None  # the model was trained on full mixes
    early_btc = side.submit(CN.frame_log_probs, y, SR) if CN.available() and SHEET_OVERLAP else None
    stems = separate(src, workdir, report)
    separated = stems is not None
    if separated:
        harm = stems["bass"] + stems["other"]
        rhythm = stems["drums"] + 0.5 * stems["bass"]
        voice = stems["vocals"]
        stems_orig_vocals = voice
    else:
        harm, rhythm, voice = y, y, None
    spoken = spoken_passages(voice, harm) if separated else []
    if spoken:
        log.info("spoken passages: %s", spoken)

    # lyrics (de-reverb + Whisper) need only the vocal stem: run them beside the chord / beat stages
    cache = workdir / "lyrics.json"  # words do not depend on tuning: re-analysis reuses them
    lyrics_job = None

    def lyrics_task(pres=None):
        share = float(np.sum(stems_orig_vocals ** 2) / max(1e-9, np.sum(y ** 2))) if separated else None
        dry = (lambda: dereverb_vocals(stems_orig_vocals, workdir, report.lyrics)) if separated else None
        try:
            return transcribe_lyrics(stems_orig_vocals if separated else y, workdir, report.lyrics, share, dry, spoken, pres=pres)
        finally:
            report.lyrics(None)

    if not cache.exists() and has_whisper() and PARALLEL:
        pool = ThreadPoolExecutor(max_workers=1)
        lyrics_job = pool.submit(lyrics_task)
        pool.shutdown(wait=False)
    share = float(np.sum(stems_orig_vocals ** 2) / max(1e-9, np.sum(y ** 2))) if separated else None
    early_pres = (side.submit(lyrics_presence, stems_orig_vocals if separated else y, share)
                  if not cache.exists() and lyrics_job is None and has_whisper() and SHEET_OVERLAP else None)
    early_bass = side.submit(basic_pitch, stems["bass"], workdir, "bass") if separated and SHEET_OVERLAP else None
    side.shutdown(wait=False)

    report("กำลังจับจังหวะ", 0.5)
    beats, bpm, beat_onset, onset_env = track_beats(rhythm)
    downbeats = None
    bt = early_bt.result() if early_bt is not None else beat_this_beats(y)
    if bt is not None:
        beats, downbeats = bt
        bpm = tempo_of(beats)
        beat_onset = onset_at(onset_env, beats)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    rt = librosa.frames_to_time(np.arange(len(rms)), sr=SR, hop_length=512)

    def rms_of(beats):
        return np.array([rms[(rt >= t0) & (rt < (beats[i + 1] if i + 1 < len(beats) else dur))].mean()
                         if ((rt >= t0) & (rt < (beats[i + 1] if i + 1 < len(beats) else dur))).any() else 0.0
                         for i, t0 in enumerate(beats)])
    rms_beats = rms_of(beats)

    # recordings that are not tuned to A440 smear across two semitones. Retune only when the offset is
    # clear (big enough, the same at the start, middle and end) AND the retuned audio fits chord shapes better.
    est, spread = estimate_tuning_segments(harm) if tune != "off" else (0.0, 0.0)
    tuning, tscale, tune_note = 0.0, 1.0, "off" if tune == "off" else "small"
    report("กำลังฟังโน้ตของดนตรี (Basic Pitch)", 0.6)
    post, mix_notes = basic_pitch(harm, workdir, "harm")
    if tune != "off" and abs(est) >= TUNE_MIN:
        tune_note = "unstable"
        if spread <= TUNE_SPREAD:
            ts = 2 ** (-est / 12)
            retune = lambda a: librosa.resample(a, orig_sr=SR, target_sr=SR / ts)
            post_t, mix_t = basic_pitch(retune(harm), workdir, "harm_tuned")
            fit0 = chord_fit(*beat_profiles(post, None, beats, dur, rms_beats))
            fit1 = chord_fit(*beat_profiles(post_t, None, beats, dur, rms_beats, ts))
            log.info("tuning est %.2f spread %.2f fit %.3f -> %.3f", est, spread, fit0, fit1)
            tune_note = "worse"
            if fit1 > fit0 + TUNE_GAIN * abs(fit0):
                tuning, tscale, tune_note = est, ts, "applied"
                post, mix_notes = post_t, mix_t
                if separated:
                    stems = {**stems, "bass": retune(stems["bass"]), "vocals": retune(stems["vocals"])}
                    voice = stems["vocals"]
    rm_job = start_rmvpe(voice) if separated else None  # the vocal stem is final here (retuned or not)
    refined = refine_grid(beats, post, tscale, dur, tempo) if downbeats is None or tempo != "auto" else beats
    if downbeats is not None and tempo != "auto":
        downbeats = None  # the user overrode the counting: bars come from the harmony instead
    tempo_note = None
    if tempo == "auto" and len(refined) > 8 and tempo_of(refined) < SLOW_TEMPO_BPM:
        p = float(np.median(np.diff(refined)))
        mid = refined[:-1] + np.diff(refined) / 2
        refined = np.sort(np.concatenate([refined, mid, [refined[-1] + p / 2] if refined[-1] + p / 2 < dur else []]))
        tempo_note = "doubled"
        log.info("tempo below %d BPM: counting twice as many beats", SLOW_TEMPO_BPM)
    if len(refined) != len(beats) or not np.allclose(refined, beats):
        beats = refined
        bpm = tempo_of(beats)
        rms_beats, beat_onset = rms_of(beats), onset_at(onset_env, beats)
    if separated:  # retuned: the bass notes again, from the retuned stem
        bass_post = early_bass.result()[0] if early_bass is not None and tscale == 1.0 else basic_pitch(stems["bass"], workdir, "bass")[0]
    else:
        bass_post = None

    report("กำลังแกะคอร์ด", 0.78)
    pcs, bss, low = beat_profiles(post, bass_post, beats, dur, rms_beats, tscale)
    chords = CH.decode_chords(pcs, bss, low)
    # bars: from the downbeat model when installed, else from where this first pass changes chords
    meter = meter_from_downbeats(beats, downbeats) if downbeats is not None else None
    meter = meter or {**CH.meter_from_chords(chords, beat_onset, bpm), "source": "harmony"}
    # bar starts: the downbeat model's bars (cleaned) can shift where a beat tracker slipped; else one fixed phase
    bar_starts = bar_starts_from_downbeats(beats, downbeats, meter["bpb"]) if meter.get("source") == "beat_this" else None
    if bar_starts:
        meter["phase"] = int(np.bincount([b % meter["bpb"] for b in bar_starts], minlength=meter["bpb"]).argmax())
    chg = change_costs_from_bars(len(pcs), bar_starts) if bar_starts else CH.change_costs(len(pcs), meter["bpb"], meter["phase"])
    if BAR_AWARE:
        pcs_v = CH.repeat_vote(pcs, meter["bpb"], meter["phase"]) if REPEAT_VOTE else pcs
        bonus = CH.key_bonus(CH.local_scales(chords, meter["bpb"], meter["phase"])) if KEY_AWARE else None
        chords = CH.decode_chords(pcs_v, bss, low, chg, bonus)
    chord_engine, alts = "template", None
    if CN.available():
        # learned chord model (BTC) on the full mix it was trained on; detail level and bass as before
        try:
            report("กำลังแกะคอร์ดด้วย AI (BTC)", 0.8)
            yb, bb = (librosa.resample(y, orig_sr=SR, target_sr=SR / tscale), beats / tscale) if tscale != 1.0 else (y, beats)
            frames = early_btc.result() if early_btc is not None and tscale == 1.0 else None
            s_lp, l_lp = CN.beat_log_probs(yb, SR, bb, dur / tscale, frames)
            chords = CH.decode_btc(s_lp, l_lp, bss, low, chg, pcs=pcs)
            chord_engine = "btc"
            alts = chord_alternatives(s_lp)
        except Exception as e:
            log.warning("BTC chord model failed, using the template decoder: %s", e)
    if spoken:  # a spoken announcement has no chords
        for i, t in enumerate(beats):
            if any(a <= t < b for a, b in spoken):
                chords[i] = {"root": -1, "q": "", "bass": -1}
    key = CH.key_from_chords(chords)
    phase = int(meter["phase"])

    pres, pending = None, False
    if cache.exists():
        lyrics = json.loads(cache.read_text("utf-8"))
    elif lyrics_job is not None:
        report("กำลังรอเนื้อร้อง", 0.9)
        lyrics = lyrics_job.result()
        if lyrics:
            cache.write_text(json.dumps(lyrics, ensure_ascii=False), "utf-8")
    elif has_whisper():
        # the long Whisper pass (1.5-9 min) comes after the melody: the sheet (chords, key, melody) is handed out
        # first through on_partial, and the words follow. Only the quick "is anyone singing?" check is needed now.
        report("กำลังตรวจว่ามีเสียงร้องไหม", 0.88)
        pres = early_pres.result() if early_pres is not None else lyrics_presence(stems_orig_vocals if separated else y, share)
        lyrics = None
        pending = True
    else:
        lyrics = None
    if pending and (pres is None or not pres["sung"] or on_partial is None):  # nothing to win: finish the words now
        report("กำลังฟังเนื้อร้อง", 0.9)
        lyrics = lyrics_task(pres)
        pending = False
        if lyrics:
            cache.write_text(json.dumps(lyrics, ensure_ascii=False), "utf-8")

    # melody: which notes carry the tune depends on whether someone sings (tests/melody, 2026-11):
    #  sung + vocal stem -> the voice (path tracker, fragments joined)
    #  sung, no stem     -> the voice-like line in the mix (22% -> 75% agreement with the singer)
    #  instrumental      -> the top line of the instruments (the empty vocal stem gave 9% on a piano piece, now 50%)
    report("กำลังแกะทำนอง", 0.9 if pending else 0.97)
    instrumental = bool(lyrics and lyrics.get("instrumental")) or (share is not None and share < 0.01)
    sung = not instrumental and (separated or bool(lyrics and lyrics.get("words")) or bool(pending and pres["sung"]))
    melody_engine = "basic-pitch"
    if instrumental or not sung:
        notes = tidy_melody(melody_line(mix_notes, lo=60, min_amp=0.3, prefer="high"), beats / tscale)
        melody_src = "instrument"
    elif separated:
        notes, melody_engine = sung_melody(voice, workdir, beats / tscale, key, rm_job)
        melody_src = "vocals"
    else:
        notes = melody_track(mix_notes, beats / tscale, mode="voice", key=key)
        melody_src = "mix-voice"
    if tscale != 1.0:  # melody was heard on retuned audio: map its times back to the original
        notes = [{**n, "t0": round(n["t0"] * tscale, 3), "t1": round(n["t1"] * tscale, 3)} for n in notes]
    if spoken:
        notes = [n for n in notes if not any(a <= (n["t0"] + n["t1"]) / 2 < b for a, b in spoken)]

    out = {
        "engine": "server",
        "tuning": round(tuning * 100),
        "tuning_est": round(est * 100),
        "tune": tune,
        "tempo": tempo,
        "tune_note": tune_note,
        "separated": separated,
        "title": title or src.stem,
        "duration": round(dur, 3),
        "bpm": int(bpm),
        "beats": [round(float(t), 3) for t in beats],
        "chords": chords,
        "phase": int(phase),
        "meter": {k: meter[k] for k in ("num", "den", "bpb", "phase", "source")},
        "bar_starts": bar_starts,
        "chord_engine": chord_engine,
        "alts": alts,
        "key": key,
        "flats": CH.use_flats(key),
        "notes": notes,
        "melody_src": melody_src,
        "melody_engine": melody_engine,
        "spoken": [[round(a, 1), round(b, 1)] for a, b in spoken],
        "tempo_note": tempo_note,
        "warnings": warnings,
        "accent": [round(float(a), 3) for a in beat_onset],
        "lyrics": lyrics,
    }
    if pending:
        on_partial({**out, "lyrics_pending": True})
        report("กำลังฟังเนื้อร้อง", 0.9)
        out["lyrics"] = lyrics_task(pres)
        if out["lyrics"]:
            cache.write_text(json.dumps(out["lyrics"], ensure_ascii=False), "utf-8")
    report("เสร็จแล้ว", 1.0)
    return out
