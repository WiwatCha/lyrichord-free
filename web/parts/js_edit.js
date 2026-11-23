
// ================= editing on the sheet itself (r17) =================
// lyric line editor: a small box at the line (text, one beat earlier / later), instead of the side panel
function closeLed() { const p = $('#led'); if (p) p.hidden = true; S.led = null; }
function openLed(k, anchor) {
  const s = A(); if (!ready(s) || !s.lines[k]) return;
  $('#ed').hidden = true; S.edit = null;
  S.led = { ln: s.lines[k] }; drawLed(); placePop($('#led'), anchor);
  const inp = $('#ledtxt'); inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length);
}
function drawLed() {
  const s = A(), ln = S.led.ln;
  $('#led').innerHTML = `<strong>แก้เนื้อร้อง</strong> <span class="hint">${fmt(ln.t)}</span>
    <input class="txt" id="ledtxt" value="${esc(ln.text)}" autocomplete="off" spellcheck="false">
    <div class="acts"><button data-l="-1" title="เร็วขึ้น 1 จังหวะ">◀ 1 จังหวะ</button><button data-l="1" title="ช้าลง 1 จังหวะ">1 จังหวะ ▶</button><button data-l="done" class="sel">เสร็จ</button></div>`;
  const inp = $('#ledtxt');
  inp.oninput = () => { ln.text = inp.value; delete ln.ct; s.lyEdited = true; if (s.lySrc === 'ai') s.lySrc = 'manual'; clearTimeout(inp.t); inp.t = setTimeout(() => { save(s); renderSheet(); }, 350); };
  inp.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); clearTimeout(inp.t); save(s); renderSheet(); closeLed(); } };
}
$('#led').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !S.led) return;
  const s = A(), ln = S.led.ln;
  if (b.dataset.l === 'done') { save(s); renderSheet(); closeLed(); return; }
  const i = Math.max(0, beatAt(s, ln.t + 0.03)) + +b.dataset.l;
  if (i < 0 || i >= s.res.beats.length) return;
  shiftLine(s, ln, beatT(s, i) - ln.t);
  const top = $('#led').style.top, left = $('#led').style.left; drawLed(); $('#led').hidden = false; $('#led').style.top = top; $('#led').style.left = left;
});
// move a lyric line (and its word timings) by dt seconds
function shiftLine(s, ln, dt) {
  if (!dt) return;
  ln.t = Math.max(0, +(ln.t + dt).toFixed(3));
  if (ln.ct) ln.ct = ln.ct.map(([c, x]) => [c, +(x + dt).toFixed(2)]);
  s.lyEdited = true; if (s.lySrc === 'ai') s.lySrc = 'manual';
  sortLines(s); rebuild(s); save(s); renderSheet(); if (S.lyPanel) renderLyPanel();
}

// a chord change moved to another beat: the chord now starts there (earlier: it takes over the beats before it;
// later inside its own span: the chord before it lasts longer; past its span: the whole chord moves)
function moveChord(s, start, len, to) {
  if (to === start || to < 0 || to >= s.chords.length) return false;
  const c = { ...s.chords[start] }, prev = start > 0 ? { ...s.chords[start - 1] } : { root: -1, q: '', bass: -1 };
  if (to < start) for (let i = to; i < start; i++) s.chords[i] = { ...c };
  else if (to < start + len) for (let i = start; i < to; i++) s.chords[i] = { ...prev };
  else { for (let i = start; i < start + len; i++) s.chords[i] = { ...prev }; for (let i = to; i < Math.min(s.chords.length, to + len); i++) s.chords[i] = { ...c }; }
  rebuild(s); save(s); renderSheet();
  return true;
}

