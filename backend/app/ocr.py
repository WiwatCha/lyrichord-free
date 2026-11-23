"""Lyrics / chord-sheet OCR with PaddleOCR PP-OCRv5 models run on onnxruntime (no PaddlePaddle needed).

Detector: PP-OCRv5_mobile_det (DB).  Recogniser: th_PP-OCRv5_mobile_rec (Thai + Latin letters, digits, #, /).
Measured on Thai chord sheets: Thai text 0.1-1.5 % character errors, chord symbols ~98 % (Tesseract: ~5 % / 58-77 %,
EasyOCR: 4-8 % / 0 %). Models: ~13 MB. Output keeps each word's x position so chords land over the right syllable.
"""
from __future__ import annotations

import io
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

MODEL_DIR = Path(os.environ.get("OCR_MODEL_DIR", "/opt/models/ppocr"))
DET = MODEL_DIR / "PP-OCRv5_mobile_det.onnx"
REC = MODEL_DIR / "th_PP-OCRv5_mobile_rec.onnx"
DICT = MODEL_DIR / "th_dict.txt"
_S = {}


def available() -> bool:
    return DET.exists() and REC.exists() and DICT.exists() and os.environ.get("USE_OCR", "1") != "0"


def _sessions():
    if not _S:
        import onnxruntime as ort
        o = ort.SessionOptions(); o.log_severity_level = 3
        _S["det"] = ort.InferenceSession(str(DET), o, providers=["CPUExecutionProvider"])
        _S["rec"] = ort.InferenceSession(str(REC), o, providers=["CPUExecutionProvider"])
        chars = DICT.read_text("utf-8").split("\n")
        _S["chars"] = ["<blank>"] + chars + [" "]
    return _S


def _detect(img: np.ndarray, limit: int = 1600) -> list[tuple[int, int, int, int]]:
    """Text boxes (x0, y0, x1, y1) from the DB detector."""
    h, w = img.shape[:2]
    r = min(1.0, limit / max(h, w))
    nh, nw = max(32, int(round(h * r / 32)) * 32), max(32, int(round(w * r / 32)) * 32)
    x = np.asarray(Image.fromarray(img).resize((nw, nh), Image.BILINEAR), np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    prob = _sessions()["det"].run(None, {_sessions()["det"].get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    lab, n = ndimage.label(prob > 0.3)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None: continue
        ys, xs = sl
        if (ys.stop - ys.start) < 3 or (xs.stop - xs.start) < 3: continue
        if prob[sl][lab[sl] == i].mean() < 0.6: continue
        bh, bw = ys.stop - ys.start, xs.stop - xs.start
        d = (bh * bw) * 1.5 / (2 * (bh + bw))  # DB "unclip": grow the shrunk text kernel back
        sx, sy = w / nw, h / nh
        boxes.append((max(0, int((xs.start - d) * sx)), max(0, int((ys.start - d) * sy)), min(w, int((xs.stop + d) * sx)), min(h, int((ys.stop + d) * sy))))
    return boxes


PAD = float(os.environ.get("OCR_PAD", "0"))


def _recognise(img: np.ndarray, box) -> tuple[str, float, list[float]]:
    x0, y0, x1, y1 = box
    p = int(round(PAD * (y1 - y0)))  # a little margin around the word, as PaddleOCR's own crop
    x0, y0, x1, y1 = max(0, x0 - p), max(0, y0 - p), min(img.shape[1], x1 + p), min(img.shape[0], y1 + p)
    crop = Image.fromarray(img[y0:y1, x0:x1])
    tw = max(16, min(3200, int(round(crop.width * 48 / max(1, crop.height)))))
    a = np.asarray(crop.resize((tw, 48), Image.BILINEAR), np.float32) / 255.0
    a = ((a - 0.5) / 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    if tw < 320:  # as PaddleOCR: short words are padded (not stretched) to the model's 320-px width
        a = np.concatenate([a, np.zeros((1, 3, 48, 320 - tw), np.float32)], axis=3)
    s = _sessions(); out = s["rec"].run(None, {s["rec"].get_inputs()[0].name: a})[0][0]  # (T, C)
    idx, conf = out.argmax(1), out.max(1)
    text, confs, xs, prev = [], [], [], 0
    T = len(idx)
    for t, k in enumerate(idx):
        if k != 0 and k != prev and k < len(s["chars"]):
            text.append(s["chars"][k]); confs.append(float(conf[t])); xs.append(x0 + (x1 - x0) * (t + 0.5) / T * max(320, tw) / tw)
        prev = k
    return "".join(text), float(np.mean(confs)) if confs else 0.0, xs


def clean_image(data: bytes) -> np.ndarray:
    """RGB array; faint watermarks (light grey logos on chord sites) are pushed to white."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    grey = a.mean(2)
    sat = a.max(2) - a.min(2)
    a[(grey > 170) & (sat < 40)] = 255  # light, colourless pixels -> background
    return a.clip(0, 255).astype(np.uint8)


def read_lines(data: bytes) -> list[dict]:
    """Text lines top to bottom: {text, y, words: [{text, x0, x1, chars_x}]} with x in image pixels."""
    img = clean_image(data)
    items = []
    for b in _detect(img):
        t, c, xs = _recognise(img, b)
        if t.strip() and c > 0.3:
            items.append({"text": t, "x0": b[0], "x1": b[2], "y0": b[1], "y1": b[3], "chars_x": xs})
    if not items:
        return []
    h = float(np.median([i["y1"] - i["y0"] for i in items]))
    items.sort(key=lambda i: (i["y0"] + i["y1"]) / 2)
    lines, cur = [], []
    for it in items:
        cy = (it["y0"] + it["y1"]) / 2
        if cur and abs(cy - np.mean([(c["y0"] + c["y1"]) / 2 for c in cur])) > 0.5 * h:
            lines.append(cur); cur = []
        cur.append(it)
    if cur: lines.append(cur)
    out = []
    for ln in lines:
        ln.sort(key=lambda i: i["x0"])
        out.append({"y": float(np.mean([(i["y0"] + i["y1"]) / 2 for i in ln])), "words": [{"text": i["text"], "x0": i["x0"], "x1": i["x1"], "chars_x": i["chars_x"]} for i in ln]})
    return out
