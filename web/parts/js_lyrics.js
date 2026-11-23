// ================= lyrics: import, auto-align, editor =================
function phrasesFromAI(s) {
  const out = []; let cur = null;
  for (const w of s.aiWords || []) {
    if (!cur || w.t0 - cur.t1 > 0.6 || cur.n >= 12) { cur = { t: w.t0, t1: w.t1, text: '', n: 0 }; out.push(cur); }
    cur.text += w.text; cur.t1 = w.t1; cur.n++;
  }
  return out;
}
// ---- reading .txt / .docx without any library ----
function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-874').decode(u8); }   // Thai TIS-620 files from older websites
}
async function unzipEntry(buf, want) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip');
  let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true), td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    if (name === want) {
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u8.subarray(start, start + csize);
      if (method === 0) return td.decode(data);
      const ds = new DecompressionStream('deflate-raw');
      return await new Response(new Blob([data]).stream().pipeThrough(ds)).text();
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error('no ' + want);
}
async function docxText(buf) {
  const xml = await unzipEntry(buf, 'word/document.xml'), doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const p of doc.getElementsByTagNameNS('*', 'p')) {
    let t = '';
    p.querySelectorAll('*').forEach(el => { if (el.localName === 't') t += el.textContent; else if (el.localName === 'tab') t += ' '; else if (el.localName === 'br' || el.localName === 'cr') t += '\n'; });
    out.push(t);
  }
  return out.join('\n');
}
const CHORDTOK = /^\(?[A-G](?:#|b|♯|♭)?(?:maj|min|m|M|dim|aug|sus|add|°|ø|\+)?\d{0,2}(?:(?:sus|add|maj|b|#|-)\d{1,2})*(?:\/[A-G](?:#|b)?)?\)?$/;
const isChordLine = str => { const tk = str.split(/[\s|,]+/).filter(Boolean); return tk.length > 0 && tk.some(t => /^\(?[A-G]/.test(t)) && tk.every(t => CHORDTOK.test(t) || /^(-+|\.+|\/|x\d+|N\.?C\.?|:|\*+|%)$/i.test(t)); };
const LABEL = /^(intro|instru(?:mental)?|solo|outro|hook|chorus|verse|pre-?chorus|bridge|interlude|ending|coda|refrain|ท่อน\S*|ดนตรี|โซโล่|เกริ่น|ซ้ำ|จบ|repeat|\*+|#+)\s*[:：\-.]?\s*/i;
// ---- chord names from web chord sheets: C, Cm, C7, Cmaj7, CM7, Cm7b5, C°, C+, Csus, C2, Cadd9, C/E, Bb, F#m ...
const QMAP = [['maj9', 'maj9'], ['M9', 'maj9'], ['maj7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'], ['m7b5', 'm7b5'], ['m7-5', 'm7b5'], ['ø', 'm7b5'],
  ['dim7', 'dim7'], ['°7', 'dim7'], ['o7', 'dim7'], ['dim', 'dim'], ['°', 'dim'], ['aug', 'aug'], ['+', 'aug'], ['m11', 'm11'], ['m9', 'm9'], ['m6', 'm6'], ['m7', 'm7'],
  ['min7', 'm7'], ['min', 'm'], ['madd9', 'm'], ['m', 'm'], ['7sus4', '7sus4'], ['7sus', '7sus4'], ['9sus4', '7sus4'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['add9', '2'], ['add2', '2'], ['2', '2'], ['6/9', '6'], ['69', '6'], ['6', '6'], ['13', '13'], ['11', '11'], ['9', '9'], ['7', '7'], ['5', '']];
function parseChordName(tok) {
  const m = String(tok).replace(/[()]/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').match(/^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/);
  if (!m) return null;
  const pc = (l, acc) => mod('C D EF G A B'.indexOf(l) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
  let q = ''; const rest = m[3];
  for (const [k, v] of QMAP) if (rest.startsWith(k)) { q = v; break; }
  const root = pc(m[1], m[2]), bass = m[4] ? pc(m[4], m[5]) : -1;
  return { root, q, bass: bass === root ? -1 : bass };
}
const isCombining = ch => /[ัิ-ฺ็-๎̀-ͯ]/.test(ch);
// web chord sheets: chord lines above lyric lines (by column), [C] inline, chord-only lines for intro/solo
// name shown on an instrumental section: the sheet's own label (Intro, Solo, Outro...) or a plain one
// name of a sung section from the sheet's label ([Verse], Chorus:, ท่อนฮุก ...)
function songSec(label) {
  const l = (label || '').toLowerCase();
  if (/pre-?chorus/.test(l)) return 'Pre-chorus';
  if (/chorus|hook|refrain|ฮุก|ฮุค/.test(l)) return 'Chorus';
  if (/verse/.test(l)) return 'Verse';
  if (/bridge/.test(l)) return 'Bridge';
  return '';
}
// whole-line notes that are not lyrics: [Verse], [Chorus 2], (modulation), (x2), (ขึ้นคีย์)
const NOTE_LINE = /^[\[(]\s*(?:(intro|instru(?:mental)?|solo|outro|hook|chorus|verse|pre-?chorus|bridge|interlude|ending|coda|refrain|ท่อน\S*|ดนตรี|โซโล่|เกริ่น|ซ้ำ|จบ|repeat)[^\])]*|modulation|key change|เปลี่ยนคีย์|ขึ้นคีย์|x\s*\d+|\d+\s*x|ซ้ำ\s*\*?)\s*[\])]\s*:?$/i;
function secName(label, at) {
  const l = (label || '').replace(/[:：\-.]+$/, '').trim();
  if (/^(intro|เกริ่น)/i.test(l)) return 'Intro';
  if (/^(outro|ending|coda|จบ)/i.test(l)) return 'Outro';
  if (/^(solo|โซโล่)/i.test(l)) return 'Solo';
  if (/^(instru|interlude|ดนตรี)/i.test(l)) return 'Instru';
  return at === 0 ? 'Intro' : '';
}
function parseSheet(text, strip) {
  const raw = text.replace(/\r/g, '').split('\n'), lines = [], instr = [];
  let brk = false, first = true, pending = null, label = null;
  // "/ Amaj7 / Dmaj7 / x4 / Amaj7 /": a repeat mark repeats the chords since the previous mark
  const chordsOf = str => {
    const out = []; let seg = [];
    for (const t of str.split(/[\s|,/]+/).filter(Boolean)) {
      const x = t.match(/^x(\d+)$/i);
      if (x) { for (let k = 0; k < Math.min(16, +x[1]); k++) out.push(...seg); seg = []; continue; }
      const c = parseChordName(t); if (c) seg.push(c);
    }
    return out.concat(seg);
  };
  const blocks = {}; let mark = null; // sections marked *, **, *** that "( * , ** )" sings again
  const addInstr = str => { const cs = chordsOf(str); if (cs.length) instr.push({ at: lines.length, chords: cs, label: secName(label, lines.length) }); label = null; };
  const flush = () => { if (pending) addInstr(pending.trim()); pending = null; };
  for (let r of raw) {
    r = r.replace(/[​ ]/g, ' ').replace(/\t/g, '    ')
      .replace(/\(\s*(\d+)\s*(?:times?|ครั้ง|รอบ)\s*\)/gi, ' x$1 ').replace(/\(\s*x\s*(\d+)\s*\)/gi, ' x$1 ')
      .replace(/\b([A-G][#b]?m?) (7|9|11|13)(?=\s|$)/g, '$1$2 '); // "C# 7" -> "C#7" (same width: columns stay)
    const tr = r.trim();
    if (!tr) { brk = true; flush(); mark = null; continue; }
    if (strip) {
      // "( * , ** )": sing the marked sections again
      const again = tr.match(/^\(?\s*(\*{1,3}(?:\s*,\s*\*{1,3})*)\s*\)?$/);
      if (again) {
        flush(); mark = null;
        for (const mk of again[1].split(/\s*,\s*/)) (blocks[mk] || []).forEach((ln, j) => lines.push({ ...ln, t: 0, brk: j === 0, anchors: ln.anchors && ln.anchors.map(a => ({ ...a })) }));
        brk = true; continue;
      }
      // a lyric line starting with *, ** or *** starts a marked section (the mark itself is not sung)
      const mm = r.match(/^(\s*)(\*{1,3})(?=\s)/);
      if (mm && !isChordLine(tr)) { mark = mm[2]; blocks[mark] = []; r = mm[1] + ' '.repeat(mm[2].length) + r.slice(mm[0].length); }
    }
    if (strip && first) { first = false; if (/^(เพลง|song|title)\s*[:：]?/i.test(tr) || / [-–—] /.test(tr)) continue; }
    first = false;
    if (strip) {
      const nl = tr.match(NOTE_LINE);
      if (nl) { flush(); if (nl[1]) label = nl[1]; brk = true; mark = null; continue; }
      const m = tr.match(LABEL);
      if (m) { const rest = tr.slice(m[0].length).trim(); if (!rest || isChordLine(rest) || /^[\s*()0-9x.:-]*$/i.test(rest)) { flush(); label = m[1]; mark = null; if (rest && isChordLine(rest)) addInstr(rest); brk = true; continue; } }
      if (isChordLine(tr)) { flush(); pending = r; continue; }
      if (/^[\s*\-=_#()[\]0-9.:xX|]+$/.test(tr)) { flush(); brk = true; continue; }
    }
    // lyric line: inline [C] chords, then chords from the chord line above (matched by column)
    let txt = '', anchors = [];
    r.split(/(\[[^\]]*\])/).forEach(part => { const m = part.match(/^\[([^\]]*)\]$/); if (m) { const c = parseChordName(m[1].trim()); if (c) anchors.push({ ci: txt.length, chord: c, label: m[1].trim() }); } else txt += part; });
    if (pending) {
      const colIdx = []; let col = 0; for (let i = 0; i < txt.length; i++) { if (!isCombining(txt[i])) { colIdx[col] = i; col++; } }
      for (const m of pending.matchAll(/\S+/g)) { const c = parseChordName(m[0]); if (c) anchors.push({ ci: colIdx[Math.min(m.index, colIdx.length - 1)] ?? txt.length, chord: c, label: m[0] }); }
      pending = null;
    }
    const lead = txt.length - txt.trimStart().length;
    let line = txt.replace(/\s+$/, '').slice(lead);
    if (strip) line = line.replace(/\(\s*(?:ซ้ำ|repeat)?[\s*x0-9]*\)\s*$/i, '').replace(/\s[xX]\s?\d+\s*$/, '').trimEnd();
    // collapse runs of spaces (keep anchor positions in step)
    let out = '', map = []; for (let i = 0; i < line.length; i++) { map[i] = out.length; if (line[i] === ' ' && out.endsWith(' ')) continue; out += line[i]; }
    anchors = anchors.map(a => ({ ...a, ci: Math.max(0, Math.min(out.length - 1, map[Math.max(0, a.ci - lead)] ?? out.length - 1)) })).sort((x, y) => x.ci - y.ci);
    if (!out.trim()) { if (anchors.length) instr.push({ at: lines.length, chords: anchors.map(a => a.chord), label: secName(label, lines.length) }); label = null; continue; }
    const sec = songSec(label); label = null;
    lines.push({ t: 0, text: out, brk: brk && lines.length > 0, anchors: anchors.length ? anchors : undefined, sec: sec || undefined }); brk = false;
    if (mark) blocks[mark].push({ text: out, anchors: anchors.length ? anchors : undefined });
  }
  flush();
  return { lines, instr, chordCount: lines.reduce((a, l) => a + (l.anchors ? l.anchors.length : 0), 0) + instr.reduce((a, g) => a + g.chords.length, 0) };
}
const cleanLyrics = (text, strip) => parseSheet(text, strip).lines;
// ---- automatic timing ----
const normTh = t => t.toLowerCase().replace(/[\s\p{P}\p{S}ัิ-ฺ็-๎]/gu, '');
function snapBeat(s, t) {
  const i = beatAt(s, t); if (i < 0) return t;
  const c = [s.res.beats[i], s.res.beats[i + 1]].filter(x => x != null).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  return Math.abs(c - t) < 0.35 ? c + 0.01 : t;
}
function alignByText(s, lines) {
  const a = [], at = [];
  for (const w of s.aiWords) { const ch = [...normTh(w.text)]; ch.forEach((c, i) => { a.push(c); at.push(w.t0 + (w.t1 - w.t0) * i / Math.max(1, ch.length)); }); }
  const b = [], bs = [], bo = [];
  for (const ln of lines) { bs.push(b.length); [...ln.text].forEach((ch, ci) => { const n = normTh(ch); for (const c of n) { b.push(c); bo.push(ci); } }); }
  const n = a.length, m = b.length;
  if (n < 5 || !m || n * m > 30e6) return false;
  const dir = new Uint8Array((n + 1) * (m + 1)); let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let j = 1; j <= m; j++) { prev[j] = -j; dir[j] = 3; }
  let best = -1e9, bi = 0;
  for (let i = 1; i <= n; i++) {
    cur[0] = 0; dir[i * (m + 1)] = 2;
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1), u = prev[j] - 1, l = cur[j - 1] - 1;
      if (d >= u && d >= l) { cur[j] = d; dir[i * (m + 1) + j] = 1; } else if (u >= l) { cur[j] = u; dir[i * (m + 1) + j] = 2; } else { cur[j] = l; dir[i * (m + 1) + j] = 3; }
    }
    if (cur[m] > best) { best = cur[m]; bi = i; }
    [prev, cur] = [cur, prev];
  }
  const map = new Int32Array(m).fill(-1); let i = bi, j = m;
  while (j > 0 && i > 0) { const d = dir[i * (m + 1) + j]; if (d === 1) { map[j - 1] = i - 1; i--; j--; } else if (d === 2) i--; else j--; }
  const hit = q => map[q] >= 0 && a[map[q]] === b[q];
  const times = lines.map((ln, k) => {
    const end = bs[k + 1] ?? m;
    for (let q = bs[k]; q < Math.min(bs[k] + 10, end - 2); q++) if (hit(q) && hit(q + 1) && hit(q + 2)) return at[map[q]] - (q - bs[k]) * 0.12;
    return null;
  });
  // e.g. romaji lyrics vs Japanese the AI heard share only stray letters: then the AI timing is not used
  let matched = 0; for (let q = 0; q < m; q++) if (hit(q)) matched++;
  if (matched < 0.35 * m || times.filter(x => x != null).length < Math.max(1, lines.length * 0.3)) return false;
  fillGaps(s, times); lines.forEach((ln, k) => { ln.t = times[k]; });
  // keep when each matched character was sung: chords can then sit on the exact word
  lines.forEach((ln, k) => {
    const pts = []; for (let q = bs[k]; q < (bs[k + 1] ?? m); q++) if (map[q] >= 0 && a[map[q]] === b[q]) pts.push([bo[q], +at[map[q]].toFixed(2)]);
    const mono = []; for (const p of pts) if (!mono.length || (p[0] > mono[mono.length - 1][0] && p[1] >= mono[mono.length - 1][1])) mono.push(p);
    ln.ct = mono.length >= 2 ? mono.filter((_, i) => i % Math.ceil(mono.length / 40) === 0 || i === mono.length - 1) : undefined;
  });
  return true;
}
function fillGaps(s, times) {
  const n = times.length, first = s.res.beats[0] || 0;
  for (let k = 0; k < n; k++) if (times[k] == null) {
    let p = k - 1; while (p >= 0 && times[p] == null) p--;
    let q = k + 1; while (q < n && times[q] == null) q++;
    const t0 = p >= 0 ? times[p] : first, t1 = q < n ? times[q] : Math.min(s.res.duration - 1, t0 + (q - p) * barDur(s));
    times[k] = t0 + (t1 - t0) * (k - p) / (q - p);
  }
  for (let k = 1; k < n; k++) if (times[k] < times[k - 1] + 0.4) times[k] = times[k - 1] + 0.4;
}
function alignByMelody(s, lines) {
  lines.forEach(l => { delete l.ct; });
  const notes = (s.res.notes || []).slice().sort((x, y) => x.t0 - y.t0), iv = [];
  for (const nt of notes) { const l = iv[iv.length - 1]; if (l && nt.t0 - l.t1 < 0.35) l.t1 = Math.max(l.t1, nt.t1); else iv.push({ t0: nt.t0, t1: nt.t1 }); }
  const chordBeats = s.chords.map((c, i) => c.root >= 0 ? s.res.beats[i] : null).filter(x => x != null);
  const start = chordBeats[0] ?? 0, end = chordBeats[chordBeats.length - 1] ?? s.res.duration;
  const tot = lines.reduce((a, l) => a + Math.max(1, l.text.length), 0); let acc = 0;
  const V = iv.reduce((a, x) => a + x.t1 - x.t0, 0);
  lines.forEach(l => {
    const f = acc / tot; acc += Math.max(1, l.text.length);
    if (V > 5) { let need = f * V; for (const x of iv) { const d = x.t1 - x.t0; if (need <= d) { l.t = x.t0 + need; break; } need -= d; } const near = iv.find(x => Math.abs(x.t0 - l.t) < 1.2); if (near) l.t = near.t0; }
    else l.t = start + f * (end - start);
  });
  const t = lines.map(l => l.t); fillGaps(s, t); lines.forEach((l, k) => { l.t = t[k]; });
}
function autoAlign(s, lines) {
  const how = (s.aiWords || []).length >= 5 && alignByText(s, lines) ? 'ai' : (alignByMelody(s, lines), 'melody');
  lines.forEach(l => { const t = snapBeat(s, l.t); if (l.ct) l.ct = l.ct.map(([c, x]) => [c, +(x + (t - l.t)).toFixed(2)]); l.t = t; });
  return how;
}
// ---- chords from an imported sheet, snapped to the audio ----
// how strongly sheet chords are held near the lyric-based time estimate (per beat away). Weak on purpose:
// the chords heard in the audio decide; the estimate only breaks ties between repeated sections.
const CFGS = { lambda: 0.05, lambdaGuess: 0.02, adv: 0.3, short: 0.8, gapOpen: 1.2, gapEm: 0.05 };
function chordSim(x, d) {
  if (!d || d.root < 0) return 0.1;
  const tx = MA.tones(x), td = MA.tones(d), ov = tx.filter(t => td.includes(t)).length / Math.max(3, tx.length);
  return ov + (x.root === d.root ? 0.5 : 0) + (x.root === d.root && MA.baseOf(x.q) === MA.baseOf(d.q) ? 0.2 : 0) + (x.root === d.root && x.q === d.q ? 0.35 : 0) - 0.45;
}
function sheetEvents(s, sheet) {
  const ev = [], first = s.chords.findIndex(c => c.root >= 0), songStart = s.res.beats[Math.max(0, first)] || 0;
  const pushInstr = at => {
    const groups = sheet.instr.filter(g => g.at === at); if (!groups.length) return;
    const cs = groups.flatMap(g => g.chords), t0 = at > 0 ? lineSpan(s, at - 1)[1] : songStart, t1 = at < s.lines.length ? s.lines[at].t : s.res.duration;
    const w = Math.max(0, t1 - t0), lab = groups.find(g => g.label)?.label || '';
    cs.forEach((c, j) => ev.push({ est: t0 + w * j / cs.length, chord: c, inst: true, grp: 'i' + at, label: lab || (at === 0 ? 'Intro' : at >= s.lines.length ? 'Outro' : '') }));
  };
  s.lines.forEach((ln, k) => { pushInstr(k); (ln.anchors || []).forEach(a => ev.push({ est: charTime(s, k, a.ci), chord: a.chord, anchor: a, grp: 'l' + k })); });
  pushInstr(s.lines.length);
  return ev;
}
// A chord sheet from the web is often written in another key than the recording (capo, a singer's key).
// Compare which chords each uses (root + major/minor) under all 12 shifts; move the sheet when one clearly fits.
function sheetShift(s, ev) {
  const fam = c => c.root * 2 + (MA.baseOf(c.q) === 'm' ? 1 : 0), ha = new Float64Array(24), hs = new Float64Array(24);
  s.res.chords.forEach(c => { if (c.root >= 0) ha[fam(c)]++; });
  ev.forEach(e => { if (e.chord.root >= 0) hs[fam(e.chord)]++; });
  const sc = k => { let v = 0; for (let r = 0; r < 12; r++) for (let m = 0; m < 2; m++) v += hs[r * 2 + m] * ha[((r + k) % 12) * 2 + m]; return v; };
  let best = 0; for (let k = 1; k < 12; k++) if (sc(k) > sc(best)) best = k;
  return sc(best) > 1.3 * sc(0) ? best : 0;
}
const shiftChord = (c, k) => ({ ...c, root: c.root < 0 ? c.root : (c.root + k) % 12, bass: c.bass >= 0 ? (c.bass + k) % 12 : c.bass });
function applySheetChords(s, sheet) {
  let ev = sheetEvents(s, sheet); const E = ev.length, M = s.chords.length; if (!E || !M) return 0;
  s.sheetShift = sheetShift(s, ev);
  if (s.sheetShift) ev = ev.map(e => ({ ...e, chord: shiftChord(e.chord, s.sheetShift) }));
  const lam = s.alignHow === 'ai' || s.alignHow === 'manual' ? CFGS.lambda : CFGS.lambdaGuess;
  const audio = s.res.chords.map(c => ({ bass: -1, ...c })), bd = 60 / s.res.bpm, prior = (i, e) => Math.min(4, lam * Math.abs(s.res.beats[i] - ev[e].est) / bd);
  // states per sheet chord e (1..E): 3e-2 = its first beat, 3e-1 = later beats, 3e = off the sheet after it
  // (state 0 = before the song, 3E = after it). Moving on after one beat costs extra (sheet chords last about half
  // a bar or more), every move costs a little (no cramming), and stepping off the sheet lets the recording have parts
  // the sheet does not (talk, an instrumental bridge) where the chords heard in the audio stay.
  const NS = 3 * E + 1, NEG = -1e9, first = e => 3 * e - 2, more = e => 3 * e - 1, off = e => 3 * e;
  const sim = (e, i) => chordSim(ev[e - 1].chord, audio[i]);
  let dp = new Float64Array(NS).fill(NEG); const back = new Int32Array(M * NS);
  dp[off(0)] = 0; dp[first(1)] = sim(1, 0) - prior(0, 0);
  for (let i = 1; i < M; i++) {
    const nd = new Float64Array(NS).fill(NEG);
    for (let st = 0; st < NS; st++) {
      let best = NEG, from = st;
      const cand = (v, f) => { if (v > best) { best = v; from = f; } };
      const e = Math.floor((st + 2) / 3), kind = st === 0 ? 2 : (st + 2) % 3; // 0 first, 1 more, 2 off
      let em;
      if (kind === 0) {
        cand(dp[off(e - 1)] - prior(i, e - 1), off(e - 1));
        if (e >= 2) { cand(dp[more(e - 1)] - CFGS.adv - prior(i, e - 1), more(e - 1)); cand(dp[first(e - 1)] - CFGS.adv - CFGS.short - prior(i, e - 1), first(e - 1)); }
        if (e >= 3) cand(dp[more(e - 2)] - 1.5 - prior(i, e - 1), more(e - 2));
        em = sim(e, i);
      } else if (kind === 1) {
        cand(dp[first(e)], first(e)); cand(dp[more(e)], more(e)); em = sim(e, i);
      } else {
        cand(dp[st], st);
        // only after the last chord of a lyric line or an instrumental block: extra material sits between phrases
        if (e >= 1 && (e === E || ev[e].grp !== ev[e - 1].grp)) { const open = e === E ? 0 : CFGS.gapOpen; cand(dp[more(e)] - open, more(e)); cand(dp[first(e)] - open - CFGS.short, first(e)); }
        em = st === 0 || e === E ? 0 : CFGS.gapEm;
      }
      nd[st] = best + em; back[i * NS + st] = from;
    }
    dp = nd;
  }
  let st = 0; for (let k = 1; k < NS; k++) if (dp[k] > dp[st]) st = k;
  const path = new Int32Array(M);
  for (let i = M - 1; i >= 0; i--) { path[i] = st; if (i > 0) st = back[i * NS + st]; }
  // path value e (1..E) = on sheet chord e, 0 = off the sheet
  for (let i = 0; i < M; i++) path[i] = path[i] === 0 || path[i] % 3 === 0 ? 0 : Math.floor((path[i] + 2) / 3);
  const out = audio.map(c => ({ ...c }));
  ev.forEach(e => { if (e.anchor) delete e.anchor.beat; });
  for (let i = 0; i < M; i++) if (path[i] >= 1 && path[i] <= E) {
    const e = ev[path[i] - 1]; out[i] = { ...e.chord };
    if (e.anchor && (i === 0 || path[i - 1] !== path[i])) e.anchor.beat = i;
  }
  s.sheetChords = out.map(c => ({ ...c })); s.chords = out.map(c => ({ ...c })); s.orig = out.map(c => ({ ...c })); s.chordSrc = 'sheet';
  // which beats are instrumental (and their section name), straight from the sheet
  s.instAt = {}; for (let i = 0; i < M; i++) if (path[i] >= 1 && path[i] <= E && ev[path[i] - 1].inst) s.instAt[i] = ev[path[i] - 1].label || '';
  if (s.alignHow !== 'ai') timeLinesFromChords(s);
  rebuild(s);
  return new Set(Array.from(path).filter(x => x >= 1 && x <= E)).size;
}
// The sheet's chords are placed by what the audio sounds like, which beats a melody-based guess of when each
// line is sung: start every line at its first chord (minus the syllables before it) and pin each chord's word.
function timeLinesFromChords(s) {
  const bt = i => s.res.beats[i];
  s.lines.forEach(ln => {
    const as = (ln.anchors || []).filter(a => a.beat != null); if (!as.length) return;
    const a0 = as[0], lead = Math.min(1.2, a0.ci * 0.09);
    ln.t = +Math.max(0, bt(a0.beat) - lead).toFixed(2);
    const ct = []; for (const a of as) { const t = +bt(a.beat).toFixed(2); if (!ct.length || (a.ci > ct[ct.length - 1][0] && t > ct[ct.length - 1][1])) ct.push([a.ci, t]); }
    ln.ct = ct.length >= 2 ? ct : undefined;
  });
  // lines without chords: keep them between their neighbours
  for (let k = 1; k < s.lines.length; k++) if (s.lines[k].t <= s.lines[k - 1].t) s.lines[k].t = +(s.lines[k - 1].t + 0.6).toFixed(2);
  s.lyCache = null;
}
function useAudioChords(s) {
  s.chords = s.res.chords.map(c => ({ bass: -1, ...c })); s.orig = s.chords.map(c => ({ ...c })); s.sheetChords = null; s.chordSrc = 'audio'; s.instAt = null;
  s.lines.forEach(l => (l.anchors || []).forEach(a => delete a.beat));
  rebuild(s); save(s); renderSheet(); renderLyPanel(); renderSources();
}
function charTime(s, k, ci) {
  const ln = s.lines[k], [t0, t1] = lineSpan(s, k), len = Math.max(1, ln.text.length);
  if (ln.ct && ln.ct.length >= 2) {
    const p = ln.ct; if (ci <= p[0][0]) return Math.max(t0, p[0][1] - (p[0][0] - ci) * 0.15);
    for (let j = 1; j < p.length; j++) if (ci <= p[j][0]) return p[j - 1][1] + (p[j][1] - p[j - 1][1]) * (ci - p[j - 1][0]) / Math.max(1, p[j][0] - p[j - 1][0]);
    return Math.min(t1, p[p.length - 1][1] + (ci - p[p.length - 1][0]) * 0.15);
  }
  return t0 + (ci / len) * (t1 - t0);
}
function applyLyrics(s, sheet, src, file) {
  const lines = sheet.lines;
  if (!lines.length) { hint('ไม่พบเนื้อร้องในข้อความ/ไฟล์นี้', true); return; }
  const how = autoAlign(s, lines); s.alignHow = how;
  s.lines = lines; s.lySrc = src; s.lyFile = file || ''; s.lyEdited = true; sortLines(s);
  s.sheet = sheet.chordCount ? { instr: sheet.instr } : null;
  let used = 0;
  if (sheet.chordCount) used = applySheetChords(s, { instr: sheet.instr }); else if (s.chordSrc === 'sheet') useAudioChords(s);
  save(s);
  hint(`ใส่เนื้อร้อง ${lines.length} บรรทัดแล้ว · จัดตำแหน่งจาก ${how === 'ai' ? 'เสียงร้องที่ AI ได้ยิน' : 'ทำนองเสียงร้อง (ประมาณการ)'}${sheet.chordCount ? ` · คอร์ดจากไฟล์ ${used} จุด จัดให้ตรงกับเสียงเพลงแล้ว` : ''}${s.sheetShift ? ` · ${'ไฟล์คอร์ดอยู่คนละคีย์กับเพลง เลื่อนคีย์ให้'} ${s.sheetShift > 6 ? s.sheetShift - 12 : '+' + s.sheetShift}` : ''} · ตรวจและเลื่อนแก้ได้ในรายการ`);
  if (S.disp !== 'lyric') setDisp('lyric'); else renderSheet();
  renderLyPanel();
  relistenWithLyrics(s, lines);
}
// the backend hears the vocals once more, told which words to expect: better words -> better line timing.
// Runs in the background; the lines are re-placed only if the user has not moved them in the meantime.
async function relistenWithLyrics(s, lines) {
  if (!s.jobId || !S.backend || !S.backend.whisper || lines.length < 4) return;
  const text = lines.map(l => l.text).join('\n'), mark = JSON.stringify(s.lines.map(l => l.t));
  try {
    let r = await fetch(api(`jobs/${s.jobId}/lyrics`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    let j = await r.json();
    if (!r.ok || j.status === 'unavailable') return;
    s.relisten = j.stage || '';
    setLyStat(s, { kind: 'relisten', p: null, stage: j.stage, t0: Date.now() });
    while (j.status === 'running' && !s.dead) {
      await new Promise(res => setTimeout(res, 1500));
      r = await fetch(api(`jobs/${s.jobId}/lyrics`)); j = await r.json();
      s.relisten = j.stage || '';
      setLyStat(s, { stage: j.stage });
    }
    s.relisten = '';
    setLyStat(s, null);
    if (j.status !== 'done' || !j.lyrics || !(j.lyrics.words || []).length) return;
    s.aiWords = j.lyrics.words; s.res.lyrics = j.lyrics;
    if (JSON.stringify(s.lines.map(l => l.t)) !== mark) { hint('ฟังเนื้อร้องรอบสองเสร็จแล้ว แต่คุณแก้ตำแหน่งไว้แล้ว จึงไม่จัดใหม่ (กด "จัดตำแหน่งอัตโนมัติ" ได้)'); return; }
    autoAlign(s, s.lines); sortLines(s); s.lyCache = null; save(s);
    if (S.active === s.id) { renderSheet(); renderLyPanel(); }
    hint('จัดเวลาเนื้อร้องใหม่แล้ว จากการฟังเสียงร้องรอบสองโดยรู้เนื้อเพลง');
  } catch { s.relisten = ''; setLyStat(s, null); }
}
// ---- lyrics status: the sheet (chords, key, melody) is out first and the words follow; say so plainly ----
const LY_P0 = 0.9, LY_P1 = 0.99; // job progress range of the lyrics stage (backend: pipeline.Report.lyrics)
function lyStep(stage) {
  const st = stage || ''; // the backend's Thai stage text, before translation
  if (/รอคิวฟังเนื้อร้อง/.test(st)) return 'รอคิว: เพลงก่อนหน้ายังฟังเนื้อร้องอยู่';
  if (/ตรวจว่ามีเสียงร้อง/.test(st)) return 'ตรวจว่ามีเสียงร้องไหม';
  if (/ลบเสียงก้องไม่สำเร็จ/.test(st)) return 'ลบเสียงก้องไม่สำเร็จ ใช้เสียงร้องปกติแทน';
  if (/ลบเสียงก้อง/.test(st)) return 'ลบเสียงก้อง ให้ได้ยินคำชัดขึ้น';
  if (/ไม่มีเสียงก้อง/.test(st)) return 'ฟังรอบสอง (เสียงที่ลบก้องแล้ว) แล้วเลือกผลที่ดีกว่า';
  if (/เทียบกับเนื้อร้องที่นำเข้า|นำเข้า/.test(st)) return 'ฟังซ้ำโดยรู้เนื้อเพลงที่นำเข้า เพื่อจัดเวลาให้ตรงขึ้น';
  return 'ฟังคำร้องจากเสียงร้องที่แยกออกมา';
}
function setLyStat(s, o) {
  clearTimeout(s.lyStatT);
  const prev = s.lyStat;
  s.lyStat = o ? { ...(prev || {}), ...o } : null;
  // time left from the measured rate between progress steps (Whisper reports in big chunks: no guess while it is still)
  const L = s.lyStat;
  if (L && o && o.kind) L.pts = [];
  if (L && o && o.p != null && (!prev || prev.p == null || o.p > prev.p + 0.005)) {
    (L.pts = L.pts || []).push([Date.now(), o.p]);
    const a = L.pts.find(q => q[1] >= 0.1) || L.pts[0], b = L.pts[L.pts.length - 1];
    L.eta = L.pts.length >= 3 && b[1] > a[1] && b[1] < 1 ? [b[0] + (1 - b[1]) * (b[0] - a[0]) / (b[1] - a[1])] : null;
  }
  if (o && (o.kind === 'done' || o.kind === 'none')) s.lyStatT = setTimeout(() => setLyStat(s, null), 15000);
  if (S.active === s.id) { renderLyStat(); if (!audio.paused) return; drawRoll(audio.currentTime); }
  const card = document.querySelector(`.src[data-id="${s.id}"] .mt`); if (card) card.innerHTML = metaText(s);
}
const MIC_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
function renderLyStat() {
  const s = A(), el = $('#lystat'); if (!el) return;
  const st = s && ready(s) ? s.lyStat : null;
  if (!st) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false; el.className = 'lystat ' + st.kind;
  const x = `<button class="lsx" id="lsx" aria-label="ปิด">✕</button>`;
  if (st.kind === 'listen' || st.kind === 'relisten') {
    const p = st.p, left = st.eta ? (st.eta[0] - Date.now()) / 1000 : null;
    const eta = ` · ${T('ผ่านไป')} ${fmt((Date.now() - st.t0) / 1000)}` + (left == null ? '' : ' · ' + (left < 0 ? T('อีกสักครู่') : left < 60 ? T('อีกไม่ถึงนาที') : `${T('เหลือประมาณ')} ${Math.round(left / 60)} ${T('นาที')}`));
    el.innerHTML = `<span class="lsi">${MIC_I}</span><div class="lst">
      <b>${st.kind === 'relisten' ? T('กำลังฟังเนื้อร้องอีกรอบ') : T('กำลังฟังเนื้อร้อง')}${p != null ? ` ${Math.round(p * 100)}%` : ''}</b>
      <small>${esc(T(lyStep(st.stage)))}${eta}</small>
      <span class="lsb${p == null ? ' ind' : ''}"><i style="width:${p != null ? Math.max(3, Math.round(p * 100)) : 30}%"></i></span>
      <small class="lsn">${st.kind === 'relisten' ? T('เนื้อร้องที่นำเข้าแสดงอยู่แล้ว จะจัดเวลาให้ตรงขึ้นเมื่อฟังเสร็จ') : T('คอร์ด คีย์ และทำนองพร้อมแล้ว เล่นตามได้เลย เนื้อร้องจะขึ้นเองเมื่อฟังเสร็จ')}</small></div>`;
  } else if (st.kind === 'done') {
    el.innerHTML = `<span class="lsi">✓</span><div class="lst"><b>${T('ได้เนื้อร้องแล้ว')} ${st.n} ${T('บรรทัด')}</b><small>${T('ตรวจและแก้ได้: แตะสองครั้งที่บรรทัด หรือกดปุ่ม "เนื้อร้อง"')}</small></div>${x}`;
  } else {
    el.innerHTML = `<span class="lsi">${MIC_I}</span><div class="lst"><b>${esc(T(st.title || 'ฟังเนื้อร้องเสร็จแล้ว แต่ไม่ได้ยินคำร้องที่ชัดพอ'))}</b><small>${T('นำเข้าเนื้อร้องจากไฟล์หรือรูปภาพได้ที่ปุ่ม "เนื้อร้อง"')}</small></div>${x}`;
  }
  const b = $('#lsx'); if (b) b.onclick = () => setLyStat(s, null);
}
// the backend hands out chords, key and melody first and keeps hearing the words (lyrics_pending):
// wait for them, then fill the lyrics the same way a finished analysis would (unless the user has lines already)
async function waitLyrics(s) {
  s.lyPending = true;
  setLyStat(s, { kind: 'listen', p: 0, stage: '', t0: Date.now() });
  try {
    let j;
    while (!s.dead) {
      await new Promise(res => setTimeout(res, 2000));
      const r = await fetch(api('jobs/' + s.jobId)); j = await r.json();
      if (!r.ok || j.status !== 'done' || !j.result) { setLyStat(s, { kind: 'none', title: 'ฟังเนื้อร้องไม่สำเร็จ' }); return; }
      if (!j.result.lyrics_pending) break;
      setLyStat(s, { p: Math.min(1, Math.max(0, (j.progress - LY_P0) / (LY_P1 - LY_P0))), stage: j.stage });
    }
    if (s.dead) return;
    const ly = j.result.lyrics; s.res.lyrics = ly; s.aiWords = (ly && ly.words) || [];
    s.lyPending = false;
    if (!s.lines.length) {
      s.lines = phrasesFromAI(s).map(p => ({ t: p.t, text: p.text.trim(), ai: true }));
      s.lySrc = s.lines.length ? 'ai' : '';
      setLyStat(s, s.lines.length ? { kind: 'done', n: s.lines.length } : { kind: 'none', title: ly && ly.instrumental ? 'เพลงบรรเลง ไม่มีเสียงร้อง' : 'ฟังเนื้อร้องเสร็จแล้ว แต่ไม่ได้ยินคำร้องที่ชัดพอ' });
    } else if (s.lySrc !== 'ai') { setLyStat(s, null); relistenWithLyrics(s, s.lines); }  // imported while waiting: second pass + re-placing now
    else setLyStat(s, null);
    if (ly && ly.cut) hint('Whisper ใช้เวลานานเกิน จึงหยุดฟังเนื้อร้องกลางเพลง เนื้อร้องส่วนท้ายอาจไม่มีเวลาอ้างอิง');
    s.lyCache = null; if (s.undo) s.snap = snap(s);  // the words heard are the starting point, not an edit
    if (S.active === s.id) { renderSheet(); renderLyPanel(); }
  } catch { setLyStat(s, { kind: 'none', title: 'ฟังเนื้อร้องไม่สำเร็จ' }); }
  finally { s.lyPending = false; if (S.active === s.id) renderLyStat(); }
}
// ---- lyric / chord-sheet pictures: OCR on the local server, then chords placed over the syllable below them ----
function fixOcrChordLine(text) {
  // OCR slips seen on chord sites: '#' read as 't' (Ftm), B read as 8 (87 = B7), "C# 7", stray letters from watermarks.
  // Every fix keeps the text length, so each character keeps its x position.
  const ok = w => { const t = w.replace(/^\/+|\/+$/g, ''); return !t || !!parseChordName(t) || /^(x\d+|\*+|\(|\)|-+)$/i.test(t); };
  let t = text.replace(/\b([A-G][#b]?m?) (7|9|11|13)(?=\s|$)/g, '$1$2 ');
  t = t.replace(/\S+/g, w => ok(w) ? w : (x => ok(x) ? x : w)(w.replace(/^([A-G])t/, '$1#').replace(/^8(?=[0-9m]|$)/, 'B').replace(/♯/g, '#')));
  const words = t.match(/\S+/g) || [], good = words.filter(ok).length;
  if (!words.length || good < 0.6 * words.length) return text;
  return good < words.length ? t.replace(/\S+/g, w => ok(w) || w.length > 2 ? w : ' '.repeat(w.length)) : t;
}
function ocrToSheet(lines) {
  // x of every character: spread over its word box by base characters (Thai marks sit on the letter before them)
  const L = lines.map(ln => {
    let text = ''; const xs = [];
    ln.words.forEach((w, j) => {
      if (j) { text += ' '; xs.push((ln.words[j - 1].x1 + w.x0) / 2); }
      const n = w.text.length, base = [...w.text].filter(ch => !isCombining(ch)).length || 1; let b = 0;
      for (let k = 0; k < n; k++) { if (!isCombining(w.text[k])) b++; xs.push(w.x0 + (w.x1 - w.x0) * (Math.max(1, b) - 0.5) / base); }
      text += w.text;
    });
    return { text: fixOcrChordLine(text), xs };
  }).filter(l => l.text.trim() && !/^(www\.|https?:)|\.(com|net|in\.th|co\.th)\s*$/i.test(l.text.trim()));
  const isLabelOnly = t => { const m = t.trim().match(LABEL); if (!m) return false; const rest = t.trim().slice(m[0].length).trim(); return !rest || isChordLine(rest) || /^[\s*()0-9x.:,-]*$/i.test(rest); };
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[i + 1];
    const lyric = b && !isChordLine(b.text) && !isLabelOnly(b.text) && /[A-Za-z฀-๿]{2}/.test(b.text);
    if (isChordLine(a.text) && !isLabelOnly(a.text) && lyric) {
      // section marks (*, **) are put back in front after the chords are placed
      const mk = b.text.match(/^\s*(\*{1,3})\s*/), cut = mk ? mk[0].length : 0, text = b.text.slice(cut), xs = b.xs.slice(cut);
      const ins = [];
      for (const m of a.text.matchAll(/\S+/g)) {
        if (!parseChordName(m[0])) continue;
        const x = a.xs[m.index] - 0.35 * (a.xs[m.index + 1] - a.xs[m.index] || 8); // left edge of the chord symbol
        let k = xs.findIndex(v => v >= x); if (k < 0) k = text.length;
        // Thai syllables: marks and following vowels (ะ า ำ) belong to the letter before; a leading vowel
        // (เ แ โ ใ ไ) belongs to the letter after, so the chord goes in front of it
        while (k > 0 && k < text.length && (isCombining(text[k]) || /[ะาำๅ]/.test(text[k]))) k--;
        while (k > 0 && /[เแโใไ]/.test(text[k - 1])) k--;
        ins.push([k, m[0]]);
      }
      let t = text; ins.sort((p, q) => q[0] - p[0]).forEach(([k, ch]) => { t = t.slice(0, k) + `[${ch}]` + t.slice(k); });
      out.push((mk ? mk[1] + ' ' : '') + t); i++;
    } else out.push(a.text);
  }
  return out.join('\n');
}
async function importLyricsImages(files) {
  const s = A(); if (!ready(s) || !files.length) return;
  if (!S.backend) { hint('อ่านรูปภาพต้องเปิดแอปผ่านหลังบ้าน (http://localhost:8000)', true); return; }
  if (!S.backend.ocr) { hint('หลังบ้านไม่ได้ติดตั้งตัวอ่านภาพ (OCR)', true); return; }
  const parts = [];
  for (const [i, f] of [...files].entries()) {
    hint(`${'กำลังอ่านรูป'} ${i + 1}/${files.length}…`);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch(api('ocr'), { method: 'POST', body: fd }), j = await r.json();
      if (!r.ok) throw new Error(j.detail);
      parts.push(ocrToSheet(j.lines));
    } catch (e) { hint((e && e.message) || 'อ่านรูปนี้ไม่ได้ ลองไฟล์ JPG หรือ PNG', true); return; }
  }
  S.lyPaste = true; S.lyDraft = parts.join('\n\n'); renderLyPanel();
  hint('อ่านรูปแล้ว ตรวจและแก้ข้อความในช่อง แล้วกด "ใช้เนื้อนี้"');
}
async function importLyricsFile(f) {
  const s = A(); if (!ready(s) || !f) return;
  try {
    const buf = await f.arrayBuffer(), isDocx = /\.docx$/i.test(f.name) || new Uint8Array(buf.slice(0, 2)).join() === '80,75';
    if (/\.doc$/i.test(f.name)) { hint('ไฟล์ .doc แบบเก่ายังไม่รองรับ ให้บันทึกเป็น .docx หรือ .txt ก่อน', true); return; }
    const text = isDocx ? await docxText(buf) : decodeText(buf);
    applyLyrics(s, parseSheet(text, S.stripChords), 'import', f.name);
  } catch (e) { console.error(e); hint('อ่านไฟล์นี้ไม่ได้ ลองบันทึกเป็น .txt (UTF-8) หรือ .docx', true); }
}
// ---- editor panel ----
function lineLabel(s, t) { const i = beatAt(s, t); if (i < 0) return '<b>ก่อนเพลง</b>&nbsp;'; const bi = s.beatBar[i]; return `<b>ห้อง ${bi + 1}</b>จังหวะที่ ${s.bars[bi].indexOf(i) + 1}`; }
function renderLyPanel() {
  const s = A(), p = $('#lypanel'); if (!ready(s) || !S.lyPanel) return;
  const src = { ai: 'ข้อความจาก AI (Whisper) ฟังภาษาไทยผิดได้ แนะนำนำเข้าเนื้อที่ถูกต้อง แล้วโปรแกรมจะใช้จังหวะที่ AI ได้ยินมาจัดให้', import: `นำเข้าจาก ${esc(s.lyFile || 'ไฟล์')}`, manual: 'แก้ไขเอง', '': 'ยังไม่มีเนื้อร้อง' }[s.lySrc || ''];
  const tap = S.tap;
  p.innerHTML = `
    <div class="ph" style="margin:0"><strong>เนื้อร้อง (${s.lines.length} บรรทัด)</strong><button class="xbtn" id="lyclose">ปิด</button></div>
    <p class="srcnote"><span class="badge2 b-off">ทำงานออฟไลน์</span>${src}</p>
    <div class="btnrow">
      <label class="sbtn pri filebtn">นำเข้าไฟล์ .txt / .docx<input type="file" id="lyfile" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
      <label class="sbtn filebtn">อ่านจากรูปภาพ (OCR)<input type="file" id="lyimg" accept="image/*" multiple></label>
      <button class="sbtn" id="lypaste" aria-pressed="${S.lyPaste}">วาง / พิมพ์เนื้อเพลง</button>
      ${s.lines.length ? `<button class="sbtn" id="lyauto">จัดตำแหน่งอัตโนมัติใหม่</button><button class="sbtn" id="tapstart">แตะตามจังหวะ</button><button class="sbtn" id="lyclear">ลบทั้งหมด</button>` : ''}
    </div>
    <label class="chk"><input type="checkbox" id="lystrip" ${S.stripChords ? 'checked' : ''}> แยกคอร์ด หัวข้อท่อน (Intro, Solo, ท่อน *) และเครื่องหมายซ้ำออกจากเนื้อร้อง</label>
    <p class="srcnote"><span class="badge2 ${s.chordSrc === 'sheet' ? 'b-off' : 'b-no'}">คอร์ด</span>${s.chordSrc === 'sheet' ? 'ใช้คอร์ดจากไฟล์ที่นำเข้า จัดให้ตรงกับเสียงเพลงแล้ว' : 'ใช้คอร์ดที่แกะจากเสียงเพลง · ถ้านำเข้าเนื้อที่มีคอร์ดอยู่เหนือคำ (แบบเว็บคอร์ด) หรือ [C] ในเนื้อ แอปจะใช้คอร์ดนั้นแทน แม่นกว่า'}
      ${s.chordSrc === 'sheet' ? '<button class="xbtn" id="useaudio">ใช้คอร์ดที่แกะจากเสียงแทน</button>' : s.sheet ? '<button class="xbtn" id="usesheet">ใช้คอร์ดจากไฟล์</button>' : ''}</p>
    ${S.lyPaste ? `<textarea id="lytext" placeholder="วางเนื้อเพลงที่ก๊อปมาจากเว็บ บรรทัดละ 1 ท่อน เว้นบรรทัดว่างระหว่างท่อนได้">${esc(S.lyDraft != null ? S.lyDraft : s.lines.map(l => (l.brk ? '\n' : '') + l.text).join('\n'))}</textarea>
      <div class="btnrow"><button class="sbtn pri" id="lyuse">ใช้เนื้อนี้ แล้วจัดตำแหน่งอัตโนมัติ</button><button class="sbtn" id="lycancel">ยกเลิก</button></div>` : ''}
    ${tap ? `<div class="tapbox"><span class="hint">ท่อนที่ ${tap.idx + 1} / ${s.lines.length} · เล่นเพลง แล้วกดปุ่มตอนเริ่มร้องท่อนนี้ (หรือกด Enter)</span>
        <div class="line">${esc(s.lines[tap.idx]?.text || 'ครบทุกท่อนแล้ว')}</div>
        <div class="btnrow"><button class="sbtn pri tapbtn" id="tapgo" style="flex:1">แตะ! เริ่มท่อนนี้</button><button class="sbtn" id="tapback">ย้อน 1 ท่อน</button><button class="sbtn" id="tapstop">เสร็จ</button></div></div>` : ''}
    ${s.lines.length ? `<p class="hint" style="margin:0">แต่ละบรรทัด: ▶ ฟังจากตรงนี้ · − / + เลื่อนทีละจังหวะ · "ตอนนี้" ตั้งให้เริ่มตรงตำแหน่งที่เพลงกำลังเล่น</p>
    <div class="lelist" id="lelist">${s.lines.map((l, k) => `<div class="le${l.brk ? ' brk' : ''}" data-k="${k}">
      <div class="tm"><button class="ib" data-act="play" aria-label="ฟังจากบรรทัดนี้">▶</button><button class="ib" data-act="m1" aria-label="เลื่อนก่อน 1 จังหวะ">−</button><span class="tml">${lineLabel(s, l.t)}</span><button class="ib" data-act="p1" aria-label="เลื่อนหลัง 1 จังหวะ">+</button><button class="ib now" data-act="now">ตอนนี้</button></div>
      <input data-k="${k}" value="${esc(l.text)}" aria-label="เนื้อร้องบรรทัด ${k + 1}">
      <button class="ib" data-act="add" aria-label="เพิ่มบรรทัดใต้บรรทัดนี้">+ใต้</button><button class="ib" data-act="del" aria-label="ลบบรรทัดนี้">✕</button></div>`).join('')}</div>` : ''}`;
  $('#lyclose').onclick = () => setLyPanel(false);
  $('#lyfile').onchange = e => { importLyricsFile(e.target.files[0]); e.target.value = ''; };
  $('#lyimg').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; importLyricsImages(fs); };
  $('#lypaste').onclick = () => { S.lyPaste = !S.lyPaste; renderLyPanel(); if (S.lyPaste) $('#lytext').focus(); };
  $('#lystrip').onchange = e => { S.stripChords = e.target.checked; store.set('cl-strip', S.stripChords ? '1' : '0'); };
  const q = id => p.querySelector(id);
  if (q('#lyuse')) q('#lyuse').onclick = () => { const fromImg = S.lyDraft != null; S.lyPaste = false; S.lyDraft = null; applyLyrics(s, parseSheet($('#lytext').value, S.stripChords), fromImg ? 'import' : 'manual', fromImg ? 'รูปภาพ' : undefined); };
  if (q('#useaudio')) q('#useaudio').onclick = () => { useAudioChords(s); hint('กลับไปใช้คอร์ดที่แกะจากเสียงเพลงแล้ว'); };
  if (q('#usesheet')) q('#usesheet').onclick = () => { applySheetChords(s, s.sheet); save(s); renderSheet(); renderLyPanel(); renderSources(); };
  if (q('#lycancel')) q('#lycancel').onclick = () => { S.lyPaste = false; S.lyDraft = null; renderLyPanel(); };
  if (q('#lyauto')) q('#lyauto').onclick = () => { const how = autoAlign(s, s.lines); s.alignHow = how; sortLines(s); s.lyEdited = true; save(s); renderSheet(); renderLyPanel(); hint(`จัดตำแหน่งใหม่จาก ${how === 'ai' ? 'เสียงร้องที่ AI ได้ยิน' : 'ทำนองเสียงร้อง'}แล้ว`); };
  if (q('#lyclear')) q('#lyclear').onclick = () => { s.lines = []; s.lySrc = 'manual'; s.lyEdited = true; save(s); renderSheet(); renderLyPanel(); };
  if (q('#tapstart')) q('#tapstart').onclick = () => { S.tap = { idx: 0 }; renderLyPanel(); if (audio.paused) { audio.currentTime = Math.max(0, (s.res.beats[0] || 0) - 0.5); togglePlay(); } };
  if (tap) {
    q('#tapgo').onclick = doTap; q('#tapstop').onclick = () => { stopTap(); renderLyPanel(); };
    q('#tapback').onclick = () => { if (tap.idx > 0) { tap.idx--; renderLyPanel(); } };
  }
  const list = q('#lelist'); if (!list) return;
  list.addEventListener('input', e => { const k = e.target.dataset.k; if (k == null) return; s.lines[+k].text = e.target.value; delete s.lines[+k].ct; s.lyEdited = true; s.lySrc = s.lySrc === 'ai' ? 'manual' : s.lySrc; clearTimeout(list.t); list.t = setTimeout(() => { save(s); renderSheet(); }, 400); });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const k = +b.closest('.le').dataset.k, ln = s.lines[k], i = Math.max(0, beatAt(s, ln.t));
    const act = b.dataset.act;
    if (act === 'play') { audio.currentTime = Math.max(0, ln.t - 60 / s.res.bpm); if (audio.paused) togglePlay(); return; }
    const t0 = ln.t;
    if (act === 'm1') ln.t = (s.res.beats[Math.max(0, i - 1)] ?? ln.t) + 0.01;
    if (act === 'p1') ln.t = (s.res.beats[i + 1] ?? ln.t) + 0.01;
    if (act === 'now') ln.t = snapBeat(s, audio.currentTime);
    if (ln.ct && ln.t !== t0) ln.ct = ln.ct.map(([c, x]) => [c, +(x + ln.t - t0).toFixed(2)]);
    if (act === 'del') s.lines.splice(k, 1);
    if (act === 'add') s.lines.splice(k + 1, 0, { t: (s.res.beats[i + s.meter.bpb] ?? ln.t + 2) + 0.01, text: '' });
    s.lyEdited = true; sortLines(s); save(s); renderSheet();
    const st = list.scrollTop; renderLyPanel(); const nl = $('#lelist'); if (nl) nl.scrollTop = st;
    if (act === 'add') { const inp = document.querySelector(`#lelist input[data-k="${k + 1}"]`); if (inp) inp.focus(); }
  });
}
function doTap() {
  const s = A(), tap = S.tap; if (!tap || !s.lines[tap.idx]) return;
  const ln = s.lines[tap.idx], t0 = ln.t; ln.t = snapBeat(s, Math.max(0, audio.currentTime - 0.12));
  if (ln.ct) ln.ct = ln.ct.map(([c, x]) => [c, +(x + ln.t - t0).toFixed(2)]);
  for (let k = tap.idx + 1; k < s.lines.length; k++) if (s.lines[k].t < s.lines[k - 1].t + 0.4) s.lines[k].t = s.lines[k - 1].t + 0.4;
  tap.idx++; s.lyEdited = true; save(s); renderSheet(); renderLyPanel();
  if (tap.idx >= s.lines.length) { stopTap(); renderLyPanel(); hint('จับจังหวะเนื้อร้องครบแล้ว'); }
}
function stopTap() { S.tap = null; }
function setLyPanel(on) { S.lyPanel = on; $('#lybtn').setAttribute('aria-pressed', on); if (!on) { stopTap(); S.lyPaste = false; } renderAll(); if (on) $('#lypanel').scrollIntoView({ block: 'nearest' }); }
function openLineEditor(k) {
  if (!S.lyPanel) setLyPanel(true);
  const row = document.querySelector(`#lelist .le[data-k="${k}"]`);
  if (row) { const list = $('#lelist'); list.scrollTop = row.offsetTop - list.offsetTop - 40; row.querySelector('input').focus(); }
}
