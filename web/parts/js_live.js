// ================= setlists: songs in the order of a show, kept on the Mac (every device sees the same list) =================
S.sets = null; S.setEdit = null; S.libTab = 'songs'; S.stageFs = +store.get('cl-stagefs') || (innerWidth <= 700 ? 26 : 34);
async function loadSets() {
  if (!S.backend) { S.sets = null; return; }
  try { const r = await fetch(api('setlists')); S.sets = r.ok ? (await r.json()).setlists || [] : null; } catch { S.sets = null; }
}
async function saveSets() {
  try {
    const r = await fetch(api('setlists'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.sets) });
    if (!r.ok) throw 0;
  } catch { hint('บันทึกเซ็ตเพลงลง Mac ไม่สำเร็จ', true); }
}
const songOf = id => (S.lib || []).find(x => x.id === id);
function renderSets() {
  const el = $('#setview'); if (!el) return;
  if (!S.sets) { el.innerHTML = `<p class="hint">${T('เซ็ตเพลงต้องเปิดผ่านแอปบน Mac (หลังบ้าน)')}</p>`; return; }
  const ed = S.sets.find(x => x.id === S.setEdit);
  if (ed) {
    const inSet = new Set(ed.songs), more = (S.lib || []).filter(x => !inSet.has(x.id));
    el.innerHTML = `<div class="setedit">
      <div class="setrow1"><button class="zb" data-sa="back" aria-label="${T('กลับ')}" title="${T('กลับ')}">‹</button>
        <input class="setname" id="setname" value="${esc(ed.name)}" aria-label="${T('ชื่อเซ็ต')}" placeholder="${T('ชื่อเซ็ต เช่น งานแต่ง 12 ธ.ค.')}">
        <button class="sbtn sm pri" data-sa="play" ${ed.songs.length ? '' : 'disabled'}>${T('เริ่มโหมดเวที')}</button></div>
      <ol class="setsongs">${ed.songs.map((id, i) => { const x = songOf(id); return `<li data-i="${i}"><span class="sn">${i + 1}</span><b>${esc(x ? x.title : T('(เพลงถูกลบจากคลัง)'))}</b><small>${x && x.key ? MA.name({ root: x.key.root, q: x.key.q, bass: -1 }) : ''}</small>
        <span class="lacts"><button class="zb" data-sa="up" aria-label="${T('เลื่อนขึ้น')}" ${i ? '' : 'disabled'}>▲</button><button class="zb" data-sa="down" aria-label="${T('เลื่อนลง')}" ${i < ed.songs.length - 1 ? '' : 'disabled'}>▼</button><button class="zb" data-sa="rm" aria-label="${T('เอาออกจากเซ็ต')}">✕</button></span></li>`; }).join('') || `<li class="empty">${T('ยังไม่มีเพลงในเซ็ต เลือกเพลงด้านล่างเพื่อเพิ่ม')}</li>`}</ol>
      <label class="setadd">${T('เพิ่มเพลง')} <select id="setadd"><option value="">${T('เลือกเพลงจากคลัง…')}</option>${more.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select></label></div>`;
    $('#setname').onchange = e => { ed.name = e.target.value.trim() || ed.name; ed.updated = Date.now() / 1000; saveSets(); };
    $('#setadd').onchange = e => { if (!e.target.value) return; ed.songs.push(e.target.value); ed.updated = Date.now() / 1000; saveSets(); renderSets(); };
    return;
  }
  el.innerHTML = `<div class="sethead"><span class="hint">${T('เรียงเพลงตามลำดับการแสดง แล้วเล่นในโหมดเวที: ตัวใหญ่ เลื่อนหน้าด้วยแป้นเหยียบ จบหน้าแล้วไปเพลงถัดไปเอง')}</span><button class="sbtn sm" data-sa="new">+ ${T('เซ็ตใหม่')}</button></div>` +
    (S.sets.length ? `<div class="liblist">${S.sets.map(x => `<div class="lrow" data-set="${esc(x.id)}"><span class="ic setic">♫</span>
      <div class="lmain"><b>${esc(x.name || T('เซ็ตไม่มีชื่อ'))}</b><small>${x.songs.length} ${T('เพลง')} · ${when(x.updated)}</small></div>
      <div class="lacts"><button class="sbtn sm pri" data-sa="play" ${x.songs.length ? '' : 'disabled'}>${T('โหมดเวที')}</button><button class="zb" data-sa="edit" aria-label="${T('แก้เซ็ต')}" title="${T('แก้เซ็ต')}">✎</button><button class="zb" data-sa="del" aria-label="${T('ลบเซ็ต')}" title="${T('ลบเซ็ต')}">🗑</button></div></div>`).join('')}</div>`
      : `<p class="hint">${T('ยังไม่มีเซ็ตเพลง')}</p>`);
}
async function setAction(e) {
  const b = e.target.closest('[data-sa]'); if (!b) return;
  const act = b.dataset.sa, row = b.closest('[data-set]'), li = b.closest('[data-i]');
  const set = S.sets && (row ? S.sets.find(x => x.id === row.dataset.set) : S.sets.find(x => x.id === S.setEdit));
  if (act === 'new') { const x = { id: 'set' + Date.now().toString(36), name: T('เซ็ตใหม่'), songs: [], updated: Date.now() / 1000 }; S.sets.unshift(x); S.setEdit = x.id; await saveSets(); renderSets(); $('#setname')?.select(); return; }
  if (act === 'back') { S.setEdit = null; renderSets(); return; }
  if (!set) return;
  if (act === 'edit') { S.setEdit = set.id; renderSets(); return; }
  if (act === 'play') { startStage(set); return; }
  if (act === 'del') { if (!confirm(`${T('ลบเซ็ต')} "${set.name}"? (${T('เพลงในคลังไม่ถูกลบ')})`)) return; S.sets = S.sets.filter(x => x !== set); await saveSets(); renderSets(); return; }
  if (li) {
    const i = +li.dataset.i, a = set.songs;
    if (act === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    if (act === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
    if (act === 'rm') a.splice(i, 1);
    set.updated = Date.now() / 1000; await saveSets(); renderSets();
  }
}
function setLibTab(v) {
  S.libTab = v; document.querySelectorAll('#libtabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lt === v));
  $('#liblist').hidden = v !== 'songs'; $('#libq').hidden = v !== 'songs'; $('#setview').hidden = v !== 'sets';
  if (v === 'sets') loadSets().then(renderSets);
}

// ================= stage mode: lyrics and chords big, nothing else; a page-turner pedal (or arrows) scrolls, then moves on =================
var STAGE = { on: false, set: null, i: 0, lock: null };  // var: read by renderAll before this line runs
function stageFont(d) { S.stageFs = Math.max(20, Math.min(64, (S.stageFs || 34) + d)); store.set('cl-stagefs', S.stageFs); document.documentElement.style.setProperty('--stagefs', S.stageFs + 'px'); requestAnimationFrame(fitChips); }
async function startStage(set) {
  STAGE.set = set || null; STAGE.i = 0;
  if (set) { const first = set.songs.find(id => songOf(id)); if (!first) return hint('เพลงในเซ็ตนี้ไม่อยู่ในคลังแล้ว', true); STAGE.i = set.songs.indexOf(first); openLib(first); }
  else if (!ready(A())) return hint('เปิดเพลงที่แกะเสร็จแล้วก่อน แล้วค่อยเข้าโหมดเวที', true);
  STAGE.on = true; S.stagePrevDisp = S.disp; if (S.disp !== 'lyric') setDisp('lyric');
  document.body.classList.add('stage-on'); S.libOpen = false; renderLibrary(); stageFont(0); renderStageBar();
  scrollTo({ top: 0 });
  try { STAGE.lock = await navigator.wakeLock.request('screen'); } catch { STAGE.lock = null; }  // keep the screen on (iPad, phone)
  try { if (innerWidth > 700 && document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {}
}
function stopStage() {
  STAGE.on = false; document.body.classList.remove('stage-on');
  if (S.stagePrevDisp && S.stagePrevDisp !== S.disp) setDisp(S.stagePrevDisp);
  try { STAGE.lock && STAGE.lock.release(); } catch {} STAGE.lock = null;
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  requestAnimationFrame(() => { fitChips(); drawRoll(audio.currentTime); });
}
document.addEventListener('visibilitychange', async () => { if (STAGE.on && document.visibilityState === 'visible' && !STAGE.lock) { try { STAGE.lock = await navigator.wakeLock.request('screen'); } catch {} } });
function stageSong(d) {
  if (!STAGE.set) return false;
  let i = STAGE.i + d; while (i >= 0 && i < STAGE.set.songs.length && !songOf(STAGE.set.songs[i])) i += d;
  if (i < 0 || i >= STAGE.set.songs.length) { stageToast(d > 0 ? 'จบเซ็ตแล้ว' : 'นี่คือเพลงแรกของเซ็ต'); return false; }
  audio.pause(); STAGE.i = i; openLib(STAGE.set.songs[i]); scrollTo({ top: 0 }); renderStageBar(); return true;
}
// a short message in the stage bar (the page's hint line is hidden on stage)
function stageToast(msg) {
  const el = $('#sttoast'); if (!el) return;
  el.textContent = T(msg); el.hidden = false; clearTimeout(stageToast.t); stageToast.t = setTimeout(() => { el.hidden = true; }, 3000);
}
function stagePage(d) {
  const bar = $('#stagebar').offsetHeight, bot = $('.bottom').offsetHeight, step = Math.max(120, innerHeight - bar - bot - 60);
  const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 4, atTop = scrollY <= 2;
  if (d > 0 && atEnd) { if (stageSong(1)) return; }
  if (d < 0 && atTop) { if (stageSong(-1)) setTimeout(() => scrollTo({ top: document.documentElement.scrollHeight }), 400); return; }
  S.userScrollAt = Date.now(); scrollBy({ top: d * step, behavior: 'smooth' });
}
function renderStageBar() {
  const s = A(), el = $('#stagebar'); if (!el || !STAGE.on) return;
  const set = STAGE.set, nextId = set ? set.songs.slice(STAGE.i + 1).find(id => songOf(id)) : null, nx = nextId && songOf(nextId);
  const key = s && s.res ? MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 }, 0, 'very', s.tr) : '';
  el.innerHTML = `<div class="sb1"><b>${esc(s ? s.name : '')}</b><small>${set ? `${esc(set.name)} · ${T('เพลงที่')} ${STAGE.i + 1}/${set.songs.length} · ` : ''}${T('คีย์')} ${key}${capoOf(s) ? ` · ${T('คาโป้')} ${capoOf(s)}` : ''}${nx ? ` · ${T('ถัดไป')}: ${esc(nx.title)}` : ''}</small></div>
    <div class="sb2">${set ? `<button class="zb" id="stprev" aria-label="${T('เพลงก่อนหน้า')}" title="${T('เพลงก่อนหน้า')}">⏮</button><button class="zb" id="stnext" aria-label="${T('เพลงถัดไป')}" title="${T('เพลงถัดไป')}">⏭</button>` : ''}
      <button class="zb" id="stsmall" aria-label="${T('ตัวเล็กลง')}" title="${T('ตัวเล็กลง')}">A−</button><button class="zb" id="stbig" aria-label="${T('ตัวใหญ่ขึ้น')}" title="${T('ตัวใหญ่ขึ้น')}">A+</button>
      <button class="sbtn sm" id="stexit">${T('ออก')}</button></div><span class="sttoast" id="sttoast" hidden></span>`;
  const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
  on('#stprev', () => stageSong(-1)); on('#stnext', () => stageSong(1)); on('#stsmall', () => stageFont(-3)); on('#stbig', () => stageFont(3)); on('#stexit', stopStage);
}
addEventListener('keydown', e => {
  if (!STAGE.on || (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'))) return;
  // page-turner pedals send PageDown / PageUp or the arrow keys
  if (['PageDown', 'ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); stagePage(1); }
  else if (['PageUp', 'ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); stagePage(-1); }
  else if (e.key === 'Escape') stopStage();
}, true);

// ================= first-time guide: five short steps on the real screen (Thai / English) =================
const TOUR = [
  { sel: '#addbtn', title: 'เริ่มจากเพิ่มเพลง', text: 'เลือกไฟล์เพลง วางลิงก์ YouTube หรือเปิดเพลงที่เคยแกะไว้จาก "คลังเพลง" แอปจะแกะคอร์ด คีย์ ทำนอง และเนื้อร้องให้' },
  { sel: '#sheetcard', title: 'แผ่นโน้ตของคุณ', text: 'แตะคอร์ดเพื่อแก้ แตะสองครั้งที่เนื้อร้องเพื่อแก้ ลากคอร์ดไปวางที่อื่นได้ ทุกอย่างบันทึกเองและเปิดต่อได้จากทุกเครื่อง' },
  { sel: '.tb', title: 'ปรับให้เหมาะกับคุณ', text: 'เลือกระดับคอร์ด พื้นฐาน / มาตรฐาน / ละเอียด เปลี่ยนคีย์ด้วย − และ + เลือกรูปคอร์ดเปียโนหรือกีตาร์ (กีตาร์มีแนะนำคาโป้) คอร์ดที่กำลังเล่นอยู่มุมขวาบน' },
  { sel: '.bottom', title: 'เล่นตามเพลง', text: 'กดเล่น แล้วดูคอร์ด เนื้อร้อง และทำนองเลื่อนตามจังหวะ ฝึกช้าลงด้วย 50% หรือ 75% และกด "วนแถวนี้" เพื่อซ้อมท่อนเดิม' },
  { sel: '#stagebtn', title: 'ขึ้นเวที', text: 'โหมดเวทีแสดงเนื้อร้องและคอร์ดตัวใหญ่ เลื่อนหน้าด้วยแป้นเหยียบ Bluetooth หรือปุ่มลูกศร จัดเพลงเป็นเซ็ตได้ใน "คลังเพลง" แล้วแอปจะไปเพลงถัดไปให้เอง' },
];
let tourAt = -1;
function startTour() { tourAt = 0; document.body.classList.add('touring'); showTour(); }
function endTour() { tourAt = -1; document.body.classList.remove('touring'); $('#tour').hidden = true; store.set('cl-tour', 'done'); }
function showTour() {
  const step = TOUR[tourAt], box = $('#tour'), hl = $('#tourhl'), card = $('#tourcard');
  let el = $(step.sel); const r0 = el && el.getBoundingClientRect();
  if (r0 && r0.height > 0 && (r0.top < 60 || r0.bottom > innerHeight - 40)) { el.scrollIntoView({ block: 'center' }); }
  box.hidden = false;
  requestAnimationFrame(() => {
    const r = el && el.getBoundingClientRect(), vis = r && r.width > 0 && r.height > 0;
    hl.hidden = !vis; box.classList.toggle('nohl', !vis);
    if (vis) { const p = 6; Object.assign(hl.style, { left: r.left - p + 'px', top: Math.max(4, r.top - p) + 'px', width: r.width + p * 2 + 'px', height: Math.min(r.height + p * 2, innerHeight - 8) + 'px' }); }
    card.innerHTML = `<small>${T('ขั้นที่')} ${tourAt + 1} / ${TOUR.length}</small><b>${T(step.title)}</b><p>${T(step.text)}</p>
      <div class="tacts"><button class="sbtn sm" id="tskip">${T('ข้าม')}</button><span class="tsp"></span>${tourAt ? `<button class="sbtn sm" id="tback">${T('ย้อน')}</button>` : ''}<button class="sbtn sm pri" id="tnext">${tourAt === TOUR.length - 1 ? T('เริ่มใช้งาน') : T('ถัดไป')}</button></div>`;
    // the card goes below the highlighted part if there is room, else above it, else in the middle
    const ch = card.offsetHeight, cw = Math.min(380, innerWidth - 24);
    let top = vis ? (r.bottom + 14 + ch < innerHeight ? r.bottom + 14 : r.top - 14 - ch > 0 ? r.top - 14 - ch : innerHeight / 2 - ch / 2) : innerHeight / 2 - ch / 2;
    let left = vis ? Math.min(innerWidth - cw - 12, Math.max(12, r.left)) : (innerWidth - cw) / 2;
    Object.assign(card.style, { top: Math.max(8, top) + 'px', left: left + 'px', width: cw + 'px' });
    $('#tskip').onclick = endTour; $('#tnext').onclick = () => { if (tourAt === TOUR.length - 1) endTour(); else { tourAt++; showTour(); } };
    const bk = $('#tback'); if (bk) bk.onclick = () => { tourAt--; showTour(); };
    $('#tnext').focus({ preventScroll: true });
  });
}
addEventListener('resize', () => { if (tourAt >= 0) showTour(); });
addEventListener('keydown', e => { if (tourAt >= 0 && e.key === 'Escape') endTour(); });
