"""Build the folder to upload to Cloudflare Pages: the web app (index.html + assets) and a _headers file.
Usage: python3 build.py && python3 tools/make_pages.py  -> dist/lyricord-pages/ and dist/lyricord-pages.zip"""
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "backend" / "web", ROOT / "dist" / "lyricord-pages"
HEADERS = """/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=604800
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self), camera=()
"""
shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True)
page = (SRC / "index.html").read_text("utf-8")
assert "/*ONLINE*/false" in page, "index.html has no ONLINE marker"
(OUT / "index.html").write_text(page.replace("/*ONLINE*/false", "/*ONLINE*/true"), "utf-8")  # this copy finds the Mac via /where
shutil.copytree(SRC / "assets", OUT / "assets")
(OUT / "_headers").write_text(HEADERS)
z = OUT.with_suffix(".zip")
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
    for p in sorted(OUT.rglob("*")):
        if p.is_file():
            f.write(p, p.relative_to(OUT))
files = [p for p in OUT.rglob("*") if p.is_file()]
print(f"{OUT} · {len(files)} files · {sum(p.stat().st_size for p in files) / 1e6:.1f} MB · {z.name} {z.stat().st_size / 1e6:.1f} MB")
