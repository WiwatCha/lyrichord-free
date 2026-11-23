// ================= playback sync (both views) =================
function lyHighlight(s, t, i) {
  const k = lineAt(s, t), active = k >= 0 && t < lineSpan(s, k)[1] + 0.4 ? k : -1;
  if (active !== S.curLine) {
    S.curLine = active;
    document.querySelectorAll('.ll[data-li]').forEach(el => { const li = +el.dataset.li; el.classList.toggle('on', li === active); el.classList.toggle('past', active >= 0 && li < active); });
    document.querySelectorAll('#lelist .le').forEach(el => el.classList.toggle('on', +el.dataset.k === active));
    const row = document.querySelector('#lelist .le.on'), list = $('#lelist');
    if (row && list && !audio.paused && document.activeElement?.tagName !== 'INPUT') { const top = row.offsetTop - list.offsetTop; if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - row.offsetHeight) list.scrollTop = top - 60; }
  }
  document.querySelectorAll('#lyv .cc.on,#lyv .ipill.on').forEach(e => e.classList.remove('on'));
  const seg = i >= 0 ? segAt(s, i) : null;
  if (seg) document.querySelectorAll(`#lyv .cc[data-s="${seg.start}"],#lyv .ipill[data-s="${seg.start}"]`).forEach(e => e.classList.add('on'));
}
function visibleZone() { const top = (STAGE && STAGE.on ? $('#stagebar') : $('.tb')).getBoundingClientRect().bottom, bot = $('.bottom').getBoundingClientRect().top; return [top, bot]; }
function followEl(el) {
  if (!el || audio.paused || $('#sheetview').hidden) return;
  const r = el.getBoundingClientRect(), [top, bot] = visibleZone(), off = r.top < top || r.bottom > bot;
  if (off && S.follow && Date.now() - S.userScrollAt > 4000) { scrollTo({ top: scrollY + r.top - (top + bot) / 2 + r.height / 2, behavior: 'smooth' }); $('#backto').hidden = true; }
  else $('#backto').hidden = !off;
}
function tick(force) {
  const s = A(); if (!ready(s) || audio.dataset.src !== s.id) return;
  const t = audio.currentTime, i = beatAt(s, t);
  $('#time').textContent = fmt(t) + ' / ' + fmt(s.res.duration);
  if (document.activeElement !== $('#seek')) $('#seek').value = t;
  if (S.loop && !audio.paused && S.cur >= 0) {
    const r = Math.floor(s.beatBar[S.cur] / 4), first = s.bars[r * 4][0];
    const lastBar = s.bars[Math.min(s.bars.length - 1, r * 4 + 3)], endT = s.res.beats[lastBar[lastBar.length - 1] + 1] ?? s.res.duration;
    if (t >= endT - 0.03) { audio.currentTime = s.res.beats[first]; return; }
  }
  if (i !== S.cur || force) {
    document.querySelectorAll('.bar.cur,.ticks i.on,.bars.loop,.chip.on').forEach(e => e.classList.remove('cur', 'on', 'loop'));
    S.cur = i;
    if (i >= 0) {
      const bi = s.beatBar[i], bar = s.bars[bi], el = document.querySelector(`.bar[data-b="${bi}"]`), seg = segAt(s, i), nx = nextSeg(s, i);
      el?.classList.add('cur'); document.querySelector(`.ticks i[data-k="${i}"]`)?.classList.add('on');
      if (seg && el) el.querySelector(`.chip[data-s="${seg.start}"]`)?.classList.add('on');
      if (S.loop) document.querySelector(`.bars[data-r="${Math.floor(bi / 4)}"]`)?.classList.add('loop');
      setNow(seg ? seg.chord : null, nx ? nx.chord : null, nx ? nx.start - i : 0, i - bar[0], bar.length);
      if (lyricShown(s)) {
        lyHighlight(s, t, i);
        // instrumental rows light up too, with the bar box being played
        document.querySelectorAll('.ll.inst').forEach(el => el.classList.toggle('on', S.curLine < 0 && el.dataset.bars.split(',').includes(String(bi))));
        document.querySelectorAll('.ibx.cur').forEach(el => el.classList.remove('cur')); if (S.curLine < 0) document.querySelector(`.ibx[data-b="${bi}"]`)?.classList.add('cur');
        followEl(document.querySelector('.ll.on'));
      }
      else followEl(el);
    } else { const fc = s.lv ? segsOf(s).flat().find(g => g.chord.root >= 0) : null; setNow(null, fc ? fc.chord : null, 0, -1, 4); if (lyricShown(s)) lyHighlight(s, t, -1); }
  }
  drawRoll(t);
}
['wheel', 'touchmove'].forEach(ev => addEventListener(ev, () => { S.userScrollAt = Date.now(); }, { passive: true }));
addEventListener('keydown', e => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) S.userScrollAt = Date.now(); });
$('#backto').addEventListener('click', () => { S.userScrollAt = 0; const el = document.querySelector(lyricShown(A()) ? '.ll.on' : '.bar.cur'); if (el) { const r = el.getBoundingClientRect(), [top, bot] = visibleZone(); scrollTo({ top: scrollY + r.top - (top + bot) / 2 + r.height / 2, behavior: 'smooth' }); } $('#backto').hidden = true; });