// ---- drag and drop: mouse drags after a few pixels; touch and pen after holding still ~0.35 s ----
const DRAG = { HOLD: 350, SLOP: 8 };
function dragSource(t) {
  const chip = t.closest('#rows .chip:not(.nc)'); if (chip) return { kind: 'chord', el: chip, start: +chip.dataset.s, len: +chip.dataset.len, label: chip.textContent };
  const cc = t.closest('#lyv .cc[data-s]'); if (cc) return { kind: 'chord', el: cc, start: +cc.dataset.s, len: +cc.dataset.len, label: cc.textContent };
  const ly = t.closest('#rows .ly span[data-li]'); if (ly) return { kind: 'line', el: ly, li: +ly.dataset.li, b0: +ly.dataset.b0, label: ly.textContent };
  return null;
}
// the beat under the pointer: a bar in the chord view (by x across its beats), a word in the lyric view
function dropBeat(s, x, y) {
  const el = document.elementFromPoint(x, y); if (!el) return null;
  const bar = el.closest('#rows .bar');
  if (bar) {
    const bi = +bar.dataset.b, beats = s.bars[bi], r = bar.querySelector('.cg').getBoundingClientRect();
    const k = Math.max(0, Math.min(beats.length - 1, Math.floor((x - r.left) / r.width * beats.length)));
    return { beat: beats[k], x: r.left + k * r.width / beats.length, top: bar.getBoundingClientRect().top, h: bar.getBoundingClientRect().height };
  }
  const ck = el.closest('#lyv .ck[data-t]');
  if (ck) { const r = ck.getBoundingClientRect(); return { beat: Math.max(0, beatAt(s, +ck.dataset.t + 0.05)), x: r.left, top: r.top, h: r.height }; }
  return null;
}
function endDrag(apply, e) {
  const D = S.drag; S.drag = null; clearTimeout(D && D.timer);
  document.body.classList.remove('dragging'); document.querySelectorAll('.dragghost,.dropmark').forEach(x => x.remove());
  if (!D || !D.on) return;
  D.src.el.classList.remove('dragsrc'); S.noClickUntil = Date.now() + 400;  // the click that ends a drag is not a tap
  if (!apply) return;
  const s = A(), tgt = dropBeat(s, e.clientX, e.clientY); if (!tgt) return;
  if (D.src.kind === 'chord') { if (moveChord(s, D.src.start, D.src.len, tgt.beat)) hint(`ย้ายคอร์ด ${D.src.label.trim()} ไปจังหวะที่ ${tgt.beat - s.bars[s.beatBar[tgt.beat]][0] + 1} ของห้อง ${s.beatBar[tgt.beat] + 1} แล้ว (⌘Z ย้อนกลับ)`); }
  else { const ln = s.lines[D.src.li]; if (ln) { shiftLine(s, ln, beatT(s, tgt.beat) - beatT(s, D.src.b0)); hint('เลื่อนเนื้อร้องแล้ว (⌘Z ย้อนกลับ)'); } }
}
function startDrag(e) {
  const D = S.drag; D.on = true; closePops();
  D.src.el.classList.add('dragsrc'); document.body.classList.add('dragging');
  const g = document.createElement('div'); g.className = 'dragghost'; g.textContent = D.src.label.trim(); document.body.append(g); D.ghost = g;
  const m = document.createElement('div'); m.className = 'dropmark'; m.hidden = true; document.body.append(m); D.mark = m;
  if (navigator.vibrate && e.pointerType !== 'mouse') navigator.vibrate(15);
  moveDrag(e);
}
function moveDrag(e) {
  const D = S.drag; D.ghost.style.left = e.clientX + 'px'; D.ghost.style.top = e.clientY + 'px';
  const t = dropBeat(A(), e.clientX, e.clientY);
  D.mark.hidden = !t; if (t) Object.assign(D.mark.style, { left: t.x - 1 + 'px', top: t.top + 'px', height: t.h + 'px' });
  // near the top / bottom edge: scroll the page so a drop far away is possible
  const edge = 60; if (e.clientY < edge) scrollBy(0, -12); else if (e.clientY > innerHeight - edge) scrollBy(0, 12);
}
for (const root of [$('#rows'), $('#lyv')]) {
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !ready(A())) return;
    const src = dragSource(e.target); if (!src) return;
    S.drag = { src, x: e.clientX, y: e.clientY, id: e.pointerId, on: false, mouse: e.pointerType === 'mouse' };
    if (!S.drag.mouse) S.drag.timer = setTimeout(() => { if (S.drag && !S.drag.on) startDrag(e); }, DRAG.HOLD);
  });
}
addEventListener('pointermove', e => {
  const D = S.drag; if (!D || e.pointerId !== D.id) return;
  if (D.on) { e.preventDefault(); moveDrag(e); return; }
  const far = Math.hypot(e.clientX - D.x, e.clientY - D.y) > DRAG.SLOP;
  if (far) { if (D.mouse) startDrag(e); else { clearTimeout(D.timer); S.drag = null; } }  // a touch that moves first is a scroll
}, { passive: false });
addEventListener('pointerup', e => { if (S.drag && e.pointerId === S.drag.id) endDrag(true, e); });
addEventListener('pointercancel', e => { if (S.drag && e.pointerId === S.drag.id) endDrag(false, e); });
// while a touch drag is on, the page must not scroll under the finger
addEventListener('touchmove', e => { if (S.drag && S.drag.on) e.preventDefault(); }, { passive: false });
// a long press must not open the phone's text menu over the chord
addEventListener('contextmenu', e => { if (e.target.closest('#rows .chip,#lyv .cc,#rows .ly span')) e.preventDefault(); });
// clicks that end a drag do nothing
for (const root of [$('#rows'), $('#lyv')]) root.addEventListener('click', e => { if (Date.now() < (S.noClickUntil || 0)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

// lyric view: double click / double tap on a sung line edits it (a single tap still jumps there)
$('#lyv').addEventListener('dblclick', e => { const ll = e.target.closest('.ll.sing'); if (ll && !e.target.closest('.cc')) { e.preventDefault(); openLed(+ll.dataset.li, ll); } });
$('#lyv').addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;  // mice get dblclick
  const ll = e.target.closest('.ll.sing'); if (!ll || e.target.closest('.cc,.lledit')) return;
  const now = Date.now(), last = S.lastTap;
  if (last && last.li === ll.dataset.li && now - last.t < 350) { S.lastTap = null; openLed(+ll.dataset.li, ll); }
  else S.lastTap = { li: ll.dataset.li, t: now };
});
