"""Download every model into <models dir> (run with the bundled Python). Usage: fetch_models.py MODELS_DIR [--lite]"""
import os
import shutil
import sys
import urllib.request
from pathlib import Path

M = Path(sys.argv[1]).resolve()
LITE = "--lite" in sys.argv
DEREVERB = "--no-dereverb" not in sys.argv  # Lyrichord Free leaves the UVR model out (unclear licence)
M.mkdir(parents=True, exist_ok=True)
os.environ["TORCH_HOME"] = str(M / "torch")


def get(url: str, dst: Path) -> None:
    if dst.exists() and dst.stat().st_size > 0:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    print("download", url, flush=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dst)


# OCR: PaddleOCR PP-OCRv5 mobile detector + Thai recogniser (ONNX)
H = "https://huggingface.co/PaddlePaddle/"
get(H + "PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx", M / "ppocr" / "PP-OCRv5_mobile_det.onnx")
get(H + "th_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx", M / "ppocr" / "th_PP-OCRv5_mobile_rec.onnx")
d = M / "ppocr" / "th_dict.txt"
if not d.exists():
    import yaml

    y = yaml.safe_load(urllib.request.urlopen(H + "th_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml"))
    d.write_text("\n".join(y["PostProcess"]["character_dict"]), encoding="utf-8")

if not LITE:
    # BTC chord model
    for f in ("btc_model.pt", "btc_model_large_voca.pt"):
        get("https://huggingface.co/puar-playground/btc-chord/resolve/main/" + f, M / "btc" / f)
    # Beat This! (beats + downbeats)
    ck = M / "beat_this-final0.ckpt"
    if not ck.exists():
        from beat_this.inference import load_model

        load_model("final0")
        src = next((M / "torch" / "hub" / "checkpoints").glob("beat_this-final0*.ckpt"))
        shutil.move(str(src), ck)
    # RMVPE vocal pitch (sung melody), MIT; checked against its SHA-256
    get("https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt", M / "rmvpe.pt")
    import hashlib

    if hashlib.sha256((M / "rmvpe.pt").read_bytes()).hexdigest() != "6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193":
        (M / "rmvpe.pt").unlink()
        sys.exit("rmvpe.pt: checksum mismatch")
    # Demucs htdemucs (stays in the torch hub cache; the app sets TORCH_HOME to it)
    from demucs.pretrained import get_model

    get_model("htdemucs")
    # Whisper small (CTranslate2 format for faster-whisper)
    if not (M / "whisper-small" / "model.bin").exists():
        from faster_whisper import download_model

        download_model("small", output_dir=str(M / "whisper-small"))
    shutil.rmtree(M / "whisper-small" / ".cache", ignore_errors=True)
    # de-echo / de-reverb of the vocal stem (UVR, FoxJoy) before Whisper
    if DEREVERB and not (M / "uvr" / "UVR-DeEcho-DeReverb.pth").exists():
        from audio_separator.separator import Separator

        Separator.check_ffmpeg_installed = lambda self: None  # WAV via soundfile, no ffmpeg needed
        Separator(model_file_dir=str(M / "uvr"), output_dir=str(M), log_level=40).load_model("UVR-DeEcho-DeReverb.pth")

total = sum(p.stat().st_size for p in M.rglob("*") if p.is_file())
print(f"models ready: {total / 1e6:.0f} MB in {M}", flush=True)
