// ================= sheet: chord view + lyric view =================
function chipHTML(seg, s, bar) {
  const c = seg.chord, label = nm(c, s), cls = c.root < 0 ? 'nc' : minorish(c) ? 'mi' : '';
  const [main, slash] = label.split('/'), edited = [...Array(seg.len).keys()].some(k => !same(s.chords[seg.start + k], s.orig[seg.start + k]));
  const rn = S.level !== 'advance' && c.root >= 0 ? `<span class="rn">${MA.roman(c, s.res.key)}</span>` : '';
  return `<button class="chip ${cls}${edited ? ' edited' : ''}" data-s="${seg.start}" data-len="${seg.len}" style="--h:${hue(c.root + ctr(s))};grid-column:${seg.start - bar[0] + 1} / span ${seg.len}" aria-label="คอร์ด ${esc(label)}"><span class="cn"><span>${esc(main)}</span>${slash ? `<span class="sl">/${esc(slash)}</span>` : ''}</span>${rn}</button>`;
}
function rowTags(s) {
  const tags = [], seen = {};
  for (let r = 0; r < s.bars.length; r += 4) {
    const prog = segsOf(s).slice(r, r + 4).map(g => g[0].chord).filter(c => c.root >= 0);
    const key = prog.map(c => MA.roman(c, s.res.key)).join('–');
    if (!key) { tags.push(null); continue; }
    if (!(key in seen)) seen[key] = String.fromCharCode(65 + Object.keys(seen).length);
    tags.push({ letter: seen[key], prog: key });
  }
  return tags;
}
// the reading view needs lyrics: a song without them (yet) shows the chord grid
const lyricShown = s => S.disp === 'lyric' && !!s && !!s.lines && s.lines.length > 0;
function renderSheet() {
  const s = A(); if (!ready(s)) return;
  renderCapo();
  $('#lvhint').textContent = T(LV_HINT[S.level]);
  const lyricMode = lyricShown(s);
  $('#rows').hidden = lyricMode; $('#lyv').hidden = !lyricMode;
  $('#sheetnote').textContent = lyricMode ? 'แตะคอร์ดเพื่อแก้ · แตะสองครั้งที่เนื้อร้องเพื่อแก้ · ลากคอร์ดไปวางบนคำอื่น (จอสัมผัส: แตะค้างแล้วลาก)'
    : 'แตะคอร์ดเพื่อแก้ · แตะเนื้อร้องเพื่อแก้ · ลากคอร์ดหรือเนื้อร้องไปจังหวะอื่น (จอสัมผัส: แตะค้างแล้วลาก)';
  if (lyricMode) renderLyricView(s); else renderChordView(s);
  renderUsed(s);
  renderProg(s);
  S.cur = -2; S.curLine = -2; S.lastKey = ''; tick(true);
}
// one legend for both views: instrumental (no lyrics) vs sung
function legendHTML(s) {
  if (!s.lines.length) return '';
  return `<div class="legend" aria-hidden="true"><span class="lg lg-inst"><i></i>ดนตรี · ไม่มีเนื้อร้อง</span><span class="lg lg-sing"><i></i>ช่วงร้อง · คอร์ดอยู่เหนือคำที่ร้อง</span></div>`;
}
const instName = (lab, n) => `${lab || 'ดนตรี'}${n ? ` · ${n} ${'ห้อง'}` : ''}`;
function renderChordView(s) {
  const tags = S.level === 'advance' ? [] : rowTags(s), pieces = barPieces(s), kinds = barKinds(s);
  let h = legendHTML(s);
  for (let r = 0; r < s.bars.length; r += 4) {
    const tg = tags[r / 4];
    h += `<div class="row">${tg ? `<p class="rowtag"><b>${tg.letter}</b>${esc(tg.prog)}</p>` : ''}<div class="bars" data-r="${r / 4}">`;
    for (let bi = r; bi < Math.min(r + 4, s.bars.length); bi++) {
      const b = s.bars[bi], cols = `grid-template-columns:repeat(${b.length},minmax(0,1fr))`, ps = pieces[bi];
      const kd = kinds[bi] || { kind: 'none' }, inst = kd.kind === 'inst' && !ps.length;
      const ly = ps.length ? `<div class="ly" data-ly="${ps[0].li}" style="${cols}">${ps.map((p, j) => `<span data-li="${p.li}" data-b0="${b[p.k] ?? b[0]}" style="grid-column:${p.k + 1} / ${(ps[j + 1] ? ps[j + 1].k : b.length) + 1}">${esc(p.text)}</span>`).join('')}</div>`
        : inst ? `<div class="ly ily">${kd.runStart ? `<span class="itag">🎹 ${esc(instName(kd.label, kd.runLen))}</span>` : '<span class="idash">ดนตรี</span>'}</div>` : '';
      h += `<div class="bar${inst ? ' bar-inst' : ps.length ? ' bar-sing' : ''}" data-b="${bi}"><span class="bn">${bi + 1}</span><div class="cg" style="${cols}">${segsOf(s)[bi].map(g => chipHTML(g, s, b)).join('')}</div>
        <div class="ticks" style="${cols}">${b.map(i => `<i data-k="${i}"></i>`).join('')}</div>${ly}</div>`;
    }
    h += '</div></div>';
  }
  $('#rows').innerHTML = h;
  fitChips();
}
function renderLyricView(s) {
  const items = lyricItems(s);
  if (!s.lines.length) {
    $('#lyv').innerHTML = `<div class="emptyly"><p style="margin:0 0 10px">ยังไม่มีเนื้อร้องสำหรับเพลงนี้</p><button class="sbtn pri" id="lyopen">ใส่เนื้อร้อง (นำเข้าไฟล์ .txt / .docx หรือวาง)</button></div>`;
    $('#lyopen').onclick = () => setLyPanel(true);
    return;
  }
  let h = legendHTML(s);
  for (const it of items) {
    if (it.type === 'brk') { h += '<div class="sec"></div>'; continue; }
    if (it.type === 'inst') {
      // instrumental: a dashed card, one box per bar, so it reads like the bar lines of a chord chart
      h += `<div class="ll inst${it.head ? ' head' : ''}" data-bar="${it.bars[0]}" data-bars="${it.bars.join(',')}">${it.head ? `<p class="ihead">🎹 ${esc(instName(it.label, it.runLen))} <span>ไม่มีเนื้อร้อง</span></p>` : ''}<div class="ibars">${it.bars.map(bi =>
        `<span class="ibx" data-b="${bi}">${segsOf(s)[bi].filter(g => g.chord.root >= 0).map(g =>
          `<button class="ipill${minorish(g.chord) ? ' mi' : ''}" data-s="${g.start}" data-len="${g.len}" style="--h:${hue(g.chord.root + ctr(s))}">${esc(nm(g.chord, s))}</button>`).join('')}</span>`).join('')}</div></div>`;
      continue;
    }
    h += `<div class="ll sing" data-li="${it.k}"><div class="llw">${it.words.map((w, j) => {
      const g = it.anchors[j][0], extra = it.anchors[j].slice(1);
      const cc = g ? `<button class="cc" data-s="${g.start}" data-len="${g.len}" style="--h:${hue(g.chord.root + ctr(s))}">${esc(nm(g.chord, s))}${extra.map(e => ' ' + esc(nm(e.chord, s))).join('')}</button>` : '<span class="cc"></span>';
      return `<span class="ck" data-t="${it.wt[j].toFixed(3)}">${cc}<span class="ct">${esc(w)}</span></span>`;
    }).join('')}</div><button class="lledit" data-li="${it.k}" aria-label="แก้บรรทัดนี้">✎ แก้</button></div>`;
  }
  $('#lyv').innerHTML = h;
}
function fitChips() {
  document.querySelectorAll('#rows .chip').forEach(ch => {
    const cn = ch.querySelector('.cn'); if (!cn) return;
    ch.classList.remove('stack'); ch.style.fontSize = '';
    let size = parseFloat(getComputedStyle(ch).fontSize);
    const over = () => cn.scrollWidth > ch.clientWidth - 4;
    while (over() && size > 12) { size -= 1; ch.style.fontSize = size + 'px'; }
    if (over() && cn.children.length > 1) { ch.classList.add('stack'); size = Math.min(parseFloat(getComputedStyle(ch).fontSize) + 3, 20); ch.style.fontSize = size + 'px'; while (over() && size > 11) { size -= 1; ch.style.fontSize = size + 'px'; } }
  });
}
function uniqueChords(s) {
  const seen = new Map();
  segsOf(s).forEach(b => b.forEach(g => { if (g.chord.root >= 0) { const l = nm(g.chord, s); if (!seen.has(l)) seen.set(l, g.chord); } }));
  return [...seen.entries()];
}
function renderUsed(s) {
  const u = uniqueChords(s);
  $('#usedlab').textContent = `คอร์ดในเพลงนี้ (${u.length} คอร์ด · ${S.inst === 'piano' ? 'เปียโน' : 'กีตาร์'})`;
  $('#used').innerHTML = u.map(([l, c]) => `<div class="uc"><b>${esc(l)}</b>${S.inst === 'piano' ? piano(c, { small: true, col: LIGHT }) : guitar(c, { small: true, col: LIGHT })}</div>`).join('');
}

