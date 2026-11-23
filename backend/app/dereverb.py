"""Remove echo / reverb from a vocal stem before Whisper listens to it (UVR "De-Echo-DeReverb" VR model by FoxJoy,
run with the audio-separator package). Runs in its own process, like Demucs, so its memory is freed afterwards.

    python -m app.dereverb IN.wav OUT.wav

The model (~220 MB) is downloaded once into $DATA_DIR/models/uvr (or $UVR_MODEL_DIR) the first time it is needed.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

MODEL = os.environ.get("DEREVERB_MODEL", "UVR-DeEcho-DeReverb.pth")


def model_dir() -> Path:
    d = Path(os.environ.get("UVR_MODEL_DIR") or Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data")) / "models" / "uvr")
    d.mkdir(parents=True, exist_ok=True)
    return d


def available() -> bool:
    return (os.environ.get("USE_DEREVERB", "1") != "0" and os.environ.get("LYRICORD_EDITION") != "free" and importlib.util.find_spec("audio_separator") is not None
            and importlib.util.find_spec("torch") is not None)


def have_model() -> bool:
    return (model_dir() / MODEL).exists()


def separator_class():
    """audio-separator refuses to start without an ffmpeg program; we read and write WAV with soundfile, so skip that."""
    from audio_separator.separator import Separator

    Separator.check_ffmpeg_installed = lambda self: None
    return Separator


def run(src: str, dst: str) -> None:
    if os.environ.get("DEREVERB_THREADS"):
        import torch

        torch.set_num_threads(int(os.environ["DEREVERB_THREADS"]))
    Separator = separator_class()

    out_dir = Path(tempfile.mkdtemp(prefix="dereverb-"))
    try:
        sep = Separator(model_file_dir=str(model_dir()), output_dir=str(out_dir), output_format="WAV", use_soundfile=True,
                        log_level=40)
        sep.load_model(MODEL)
        files = sep.separate(src)
        dry = next(f for f in files if "No Reverb" in f or "No Echo" in f)
        p = Path(dry) if os.path.isabs(dry) else out_dir / dry
        shutil.move(str(p), dst)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
