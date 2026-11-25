"""Make the downloaded models smaller on disk, with the same results (run by fetch_models.py; also on its own:
python desktop/slim_models.py <models dir>). Each step is skipped when its model is missing or already slim.

* Whisper small: the CTranslate2 file ships in float16 (484 MB) but the app loads it as int8 (pipeline.py,
  compute_type="int8"), so CTranslate2 turned it into int8 at every start. Here it is stored as int8 once, with
  CTranslate2's own int8 rule (ctranslate2/specs/model_spec.py, _quantize: one scale per row, 127 / max |w|):
  the weights the app uses are the same, the file is half the size (transcripts identical word for word and in timing).
"""
from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

import numpy as np

DTYPES = ("float32", "int8", "int16", "int32", "float16", "bfloat16")  # CTranslate2 DataType order


def _read_ct2(path: Path):
    f = io.BytesIO(path.read_bytes())
    u = lambda fmt: struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]

    def s() -> str:
        return f.read(u("H"))[:-1].decode("utf-8")

    version, name, revision = u("I"), s(), None
    revision = u("I")
    variables = []
    for _ in range(u("I")):
        vname = s()
        dims = [u("I") for _ in range(u("B"))]
        dtype = DTYPES[u("B")]
        raw = f.read(u("I"))
        variables.append((vname, dims, dtype, raw))
    aliases = [(s(), s()) for _ in range(u("I"))]
    return version, name, revision, variables, aliases


def _write_ct2(path: Path, version, name, revision, variables, aliases) -> None:
    out = io.BytesIO()
    w = lambda fmt, v: out.write(struct.pack(fmt, v))

    def s(x: str) -> None:
        b = x.encode("utf-8")
        w("H", len(b) + 1); out.write(b); w("B", 0)

    w("I", version); s(name); w("I", revision); w("I", len(variables))
    for vname, dims, dtype, raw in variables:
        s(vname); w("B", len(dims))
        for d in dims:
            w("I", d)
        w("B", DTYPES.index(dtype)); w("I", len(raw)); out.write(raw)
    w("I", len(aliases))
    for a, b in aliases:
        s(a); s(b)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(out.getvalue())
    tmp.replace(path)


def _int8(value: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """CTranslate2's int8 quantization (model_spec._quantize), unchanged."""
    value = value.astype(np.float32)
    old_shape = None
    if value.ndim == 3:  # conv1d: one scale per output channel
        old_shape = value.shape
        value = value.reshape(value.shape[0], -1)
    amax = np.amax(np.absolute(value), axis=1)
    amax[amax == 0] = 127.0
    amax = np.maximum(amax, np.float32(127) / np.finfo(np.float32).max)
    scale = (127.0 / amax).astype(np.float32)
    value = value * np.expand_dims(scale, 1)
    value = np.rint(value).astype(np.int8)
    if old_shape:
        value = value.reshape(old_shape)
    return value, scale


def whisper_int8(model_dir: Path) -> str:
    f = model_dir / "model.bin"
    if not f.exists():
        return "whisper: not found"
    version, name, revision, variables, aliases = _read_ct2(f)
    if any(v[2] == "int8" and v[0].endswith("/weight") for v in variables):
        return "whisper: already int8"
    before, out = f.stat().st_size, []
    for vname, dims, dtype, raw in variables:
        # the two audio conv layers stay as they are: CTranslate2 keeps Whisper's conv weights in float at load time
        # (quantizing them too changed the words; without them the words and times are identical, tests 2026-11-25)
        if vname.endswith("/weight") and len(dims) == 2 and dtype in ("float16", "float32"):
            q, scale = _int8(np.frombuffer(raw, dtype=dtype).reshape(dims))
            out.append((vname, dims, "int8", q.tobytes()))
            out.append((vname + "_scale", [len(scale)], "float32", scale.tobytes()))
        else:
            out.append((vname, dims, dtype, raw))
    out.sort(key=lambda v: v[0])
    _write_ct2(f, version, name, revision, out, aliases)
    return f"whisper: {before / 1e6:.0f} -> {f.stat().st_size / 1e6:.0f} MB (int8)"


def slim(models: Path) -> list[str]:
    return [whisper_int8(models / "whisper-small")]


if __name__ == "__main__":
    for line in slim(Path(sys.argv[1])):
        print(line)
