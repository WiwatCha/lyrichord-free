"""Online access with no setup: when the app starts, open a free Cloudflare quick tunnel to it and tell the
online page (lyricord.<account>.workers.dev) where this computer is now. A phone that scanned the QR code once
(it keeps the access key) finds the computer by itself from then on, whatever the tunnel address is today.

Needs the cloudflared program (Mac: brew install cloudflared). LYRICORD_ONLINE=0 turns this off.
The online page's address: LYRICORD_PAGES_URL, else pages-url.txt in the data folder, else PAGES_DEFAULT.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from . import online as ON

PAGES_DEFAULT = ""  # your own online page (tools/cloudflare), or LYRICORD_PAGES_URL / pages-url.txt
URL_RX = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def pages_url() -> str:
    v = os.environ.get("LYRICORD_PAGES_URL")
    if v is None:
        f = ON.DATA / "pages-url.txt"
        v = f.read_text("utf-8").strip() if f.exists() else PAGES_DEFAULT
    return v.strip().rstrip("/")


def find_cloudflared() -> str | None:
    """The copy that comes with the app (LYRICORD_CLOUDFLARED, set by the launcher), else on PATH, else where
    Homebrew / the Windows installer put it (an app opened from Finder has a short PATH)."""
    own = os.environ.get("LYRICORD_CLOUDFLARED", "")
    if own and Path(own).exists():
        return own
    exe = "cloudflared.exe" if sys.platform == "win32" else "cloudflared"
    found = shutil.which(exe)
    if found:
        return found
    places = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".local/bin")]
    if sys.platform == "win32":
        pf = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")]
        places = [str(Path(p) / "cloudflared") for p in pf]
    for d in places:
        p = Path(d) / exe
        if p.exists():
            return str(p)
    return None


def announce(pages: str, key: str, url: str, tries: int = 5) -> bool:
    """Tell the online page where this computer is (url '' = gone). True when the page took it."""
    if not pages or not key:
        return False
    body = json.dumps({"key": key, "url": url}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(pages + "/where", data=body, method="POST",
                                         headers={"content-type": "application/json", "user-agent": "Lyrichord"})
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read().decode()).get("ok") is True
        except Exception as e:
            print("online: telling the page failed:", e)
            time.sleep(min(30, 2 * (i + 1)))
    return False


class Tunnel:
    """cloudflared in the background, restarted if it stops; state: 'off' | 'starting' | 'on' | 'missing' | 'error'."""

    def __init__(self, port: int):
        self.port, self.proc, self.stopped = port, None, False
        self.url, self.state, self.pages, self.announced = "", "off", pages_url(), False
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> "Tunnel":
        if os.environ.get("LYRICORD_ONLINE", "0" if os.environ.get("LYRICORD_EDITION") == "free" else "1") == "0":
            return self
        self.exe = find_cloudflared()
        if not self.exe:
            self.state = "missing"
            print("online: cloudflared not found (Mac: brew install cloudflared), online access is off")
            return self
        self.thread.start()
        return self

    def _run(self) -> None:
        delay = 5
        while not self.stopped:
            self.state, self.url, self.announced = "starting", "", False
            try:
                flags = {"creationflags": 0x08000000} if sys.platform == "win32" else {}  # no console window
                self.proc = subprocess.Popen([self.exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{self.port}"],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace", **flags)
            except OSError as e:
                self.state = "error"
                print("online: cloudflared did not start:", e)
                return
            for line in self.proc.stderr:
                if self.stopped:
                    break
                m = URL_RX.search(line) if not self.url else None
                if m:
                    self.url = m.group(0)
                    ON.save(self.url, self.pages)
                    self.announced = announce(self.pages, ON.key(), self.url)
                    self.state = "on"
                    delay = 5
                    print("online:", self.url, "· page told:", self.announced)
            self.proc.wait()
            ON.clear()
            if self.stopped:
                break
            self.state = "error"
            print(f"online: tunnel stopped (code {self.proc.returncode}), again in {delay}s")
            time.sleep(delay)
            delay = min(300, delay * 2)

    def stop(self) -> None:
        self.stopped = True
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()
        if self.url:
            announce(self.pages, ON.key(), "", tries=1)
        ON.clear()
        self.state = "off"
