"""Build the Lyrichord desktop bundle for the computer this runs on (Windows x64, macOS arm64/x64, Linux x64).

    python desktop/build.py [--out DIR] [--lite] [--test] [--package]

1. portable CPython 3.11 (python-build-standalone) -> <out>/Lyrichord/python
2. every library (torch CPU, Basic Pitch, BTC, Beat This!, Demucs, faster-whisper, OCR) installed into it
3. the app + launcher -> <out>/Lyrichord/app, all models -> <out>/Lyrichord/models (works offline afterwards)
4. --test: start the bundled app headless, check /api/health and analyse tests/demo.wav end to end
5. --package: macOS -> Lyrichord.app + Lyrichord-<version>-mac-<arch>.dmg, Linux -> .tar.gz
   (Windows: desktop/windows/lyricord.iss turns the folder into Lyrichord-Setup-<version>.exe with Inno Setup)
--lite skips torch and the torch models (OCR + Basic Pitch only), for quick checks of the bundle itself.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DESK = REPO / "desktop"
BACKEND = REPO / "backend"
VERSION = (BACKEND / "VERSION").read_text().strip()
TORCH = "2.5.1"
WIN, MAC = sys.platform == "win32", sys.platform == "darwin"
ARCH = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
# --edition free: Lyrichord Free (given away): files and live audio only, no UVR de-reverb, its own app id and data folder
EDITION = "full"
NAME, SLUG, BUNDLE_ID = "Lyrichord", "Lyrichord", "app.lyricord.desktop"


def set_edition(e: str):
    global EDITION, NAME, SLUG, BUNDLE_ID
    EDITION = e
    if e == "free":
        NAME, SLUG, BUNDLE_ID = "Lyrichord Free", "LyrichordFree", "app.lyrichord.free"


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def run(cmd, **kw):
    log("$", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def triple() -> str:
    if WIN:
        return "x86_64-pc-windows-msvc"
    if MAC:
        return "aarch64-apple-darwin" if ARCH == "arm64" else "x86_64-apple-darwin"
    return "x86_64-unknown-linux-gnu"


def fetch_python(dst: Path) -> Path:
    """Latest python-build-standalone CPython 3.11 'install_only' build for this platform."""
    req = urllib.request.Request("https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=5")
    if os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["GITHUB_TOKEN"])
    pat = re.compile(r"cpython-3\.11\.\d+\+\d+-" + re.escape(triple()) + r"-install_only\.tar\.gz$")
    url = None
    for rel in json.load(urllib.request.urlopen(req)):
        url = next((a["browser_download_url"] for a in rel["assets"] if pat.search(a["name"])), None)
        if url:
            break
    if not url:
        raise SystemExit("no python-build-standalone build found for " + triple())
    log("python:", url)
    tgz = dst.parent / "python.tar.gz"
    urllib.request.urlretrieve(url, tgz)
    with tarfile.open(tgz) as t:
        t.extractall(dst.parent)  # the archive's top folder is "python"
    tgz.unlink()
    return dst / ("python.exe" if WIN else "bin/python3")


def pip(py: Path, *args):
    run([py, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", *args])


def install_libs(py: Path, lite: bool):
    run([py, "-m", "pip", "install", "--no-cache-dir", "-U", "pip", "wheel"])
    if not lite:
        # CPU-only torch: the CUDA builds are several GB. On macOS PyPI's build is the CPU/Metal one.
        idx = [] if MAC else ["--index-url", "https://download.pytorch.org/whl/cpu"]
        pip(py, f"torch=={TORCH}", f"torchaudio=={TORCH}", *idx)
    pip(py, "-r", BACKEND / "requirements.txt", "pyyaml", "setuptools<80")  # resampy imports pkg_resources
    pip(py, "--no-deps", "basic-pitch==0.4.0")
    if not lite:
        pip(py, "-r", BACKEND / "requirements-demucs.txt", "-r", BACKEND / "requirements-whisper.txt")
        pip(py, "--no-deps", "beat-this==1.1.0")
        pip(py, "einops", "rotary-embedding-torch", "soxr")
        if EDITION != "free":  # de-reverb (UVR VR model) before Whisper; its licence is unclear, so not in the free edition
            pip(py, "--no-deps", "audio-separator==0.48.0")
            pip(py, "audioread", "pydub", "pyyaml", "requests", "tqdm", "samplerate")
        # demucs may have pulled another torch; put the pinned CPU build back if so
        out = subprocess.run([py, "-c", "import torch; print(torch.__version__)"], capture_output=True, text=True).stdout.strip()
        if not out.startswith(TORCH):
            idx = [] if MAC else ["--index-url", "https://download.pytorch.org/whl/cpu"]
            pip(py, "--force-reinstall", "--no-deps", f"torch=={TORCH}", f"torchaudio=={TORCH}", *idx)


def site_packages(py_root: Path) -> Path:
    return py_root / "Lib" / "site-packages" if WIN else next((py_root / "lib").glob("python3.*/site-packages"))


def strip(py_root: Path):
    """Drop what is never used at run time (tests, headers, static libraries, unused Basic Pitch models)."""
    sp = site_packages(py_root)
    gone = 0
    for p in list(sp.rglob("*")):
        if not p.exists():
            continue
        rel = p.relative_to(sp).as_posix()
        kill = (p.is_dir() and p.name in ("tests", "test") and rel.split("/")[0] in ("scipy", "numpy", "sklearn", "pandas", "librosa", "numba"))
        kill |= p.is_dir() and rel in ("torch/include", "torch/share", "torchaudio/include", "caffe2")
        kill |= p.is_file() and p.suffix == ".lib" and rel.startswith("torch/lib/")  # Windows static libs, hundreds of MB
        if kill:
            gone += sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    bp = sp / "basic_pitch" / "saved_models" / "icassp_2022"
    if bp.exists():
        for p in bp.iterdir():
            if p.name != "nmp.onnx":
                gone += sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size
                shutil.rmtree(p) if p.is_dir() else p.unlink()
    log(f"stripped {gone / 1e6:.0f} MB")


def copy_app(root: Path, py: Path):
    app = root / "app"
    shutil.rmtree(app, ignore_errors=True)
    (app / "backend").mkdir(parents=True)
    run([sys.executable, REPO / "build.py", "--edition", EDITION])  # the web page of this edition (needs node)
    shutil.copytree(BACKEND / "app", app / "backend" / "app", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(BACKEND / "web", app / "backend" / "web")
    shutil.copy(BACKEND / "VERSION", app / "backend" / "VERSION")
    shutil.copy(DESK / "launcher.py", app / "launcher.py")
    (app / "edition.txt").write_text(EDITION)
    for f in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        if (REPO / f).exists():
            shutil.copy(REPO / f, root / f)
    run([py, DESK / "make_icons.py", app])
    for f in ("lyricord.ico", "lyricord.icns"):
        shutil.copy(app / f, root / f)


def self_test(root: Path, py: Path, lite: bool):
    """Start the bundled app like a user would (but headless) and analyse the demo song end to end."""
    tmp = Path(tempfile.mkdtemp(prefix="lyricord-test-"))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "VIRTUAL_ENV"))}
    env.update(DATA_DIR=str(tmp), LYRICORD_PORT="8765", HOME=env.get("HOME", str(tmp)))
    proc = subprocess.Popen([py, root / "app" / "launcher.py", "--headless"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        line = proc.stdout.readline().strip()
        while line and not line.startswith(("ready", "failed")):
            line = proc.stdout.readline().strip()
        if not line.startswith("ready"):
            raise SystemExit(f"self-test: app did not start ({line}); log:\n" + (tmp / "lyricord.log").read_text(errors="replace")[-4000:])
        port = int(line.split()[1])
        base = f"http://127.0.0.1:{port}/api/"
        h = json.load(urllib.request.urlopen(base + "health"))
        log("health:", h)
        want = ["ocr", "basic_pitch"] + ([] if lite else ["btc", "beat_this", "demucs", "whisper"] + (["dereverb"] if EDITION != "free" else []))
        missing = [k for k in want if not h.get(k)]
        if missing or h.get("version") != VERSION:
            raise SystemExit(f"self-test: missing {missing} / version {h.get('version')} != {VERSION}")
        # upload the demo song and wait for the analysis (Demucs + Whisper on CPU take a few minutes)
        bnd = "----lyricord"
        body = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"demo.wav\"\r\nContent-Type: audio/wav\r\n\r\n").encode() \
            + (REPO / "tests" / "demo.wav").read_bytes() + f"\r\n--{bnd}--\r\n".encode()
        r = urllib.request.Request(base + "jobs/upload", data=body, headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
        job = json.load(urllib.request.urlopen(r))["id"]
        t0 = time.time()
        while True:
            j = json.load(urllib.request.urlopen(base + "jobs/" + job))
            if j["status"] in ("done", "error"):
                break
            if time.time() - t0 > 1500:
                raise SystemExit("self-test: analysis took too long")
            time.sleep(3)
        if j["status"] != "done":
            raise SystemExit(f"self-test: analysis failed: {j.get('error')}")
        res = j["result"]
        log(f"demo analysed in {time.time() - t0:.0f}s: bpm {res['bpm']} key {res['key']} chord engine {res.get('chord_engine')} "
            f"separated {res.get('separated')} lyrics {len(res.get('lyrics') or [])} lines")
        if abs(res["bpm"] - 100) > 3 or res["key"] != {"root": 0, "q": ""}:
            raise SystemExit("self-test: wrong tempo or key on the demo song")
        if not lite and not res.get("separated"):
            raise SystemExit("self-test: Demucs did not run")
        lyr = res.get("lyrics") or {}
        log("lyrics check:", {k: lyr.get(k) for k in ("instrumental", "why", "lang")}, len(lyr.get("words") or []), "words")
        if not lite and not lyr.get("instrumental"):
            raise SystemExit("self-test: the demo song has no singing, but it was not detected as instrumental")
        if not lite and EDITION != "free":  # de-reverb runs only on sung songs: check it separately on 10 s of the demo
            clip = tmp / "clip.wav"
            run([py, "-c", f"import soundfile as s; y, r = s.read(r'{REPO / 'tests' / 'demo.wav'}'); s.write(r'{clip}', y[: r * 10], r)"])
            t1 = time.time()
            run([py, "-m", "app.dereverb", clip, tmp / "dry.wav"], cwd=root / "app" / "backend",
                env={**env, "UVR_MODEL_DIR": str(root / "models" / "uvr")})
            if not (tmp / "dry.wav").exists():
                raise SystemExit("self-test: de-reverb produced nothing")
            log(f"de-reverb ok ({time.time() - t1:.0f}s for 10 s)")
        log("SELF-TEST PASSED")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except Exception:
            proc.kill()


def size_of(p: Path) -> float:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1e6


def package_mac(root: Path, out: Path) -> Path:
    app = out / f"{NAME}.app"
    shutil.rmtree(app, ignore_errors=True)
    (app / "Contents" / "MacOS").mkdir(parents=True)
    res = app / "Contents" / "Resources"
    shutil.move(str(root), res)  # the bundle becomes the app's Resources
    # the icon keeps its file name lyricord.icns (CFBundleIconFile below)
    exe = app / "Contents" / "MacOS" / SLUG
    exe.write_text('#!/bin/bash\nR="$(cd "$(dirname "$0")/../Resources" && pwd)"\nexport PYTHONDONTWRITEBYTECODE=1\nexec "$R/python/bin/python3" "$R/app/launcher.py" "$@"\n')
    exe.chmod(0o755)
    (app / "Contents" / "Info.plist").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>{NAME}</string>
<key>CFBundleDisplayName</key><string>{NAME}</string>
<key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string>
<key>CFBundleVersion</key><string>{VERSION}</string>
<key>CFBundleShortVersionString</key><string>{VERSION}</string>
<key>CFBundleExecutable</key><string>{SLUG}</string>
<key>CFBundleIconFile</key><string>lyricord</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>{NAME} listens to the microphone for live chords and the tuner.</string>
</dict></plist>
""")
    # ad-hoc signature: Apple Silicon refuses unsigned code; a Developer ID + notarisation can replace this later
    run(["codesign", "--force", "--deep", "--sign", "-", app])
    dmgroot = out / "dmg"
    shutil.rmtree(dmgroot, ignore_errors=True)
    dmgroot.mkdir()
    shutil.move(str(app), dmgroot / f"{NAME}.app")
    os.symlink("/Applications", dmgroot / "Applications")
    dmg = out / f"{SLUG}-{VERSION}-mac-{ARCH}.dmg"
    dmg.unlink(missing_ok=True)
    run(["hdiutil", "create", "-volname", NAME, "-srcfolder", dmgroot, "-ov", "-format", "ULFO", dmg])
    return dmg


