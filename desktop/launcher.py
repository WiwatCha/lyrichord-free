"""Lyrichord desktop (formerly Lyricord): runs the server on this computer and opens it in the web browser.

Bundle layout (same on Windows, macOS and Linux):
    <root>/python/            portable CPython with every library installed
    <root>/app/launcher.py    this file
    <root>/app/backend/       the FastAPI app (app/, web/, VERSION)
    <root>/models/            btc/, ppocr/, beat_this-final0.ckpt, whisper-small/, torch/hub/checkpoints/ (Demucs)
User data (songs analysed, access key, log) lives outside the install folder, so updates keep it.
"""
from __future__ import annotations

import json
import os
import platform
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BACKEND = HERE / "backend"
MODELS = ROOT / "models"
EDITION = (HERE / "edition.txt").read_text().strip() if (HERE / "edition.txt").exists() else "full"
APP_NAME = "Lyrichord Free" if EDITION == "free" else "Lyrichord"  # the free edition keeps its own data folder
OLD_NAME = "Lyricord"  # the app's name up to r15: its data folder is moved to the new name once


def data_dir() -> Path:
    if os.environ.get("DATA_DIR"):
        d = Path(os.environ["DATA_DIR"])
        d.mkdir(parents=True, exist_ok=True)
        return d
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        d, old = base / APP_NAME, base / OLD_NAME
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
        d, old = base / APP_NAME, base / OLD_NAME
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        d, old = base / APP_NAME.lower(), base / OLD_NAME.lower()
    if EDITION != "free" and not d.exists() and old.is_dir():  # (never move the full app's songs into the free one)
        try:  # songs analysed, settings and the access key of the online page come along
            old.rename(d)
        except OSError:  # in use (an old copy still running) or another disk: keep using the old folder
            d = old
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA = data_dir()
LOG = DATA / "lyricord.log"
PORT_FILE = DATA / "port.txt"
VERSION = (BACKEND / "VERSION").read_text().strip() if (BACKEND / "VERSION").exists() else "dev"


