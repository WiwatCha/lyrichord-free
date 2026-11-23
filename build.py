"""Build Lyricord's web app.

web/parts/*            -> web/template.html                 (web/assemble.py)
template + analysis.js + chord_vocab.json -> backend/web/index.html
Thai UI strings are wrapped with T(...) at build time (tools/i18n_wrap.js) and translated with web/i18n/en.json.
"""
import json
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).parent
exec((root / "web/assemble.py").read_text(), {"__file__": str(root / "web/assemble.py")})
TH = re.compile(r"[฀-๿]")

t = (root / "web/template.html").read_text()
a = (root / "web/analysis.js").read_text()
v = (root / "backend/app/chord_vocab.json").read_text()

# 1) wrap Thai strings in the app script
i = t.rindex("<script>\n") + len("<script>\n")
j = t.rindex("</script>")
keys_file = root / "web/i18n/.keys.json"
keys_file.parent.mkdir(exist_ok=True)
wrapped = subprocess.run(["node", str(root / "tools/i18n_wrap.js"), str(keys_file)], input=t[i:j], capture_output=True, text=True)
if wrapped.returncode:
    sys.exit("i18n wrap failed:\n" + wrapped.stderr)
t = t[:i] + wrapped.stdout + t[j:]
keys = set(json.loads(keys_file.read_text()))
keys_file.unlink()

# 2) static page text and attributes
class Grab(HTMLParser):
    skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"): self.skip += 1
        for k, val in attrs:
            if k in ("placeholder", "aria-label", "title") and val and TH.search(val): keys.add(val)
    def handle_endtag(self, tag):
        if tag in ("script", "style"): self.skip -= 1
    def handle_data(self, data):
        if not self.skip and TH.search(data): keys.add(data.strip())
Grab().feed(t[: t.index("<script>")])

# 3) constants translated at use, and messages that come from the backend
top = (root / "web/parts/js_top.js").read_text()
for name in ("SOL", "LV_NAME", "LV_HINT", "QLABEL", "KIND"):
    m = re.search(r"const %s = (\{.*?\}|\[.*?\]);" % name, top, re.S)
    keys.update(x for x in re.findall(r"'([^']*)'", m.group(1)) if TH.search(x))
live = (root / "web/parts/js_live.js").read_text()  # the guide's steps, translated when shown
m = re.search(r"const TOUR = (\[.*?\n\]);", live, re.S)
keys.update(x for x in re.findall(r"'([^']*)'", m.group(1)) if TH.search(x))
m = re.search(r"const CREDITS = (\[.*?\n\]);", (root / "web/parts/js_simple.js").read_text(), re.S)
keys.update(x for x in re.findall(r"'([^']*)'", m.group(1)) if TH.search(x))
for f in ("backend/app/pipeline.py", "backend/app/main.py"):
    for s in re.findall(r'"([^"\n]*[฀-๿][^"\n]*)"', (root / f).read_text()):
        if "{" not in s: keys.add(s)

# 4) dictionary
en_path = root / "web/i18n/en.json"
en = json.loads(en_path.read_text()) if en_path.exists() else {"en": {}, "rx": []}
missing = sorted(k for k in keys if k not in en["en"])
(root / "web/i18n/missing.json").write_text(json.dumps(missing, ensure_ascii=False, indent=1))
t = t.replace("/*I18N*/{ en: {}, rx: [] }", json.dumps({"en": en["en"], "rx": en["rx"]}, ensure_ascii=False))

version = (root / "backend/VERSION").read_text().strip()
t = t.replace("/*VERSION*/'dev'", json.dumps(version))
edition = "free" if "--edition=free" in sys.argv or ("--edition" in sys.argv and sys.argv[sys.argv.index("--edition") + 1:][:1] == ["free"]) else "full"
t = t.replace("/*EDITION*/'full'", json.dumps(edition))
html = t.replace("/*VOCAB*/", "const CHORD_VOCAB = " + v.strip() + ";").replace("/*ANALYSIS*/", a)
out = root / "backend/web/index.html"
out.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(root / "web/assets", root / "backend/web/assets", dirs_exist_ok=True)
out.write_text(html)
print("edition", edition, "·", "version", version, "·", "wrote", out, len(html.splitlines()), "lines ·", len(keys), "UI strings ·", len(missing), "missing English")
