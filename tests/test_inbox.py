"""Watched folder (app/inbox.py) without the server: which files are taken, when, in what order, and where they go.

    PYTHONPATH=backend python3 tests/test_inbox.py"""
import os
import tempfile
import time
from pathlib import Path

from app import inbox as IB

root = Path(tempfile.mkdtemp(prefix="inbox-test-"))
taken = []


def take(p: Path, title: str):
    if title == "broken":
        raise ValueError("cannot read")
    taken.append(title)
    return f"job{len(taken)}", title != "known"


def put(rel: str, data: bytes = b"x" * 100, age: float = 10) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    t = time.time() - age
    os.utime(p, (t, t))
    return p


w = IB.Watcher(root, take).start()
w.stop.set()  # scan by hand only
for rel in ("10 last.mp3", "2 second.wav", "1 first.m4a", "notes.txt", ".hidden.mp3", "song.mp3.part", "dl.crdownload",
            "album/3 inner.flac", "broken.mp3", "known.mp3"):
    put(rel)
put("fresh.mp3", age=0)  # just written: not settled yet

assert w.scan() == [], "first look only notes sizes"
made = w.scan()
print("taken in order:", taken)
assert taken[:3] == ["1 first", "2 second", "10 last"], taken  # numbers in names sort as numbers
assert "3 inner" in taken and "known" in taken and "fresh" not in taken and "broken" not in taken
assert len(made) == len(taken) - 1, "the file already in the library is not a new job"
assert (root / "notes.txt").exists(), "other files stay where they are"
assert (root / ".hidden.mp3").exists() and (root / "song.mp3.part").exists() and (root / "dl.crdownload").exists()
assert (root / "broken.mp3").exists(), "a file that fails stays in place"
assert (root / IB.DONE / "1 first.m4a").exists() and (root / IB.DONE / "album/3 inner.flac").exists()
assert not (root / "album").exists(), "an emptied sub-folder is removed"
assert (root / "fresh.mp3").exists()

# a file still being copied (size changes between looks) waits
p = put("growing.mp3", b"x" * 10, age=10)
w.scan()
put("growing.mp3", b"x" * 50, age=10)
w.scan()
assert "growing" not in taken, "size changed: not taken yet"
w.scan()
assert "growing" in taken

# the broken file is not retried every few seconds; the fresh one is taken once settled
n = len(taken)
os.utime(root / "fresh.mp3", (time.time() - 10, time.time() - 10))
w.scan(); w.scan()
assert taken[n:] == ["fresh"], taken[n:]

# the same name again goes next to the first copy in Done, never over it
put("2 second.wav")
w.scan(); w.scan()
assert (root / IB.DONE / "2 second.wav").exists() and (root / IB.DONE / "2 second (2).wav").exists()

assert IB.folder() is None or os.environ.get("LYRICORD_INBOX")
os.environ["LYRICORD_INBOX"] = "0"
assert IB.folder() is None, "0 turns it off"
print(f"inbox: all checks passed ({len(taken)} files taken)")
