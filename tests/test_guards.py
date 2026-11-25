"""Unit checks for the guards added in r14: spoken passages, input warnings, octave fixes, transcript cleaning,
character alignment for the second lyrics pass, and the two-job progress line.
    PYTHONPATH=backend python3 tests/test_guards.py"""
import numpy as np

from app import pipeline as PL

SR = PL.SR
ok = True


def check(name, cond, extra=""):
    global ok
    print(("ok  " if cond else "FAIL"), name, extra)
    ok &= bool(cond)


rng = np.random.default_rng(0)
t = np.arange(SR * 40) / SR
# band plays 0-10 s and 20-40 s; a voice talks 10-20 s over silence, then sings over the band
harm = np.where((t < 10) | (t >= 20), 0.3 * np.sin(2 * np.pi * 220 * t), 0.0) + 0.0005 * rng.standard_normal(len(t))
voice = np.where(t >= 10, 0.3 * np.sin(2 * np.pi * 330 * t) * (1 + 0.5 * np.sin(2 * np.pi * 3 * t)), 0.0)
sp = PL.spoken_passages(voice.astype(np.float32), harm.astype(np.float32))
check("spoken passage found where only a voice is heard", len(sp) == 1 and abs(sp[0][0] - 10) <= 1.5 and abs(sp[0][1] - 20) <= 1.5, sp)
check("no spoken passage in a sung song", PL.spoken_passages(voice[SR * 20:].astype(np.float32), harm[SR * 20:].astype(np.float32)) == [])

song = (0.2 * np.sin(2 * np.pi * 440 * t) + 0.05 * rng.standard_normal(len(t))).astype(np.float32)
check("no warning for a normal file", PL.input_warnings(song, 40.0) == [], PL.input_warnings(song, 40.0))
check("quiet file warned", any("เบา" in w for w in PL.input_warnings(song * 0.003, 40.0)))
check("short file warned", any("สั้น" in w for w in PL.input_warnings(song[: SR * 10], 10.0)))
check("long file warned", any("10 นาที" in w for w in PL.input_warnings(song, 700.0)))
import scipy.signal as ss  # noqa: E402

b, a = ss.butter(10, 3500 / (SR / 2))
dull = ss.filtfilt(b, a, song).astype(np.float32)  # highs cut off at 3.5 kHz, like a heavily compressed file
check("dull (low-pass) file warned", any("คุณภาพ" in w for w in PL.input_warnings(dull, 40.0)))

mel = [{"t0": i * 0.5, "t1": i * 0.5 + 0.3, "midi": m} for i, m in enumerate([60, 72, 61, 62, 64, 79, 65, 67, 69])]
fixed = [x["midi"] for x in PL.fix_octaves(mel)]
check("octave slips moved back", fixed == [60, 60, 61, 62, 64, 67, 65, 67, 69], fixed)
leap = [{"t0": i * 0.5, "t1": i * 0.5 + 0.45, "midi": m} for i, m in enumerate([60, 62, 64, 72, 71, 72, 74, 76])]
check("a real leap to a new register is kept", [x["midi"] for x in PL.fix_octaves(leap)] == [60, 62, 64, 72, 71, 72, 74, 76])

W = lambda xs: [{"t0": i, "t1": i + 0.5, "text": x} for i, x in enumerate(xs)]
c = [w["text"] for w in PL.clean_words(W(["รัก"] * 3 + ["ฮื้อ"] * 9 + ["ไป", "a", "b", "a", "b", "a", "b", "a", "b", "a", "b"]))]
check("loops cut to three, real triple kept", c == ["รัก"] * 3 + ["ฮื้อ"] * 3 + ["ไป", "a", "b", "a", "b", "a", "b"], c)
c = PL.clean_words(W(["พูด", "พูด", "ร้อง"]), None, [(0.0, 1.9)])
check("words in spoken passages dropped", [w["text"] for w in c] == ["ร้อง"], c)
check("loop share", PL.loop_share("ฮื้อฮื้อฮื้อฮื้อฮื้อฮื้อ") > 0.3 and PL.loop_share("ความจริงที่ฉันต้องการเก็บไว้") == 0)

al = PL._char_alignment("ความจริงที่ฉัน", "ความจิงที่ฉน")
check("character alignment", al[:4] == [0, 1, 2, 3] and al[-1] == 13 and -1 not in al[4:6], al)

seen = []
p = PL.Progress(lambda m, f: seen.append((m, f)))
p("chords", 0.5); p.lyrics("whisper 10%"); p("melody", 0.4); p.lyrics(None)
check("progress joins two jobs and never goes back", seen[1] == ("chords · whisper 10%", 0.5) and seen[2][1] == 0.5 and seen[3] == ("melody", 0.5), seen)

