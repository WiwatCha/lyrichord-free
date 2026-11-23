"""Second lyrics pass with the user's lyrics as Whisper hotwords (pipeline.relisten_lyrics), on workdirs kept by e2e_cmp.py.

    PYTHONPATH=backend python3 tests/e2e/relisten_test.py <workdir> <reference lyrics .txt> [<workdir> <ref> ...]

Prints recall / precision of pass 1 and of the hinted pass against the reference, and the seconds it took.
"""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lyrics"))
from app import pipeline as PL  # noqa: E402
from lcs import lcs_recall  # noqa: E402


def flat(t):
    return t.replace(" ", "").replace("\n", "")


args = sys.argv[1:]
for wd, ref in zip(args[::2], args[1::2]):
    wd, text = Path(wd), Path(ref).read_text()
    R = flat(text)
    w1 = PL.clean_words(json.loads((wd / "lyrics.json").read_text())["words"])
    t = time.time()
    r = PL.relisten_lyrics(wd, text, lambda m, p=None: None) or {}
    w2 = r.get("words") or []
    h1, h2 = (flat("".join(w["text"] for w in w)) for w in (w1, w2))
    print(wd.name, json.dumps({"sec": round(time.time() - t), "words1": len(w1), "words2": len(w2),
                               "recall1": lcs_recall(R, h1), "recall2": lcs_recall(R, h2),
                               "prec1": lcs_recall(h1, R) if h1 else 0, "prec2": lcs_recall(h2, R) if h2 else 0}), flush=True)