// ================= status: what works offline =================
function features() {
  const h = S.backend, on = navigator.onLine;
  return [
    ['แกะคอร์ด ทำนอง จังหวะ จากไฟล์เพลง', 'off', h ? 'หลังบ้านในเครื่องนี้ (Basic Pitch)' : 'คำนวณในเบราว์เซอร์'],
    ['ลบเสียงก้องก่อนฟังเนื้อร้อง (UVR)', h && h.dereverb ? 'off' : 'no', h ? (h.dereverb ? 'เลือกผลที่ Whisper มั่นใจกว่าให้เอง' : 'ไม่ได้ติดตั้ง') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['แกะคอร์ดด้วย AI (BTC)', h && h.btc ? 'off' : 'no', h ? (h.btc ? 'โมเดลอยู่ในเครื่อง' : 'ใช้ตัวแกะคอร์ดแบบเทมเพลตแทน') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['อ่านเนื้อร้อง/คอร์ดจากรูปภาพ (OCR)', h && h.ocr ? 'off' : 'no', h ? (h.ocr ? 'PaddleOCR อยู่ในเครื่อง' : 'หลังบ้านไม่ได้ติดตั้ง OCR') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['หาจังหวะและต้นห้องด้วย AI (Beat This!)', h && h.beat_this ? 'off' : 'no', h ? (h.beat_this ? 'โมเดลอยู่ในเครื่อง' : 'ใช้ตัวหาจังหวะในแอปแทน') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['แยกเสียงร้องออกจากดนตรี (Demucs)', h && h.demucs ? 'off' : 'no', h ? (h.demucs ? 'โมเดลอยู่ในเครื่อง' : 'หลังบ้านไม่ได้ติดตั้ง Demucs') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['AI ฟังเนื้อร้อง/จังหวะร้อง (Whisper)', h && h.whisper ? 'off' : 'no', h ? (h.whisper ? `รุ่น ${h.whisper_model || ''}${h.offline_models ? ' · โมเดลอยู่ในเครื่อง' : ''}` : 'หลังบ้านไม่ได้ติดตั้ง Whisper') : 'ต้องเปิดผ่านหลังบ้าน'],
    ['นำเข้าเนื้อร้อง .txt / .docx และแก้ไข', 'off', 'อ่านไฟล์ในเครื่อง'],
    ['ส่งออก PDF', 'off', 'สร้างในเครื่อง'],
    ['ส่งออก PowerPoint', S.pptLocal ? 'off' : on ? 'net' : 'no', S.pptLocal ? 'ตัวสร้างอยู่ในแอป' : 'โหลดตัวสร้างจากเน็ตครั้งแรก'],
    ['ไมค์ / เสียงจากแท็บ (สด)', window.isSecureContext && navigator.mediaDevices ? 'off' : 'no', window.isSecureContext ? 'ประมวลผลในเครื่อง' : 'ต้องเปิดผ่าน http://localhost หรือ https'],
    ['แกะจากลิงก์ YouTube', !h ? 'no' : on ? 'net' : 'no', !h ? 'ต้องเปิดผ่านหลังบ้าน' : on ? 'ต้องใช้เน็ต (เชื่อมต่ออยู่)' : 'ตอนนี้ออฟไลน์'],
  ];
}
function renderStatus() {
  const f = features(), on = navigator.onLine, nOff = f.filter(x => x[1] === 'off').length;
  $('#stdot').className = 'dot' + (on ? '' : ' no');
  $('#sttxt').textContent = `${on ? 'ออนไลน์' : 'ออฟไลน์'} · ${S.backend ? 'หลังบ้านพร้อม' : 'โหมดเบราว์เซอร์'} · ทำงานออฟไลน์ได้ ${nOff}/${f.length}`;
  $('#stpop').innerHTML = `<strong>อะไรใช้ได้แบบไม่ต้องต่อเน็ต</strong><p class="hint" style="margin:2px 0 8px">ตอนนี้: ${on ? 'ต่อเน็ตอยู่' : 'ไม่ได้ต่อเน็ต'} · ${S.backend ? (API.base ? 'ต่อหลังบ้านออนไลน์' : 'เปิดผ่านหลังบ้าน (localhost)') : 'เปิดแบบเบราว์เซอร์อย่างเดียว'} · Lyrichord v${APP_VERSION}${S.backend ? ` (${'หลังบ้าน'} v${S.backend.version || '?'})` : ''}</p>` +
    f.map(([n, st, d]) => `<div class="strow"><span>${n}</span><span class="badge2 b-${st}">${st === 'off' ? 'ออฟไลน์ได้' : st === 'net' ? 'ต้องใช้เน็ต' : 'ไม่พร้อม'}</span><small>${esc(d)}</small></div>`).join('') +
    // online page: connect to the AI backend on your computer (address and key shown by start-online)
    `<div class="stapi"><strong>${'หลังบ้าน AI ของคุณ'}</strong>` +
    `<p class="hint">${API.base ? (S.backend ? 'เชื่อมต่อแล้ว' : S.backendErr === 'key' ? 'รหัสไม่ถูกต้อง' : 'ติดต่อไม่ได้ (เปิด start-online บนคอมแล้วหรือยัง)') : 'ใช้หลังบ้านของหน้านี้'}</p>` +
    `<input id="apiurl" type="url" placeholder="https://xxxx.trycloudflare.com" value="${esc(API.base)}"><input id="apikey" placeholder="${'รหัสเข้าใช้'}" value="${esc(API.key)}">` +
    `<div class="row"><button class="btn" id="apiset">${'เชื่อมต่อ'}</button>${API.base ? `<button class="btn" id="apiclr">${'เลิกเชื่อมต่อ'}</button>` : ''}</div></div>` +
    (S.online && S.online.link ? `<div class="stqr"><strong>${'ใช้บน iPhone / iPad'}</strong><p class="hint">${'สแกน QR ด้วยกล้อง แล้วแตะลิงก์ที่ขึ้นมา (เปิดใน Safari) ต่อหลังบ้าน AI ของคอมเครื่องนี้ได้ทันที'}</p>${S.online.qr}<input readonly value="${esc(S.online.link)}" onclick="this.select()"></div>` : '');
  const yb = $('#ytbtn'); yb.disabled = !on; yb.title = on ? '' : 'ต้องต่ออินเทอร์เน็ต';
}
// start-online is running on this computer: show the QR code for phones / tablets
async function loadOnline() {
  if (API.base || !S.backend || S.backend.online) return;
  try { const r = await fetch(api('online')); const j = r.ok ? await r.json() : {}; S.online = j && j.link ? j : null; } catch { S.online = null; }
  renderStatus();
}
$('#stpop').addEventListener('click', e => {
  if (e.target.id === 'apiset') setBackend($('#apiurl').value, $('#apikey').value);
  if (e.target.id === 'apiclr') setBackend('', '');
});
addEventListener('online', renderStatus); addEventListener('offline', renderStatus);
$('#stbtn').addEventListener('click', e => { e.stopPropagation(); const p = $('#stpop'); p.hidden = !p.hidden; if (!p.hidden) loadOnline(); $('#stbtn').setAttribute('aria-expanded', !p.hidden); if (!p.hidden) { const r = $('#stbtn').getBoundingClientRect(); p.style.top = (r.bottom + scrollY) + 'px'; } });

// ================= controls =================
function setLevel(v) { S.level = v; store.set('cl-level', v); document.querySelectorAll('#lvseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lv === v)); closePops(); S.lastKey = ''; const s = A(); if (ready(s)) { s.lyCache = null; renderSheet(); } else if (isLive(s)) { renderHist(); setNow(s.liveCur || null, null, 0, -1, 4); } }
function setInst(v) { S.inst = v; store.set('cl-inst2', v); document.querySelectorAll('#inseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.in === v)); S.lastKey = ''; const s = A(); if (ready(s)) { renderSheet(); renderUsed(s); renderCapo(); tick(true); } else if (s) setNow(s.liveCur || null, null, 0, -1, 4); }
function setDisp(v) { S.disp = v; store.set('cl-disp2', v); document.querySelectorAll('#dmseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dm === v)); closePops(); const s = A(); if (ready(s)) renderSheet(); }
function setExDiag(v) { S.exDiag = v; store.set('cl-exdiag', v); document.querySelectorAll('#exdiag button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dg === v)); }
function setDock(v) {
  S.dock = v; store.set('cl-dock', v); document.body.classList.remove('d-hide', 'd-normal', 'd-tall'); document.body.classList.add('d-' + v);
  document.documentElement.style.setProperty('--dockh', v === 'tall' ? '62vh' : S.dockH + 'px');
  $('#dockmax').setAttribute('aria-pressed', v === 'tall'); $('#dockmin').setAttribute('aria-pressed', v === 'hide');
  $('#dockmin').title = v === 'hide' ? 'แสดง' : 'ย่อ'; $('#dockmax').title = v === 'tall' ? 'ย่อกลับ' : 'ขยาย';
  requestAnimationFrame(() => drawRoll(audio.currentTime));
}
// ---- zones: the play-along zone under the sheet (top-bottom) or beside it (left-right); drag the handles (or arrow keys on them) ----
const phone = () => innerWidth <= 700;
function setLayout(v) {
  S.layout = v; store.set('cl-layout', v);
  const lr = v === 'lr' && !phone();
  document.body.classList.toggle('lay-lr', lr); document.body.classList.toggle('lay-tb', !lr);
  if (lr) $('#stage').append($('#vsplit'), $('#dock')); else $('#hsplit').after($('#dock'));
  document.querySelectorAll('#layseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lay === v));
  requestAnimationFrame(() => { fitChips(); fitBig(); drawRoll(audio.currentTime); });
}
function setDockW(w, keep) {
  S.dockW = Math.round(Math.max(260, Math.min(innerWidth - 340, w)));
  document.documentElement.style.setProperty('--dockw', S.dockW + 'px');
  if (!keep) store.set('cl-dockw', S.dockW);
  if (S.dock === 'tall' && !keep) setDock('normal');
  requestAnimationFrame(() => { fitChips(); drawRoll(audio.currentTime); });
}
function setDockH(h) { S.dockH = Math.round(Math.max(120, Math.min(innerHeight * 0.75, h))); store.set('cl-dockh', S.dockH); setDock('normal'); }
// phone, play-along tab: the lane takes exactly the room between the toolbar and the transport
function fitPlay() {
  if (!phone() || S.ptab !== 'play') return;
  const other = $('.bottom').offsetHeight - $('.fig').offsetHeight, h = Math.max(200, Math.round(innerHeight - $('.tb').offsetHeight - other - 30));
  if (h !== fitPlay.h) { fitPlay.h = h; document.documentElement.style.setProperty('--playh', h + 'px'); }
}
function setPTab(v) { S.ptab = v; store.set('cl-ptab', v); document.body.classList.remove('p-sheet', 'p-play'); document.body.classList.add('p-' + v); document.querySelectorAll('#ptabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.pt === v)); requestAnimationFrame(() => { fitPlay(); if (phone() && v === 'play') setTimeout(() => scrollTo({ top: document.documentElement.scrollHeight }), 60); fitChips(); tick(true); drawRoll(audio.currentTime); }); }
function sizer(el, move) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} document.body.classList.add('sizing');
    const x0 = e.clientX, y0 = e.clientY, w0 = $('#dock').offsetWidth, h0 = S.dockH;
    const mv = ev => move(ev.clientX - x0, ev.clientY - y0, w0, h0);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); document.body.classList.remove('sizing'); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
sizer($('#vsplit'), (dx, dy, w0) => setDockW(w0 - dx));
sizer($('#hsplit'), (dx, dy, w0, h0) => setDockH(h0 - dy));
$('#vsplit').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setDockW($('#dock').offsetWidth + (e.key === 'ArrowLeft' ? 24 : -24)); } });
$('#hsplit').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setDockH(S.dockH + (e.key === 'ArrowUp' ? 24 : -24)); } });
$('#layseg').addEventListener('click', e => { const b = e.target.closest('[data-lay]'); if (b) setLayout(b.dataset.lay); });
$('#tbmore').addEventListener('click', () => { const on = !document.body.classList.contains('tb-open'); if (on) openDrawer(); else closeDrawer(); });
$('#dockmin').addEventListener('click', () => setDock(S.dock === 'hide' ? 'normal' : 'hide'));
$('#dockmax').addEventListener('click', () => setDock(S.dock === 'tall' ? 'normal' : 'tall'));
$('#ptabs').addEventListener('click', e => { const b = e.target.closest('[data-pt]'); if (b) setPTab(b.dataset.pt); });
addEventListener('resize', () => { clearTimeout(setDockW.t); setDockW.t = setTimeout(() => { setDockW(S.dockW, true); if ((S.layout === 'lr' && !phone()) !== document.body.classList.contains('lay-lr')) setLayout(S.layout); fitBig(); }, 150); });
$('#lvseg').addEventListener('click', e => { const b = e.target.closest('[data-lv]'); if (b) setLevel(b.dataset.lv); });
$('#inseg').addEventListener('click', e => { const b = e.target.closest('[data-in]'); if (b) setInst(b.dataset.in); });
$('#dmseg').addEventListener('click', e => { const b = e.target.closest('[data-dm]'); if (b) setDisp(b.dataset.dm); });
$('#play').addEventListener('click', togglePlay);
$('#seek').addEventListener('input', e => { audio.currentTime = +e.target.value; });
document.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => { audio.playbackRate = +b.dataset.rate; document.querySelectorAll('[data-rate]').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
$('#loop').addEventListener('click', () => { S.loop = !S.loop; $('#loop').setAttribute('aria-pressed', S.loop); tick(true); });
$('#follow').addEventListener('click', () => { S.follow = !S.follow; store.set('cl-follow', S.follow ? '1' : '0'); $('#follow').setAttribute('aria-pressed', S.follow); if (S.follow) S.userScrollAt = 0; });
const shift = d => { const s = A(); if (!ready(s)) return; s.tr = Math.max(-6, Math.min(6, s.tr + d)); S.lastKey = ''; save(s); renderAll(); };
$('#trd').addEventListener('click', () => shift(-1));
$('#tru').addEventListener('click', () => shift(1));
$('#prog').addEventListener('click', e => {
  const s = A(); if (!s || !s.res) return;
  if (e.target.closest('#progmore')) { S.progAll = !S.progAll; renderProg(s); return; }
  const b = e.target.closest('.pn'); if (b) seekTo(s, s.res.beats[s.bars[+b.dataset.bar][0]]);
});
$('#tunebtn').addEventListener('click', () => { const s = A(); if (s && s.res) reanalyze(s, { tune: s.res.tune === 'off' ? 'auto' : 'off' }); });
$('#bpmhalf').addEventListener('click', () => { const s = A(); if (s && s.res) reanalyze(s, { tempo: s.res.tempo === 'double' ? 'auto' : s.res.tempo === 'half' ? 'auto' : 'half' }); });
$('#bpmdbl').addEventListener('click', () => { const s = A(); if (s && s.res) reanalyze(s, { tempo: s.res.tempo === 'half' ? 'auto' : s.res.tempo === 'double' ? 'auto' : 'double' }); });
$('#meter').addEventListener('change', e => {
  const s = A(); if (!ready(s)) return; const bpb = +e.target.value;
  s.meter = { num: bpb === 6 ? 6 : bpb, den: bpb === 6 ? 8 : 4, bpb, phase: bpb === s.autoMeter.bpb ? s.autoMeter.phase : 0 }; s.meterUser = true;
  rebuild(s); save(s); renderSources(); renderAll();
});
const phase = d => { const s = A(); if (!ready(s)) return; s.meter = { ...s.meter, phase: (s.meter.phase + d + s.meter.bpb) % s.meter.bpb }; s.meterUser = true; rebuild(s); save(s); renderAll(); };
$('#phl').addEventListener('click', () => phase(-1));
$('#phr').addEventListener('click', () => phase(1));
$('#lybtn').addEventListener('click', () => setLyPanel(!S.lyPanel));
$('#expbtn').addEventListener('click', e => {
  e.stopPropagation(); const p = $('#expop'); p.hidden = !p.hidden; $('#expbtn').setAttribute('aria-expanded', !p.hidden);
  if (!p.hidden) { const n = S.sources.filter(s => ready(s) && s.kind !== 'demo').length; $('#setall').textContent = `${T('บันทึกทุกเพลงที่เปิดอยู่')} (${n})`; $('#setall').disabled = n < 2; S.exMode = S.disp; document.querySelectorAll('#exmode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.ex === S.exMode)); $('#exhint').textContent = ''; }
});
$('#undo').addEventListener('click', () => undoStep(true));
$('#redo').addEventListener('click', () => undoStep(false));
$('#exdiag').addEventListener('click', e => { const b = e.target.closest('[data-dg]'); if (b) setExDiag(b.dataset.dg); });
setExDiag(S.exDiag);
$('#exmode').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (!b) return; S.exMode = b.dataset.ex; document.querySelectorAll('#exmode button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('#pdf').addEventListener('click', () => exportPDF().catch(err => { console.error(err); exHint('สร้าง PDF ไม่สำเร็จ', true); }));
$('#pptx').addEventListener('click', () => exportPPTX().catch(err => { console.error(err); exHint('สร้าง PowerPoint ไม่สำเร็จ', true); }));
$('#copy').addEventListener('click', async () => { const t = exportText(); if (!t) return; try { await navigator.clipboard.writeText(t); exHint('คัดลอกแล้ว'); } catch { exHint('คัดลอกไม่ได้ในหน้านี้', true); } });
const seekTo = (s, t) => { if (!s.url) return; if (audio.dataset.src !== s.id) { audio.src = s.url; audio.dataset.src = s.id; } audio.currentTime = Math.max(0, t); S.userScrollAt = Date.now(); };
$('#rows').addEventListener('click', e => {
  const s = A(); if (!ready(s)) return;
  const chip = e.target.closest('.chip'); if (chip) { e.stopPropagation(); openEd(chip); return; }
  const ly = e.target.closest('.ly span[data-li]'); if (ly) { e.stopPropagation(); openLed(+ly.dataset.li, ly); return; }
  const bar = e.target.closest('.bar'); if (bar) { closePops(); seekTo(s, s.res.beats[s.bars[+bar.dataset.b][0]]); }
});
$('#lyv').addEventListener('click', e => {
  const s = A(); if (!ready(s)) return;
  const cc = e.target.closest('.cc[data-s],.ipill'); if (cc) { e.stopPropagation(); openEd(cc); return; }
  const ed = e.target.closest('.lledit'); if (ed) { e.stopPropagation(); openLed(+ed.dataset.li, ed.closest('.ll')); return; }
  const ll = e.target.closest('.ll'); if (!ll) return; closePops();
  if (ll.dataset.li != null) seekTo(s, s.lines[+ll.dataset.li].t - 0.05); else if (ll.dataset.bar != null) seekTo(s, s.res.beats[s.bars[+ll.dataset.bar][0]]);
});
document.addEventListener('click', e => {
  if (!e.target.isConnected) return;
  if (!e.target.closest('#ed,.chip,.cc,.ipill')) { $('#ed').hidden = true; S.edit = null; }
  if (!e.target.closest('#led,.ly span,.lledit,.ll.sing')) closeLed();
  if (!e.target.closest('#expop,#expbtn')) { $('#expop').hidden = true; $('#expbtn').setAttribute('aria-expanded', false); }
  if (!e.target.closest('#stpop,#stbtn')) { $('#stpop').hidden = true; $('#stbtn').setAttribute('aria-expanded', false); }
});
$('#srcs').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'); if (x) { e.stopPropagation(); removeSource(x.dataset.x); return; }
  const c = e.target.closest('.src'); if (c && c.dataset.id !== S.active) switchTo(c.dataset.id);
});
$('#srcs').addEventListener('keydown', e => { const c = e.target.closest('.src'); if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); switchTo(c.dataset.id); } });
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f && /\.lyrichord$/i.test(f.name)) importSet(f); else addFile(f); e.target.value = ''; });
$('#setfile').addEventListener('change', async e => { for (const f of [...e.target.files]) await importSet(f); e.target.value = ''; });
$('#xmlbtn').addEventListener('click', () => exportScore('xml').catch(err => { console.error(err); exHint('สร้างไฟล์ไม่สำเร็จ', true); }));
$('#midbtn').addEventListener('click', () => exportScore('mid').catch(err => { console.error(err); exHint('สร้างไฟล์ไม่สำเร็จ', true); }));
$('#setone').addEventListener('click', () => exportSet(false).catch(err => { console.error(err); exHint('บันทึกไม่สำเร็จ', true); }));
$('#setall').addEventListener('click', () => exportSet(true).catch(err => { console.error(err); exHint('บันทึกไม่สำเร็จ', true); }));
$('#liveview').addEventListener('click', recClick);
$('#capo').addEventListener('change', e => setCapo(+e.target.value));
$('#capohint').addEventListener('click', () => { const s = A(); if (!ready(s)) return; setCapo(s.capo ? 0 : capoPlan(s).rec); });
$('#libbtn').addEventListener('click', () => { S.libOpen = !S.libOpen; store.set('cl-libopen', S.libOpen ? '1' : '0'); if (S.libOpen) loadLibrary(); else renderLibrary(); });
$('#libtabs').addEventListener('click', e => { const b = e.target.closest('[data-lt]'); if (b) setLibTab(b.dataset.lt); });
$('#setview').addEventListener('click', setAction);
$('#stagebtn').addEventListener('click', () => startStage(null));
$('#helpbtn').addEventListener('click', () => startTour());
$('#libq').addEventListener('input', e => { S.libQ = e.target.value; renderLibrary(); });
$('#liblist').addEventListener('click', libAction);
$('#ytform').addEventListener('submit', e => { e.preventDefault(); addYoutube($('#yturl').value); });
$('#adddemo').addEventListener('click', () => { const d = S.sources.find(s => s.kind === 'demo'); if (d) switchTo(d.id); else addDemo(); });
$('#addmic').addEventListener('click', () => addLive('mic'));
$('#addtab').addEventListener('click', () => addLive('tab'));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  if (/\.lyrichord$/i.test(f.name)) importSet(f);
  else if (/\.(txt|docx)$/i.test(f.name)) { if (!S.lyPanel) setLyPanel(true); importLyricsFile(f); } else addFile(f);
});
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && !(e.target.closest && e.target.closest('input,textarea,[contenteditable]'))) {
    e.preventDefault(); undoStep(e.key.toLowerCase() === 'z' && !e.shiftKey); return;
  }
  if (S.tap && e.key === 'Enter' && !e.target.closest('textarea,input')) { e.preventDefault(); doTap(); return; }
  if (e.code === 'Space' && !e.target.closest('input,button,select,textarea,.src,summary,label')) { e.preventDefault(); togglePlay(); }
});
const setBH = () => { document.documentElement.style.setProperty('--bh', $('.bottom').offsetHeight + 'px'); fitPlay(); };
new ResizeObserver(setBH).observe($('.bottom'));
const setTBH = () => { document.documentElement.style.setProperty('--tbh', ($('.tb').offsetHeight + 8) + 'px'); fitPlay(); };
new ResizeObserver(setTBH).observe($('.tb'));
const ro = new ResizeObserver(() => { drawRoll(audio.currentTime); clearTimeout(ro.t); ro.t = setTimeout(fitChips, 120); }); ro.observe($('#roll')); ro.observe($('#rows'));