// ================= chord progression overview =================
// One short line per kind of section (Intro, Verse, Chorus, Instru ...), roman numerals in the section's own key,
// so the pattern behind the song (e.g. I–V–VIm–IV) is easy to learn. Uses the chords of the chosen level.
function sectionKey(s, chords, prev) {
  // stays in the key before it unless the section's chords clearly fit another scale (a modulation)
  const g = prev || s.res.key, rel = k => (k.root + (k.q === 'm' ? 3 : 0)) % 12, MAJ = [0, 2, 4, 5, 7, 9, 11];
  if (chords.length < 6) return g;
  const fit = t => chords.reduce((v, c) => v + MA.tones(c, 'very').reduce((a, p) => a + (MAJ.includes(((p - t) % 12 + 12) % 12) ? 1 : -1.5), 0), 0);
  // best-fitting scale overall (not the first one that beats the old key: G# and C# share six notes)
  const f = Array.from({ length: 12 }, (_, t) => fit(t)), g0 = rel(g);
  let best = g0; for (let t = 0; t < 12; t++) if (f[t] > f[best]) best = t;
  if (!(f[best] > f[g0] + 2 + 0.1 * Math.abs(f[g0]))) best = g0;
  return best === rel(g) ? g : { root: g.q === 'm' ? (best + 9) % 12 : best, q: g.q };
}
function progText(s, bars, key) {
  // 4-bar phrases (" | " between them), each the collapsed chord sequence; a phrase that repeats shows ×n
  const ph = [];
  for (let k = 0; k < bars.length; k += 4) {
    const seq = [];
    for (const bi of bars.slice(k, k + 4)) for (const g of segsOf(s)[bi] || []) if (g.chord.root >= 0) { const r = MA.roman(g.chord, key); if (seq[seq.length - 1] !== r) seq.push(r); }
    if (!seq.length) continue;
    // a phrase that is one short cycle (I–V–I–V) is written once
    let txt = seq.join('–');
    for (let p = 1; p <= seq.length / 2; p++) if (seq.length % p === 0 && seq.every((x, i) => x === seq[i % p])) { txt = seq.slice(0, p).join('–'); break; }
    if (ph.length && ph[ph.length - 1].txt === txt) ph[ph.length - 1].n++; else ph.push({ txt, n: 1 });
  }
  if (!ph.length) return { text: '', n: 0 };
  const shown = ph.slice(0, 3).map(x => x.txt + (x.n > 1 ? ` ×${x.n}` : '')).join(' | ') + (ph.length > 3 ? ' | …' : '');
  return { text: shown, n: ph.length, tokens: ph.flatMap(x => x.txt.split('–')) };
}
// sung sections: one group per lyric line (each line is a musical phrase, and easy to find in the lyrics)
function progLines(s, ks, key) {
  const ph = [];
  for (const k of ks) {
    const ln = s.lines[k], seq = [], add = c => { if (c && c.root >= 0) { const r = MA.roman(c, key); if (seq[seq.length - 1] !== r) seq.push(r); } };
    if (s.chordSrc === 'sheet' && ln.anchors && ln.anchors.some(a => a.beat != null)) {
      // chords imported from a sheet: exactly the chords written over this line
      for (const a of ln.anchors) if (a.beat != null) add(segAt(s, a.beat)?.chord);
    } else {
      // from the chord sounding at the first sung word to the end of the line
      const first = Math.max(0, ln.text.search(/\S/)), tw = Math.max(ln.t, charTime(s, k, first));
      const t1 = k + 1 < s.lines.length ? Math.min(s.lines[k + 1].t, lineSpan(s, k)[1] + barDur(s)) : lineSpan(s, k)[1];
      const b0 = s.beatBar[Math.max(0, beatAt(s, tw))] ?? 0, b1 = s.beatBar[Math.max(0, beatAt(s, t1 - 0.02))] ?? b0;
      for (let bi = b0; bi <= b1; bi++) for (const g of segsOf(s)[bi] || []) if (beatT(s, g.start + g.len) > tw + 0.15 && beatT(s, g.start) < t1 - 0.05) add(g.chord);
    }
    if (!seq.length) continue;
    const txt = seq.join('–');
    if (ph.length && ph[ph.length - 1].txt === txt) ph[ph.length - 1].n++; else ph.push({ txt, n: 1 });
  }
  if (!ph.length) return { text: '', n: 0 };
  return { text: ph.slice(0, 4).map(x => x.txt + (x.n > 1 ? ` ×${x.n}` : '')).join(' | ') + (ph.length > 4 ? ' | …' : ''), n: ph.length, tokens: ph.flatMap(x => x.txt.split('–')) };
}
// similarity of two progressions (shared chords in order / longer length), to merge repeats of a section
function progSim(a, b) {
  const x = a.tokens || [], y = b.tokens || []; if (!x.length || !y.length) return 0;
  const d = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = x[i - 1] === y[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
  return d[x.length][y.length] / Math.max(x.length, y.length);
}
function songSections(s) {
  const kinds = barKinds(s), nb = s.bars.length, hasChord = bi => (segsOf(s)[bi] || []).some(g => g.chord.root >= 0);
  const starts = [];
  if (s.lines.length) {
    // instrumental runs + sung blocks (a blank line, a section label or an instrumental part starts a new block)
    const realInst = bi => kinds[bi].runStart && (kinds[bi].runLen >= 2 || kinds[bi].label);
    for (let bi = 0; bi < nb; bi++) if (realInst(bi)) starts.push({ bar: bi, kind: 'inst', name: kinds[bi].label || 'ดนตรี' });
    let open = false, prevEnd = -1;
    s.lines.forEach((ln, k) => {
      const [t0, t1] = lineSpan(s, k), b0 = s.beatBar[Math.max(0, beatAt(s, t0))] ?? 0, b1 = s.beatBar[Math.max(0, beatAt(s, t1 - 0.02))] ?? b0;
      let instBetween = false; for (let x = prevEnd + 1; x < b0 && prevEnd >= 0; x++) if (realInst(x)) instBetween = true;
      // an instrumental part inside a sung section (no blank line, no label) continues that section
      if (!open || ln.brk || ln.sec) starts.push({ bar: b0, kind: 'sing', name: ln.sec || '', k });
      else if (instBetween) starts.push({ bar: b0, kind: 'sing', name: '', k, cont: true });
      open = true; prevEnd = b1;
    });
  } else {
    // no lyrics: 8-bar phrases, a new part when a phrase clearly differs from the one before
    let last = null;
    for (let r = 0; r < nb; r += 8) {
      const bars = []; for (let x = r; x < Math.min(nb, r + 8); x++) if (hasChord(x)) bars.push(x);
      const p = progText(s, bars, s.res.key); if (!p.text) continue;
      if (!last || progSim(p, last) < 0.6) starts.push({ bar: r, kind: 'part', name: '' }); last = p;
    }
  }
  starts.sort((a, b) => a.bar - b.bar || (a.kind === 'inst' ? -1 : 1));
  let secs = starts.map((st, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].bar : nb, bars = [];
    for (let x = st.bar; x < end; x++) if (hasChord(x)) bars.push(x);
    const nextK = starts.slice(i + 1).find(x => x.k != null)?.k ?? s.lines.length;
    return { ...st, bars, ks: st.k != null ? Array.from({ length: Math.max(0, nextK - st.k) }, (_, j) => st.k + j) : [] };
  });
  // fold continuations into the sung section they belong to
  const merged = [];
  for (const x of secs) {
    const prev = [...merged].reverse().find(y => y.kind === 'sing');
    if (x.cont && prev) { prev.bars.push(...x.bars); prev.ks.push(...x.ks); } else merged.push(x);
  }
  let prevKey = s.res.key;
  secs = merged.map(x => {
    const chords = x.bars.flatMap(bi => segsOf(s)[bi].map(g => g.chord).filter(c => c.root >= 0)), key = prevKey = sectionKey(s, chords, prevKey);
    return { ...x, key, prog: x.kind === 'sing' && x.ks.length ? progLines(s, x.ks, key) : progText(s, x.bars, key) };
  }).filter(x => x.bars.length && x.prog.text);
  // sung blocks without a label: the first pattern is the Verse, the next new one the Chorus, then the Bridge
  const named = {}, order = ['Verse', 'Chorus', 'Bridge'];
  const known = secs.filter(x => x.kind === 'sing' && x.name), used = new Set(known.map(x => x.name)), pool = [...known];
  let next = 0, letter = 0;
  for (const x of secs) if (x.kind !== 'inst' && !x.name) {
    // the most similar earlier section (ties: the most recent one)
    let like = null, bs = 0.6; for (const y of pool) if (y.kind === x.kind) { const v = progSim(x.prog, y.prog); if (v >= bs) { bs = v; like = y; } }
    if (like) x.name = like.name;
    else {
      if (x.kind === 'part') x.name = 'Part ' + String.fromCharCode(65 + letter++);
      else { while (next < order.length && used.has(order[next])) next++; x.name = order[next] || 'Part ' + String.fromCharCode(65 + letter++); next++; }
      used.add(x.name);
    }
    pool.push(x);
  }
  return secs;
}
function renderProg(s) {
  const el = $('#prog'), secs = ready(s) && !isLive(s) ? songSections(s) : [];
  el.hidden = !secs.length; if (!secs.length) { el.innerHTML = ''; return; }
  // one row per section and pattern, in order of first appearance, with how often it comes back
  const rows = [];
  for (const x of secs) {
    const kname = x.key.root === s.res.key.root && x.key.q === s.res.key.q ? '' : MA.name({ root: x.key.root, q: x.key.q, bass: -1 }, 0, 'very', s.tr);
    const row = rows.find(r => r.x.name === x.name && r.kname === kname && (r.x.prog.text === x.prog.text || progSim(r.x.prog, x.prog) >= 0.6));
    if (row) row.n++; else rows.push({ x, n: 1, kname });
  }
  const showAll = S.progAll || rows.length <= 6;
  el.innerHTML = `<span class="ph2">${'ทางเดินคอร์ด'}</span><ul>${rows.slice(0, showAll ? rows.length : 6).map(({ x, n, kname }) =>
    `<li><button class="pn${x.kind === 'inst' ? ' i' : ''}" data-bar="${x.bars[0]}">${esc(T(x.name))}${n > 1 ? ` ×${n}` : ''}</button><span class="px">:</span> <span class="pr">${esc(x.prog.text)}</span>${kname ? ` <span class="pk">(${'คีย์'} ${esc(kname)})</span>` : ''}</li>`).join('')}</ul>` +
    (rows.length > 6 ? `<button class="pmore" id="progmore">${showAll ? 'ย่อ' : `${'แสดงทั้งหมด'} (${rows.length})`}</button>` : '');
}