def package_linux(root: Path, out: Path) -> Path:
    tgz = out / f"{SLUG}-{VERSION}-linux-x64.tar.gz"
    with tarfile.open(tgz, "w:gz") as t:
        t.add(root, arcname=SLUG)
    return tgz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "dist" / "desktop"))
    ap.add_argument("--lite", action="store_true")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--package", action="store_true")
    ap.add_argument("--host-python", action="store_true", help="local check only: a venv of this Python instead of the portable one")
    ap.add_argument("--reuse", action="store_true", help="keep an existing python/ and models/ (faster rebuilds)")
    ap.add_argument("--edition", choices=["full", "free"], default="full")
    a = ap.parse_args()
    set_edition(a.edition)
    out = Path(a.out).resolve()
    root = out / SLUG
    log(f"{NAME} {VERSION} desktop build for {sys.platform}-{ARCH} -> {root}")
    out.mkdir(parents=True, exist_ok=True)
    pyroot = root / "python"
    if not (a.reuse and pyroot.exists()):
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True)
        if a.host_python:
            run([sys.executable, "-m", "venv", pyroot])
            py = pyroot / ("Scripts/python.exe" if WIN else "bin/python3")
        else:
            py = fetch_python(pyroot)
        install_libs(py, a.lite)
    py = pyroot / ("python.exe" if WIN else "bin/python3")
    copy_app(root, py)
    run([py, DESK / "fetch_models.py", root / "models"] + (["--lite"] if a.lite else []) + (["--no-dereverb"] if EDITION == "free" else []))
    strip(pyroot)
    log(f"bundle: python {size_of(pyroot):.0f} MB · models {size_of(root / 'models'):.0f} MB · total {size_of(root):.0f} MB")
    if a.test:
        self_test(root, py, a.lite)
    # compile once now: faster first start, and nothing is written into the (signed) app later
    subprocess.run([py, "-m", "compileall", "-q", "-j", "0", pyroot / ("Lib" if WIN else "lib"), root / "app"], check=False)
    (out / "VERSION").write_text(VERSION)
    if a.package:
        if MAC:
            log("package:", package_mac(root, out))
        elif not WIN:
            log("package:", package_linux(root, out))
        else:
            log("Windows: run ISCC desktop/windows/lyricord.iss next")


if __name__ == "__main__":
    main()