// static page text: remember the Thai original of every text node / attribute once, then swap
const NOI18N = '#rows,#lyv,#lelist,#reclist,#liblist,#srcs,textarea,script,style';
function applyStatic() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest(NOI18N)) continue;
    if (n.__th == null) { if (!/[\u0E00-\u0E7F]/.test(n.nodeValue)) continue; n.__th = n.nodeValue; }
    const k = n.__th.trim(); n.nodeValue = LANG === 'en' && I18N.en[k] != null ? n.__th.replace(k, I18N.en[k]) : n.__th;
  }
  document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el => {
    if (el.closest(NOI18N)) return;
    for (const a of ['placeholder', 'aria-label', 'title']) {
      if (!el.hasAttribute(a)) continue; const key = 'th' + a.replace('-', '');
      if (el.dataset[key] == null) { const v = el.getAttribute(a); if (!/[\u0E00-\u0E7F]/.test(v)) continue; el.dataset[key] = v; }
      el.setAttribute(a, T(el.dataset[key]));
    }
  });
  document.documentElement.lang = LANG;
}
function setLang(v) {
  LANG = v; store.set('cl-lang', v);
  document.querySelectorAll('#langseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === v));
  applyStatic(); S.lastKey = ''; S.cur = -2;
  setLevel(S.level); setInst(S.inst);
  renderSources(); renderAll(); renderStatus(); renderLyPanel(); renderLibrary();
  if (!$('#hint').classList.contains('err')) hint('');
}
$('#langseg').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });
document.querySelectorAll('#langseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === LANG));
applyStatic();
document.body.classList.toggle('free', EDITION === 'free'); document.title = APP_NAME; $('#edchip').hidden = EDITION !== 'free'; setPro(S.pro);
setLevel(S.level); setInst(S.inst); setDisp(S.disp); setDock(S.dock); setDockW(S.dockW, true); setLayout(S.layout); setPTab(S.ptab);
$('#follow').setAttribute('aria-pressed', S.follow);
setLibTab('songs');
renderStatus();
// Lyrichord Free: consent first, then the guide; the full app opens with the demo song
if (needConsent()) showConsent();
else if (store.get('cl-tour') !== 'done') setTimeout(() => { if (tourAt < 0 && !STAGE.on) startTour(); }, 1800);
if (EDITION !== 'free') addDemo(); else renderAll();
$('#ver').textContent = 'v' + APP_VERSION;
checkBackend().then(async h => {
  S.backend = h;
  if (h && h.edition === 'free') document.body.classList.add('free');  // a free backend has no YouTube, whatever page it serves
  // a page and a server from different versions: say so plainly (usually an old app still installed or running)
  if (h && h.version !== APP_VERSION) {
    const w = document.createElement('p'); w.className = 'verwarn'; w.id = 'verwarn';
    w.textContent = `${'หน้าเว็บเป็นเวอร์ชัน'} ${APP_VERSION} ${'แต่โปรแกรมหลังบ้านเป็นเวอร์ชัน'} ${h.version || '?'} · ${'ปิดแอปแล้วดับเบิลคลิก update-lyricord ในโฟลเดอร์ lyricord ใหม่ จากนั้นกด Ctrl+Shift+R (Mac: Cmd+Shift+R)'}`;
    document.querySelector('header')?.after(w);
  }
  if (/^https?:/.test(location.protocol)) { try { const r = await fetch('assets/vendor/pptxgen.bundle.js', { method: 'HEAD' }); S.pptLocal = r.ok; } catch { S.pptLocal = false; } }
  renderStatus();
  loadLibrary();
  await loadOnline();
  if (new URLSearchParams(location.search).has('showqr') && S.online) { const p = $('#stpop'); p.hidden = false; const r = $('#stbtn').getBoundingClientRect(); p.style.top = (r.bottom + scrollY) + 'px'; }
  if (S.backendErr === 'key') hint('หลังบ้านออนไลน์: รหัสเข้าใช้ไม่ถูกต้อง แก้ได้ที่ปุ่มสถานะมุมขวาบน', true);
  else if (S.backendErr === 'nomac' || (S.backendErr === 'down' && ONLINE_PAGE && S.macFound === false)) hint('ยังติดต่อ Mac ที่บ้านไม่ได้: เปิดแอป Lyrichord บน Mac ไว้ (ต้องติดตั้ง cloudflared) แล้วรีโหลดหน้านี้ ระหว่างนี้ใช้แบบแกะในเครื่องนี้ไปก่อน', true);
  else if (S.backendErr === 'down') hint('ติดต่อหลังบ้านออนไลน์ไม่ได้ ใช้โหมดเบราว์เซอร์แทน (เปิด start-online บนคอมพิวเตอร์ แล้วใส่ที่อยู่ใหม่ที่ปุ่มสถานะมุมขวาบน)', true);
  if (h && !h.whisper) hint('หลังบ้านยังไม่มี Whisper: นำเข้าเนื้อร้องจากไฟล์ได้ตามปกติ โปรแกรมจะจัดจังหวะจากทำนองเสียงร้องแทน');
});
window.__app = { CFGS, setLang, T, S, switchTo, loadLibrary, openLib, setLevel, setInst, setLayout, setDisp, exportPDF, exportPPTX, importLyricsFile, cleanLyrics, A, musicXML, midiFile, startRec, stopRec, exportSet, importSet, addFile };
}
