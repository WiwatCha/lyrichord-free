"""Score an OCR transcript of a chord sheet against the reference text:
 thai_cer  = character error rate on the Thai lyric text (spaces ignored)
 chord_acc = share of reference chord symbols recovered in order (LCS), chord_extra = wrong extra chord tokens"""
import re, sys
TH = re.compile(r'[฀-๿]')
CH = re.compile(r'^[A-G](?:#|b)?(?:maj7|maj9|m7b5|m7|m9|m6|m|dim7|dim|aug|sus2|sus4|7sus4|add9|2|6|7|9|11|13|7-9)?(?:/[A-G](?:#|b)?)?$')
def norm_chord(t): return t.replace('♯', '#').replace('♭', 'b')
def chords(text):
    out = []
    for t in re.split(r'[\s/|]+', text.replace('C# 7', 'C#7')):
        t = norm_chord(t.strip('()*,.'))
        if t and CH.match(t): out.append(t)
    # slash chords were split by '/', rejoin "B/D#" style: handled by scoring slash as two tokens on both sides
    return out
def thai(text): return ''.join(ch for ch in text if TH.match(ch) or ch in 'ๆ')
def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]
def lcs(a, b):
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1): d[i][j] = d[i-1][j-1] + 1 if a[i-1] == b[j-1] else max(d[i-1][j], d[i][j-1])
    return d[-1][-1]
def score(hyp, ref):
    hyp = re.sub(r'\[([^\]]*)\]', lambda m: ' ' + m.group(1) + ' ' if CH.match(m.group(1)) else '', hyp)
    hyp = re.sub(r'(?<=\w) (?=[A-G])', ' ', hyp)
    rt, ht = thai(ref), thai(hyp); rc, hc = chords(ref), chords(hyp); L = lcs(hc, rc)
    words = lambda t: [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]*", t) if not CH.match(w) and w.lower() not in ('intro', 'instru', 'outro', 'times')]
    rw, hw = words(ref), words(hyp); LW = lcs(hw, rw)
    return {'eng_word_acc': round(LW / max(1, len(rw)), 3), 'thai_cer': round(lev(ht, rt) / max(1, len(rt)), 3), 'chord_acc': round(L / len(rc), 3), 'chord_extra': len(hc) - L, 'ref_chords': len(rc), 'ref_thai_chars': len(rt)}
if __name__ == '__main__':
    print(score(open(sys.argv[1]).read(), open(sys.argv[2]).read()))