# Thai comes out of Whisper as letter fragments: a phrase looped 30 times is not a run of equal words
frag = [{"t0": 1.0, "t1": 1.0, "text": c} for c in "ความจริง" + "ขอบคุณ" * 30]
kept = "".join(w["text"] for w in PL.clean_words(frag))
check("letter-level loop cut to three", kept == "ความจริง" + "ขอบคุณ" * 3, kept[:40])
check("loop share sees a 10-letter Thai loop", PL.loop_share("ไอคาราชาภิ" * 20) > 0.8)
song = "ความจริงที่ฉันต้องการเก็บไว้มันทำให้ฉันต้องคอยห่างเธอ" + "รักเธอ" * 3 + "ไม่กล้ามองไม่จ้องตา"
check("normal lyrics (a word sung three times) are not a loop", PL.loop_share(song) == 0 and len(PL.clean_words([{"t0": 0, "t1": 0, "text": c} for c in song])) == len(song))

# an empty transcript must not beat a real one just because it does not loop
looping = {"words": W(["a"] * 199), "conf": 0.95, "loops": 0.9}
empty = {"words": [], "conf": 0.0, "loops": 0.0}
check("empty transcript does not win", PL._pick_score(looping) > PL._pick_score(empty), (PL._pick_score(looping), PL._pick_score(empty)))

import os

# one tempo for the whole song: a chorus counted double (busy drums) goes back to the song's tempo
grid = np.arange(0, 300, 0.88)  # 68 BPM; the model adds a beat between each pair from 90 s to 180 s
song_b = np.sort(np.concatenate([grid, (grid[:-1] + 0.44)[(grid[:-1] > 90) & (grid[:-1] < 180)]]))
fixed = PL.steady_octave(song_b)
g = np.diff(fixed)
check("double-counted chorus back to one tempo", len(song_b) > len(grid) and len(fixed) == len(grid) and g.min() > 0.8 and g.max() < 0.96,
      (len(song_b), len(fixed), len(grid), g.min(), g.max()))
slow = grid[grid < 90]
one = np.insert(slow, 20, slow[19] + 0.44)  # a single extra beat in a fill
check("a single inserted half beat is dropped", len(PL.steady_octave(one)) == len(slow))
steady = np.cumsum(0.66 + 0.04 * np.sin(np.arange(300) / 7))  # a steady song with a little drift: untouched
check("a steady song keeps every beat", np.array_equal(PL.steady_octave(steady), np.round(steady, 6)))

check("lyrics run after the chords unless PARALLEL_LYRICS=1", PL.PARALLEL is (os.environ.get("PARALLEL_LYRICS") == "1"))

# the de-reverbed pass: never for English (never better, ~4 min); for other languages only when the plain stem's
# transcript is no answer (loops or empty: tests/lyrics/dereverb_study.py); DEREVERB_ALWAYS=1 = every time
saved = (PL.has_whisper, PL._whisper_model, PL.vocal_presence, PL._transcribe)
PL.has_whisper, PL._whisper_model = (lambda: True), (lambda: None)


def dereverb_runs(lang, loops, always=False):
    calls = []
    PL._transcribe = lambda m, y, lg, label, rep, **k: {"lang": lg, "words": W(["x"]), "conf": 0.9, "cut": False, "loops": loops}
    PL.vocal_presence = lambda m, y, s: {"sung": True, "lang": lang, "why": ""}
    os.environ["DEREVERB_ALWAYS"] = "1" if always else "0"
    PL.transcribe_lyrics(np.zeros(SR * 2, np.float32), None, lambda *a: None, 0.5, lambda: calls.append(lang))
    os.environ.pop("DEREVERB_ALWAYS")
    return bool(calls)


check("de-reverb: not for a usable Thai transcript", not dereverb_runs("th", 0.0))
check("de-reverb: for a looping Thai transcript", dereverb_runs("th", 0.5))
check("de-reverb: never for English, even looping", not dereverb_runs("en", 0.5))
check("de-reverb: DEREVERB_ALWAYS=1 keeps both passes", dereverb_runs("th", 0.0, always=True))
PL.has_whisper, PL._whisper_model, PL.vocal_presence, PL._transcribe = saved
os.environ["DEREVERB_EN"] = "1"
check("DEREVERB_EN=1 keeps it for English", PL.dereverb_for("en") and PL.dereverb_for("th") and PL.dereverb_for(None))
del os.environ["DEREVERB_EN"]
check("English skips by default", not PL.dereverb_for("en"))

print("all guard tests passed" if ok else "SOME GUARD TESTS FAILED")
raise SystemExit(0 if ok else 1)
