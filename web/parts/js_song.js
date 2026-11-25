// ================= song data, levels, saving =================
function songKey(s) {
  if (s.kind === 'demo') return 'demo:grace';  // the old demo's saved edits (key 'demo') must not land on this song
  return 'f:' + s.name + '|' + Math.round(s.res.duration); }
function finish(s, res, url, given) {
  if (s.dead) { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
  s.res = res; s.url = url; s.status = 'ready'; s.progress = 1;
  s.chords = res.chords.map(c => ({ bass: -1, ...c })); s.orig = s.chords.map(c => ({ ...c }));
  // the engine already found the bars (downbeat model or a bar-aware chord pass); older results: detect here
  s.autoMeter = res.meter && res.meter.bpb ? { ...res.meter } : MA.detectMeter(s.chords, res.accent, res.bpm); s.meter = { ...s.autoMeter };
  s.aiWords = (res.lyrics && res.lyrics.words) || [];
  s.lines = phrasesFromAI(s).map(p => ({ t: p.t, text: p.text.trim(), ai: true }));
  s.lySrc = s.lines.length ? 'ai' : ''; s.chordSrc = 'audio'; s.sheet = null; s.sheetChords = null; s.instAt = null;
  s.skey = songKey(s); loadSaved(s, given); rebuild(s);
  undoReset(s);
  renderSources();
  if (S.active === s.id) switchTo(s.id);
  if (S.active === s.id) {
    const notes = [...(res.warnings || [])];
    if (res.tempo_note === 'doubled') notes.push('จังหวะช้ามาก แอปนับเป็นสองเท่าให้อ่านง่ายขึ้น (กด ÷2 ข้าง BPM ถ้าไม่ต้องการ)');
    if ((res.spoken || []).length) notes.push(`ช่วงพูด ${res.spoken.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')} ไม่นับเป็นคอร์ด/เนื้อร้อง/ทำนอง`);
    if (notes.length) hint(notes.join(' · '), !!(res.warnings || []).length);
  }
  if (res.lyrics && res.lyrics.instrumental && S.active === s.id) hint('เพลงบรรเลง ไม่มีเสียงร้อง: ไม่ได้ฟังเนื้อร้อง (ถ้ามีเนื้อร้อง นำเข้าจากไฟล์หรือรูปภาพได้ตามปกติ)');
  else if (res.lyrics && res.lyrics.cut && S.active === s.id) hint('Whisper ใช้เวลานานเกิน จึงหยุดฟังเนื้อร้องกลางเพลง เนื้อร้องส่วนท้ายอาจไม่มีเวลาอ้างอิง');
  if (res.lyrics_pending && s.jobId) waitLyrics(s);
  if (s.jobId) { if (!given) syncEdits(s); loadLibrary(); }  // into the library (edits made in this browser before go along)
}
function fail(s, msg) { if (s.dead) return; s.status = 'error'; s.error = msg; renderSources(); if (S.active === s.id) renderAll(); }
function rebuild(s) {
  const n = s.chords.length, bpb = s.meter.bpb, ph = ((s.meter.phase % bpb) + bpb) % bpb;
  s.bars = []; s.beatBar = [];
  const bs = s.res.bar_starts;
  if (bs && bs.length > 2 && s.autoMeter && bpb === s.autoMeter.bpb) {
    // bars from the downbeat model: they may shift where the music does; ◀ ▶ moves them all by a beat
    let d = (((s.meter.phase - s.autoMeter.phase) % bpb) + bpb) % bpb; if (d > bpb / 2) d -= bpb;
    const st = bs.map(x => x + d).filter(x => x >= 0 && x < n);
    if (st[0] > 0) s.bars.push([...Array(st[0]).keys()]);
    st.forEach((a, k) => { const e = k + 1 < st.length ? st[k + 1] : n; s.bars.push(Array.from({ length: e - a }, (_, j) => a + j)); });
  } else {
    if (ph) s.bars.push([...Array(ph).keys()]);
    for (let i = ph; i < n; i += bpb) s.bars.push([...Array(Math.min(bpb, n - i)).keys()].map(k => i + k));
  }
  s.bars.forEach((b, bi) => b.forEach(i => s.beatBar[i] = bi));
  const locked = s.bars.map(b => b.some(i => !same(s.chords[i], s.orig[i])));
  s.lv = MA.levels(s.chords, s.bars, s.res.key, bpb, locked);
  s.lyCache = null;
}
// undo / redo: every save() of a changed song keeps the state before it (chords, lyrics, key shift, bars, sheet)
const snap = s => JSON.stringify({ chords: s.chords, orig: s.orig, lines: s.lines, lySrc: s.lySrc, lyFile: s.lyFile, lyEdited: s.lyEdited, tr: s.tr, capo: s.capo || 0,
  meter: s.meter, meterUser: s.meterUser, chordSrc: s.chordSrc, sheetChords: s.sheetChords, sheet: s.sheet, instAt: s.instAt });
function undoReset(s) { s.undo = []; s.redo = []; s.snap = snap(s); undoButtons(); }
function undoButtons() { const s = A(); if (!$('#undo')) return; $('#undo').disabled = !(s && s.undo && s.undo.length); $('#redo').disabled = !(s && s.redo && s.redo.length); }
function undoStep(back) {
  const s = A(); if (!ready(s) || !s.undo) return;
  const from = back ? s.undo : s.redo, to = back ? s.redo : s.undo;
  if (!from.length) return hint(back ? 'ไม่มีอะไรให้ย้อนกลับ' : 'ไม่มีอะไรให้ทำซ้ำ');
  to.push(snap(s)); const d = JSON.parse(from.pop());
  Object.assign(s, d); s.lyCache = null; s.restoring = true; rebuild(s); save(s); s.restoring = false;
  renderAll(); if ($('#lypanel') && !$('#lypanel').hidden) renderLyPanel(); undoButtons(); hint(back ? 'ย้อนกลับแล้ว' : 'ทำซ้ำแล้ว');
}
function save(s) {
  if (!s || !s.skey) return;
  if (s.undo && !s.restoring) { const cur = snap(s); if (cur !== s.snap) { s.undo.push(s.snap); if (s.undo.length > 100) s.undo.shift(); s.redo = []; s.snap = cur; } }
  else if (s.restoring) s.snap = snap(s);
  undoButtons();
  s.lyCache = null;
  store.set('cl:' + s.skey, JSON.stringify(savedData(s)));
  syncEdits(s);
}
// everything the user changed on a song (also what a .lyrichord set carries next to the analysis)
function savedData(s) {
  const edits = {}; s.chords.forEach((c, i) => { if (!same(c, s.orig[i])) edits[i] = c; });
  return { v: 3, edits, lines: s.lyEdited ? s.lines : null, lySrc: s.lySrc, lyFile: s.lyFile, tr: s.tr, capo: s.capo || 0, meter: s.meterUser ? s.meter : null,
    sheetChords: s.chordSrc === 'sheet' ? s.sheetChords : null, sheet: s.sheet || null, instAt: s.chordSrc === 'sheet' ? s.instAt : null };
}
function loadSaved(s, given) {
  let d = given || null; if (!d) try { d = JSON.parse(store.get('cl:' + s.skey) || 'null'); } catch { d = null; }
  if (!d) return;
  if (d.sheetChords && d.sheetChords.length === s.chords.length) { s.sheetChords = d.sheetChords; s.chords = d.sheetChords.map(c => ({ ...c })); s.orig = d.sheetChords.map(c => ({ ...c })); s.chordSrc = 'sheet'; }
  s.sheet = d.sheet || null; s.lyFile = d.lyFile || ''; s.instAt = s.chordSrc === 'sheet' ? d.instAt || null : null;
  for (const i in d.edits || {}) if (s.chords[i]) s.chords[i] = d.edits[i];
  if (d.lines) { s.lines = d.lines; s.lyEdited = true; s.lySrc = d.lySrc || 'manual'; }
  else if (d.lyrics) { s.lines = d.lyrics.map(l => ({ t: l.t, text: l.text.trim() })); s.lyEdited = true; s.lySrc = 'manual'; }
  if (d.tr) s.tr = d.tr;
  if (d.capo) s.capo = d.capo;
  if (d.meter) { s.meter = d.meter; s.meterUser = true; }
}
const segsOf = s => s.lv[S.level];
function segAt(s, i) { const bi = s.beatBar[i]; if (bi == null) return null; return segsOf(s)[bi].find(g => g.start <= i && i < g.start + g.len) || null; }
function nextSeg(s, i) {
  const cur = segAt(s, i), l = cur ? nm(cur.chord, s) : '';
  for (let bi = s.beatBar[i]; bi < s.bars.length; bi++) for (const g of segsOf(s)[bi]) if (g.start > i && nm(g.chord, s) !== l && g.chord.root >= 0) return g;
  return null;
}
const beatT = (s, i) => s.res.beats[i] ?? s.res.duration;
const barT = (s, bi) => { const b = s.bars[bi]; return [beatT(s, b[0]), beatT(s, b[b.length - 1] + 1)]; };
const barDur = s => s.meter.bpb * 60 / s.res.bpm;

// ---------- lyrics as timed lines ----------
// a line runs from its start until the next line, but at most ~4 bars, so instrumental gaps stay visible
function lineSpan(s, k) {
  const L = s.lines, t0 = L[k].t, next = k + 1 < L.length ? L[k + 1].t : s.res.duration, bd = barDur(s);
  if (next - t0 <= 4.2 * bd) return [t0, next];
  const est = Math.min(4 * bd, Math.max(2 * bd, [...L[k].text].length * 0.2));
  const bi = s.beatBar[beatAt(s, t0 + est - 0.01)];
  return [t0, Math.min(next, bi != null ? barT(s, bi)[1] : t0 + est)];
}
function sortLines(s) { s.lines.sort((a, b) => a.t - b.t); }
// split every line over the bars it spans (word by word, by time) -> per-bar text for chord view
function barPieces(s) {
  const out = s.bars.map(() => []);
  s.lines.forEach((ln, k) => {
    const words = segWords(ln.text);
    let off = 0, cur = null;
    for (const w of words) {
      const t = charTime(s, k, off), i = beatAt(s, t), bi = i < 0 ? 0 : s.beatBar[i];
      off += w.length;
      if (bi == null) continue;
      if (!cur || cur.bi !== bi) { cur = { bi, k: i < 0 ? 0 : s.bars[bi].indexOf(i), text: '', li: k }; out[bi].push(cur); }
      cur.text += w;
    }
  });
  out.forEach(arr => arr.forEach(p => { p.text = p.text.replace(/\s+/g, ' ').trim(); }));
  return out;
}
// lyric view items: instrumental bars, section breaks and lines with chord anchors on words
// What each bar is: 'sing' (lyrics are sung over it), 'inst' (instrumental: chords but no lyrics) or 'none'.
// With an imported sheet the instrumental parts come straight from the sheet (Intro / Instru / Outro);
// otherwise a bar with chords that no lyric line covers is instrumental.
function barKinds(s) {
  if (s.lyCache && s.lyCache.level === S.level && s.lyCache.kinds) return s.lyCache.kinds;
  const nb = s.bars.length, kinds = Array.from({ length: nb }, () => ({ kind: 'none', label: '' }));
  const spans = s.lines.map((_, k) => lineSpan(s, k)), covered = new Array(nb).fill(false);
  spans.forEach(([t0, t1]) => { const a = s.beatBar[Math.max(0, beatAt(s, t0))], b = s.beatBar[Math.max(0, beatAt(s, t1 - 0.02))]; if (a != null && b != null) for (let bi = a; bi <= b; bi++) covered[bi] = true; });
  const firstBar = spans.length ? s.beatBar[Math.max(0, beatAt(s, spans[0][0]))] ?? 0 : nb;
  const lastBar = spans.length ? s.beatBar[Math.max(0, beatAt(s, spans[spans.length - 1][1] - 0.02))] ?? nb : -1;
  const inst = s.chordSrc === 'sheet' && s.instAt ? s.instAt : null;
  for (let bi = 0; bi < nb; bi++) {
    const beats = s.bars[bi], hasChord = segsOf(s)[bi].some(g => g.chord.root >= 0);
    const ib = inst ? beats.filter(i => i in inst) : [];
    if (inst && hasChord && ib.length * 2 >= beats.length) kinds[bi] = { kind: 'inst', label: inst[ib[0]] || '' };
    else if (covered[bi]) kinds[bi] = { kind: 'sing', label: '' };
    else if (hasChord && s.lines.length) kinds[bi] = { kind: 'inst', label: bi < firstBar ? 'Intro' : bi > lastBar ? 'Outro' : '' };
  }
  // runs: the first bar of every instrumental run carries the header and the run length
  for (let bi = 0; bi < nb; bi++) if (kinds[bi].kind === 'inst' && (bi === 0 || kinds[bi - 1].kind !== 'inst' || kinds[bi - 1].label !== kinds[bi].label)) {
    let e = bi; while (e + 1 < nb && kinds[e + 1].kind === 'inst' && kinds[e + 1].label === kinds[bi].label) e++;
    kinds[bi].runStart = true; kinds[bi].runLen = e - bi + 1;
  }
  s.lyCache = { ...(s.lyCache && s.lyCache.level === S.level ? s.lyCache : { level: S.level }), kinds };
  return kinds;
}
function lyricItems(s) {
  if (s.lyCache && s.lyCache.level === S.level && s.lyCache.items) return s.lyCache.items;
  const kinds = barKinds(s), spans = s.lines.map((_, k) => lineSpan(s, k)), items = [];
  // instrumental runs, split into rows of 4 bars; the first row carries the section header
  for (let bi = 0; bi < kinds.length;) {
    if (kinds[bi].kind !== 'inst' || !segsOf(s)[bi].some(g => g.chord.root >= 0)) { bi++; continue; }
    const lab = kinds[bi].label; let e = bi; while (e + 1 < kinds.length && kinds[e + 1].kind === 'inst' && kinds[e + 1].label === lab) e++;
    for (let r = bi; r <= e; r += 4) {
      const bars = []; for (let x = r; x <= Math.min(e, r + 3); x++) if (segsOf(s)[x].some(g => g.chord.root >= 0)) bars.push(x);
      if (bars.length) items.push({ type: 'inst', bars, label: lab, head: r === bi, runLen: e - bi + 1, pos: r, ord: 0 });
    }
    bi = e + 1;
  }
  s.lines.forEach((ln, k) => {
    const [t0, t1] = spans[k], b0 = s.beatBar[Math.max(0, beatAt(s, t0))] ?? 0;
    if (ln.brk) items.push({ type: 'brk', pos: b0, ord: 1, k });
    const words = segWords(ln.text), starts = []; let off = 0; for (const w of words) { starts.push(off); off += w.length; }
    const wt = starts.map(c => charTime(s, k, c)), anchors = words.map(() => []);
    const place = (wi, g) => { while (anchors[wi].length && wi + 1 < words.length) { wi++; while (wi + 1 < words.length && !words[wi].trim()) wi++; } anchors[wi].push(g); };
    let last = '';
    const b1 = s.beatBar[Math.max(0, beatAt(s, t1 - 0.02))] ?? b0;
    if (s.chordSrc === 'sheet' && ln.anchors && ln.anchors.some(a => a.beat != null)) {
      for (const a of ln.anchors) {
        if (a.beat == null) continue; const g = segAt(s, a.beat); if (!g || g.chord.root < 0) continue;
        const lab = nm(g.chord, s); if (lab === last) continue; last = lab;
        let wi = 0; for (let j = 0; j < words.length; j++) if (starts[j] <= a.ci && words[j].trim()) wi = j;
        place(wi, g);
      }
    } else for (let bi = b0; bi <= b1; bi++) {
      if (kinds[bi] && kinds[bi].kind === 'inst') continue; // those chords are shown in the instrumental block
      for (const g of segsOf(s)[bi]) {
        const gt0 = beatT(s, g.start), gt1 = beatT(s, g.start + g.len);
        if (gt1 <= t0 + 0.02 || gt0 >= t1 - 0.02 || g.chord.root < 0) continue;
        const lab = nm(g.chord, s); if (lab === last) continue; last = lab;
        let wi = 0; for (let j = 0; j < words.length; j++) if (wt[j] <= gt0 + 0.12 && words[j].trim()) wi = j;
        place(wi, g);
      }
    }
    items.push({ type: 'line', k, t0, t1, words, anchors, wt, pos: b0, ord: 2 });
  });
  items.forEach((it, i) => { it.seq = i; });
  items.sort((a, b) => a.pos - b.pos || a.ord - b.ord || a.seq - b.seq);
  // a break before a line that directly follows an instrumental block is redundant
  const out = items.filter((it, i) => !(it.type === 'brk' && (i === 0 || items[i - 1].type === 'inst' || items[i - 1].type === 'brk')));
  s.lyCache = { ...s.lyCache, level: S.level, items: out };
  return out;
}
function lineAt(s, t) { let k = -1; for (let j = 0; j < s.lines.length; j++) if (s.lines[j].t <= t + 0.03) k = j; return k; }
