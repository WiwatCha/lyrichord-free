"""FastAPI server: job queue around pipeline.py, and the web app itself at /.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import chordnet as CN
from . import dereverb as DR
from . import library as LIB
from . import ocr as OCR
from . import pipeline as PL

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data")) / "jobs"
WEB = Path(os.environ.get("WEB_DIR", ROOT / "web"))
VERSION = (ROOT / "VERSION").read_text().strip() if (ROOT / "VERSION").exists() else "dev"
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", 200))
KEEP_JOBS = int(os.environ.get("KEEP_JOBS", 50))
# Lyrichord Free (given away): no YouTube download (YouTube's terms), no UVR de-reverb (unclear licence)
EDITION = "free" if os.environ.get("LYRICORD_EDITION") == "free" else "full"
DATA.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Chord & melody lead sheet")
@app.middleware("http")
async def no_stale_page(request, call_next):
    """The page itself must never come from the browser cache: an old page with a new server is confusing."""
    resp = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith(".html"):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


def _access_key() -> str:
    """Key for requests that reach this computer through Cloudflare (the online page / tunnel).
    ACCESS_KEY env, else a random key made once and kept in the data folder."""
    if os.environ.get("ACCESS_KEY"):
        return os.environ["ACCESS_KEY"]
    f = DATA.parent / "access_key.txt"
    if not f.exists():
        import secrets
        f.write_text(secrets.token_urlsafe(12))
    return f.read_text().strip()


ACCESS_KEY = _access_key()


@app.middleware("http")
async def need_key_online(request, call_next):
    """Requests through Cloudflare (they carry cf-ray, which a visitor cannot remove) must bring the key.
    Opening the app on this computer (localhost) needs no key. /api/health stays open so the page can say what is wrong."""
    import hmac

    p = request.url.path
    if (request.method != "OPTIONS" and p.startswith("/api/") and p != "/api/health" and request.headers.get("cf-ray")
            and not hmac.compare_digest(request.query_params.get("key") or request.headers.get("x-lyricord-key") or "", ACCESS_KEY)):
        return JSONResponse({"detail": "ต้องใส่รหัสเข้าใช้หลังบ้าน (ดูในหน้าต่าง start-online)"}, status_code=401)
    return await call_next(request)


# the online page (Cloudflare Pages) calls this computer from another origin: allow *.pages.dev, *.workers.dev and localhost,
# plus any origins listed in CORS_ORIGINS (e.g. your own domain)
app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o],
                   allow_origin_regex=r"https://([a-z0-9-]+\.)*(pages|workers)\.dev|http://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])


@dataclass
class Job:
    id: str
    kind: str  # youtube | upload
    title: str = ""
    status: str = "queued"  # queued | running | done | error
    stage: str = "รอคิว"
    progress: float = 0.0
    error: str = ""
    result: dict | None = None
    audio: Path | None = None
    created: float = field(default_factory=time.time)
    relisten: dict = field(default_factory=dict)  # second lyrics pass with the user's lyrics: status / stage / lyrics
    lyrics_pending: bool = False  # "done" with the sheet; Whisper is still hearing the words (result.lyrics_pending)
    vid: str = ""  # YouTube id
    sha: str = ""  # SHA-256 of the uploaded file: the same song added again opens from the library

    def public(self) -> dict:
        d = {"id": self.id, "kind": self.kind, "title": self.title, "status": self.status,
             "stage": self.stage, "progress": round(self.progress, 3), "error": self.error}
        if self.status == "done":
            d["result"] = self.result
            d["audio_url"] = f"/api/jobs/{self.id}/audio"
            d["edits"] = LIB.read_edits(DATA / self.id)
        return d


JOBS: dict[str, Job] = {}
YT_CACHE: dict[str, str] = {}
LOCK = threading.Lock()
def _ram_gb() -> float:
    try:
        if os.name == "nt":
            import ctypes

            class M(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong)] + [(f"x{i}", ctypes.c_ulonglong) for i in range(6)]
            m = M(); m.l = ctypes.sizeof(M)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.total / 2**30
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30
    except Exception:
        return 0.0


# A new song's sheet does not wait for the previous song's lyrics (Whisper, 1-5 min): the sheet stage and the
# lyrics stage each take turns on their own, so one song can be heard for words while the next one is analysed.
# Off on small machines (Demucs + Whisper + de-reverb together ran out of memory on 8 GB) or OVERLAP_LYRICS=0.
OVERLAP = os.environ.get("OVERLAP_LYRICS", "auto") == "1" or (os.environ.get("OVERLAP_LYRICS", "auto") == "auto" and _ram_gb() >= 12)
SHEET_TURN, LYRICS_TURN = threading.Lock(), threading.Lock()
POOL = ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", 4 if OVERLAP else 1)))
log.info("lyrics overlap the next song's sheet: %s (RAM %.0f GB)", OVERLAP, _ram_gb())


def _prune() -> None:
    """Jobs held in memory: the newest KEEP_JOBS. A finished song stays on disk (the library) and is read back when
    asked for; a job that failed or never finished is deleted."""
    with LOCK:
        old = sorted(JOBS.values(), key=lambda j: j.created)[:-KEEP_JOBS]
        for j in old:
            if j.status in ("queued", "running") or j.lyrics_pending:
                continue
            JOBS.pop(j.id, None)
            if not (DATA / j.id / LIB.SONG).exists():
                for k, v in list(YT_CACHE.items()):
                    if v == j.id:
                        YT_CACHE.pop(k)
                shutil.rmtree(DATA / j.id, ignore_errors=True)


def _from_disk(job_id: str) -> Job | None:
    d = DATA / job_id
    s = LIB.read_song(d) if job_id.isalnum() and d.is_dir() else None
    if not s:
        return None
    res = dict(s.get("result") or {})
    res.pop("lyrics_pending", None)  # the app was closed while hearing the words: the sheet is kept without them
    audio = d / s.get("audio", "")
    return Job(id=job_id, kind=s.get("kind") or "upload", title=s.get("title") or "", status="done", stage="เสร็จแล้ว",
               progress=1.0, result=res, audio=audio if s.get("audio") and audio.exists() else None,
               created=s.get("created") or time.time(), vid=s.get("vid") or "", sha=s.get("sha") or "")


def _job(job_id: str) -> Job | None:
    """A job in memory, else a song from the library on disk (after a restart)."""
    with LOCK:
        j = JOBS.get(job_id)
    if j is None:
        j = _from_disk(job_id)
        if j is not None:
            with LOCK:
                j = JOBS.setdefault(job_id, j)
    return j


def _persist(job: Job) -> None:
    if job.result is None:
        return
    try:
        LIB.save_song(DATA / job.id, {"id": job.id, "kind": job.kind, "title": job.title, "vid": job.vid, "sha": job.sha,
                                      "audio": job.audio.name if job.audio else ""}, job.result)
    except Exception:
        log.exception("could not save %s to the library", job.id)


for _d, _s in LIB.all_songs(DATA):  # YouTube links already in the library open from it
    if _s.get("vid"):
        YT_CACHE.setdefault(_s["vid"], _d.name)


def _run(job: Job, url: str | None, upload: Path | None, tune: str = "auto", tempo: str = "auto") -> None:
    wd = DATA / job.id

    def report(stage: str, p: float) -> None:
        job.stage, job.progress = stage, max(job.progress, p)

    turn = {"sheet": False, "lyrics": False}

    def take(name: str) -> None:
        (SHEET_TURN if name == "sheet" else LYRICS_TURN).acquire()
        turn[name] = True

    def give(name: str) -> None:
        if turn[name]:
            turn[name] = False
            (SHEET_TURN if name == "sheet" else LYRICS_TURN).release()

    take("sheet")
    job.status = "running"
    try:
        if job.audio and job.audio.exists():  # re-analysis: reuse the audio we already have
            src = job.audio
        elif url:
            report("กำลังดาวน์โหลดเสียงจาก YouTube", 0.02)
            src, title = PL.download_youtube(url, wd, report)
            job.title = title
        else:
            src = upload
        job.audio = src
        def partial(res: dict) -> None:  # chords, key and melody ready: the page shows them while Whisper works
            job.result, job.lyrics_pending = res, True
            job.status = "done"
            _persist(job)
            if OVERLAP:  # the next song's sheet may start now; this song's words wait for the lyrics turn
                give("sheet")
                if not LYRICS_TURN.acquire(blocking=False):
                    job.stage = "รอคิวฟังเนื้อร้อง (เพลงก่อนหน้ากำลังฟังอยู่)"
                    LYRICS_TURN.acquire()
                turn["lyrics"] = True

        job.result = PL.analyze_file(src, wd, report, title=job.title, tune=tune, tempo=tempo, on_partial=partial)
        job.status = "done"
        job.lyrics_pending = False
        _persist(job)
    except PL.PipelineError as e:
        job.status, job.error = "error", str(e)
    except Exception as e:  # unexpected: log it, show a plain message
        log.exception("job %s failed", job.id)
        if job.lyrics_pending and job.result:  # the sheet is already out: keep it, without words
            job.result = {**job.result, "lyrics_pending": False}
        else:
            job.status, job.error = "error", f"เกิดข้อผิดพลาดในการวิเคราะห์ ({type(e).__name__})"
    finally:
        give("lyrics")
        give("sheet")
        job.lyrics_pending = False
        if job.status == "done":
            _persist(job)
        try:
            with LOCK:
                busy = {j.id for j in JOBS.values() if j.status in ("queued", "running") or j.lyrics_pending}
            LIB.trim_old(DATA, busy | {job.id})
        except Exception:
            log.exception("library trim failed")


def _new_job(kind: str, title: str) -> Job:
    _prune()
    job = Job(id=uuid.uuid4().hex[:12], kind=kind, title=title)
    (DATA / job.id).mkdir(parents=True, exist_ok=True)
    with LOCK:
        JOBS[job.id] = job
    return job


class YoutubeIn(BaseModel):
    url: str


@app.get("/api/online")
def online(request: Request):
    """Link + QR for phones while start-online runs. Only for the app opened on this computer (never via the tunnel)."""
    from . import online as ON

    if request.headers.get("cf-ray"):
        raise HTTPException(403, "only on this computer")
    i = ON.info()
    return {**i, "qr": ON.qr_svg(i["link"])} if i else {}


@app.get("/api/health")
def health(request: Request):
    import hmac
    import importlib.util

    online = bool(request.headers.get("cf-ray"))
    key_ok = not online or hmac.compare_digest(request.query_params.get("key") or request.headers.get("x-lyricord-key") or "", ACCESS_KEY)

    return {
        "ok": True,
        "online": online,
        "key_ok": key_ok,
        "demucs": PL.has_demucs(),
        "version": VERSION,
        "edition": EDITION,
        "whisper": PL.has_whisper(),
        "dereverb": DR.available(),
        "th_whisper": (PL.thai_whisper_dir() / "model.bin").exists(),
        "beat_this": PL.has_beat_this(),
        "ocr": OCR.available(),
        "btc": CN.available(),
        "basic_pitch": importlib.util.find_spec("basic_pitch") is not None,
        "youtube": importlib.util.find_spec("yt_dlp") is not None,
        "max_minutes": PL.MAX_SECONDS // 60,
        "whisper_model": PL.WHISPER_MODEL if PL.has_whisper() else None,
        "offline_models": os.environ.get("HF_HUB_OFFLINE") == "1",
    }


@app.post("/api/jobs/youtube")
def create_youtube(body: YoutubeIn):
    if EDITION == "free":
        raise HTTPException(404, "รุ่นนี้ไม่มีการแกะจาก YouTube ใช้ไฟล์เพลงหรือเสียงจากแท็บแทน")
    url = body.url.strip()
    if not PL.YT_RE.match(url):
        raise HTTPException(400, "ลิงก์นี้ไม่ใช่ลิงก์คลิป YouTube")
    vid = PL.youtube_id(url)
    cached = _job(YT_CACHE.get(vid or "", ""))
    if cached and cached.status in ("queued", "running", "done"):
        return cached.public()
    job = _new_job("youtube", "YouTube " + (vid or ""))
    job.vid = vid or ""
    if vid:
        YT_CACHE[vid] = job.id
    POOL.submit(_run, job, url, None)
    return job.public()


@app.post("/api/ocr")
async def ocr_image(file: UploadFile = File(...)):
    """Text lines of a lyric / chord-sheet picture, with word positions (so chords can be placed over syllables)."""
    if not OCR.available():
        raise HTTPException(503, "หลังบ้านไม่ได้ติดตั้งตัวอ่านภาพ (OCR)")
    data = await file.read()
    if len(data) > 25 << 20:
        raise HTTPException(413, "รูปใหญ่เกิน 25 MB")
    try:
        lines = OCR.read_lines(data)
    except Exception as e:
        log.warning("ocr failed: %s", e)
        raise HTTPException(400, "อ่านรูปนี้ไม่ได้ ลองไฟล์ JPG หรือ PNG")
    return {"lines": lines}


@app.post("/api/jobs/upload")
async def create_upload(file: UploadFile = File(...)):
    name = Path(file.filename or "audio").name
    job = _new_job("upload", Path(name).stem)
    dest = DATA / job.id / ("upload" + (Path(name).suffix.lower() or ".bin"))
    size, sha = 0, hashlib.sha256()
    with dest.open("wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            sha.update(chunk)
            if size > MAX_UPLOAD_MB << 20:
                f.close()
                shutil.rmtree(DATA / job.id, ignore_errors=True)
                JOBS.pop(job.id, None)
                raise HTTPException(413, f"ไฟล์ใหญ่เกิน {MAX_UPLOAD_MB} MB")
            f.write(chunk)
    job.sha = sha.hexdigest()
    # the very same file was analysed before: open it from the library (with its edits) instead of again
    for d, s in LIB.all_songs(DATA):
        if s.get("sha") == job.sha and d.name != job.id:
            old = _job(d.name)
            if old and old.status == "done" and old.audio:
                shutil.rmtree(DATA / job.id, ignore_errors=True)
                with LOCK:
                    JOBS.pop(job.id, None)
                log.info("upload %s = library song %s", name, old.id)
                return {**old.public(), "from_library": True}
    POOL.submit(_run, job, None, dest)
    return job.public()


class ReanalyzeIn(BaseModel):
    tune: str = "auto"  # auto | off
    tempo: str = "auto"  # auto | half | double


@app.post("/api/jobs/{job_id}/reanalyze")
def reanalyze(job_id: str, body: ReanalyzeIn):
    job = _job(job_id)
    if not job or not job.audio or not job.audio.exists():
        raise HTTPException(404, "ไม่พบงานนี้ (เซิร์ฟเวอร์อาจรีสตาร์ต)")
    if job.status in ("queued", "running") or job.lyrics_pending:
        return job.public()
    job.status, job.stage, job.progress, job.error, job.result = "queued", "รอคิว", 0.0, "", None
    POOL.submit(_run, job, None, None, "off" if body.tune == "off" else "auto",
                body.tempo if body.tempo in ("half", "double") else "auto")
    return job.public()


class LyricsIn(BaseModel):
    text: str


def _relisten(job: Job, text: str) -> None:
    def report(stage: str, p=None) -> None:
        job.relisten["stage"] = stage

    with (LYRICS_TURN if OVERLAP else SHEET_TURN):  # Whisper again: one lyrics pass at a time
        _relisten_now(job, text, report)


def _relisten_now(job: Job, text: str, report) -> None:
    try:
        out = PL.relisten_lyrics(DATA / job.id, text, report)
        if out and job.result is not None:
            job.result["lyrics"] = out
            _persist(job)
        job.relisten.update(status="done", lyrics=out)
    except Exception as e:
        log.exception("relisten %s failed", job.id)
        job.relisten.update(status="error", error=type(e).__name__)


@app.post("/api/jobs/{job_id}/lyrics")
def relisten(job_id: str, body: LyricsIn):
    """Hear the vocals again with the lyrics the user imported (Whisper is told the words to expect)."""
    job = _job(job_id)
    if not job or job.status != "done":
        raise HTTPException(404, "ไม่พบงานนี้ (เซิร์ฟเวอร์อาจรีสตาร์ต)")
    if job.relisten.get("status") == "running":
        return job.relisten
    if not PL.has_whisper() or not (DATA / job.id / "lyrics.json").exists() or not (DATA / job.id / "stems").exists():
        return {"status": "unavailable"}
    job.relisten = {"status": "running", "stage": "รอคิว"}
    POOL.submit(_relisten, job, body.text[:20000])
    return job.relisten


@app.get("/api/jobs/{job_id}/lyrics")
def relisten_status(job_id: str):
    job = _job(job_id)
    if not job:
        raise HTTPException(404, "ไม่พบงานนี้ (เซิร์ฟเวอร์อาจรีสตาร์ต)")
    return job.relisten or {"status": "none"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = _job(job_id)
    if not job:
        raise HTTPException(404, "ไม่พบงานนี้ (เซิร์ฟเวอร์อาจรีสตาร์ต)")
    return job.public()


@app.get("/api/jobs/{job_id}/audio")
def get_audio(job_id: str):
    job = _job(job_id)
    if not job or not job.audio or not job.audio.exists():
        raise HTTPException(404, "ไม่พบไฟล์เสียง")
    return FileResponse(job.audio)


# ---------------------------------------------------------------- song library
@app.get("/api/library")
def library():
    """Every song analysed on this computer, most recently used first (no big arrays)."""
    return {"songs": [LIB.summary(d, s) for d, s in LIB.all_songs(DATA)]}


def _lib_job(song_id: str) -> Job:
    job = _job(song_id)
    if not job or not (DATA / song_id / LIB.SONG).exists():
        raise HTTPException(404, "ไม่พบเพลงนี้ในคลัง")
    return job


@app.put("/api/library/{song_id}/edits")
async def save_edits(song_id: str, request: Request):
    """What the user changed on the sheet, so every device that opens the song sees the same edits."""
    _lib_job(song_id)
    body = await request.body()
    if len(body) > 4 << 20:
        raise HTTPException(413, "ข้อมูลใหญ่เกินไป")
    try:
        import json as _json
        edits = _json.loads(body)
        assert isinstance(edits, dict)
    except Exception:
        raise HTTPException(400, "ข้อมูลไม่ถูกต้อง")
    LIB.save_edits(DATA / song_id, edits)
    return {"ok": True}


class RenameIn(BaseModel):
    title: str


@app.patch("/api/library/{song_id}")
def rename_song(song_id: str, body: RenameIn):
    job = _lib_job(song_id)
    title = body.title.strip()[:200]
    if not title:
        raise HTTPException(400, "ชื่อเพลงว่าง")
    job.title = title
    s = LIB.read_song(DATA / song_id)
    s["title"], s["updated"] = title, time.time()
    LIB._write(DATA / song_id / LIB.SONG, s)
    return {"ok": True}


# ---------------------------------------------------------------- setlists (stage mode): one file for every device
SETLISTS = DATA.parent / "setlists.json"


@app.get("/api/setlists")
def get_setlists():
    try:
        return {"setlists": __import__("json").loads(SETLISTS.read_text("utf-8"))}
    except Exception:
        return {"setlists": []}


@app.put("/api/setlists")
async def put_setlists(request: Request):
    """The whole list at once (small): [{id, name, songs: [song id, ...], updated}]."""
    import json as _json

    body = await request.body()
    if len(body) > 1 << 20:
        raise HTTPException(413, "ข้อมูลใหญ่เกินไป")
    try:
        sl = _json.loads(body)
        assert isinstance(sl, list) and len(sl) <= 500
        clean = [{"id": str(x["id"])[:40], "name": str(x.get("name") or "")[:120], "updated": float(x.get("updated") or time.time()),
                  "songs": [str(s)[:40] for s in x.get("songs", [])][:300]} for x in sl if isinstance(x, dict) and x.get("id")]
    except Exception:
        raise HTTPException(400, "ข้อมูลไม่ถูกต้อง")
    LIB._write(SETLISTS, clean)
    return {"ok": True, "setlists": clean}


@app.delete("/api/library/{song_id}")
def delete_song(song_id: str):
    job = _lib_job(song_id)
    if job.status in ("queued", "running") or job.lyrics_pending:
        raise HTTPException(409, "เพลงนี้กำลังวิเคราะห์อยู่ รอให้เสร็จก่อนแล้วค่อยลบ")
    with LOCK:
        JOBS.pop(song_id, None)
        for k, v in list(YT_CACHE.items()):
            if v == song_id:
                YT_CACHE.pop(k)
    shutil.rmtree(DATA / song_id, ignore_errors=True)
    return {"ok": True}


if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
