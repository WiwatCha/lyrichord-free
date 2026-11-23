"""Song library: every analysed song stays on this computer, with the user's edits, until the user deletes it.

    <DATA>/<job id>/song.json   the analysis result + title, kind, YouTube id, SHA-256 of the audio, times
    <DATA>/<job id>/edits.json  what the user changed (the page's savedData: chords, lyrics, key shift, bars)
    <DATA>/<job id>/upload.* | youtube audio   the song itself

Working files (separated stems, Basic Pitch audio, de-reverbed vocals; ~100 MB a song) are kept for the most
recent KEEP_FULL songs only; an older song re-analysed makes them again (Demucs ~20 s).
"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

KEEP_FULL = int(os.environ.get("KEEP_FULL", 10))
SONG, EDITS = "song.json", "edits.json"
WORK_FILES = ("bp_*.wav", "vocals_dry.wav", "vocals_for_dereverb.wav", "*_dry*.wav")


def _write(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), "utf-8")
    tmp.replace(path)  # never a half-written file, even if the app is closed mid-save


def save_song(d: Path, meta: dict, result: dict) -> None:
    old = read_song(d) or {}
    now = time.time()
    _write(d / SONG, {"v": 1, **{k: v for k, v in old.items() if k not in ("result",)}, **meta,
                      "created": old.get("created", meta.get("created", now)), "updated": now, "result": result})


def read_song(d: Path) -> dict | None:
    try:
        return json.loads((d / SONG).read_text("utf-8"))
    except Exception:
        return None


def read_edits(d: Path) -> dict | None:
    try:
        return json.loads((d / EDITS).read_text("utf-8"))
    except Exception:
        return None


def save_edits(d: Path, edits: dict) -> None:
    _write(d / EDITS, edits)
    s = read_song(d)
    if s:
        s["updated"] = time.time()
        _write(d / SONG, s)


def summary(d: Path, s: dict) -> dict:
    """One row of the library list (no big arrays)."""
    r = s.get("result") or {}
    e = read_edits(d) or {}
    ly = r.get("lyrics") or {}
    lines = e.get("lines")
    return {"id": s["id"], "title": s.get("title") or s["id"], "kind": s.get("kind"), "vid": s.get("vid"),
            "duration": r.get("duration"), "key": r.get("key"), "bpm": r.get("bpm"), "created": s.get("created"),
            "updated": s.get("updated"), "edited": bool(e.get("edits") or lines or e.get("tr") or e.get("sheetChords")),
            "lyrics": len(lines) if lines else (1 if ly.get("words") else 0), "instrumental": bool(ly.get("instrumental"))}


def all_songs(data: Path) -> list[tuple[Path, dict]]:
    out = []
    for d in data.iterdir() if data.exists() else []:
        s = read_song(d) if d.is_dir() else None
        if s and s.get("id") == d.name and (s.get("result") or {}).get("chords"):
            out.append((d, s))
    return sorted(out, key=lambda x: -(x[1].get("updated") or 0))


def trim(d: Path) -> int:
    """Drop the working files of a song (stems etc.); its audio, result and edits stay. Bytes freed."""
    freed = 0
    st = d / "stems"
    if st.exists():
        freed += sum(f.stat().st_size for f in st.rglob("*") if f.is_file())
        shutil.rmtree(st, ignore_errors=True)
    for pat in WORK_FILES:
        for f in d.glob(pat):
            freed += f.stat().st_size
            f.unlink(missing_ok=True)
    return freed


def trim_old(data: Path, busy: set[str]) -> None:
    """Keep the working files of the KEEP_FULL most recently used songs only."""
    for d, _ in all_songs(data)[KEEP_FULL:]:
        if d.name not in busy and (d / "stems").exists():
            trim(d)
