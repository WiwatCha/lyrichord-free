"""Online access details (written by start-online) and a QR code so a phone or iPad connects with one scan.

    python -m app.online set <tunnel url> [<online page url>]   -> saves them, prints the link and a QR code
    python -m app.online clear                                  -> online access stopped
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
FILE = DATA / "online.json"


def key() -> str:
    """Same key the server checks (main._access_key): ACCESS_KEY, else the one kept in the data folder."""
    if os.environ.get("ACCESS_KEY"):
        return os.environ["ACCESS_KEY"]
    f = DATA / "access_key.txt"
    return f.read_text().strip() if f.exists() else ""


def info() -> dict:
    """{url, pages, link} while start-online runs, else {}. The link carries the access key."""
    try:
        d = json.loads(FILE.read_text("utf-8"))
    except Exception:
        return {}
    url, pages = d.get("url", "").rstrip("/"), d.get("pages", "").rstrip("/")
    if not url:
        return {}
    k = key()
    # with an online page the link never changes: the page asks /where for today's tunnel address
    link = f"{pages}/#key={k}" if pages else f"{url}/?key={k}"
    return {"url": url, "pages": pages, "key": k, "link": link}


def save(url: str, pages: str = "") -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps({"url": url, "pages": pages}), "utf-8")


def clear() -> None:
    FILE.unlink(missing_ok=True)


def qr_svg(text: str) -> str:
    import segno

    buf = __import__("io").BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=8, border=3, dark="#000", light="#fff", xmldecl=False, omitsize=True)
    return buf.getvalue().decode()


def print_qr(text: str) -> None:
    import segno

    out = sys.stdout
    try:
        out.reconfigure(encoding="utf-8")
    except Exception:
        pass
    # dark modules as spaces on a light background read best in a black console window
    segno.make(text, error="m").terminal(out=out, compact=True, border=2)


def main(argv: list[str]) -> None:
    if argv[:1] == ["set"] and len(argv) >= 2:
        save(argv[1], argv[2] if len(argv) > 2 else "")
        if len(argv) > 2 and argv[2]:  # the phone finds this address through the online page (start-online scripts)
            from .tunnel import announce
            announce(argv[2].rstrip("/"), key(), argv[1].rstrip("/"))
        i = info()
        if not os.environ.get("LYRICORD_NO_QR"):
            print("\nScan with the camera of your iPhone / iPad (same link as below):\n")
            print_qr(i["link"])
        print("\nLink: " + i["link"] + "\n")
    elif argv[:1] == ["clear"]:
        clear()
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
