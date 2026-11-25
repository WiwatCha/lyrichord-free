"""Watched folder ("Lyrichord Inbox"): audio files put there are analysed on their own and land in the song library.

    LYRICORD_INBOX=<folder>   on (the desktop app sets ~/Music/Lyrichord Inbox; empty or unset = off)

* checked every few seconds (no extra package); a file is taken once its size and time stop changing (still copying
  otherwise) and it is a couple of seconds old; sub-folders too, in name order (1, 2, 10), like adding many files;
* taken = copied into the app as an upload and moved to "<folder>/แกะแล้ว" (Done), so it is never taken twice;
  the very same file already in the library is only moved (the library song stays as it is);
* hidden files and unfinished downloads (.part, .crdownload, .download) are left alone, other files too.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger("inbox")

AUDIO = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".aif", ".aiff", ".wma", ".webm", ".mp4", ".m4v", ".mov"}
PARTIAL = {".part", ".crdownload", ".download", ".tmp"}
DONE = "แกะแล้ว"
EVERY = float(os.environ.get("INBOX_EVERY", 3))
SETTLE = 2.0  # seconds a file must be left alone before it is taken


def folder() -> Path | None:
    p = os.environ.get("LYRICORD_INBOX", "").strip()
    return Path(p).expanduser() if p and p != "0" else None


def _natural(p: Path) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(p))]


def candidates(root: Path) -> list[Path]:
    out = []
    for p in root.rglob("*"):
        rel = p.relative_to(root).parts
        if rel[0] == DONE or any(x.startswith(".") for x in rel) or not p.is_file():
            continue
        if p.suffix.lower() in AUDIO and p.suffix.lower() not in PARTIAL:
            out.append(p)
    return sorted(out, key=_natural)


def move_done(root: Path, p: Path) -> Path:
    """Move a taken file to <root>/แกะแล้ว/<same sub-folder>/, never over another file."""
    dest = root / DONE / p.relative_to(root)
    dest.parent.mkdir(parents=True, exist_ok=True)
    n, target = 2, dest
    while target.exists():
        target = dest.with_name(f"{dest.stem} ({n}){dest.suffix}")
        n += 1
    shutil.move(str(p), str(target))
    for d in p.parents:  # an emptied sub-folder goes too (not the inbox itself)
        if d == root or root not in d.parents:
            break
        try:
            d.rmdir()
        except OSError:
            break
    return target


class Watcher:
    """take(path, title) -> (job id, new) adds one file (new False: the same file is already in the library)."""

    def __init__(self, root: Path, take: Callable[[Path, str], tuple[str, bool]]):
        self.root, self.take = root, take
        self.seen: dict[Path, tuple[int, float]] = {}
        self.taken: list[dict] = []  # newest last: {file, job, new, at}
        self.skip: set[Path] = set()  # failed once: left in place, not tried again until the app restarts
        self.stop = threading.Event()

    def start(self) -> "Watcher":
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / DONE).mkdir(exist_ok=True)
        threading.Thread(target=self._loop, name="inbox", daemon=True).start()
        log.info("watching %s", self.root)
        return self

    def _loop(self) -> None:
        while not self.stop.wait(EVERY):
            try:
                self.scan()
            except Exception:
                log.exception("inbox scan failed")

    def scan(self, now: float | None = None) -> list[str]:
        """One look at the folder: takes every file that has settled. Returns the job ids made."""
        now = time.time() if now is None else now
        made, files = [], candidates(self.root) if self.root.exists() else []
        for p in list(self.seen):
            if p not in files:
                self.seen.pop(p)
        for p in files:
            if p in self.skip:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            sig = (st.st_size, st.st_mtime)
            settled = self.seen.get(p) == sig and st.st_size > 0 and now - st.st_mtime >= SETTLE
            self.seen[p] = sig
            if not settled:
                continue
            try:
                job, new = self.take(p, p.stem)
                move_done(self.root, p)
            except Exception as e:
                log.warning("inbox: %s not taken (%s)", p.name, e)
                self.skip.add(p)
                continue
            self.seen.pop(p, None)
            self.taken = (self.taken + [{"file": p.name, "job": job, "new": new, "at": now}])[-50:]
            log.info("inbox: %s -> %s%s", p.name, job, "" if new else " (already in the library)")
            if new:
                made.append(job)
        return made