def setup_env() -> None:
    """Point the app at the models inside this install, and never reach out to the internet for them."""
    env = os.environ
    env.setdefault("DATA_DIR", str(DATA))
    env.setdefault("LYRICORD_EDITION", EDITION)
    # Wi-Fi mode: phones and tablets on the same network open the app (with the access key); on in Lyrichord Free
    env.setdefault("LYRICORD_LAN", "1" if EDITION == "free" else "0")
    # watched folder: audio files put in ~/Music/<app> Inbox are analysed into the song library on their own
    env.setdefault("LYRICORD_INBOX", str(Path.home() / "Music" / f"{APP_NAME} Inbox"))
    env.setdefault("BTC_DIR", str(MODELS / "btc"))
    env.setdefault("OCR_MODEL_DIR", str(MODELS / "ppocr"))
    env.setdefault("BEAT_THIS_CKPT", str(MODELS / "beat_this-final0.ckpt"))
    env.setdefault("TORCH_HOME", str(MODELS / "torch"))  # Demucs weights (torch hub cache)
    if (MODELS / "whisper-small" / "model.bin").exists():
        env.setdefault("WHISPER_MODEL", str(MODELS / "whisper-small"))
    env.setdefault("UVR_MODEL_DIR", str(MODELS / "uvr"))
    cf = MODELS.parent / "bin" / ("cloudflared.exe" if sys.platform == "win32" else "cloudflared")
    if cf.exists():  # bundled with the full edition (desktop/build.py): online access works with nothing else installed
        env.setdefault("LYRICORD_CLOUDFLARED", str(cf))
    env.setdefault("ALLOW_MODEL_FETCH", "1")  # the Thai Whisper model is fetched once into the user's data folder
    env.setdefault("HF_HUB_OFFLINE", "1")
    env.setdefault("TRANSFORMERS_OFFLINE", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    sys.path.insert(0, str(BACKEND))


def setup_logging() -> None:
    # pythonw (Windows) and a Finder launch (macOS) have no console: send everything to a log file
    if sys.stdout is None or sys.stderr is None or not sys.stdout.isatty():
        f = open(LOG, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = f
    print(f"\n==== {time.strftime('%Y-%m-%d %H:%M:%S')} {APP_NAME} {VERSION} on {platform.platform()} ====")


def health(port: int, timeout: float = 1.5) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as r:
            j = json.loads(r.read().decode())
            return j if j.get("ok") else None
    except Exception:
        return None


def running_instance() -> int | None:
    """Port of a Lyrichord desktop app that is already running (same version), else None."""
    try:
        port = int(PORT_FILE.read_text().strip())
    except Exception:
        return None
    h = health(port)
    return port if h and h.get("version") == VERSION else None


def free_port(start: int = 8000) -> int:
    for port in list(range(start, start + 20)) + [0]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def open_browser(port: int) -> None:
    webbrowser.open(f"http://127.0.0.1:{port}/")


class Server:
    def __init__(self, port: int):
        import uvicorn

        from app.main import app  # noqa: imported after setup_env so the models are found

        self.port = port
        host = "0.0.0.0" if os.environ.get("LYRICORD_LAN") == "1" else "127.0.0.1"  # 0.0.0.0: reachable on the Wi-Fi (key required)
        self.srv = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_config=None, access_log=False))
        self.thread = threading.Thread(target=self.srv.run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def ready(self, wait: float = 120) -> bool:
        t = time.time()
        while time.time() - t < wait:
            if health(self.port):
                return True
            if not self.thread.is_alive():
                return False
            time.sleep(0.3)
        return False

    def stop(self) -> None:
        self.srv.should_exit = True
        self.thread.join(timeout=10)


def start_online(port: int):
    """Open the free Cloudflare tunnel so the online page works from a phone anywhere (needs cloudflared)."""
    try:
        from app.tunnel import Tunnel
        return Tunnel(port).start()
    except Exception as e:
        print("online: not started:", e)
        return None


def window(server: Server) -> None:
    """Small control window: shows that Lyrichord runs, opens the app, quits (stopping the server)."""
    import tkinter as tk

    url = f"http://127.0.0.1:{server.port}/"
    root = tk.Tk()
    root.title(APP_NAME)
    root.resizable(False, False)
    ico = HERE / "lyricord.png"
    if ico.exists():
        try:
            root.iconphoto(True, tk.PhotoImage(file=str(ico)))
        except Exception:
            pass
    pad = {"padx": 18, "pady": 6}
    tk.Label(root, text=APP_NAME, font=("Helvetica", 20, "bold"), fg="#ff4f7b").pack(**pad)
    status = tk.StringVar(value="กำลังเริ่ม… / Starting…")
    tk.Label(root, textvariable=status, font=("Helvetica", 12)).pack(**pad)
    tk.Label(root, text=url, font=("Helvetica", 11), fg="#3b82f6").pack(padx=18)
    row = tk.Frame(root)
    row.pack(padx=18, pady=12)
    open_btn = tk.Button(row, text="เปิดแอป / Open", width=16, state="disabled", command=lambda: open_browser(server.port))
    open_btn.pack(side="left", padx=4)

    def quit_app():
        status.set("กำลังปิด… / Closing…")
        root.update()
        if tunnel["t"] is not None:
            tunnel["t"].stop()
        server.stop()
        root.destroy()

    tk.Button(row, text=f"ปิด {APP_NAME} / Quit", width=18, command=quit_app).pack(side="left", padx=4)
    online = tk.StringVar(value="")
    tk.Label(root, textvariable=online, font=("Helvetica", 11), fg="#555", wraplength=360, justify="center").pack(padx=18)
    qr_btn = tk.Button(root, text="QR สำหรับ iPhone / iPad", width=24, command=lambda: webbrowser.open(f"http://127.0.0.1:{server.port}/?showqr=1"))
    if os.environ.get("LYRICORD_LAN") == "1":  # Wi-Fi mode: a QR code for phones and tablets on the same network
        tk.Button(root, text="ใช้บนมือถือ / iPad (Wi-Fi เดียวกัน) / Phones", width=34,
                  command=lambda: webbrowser.open(f"http://127.0.0.1:{server.port}/?showlan=1")).pack(pady=(0, 10))
    tunnel = {"t": None}

    def watch_online():
        t = tunnel["t"]
        if t is not None:
            msg = {"on": "ใช้บน iPhone / iPad ได้จากทุกที่ / Online: ready",
                   "starting": "กำลังเปิดการใช้จากนอกบ้าน… / Going online…",
                   "missing": "ใช้นอกบ้านไม่ได้: ยังไม่ได้ติดตั้ง cloudflared (brew install cloudflared)",
                   "error": "การเชื่อมต่อนอกบ้านหลุด กำลังลองใหม่… / Reconnecting…"}.get(t.state, "")
            if t.state == "on" and not t.announced:
                msg = "ใช้นอกบ้านได้ แต่แจ้งที่อยู่ให้หน้าเว็บไม่สำเร็จ / Online, page not told"
            online.set(msg)
            if t.state == "on" and not qr_btn.winfo_ismapped():
                qr_btn.pack(pady=(4, 8))
            elif t.state != "on" and qr_btn.winfo_ismapped():
                qr_btn.pack_forget()
        root.after(1000, watch_online)
    tk.Label(root, text=f"v{VERSION} · ปิดหน้าต่างนี้ = ปิดแอป / closing this window quits", font=("Helvetica", 9), fg="#888").pack(pady=(0, 10))
    root.protocol("WM_DELETE_WINDOW", quit_app)

    def wait_ready():
        ok = server.ready()
        def done():
            if ok:
                status.set("พร้อมใช้งาน / Ready")
                open_btn.config(state="normal")
                open_browser(server.port)
                tunnel["t"] = start_online(server.port)
                watch_online()
            else:
                status.set(f"เริ่มไม่สำเร็จ ดูไฟล์ / Failed, see: {LOG}")
        root.after(0, done)

    threading.Thread(target=wait_ready, daemon=True).start()
    root.mainloop()


def main() -> None:
    setup_logging()
    port = running_instance()
    if port:  # already running: just show it
        print("already running on", port)
        open_browser(port)
        return
    setup_env()
    port = free_port(int(os.environ.get("LYRICORD_PORT", "8000")))
    server = Server(port)
    server.start()
    PORT_FILE.write_text(str(port))
    if "--headless" in sys.argv:  # used by the build's self-test
        ok = server.ready()
        out = sys.__stdout__  # the build's self-test reads this line (normal output goes to the log file)
        out.write(f"{'ready' if ok else 'failed'} {port}\n")
        out.flush()
        while ok and server.thread.is_alive():
            time.sleep(1)
        return
    try:
        window(server)
    except Exception as e:  # no Tk: run until the server stops (Ctrl+C)
        print("no window:", e)
        t = None
        if server.ready():
            open_browser(port)
            t = start_online(port)
        try:
            while server.thread.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            server.stop()
    finally:
        try:
            PORT_FILE.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()
