// ================= simple mode, add-song window, the "More" drawer, help, consent (Lyrichord Free) =================
// Simple mode keeps on screen only what most people use (add a song, library, key, chord level, play, stage mode);
// everything else is one tap away in "More". Advanced mode (a switch in More) shows the full toolbar as before.
function setPro(on) {
  S.pro = !!on; store.set('cl-pro', S.pro ? '1' : '0');
  document.body.classList.toggle('simple', !S.pro);
  const c = $('#prochk'); if (c) c.checked = S.pro;
  if (S.pro) closeDrawer();
  requestAnimationFrame(() => { fitChips(); drawRoll(audio.currentTime); });
}
function openAdd() { document.body.classList.add('add-open'); $('#addback').hidden = false; const f = $('#adds .k-file'); if (f) f.focus?.(); }
function closeAdd() { document.body.classList.remove('add-open'); $('#addback').hidden = true; }
function openDrawer() { document.body.classList.add('tb-open'); $('#tbmore').setAttribute('aria-expanded', true); if (!S.pro) $('#drawback').hidden = false; laneBtn(); }
function closeDrawer() { document.body.classList.remove('tb-open'); $('#tbmore').setAttribute('aria-expanded', false); $('#drawback').hidden = true; }
const laneBtn = () => { const b = $('#lanebtn'); if (b) { b.setAttribute('aria-pressed', S.dock !== 'hide'); b.textContent = S.dock === 'hide' ? T('แสดงแถบเล่นตามเพลง') : T('ซ่อนแถบเล่นตามเพลง'); } };

// what the app looks like before any song: one clear next step
function welcomeHTML() {
  return `<div class="welcome"><span class="wic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg></span>
    <h2>${T('เปลี่ยนเพลงเป็นคอร์ดและเนื้อร้อง')}</h2>
    <p>${T('เลือกไฟล์เพลง แอปจะแกะคอร์ด คีย์ ทำนอง และเนื้อร้องให้ในเครื่องของคุณ ไม่ต้องต่ออินเทอร์เน็ต')}</p>
    <button class="sbtn pri wgo" id="wadd">+ ${T('เพิ่มเพลงแรก')}</button>
    <p class="wfoot">${T('หรือลากไฟล์เพลงมาวางที่ไหนก็ได้บนหน้านี้')}</p>
    <div class="wrow"><button class="sbtn" id="wdemo">${T('ลองเพลงตัวอย่าง')}</button><button class="sbtn" id="wtour">${T('ดูวิธีใช้ 1 นาที')}</button>${S.lib && S.lib.length ? `<button class="sbtn" id="wlib">${T('เปิดคลังเพลง')} (${S.lib.length})</button>` : ''}</div>
    <p class="wfoot">${T('ทำงานในเครื่องของคุณ · ไม่ส่งเพลงออกไปไหน · ใช้กับเพลงที่คุณมีสิทธิ์ใช้')}</p></div>`;
}
document.addEventListener('click', e => {
  if (e.target.closest('#wadd')) openAdd();
  else if (e.target.closest('#wdemo')) { const d = S.sources.find(s => s.kind === 'demo'); if (d) switchTo(d.id); else addDemo(); }
  else if (e.target.closest('#wtour')) startTour();
  else if (e.target.closest('#wlib')) { S.libOpen = true; renderLibrary(); }
});

// ---- documents: terms, privacy, credits, about (Thai / English) ----
const CREDITS = [
  ['Demucs', 'แยกเสียงร้อง เบส กลอง', 'MIT', 'https://github.com/facebookresearch/demucs'],
  ['Beat This!', 'หาจังหวะและต้นห้อง', 'MIT', 'https://github.com/CPJKU/beat_this'],
  ['BTC (Bi-directional Transformer for Chords)', 'แกะคอร์ด', 'MIT', 'https://github.com/jayg996/BTC-ISMIR19'],
  ['Basic Pitch', 'ฟังโน้ตดนตรี', 'Apache-2.0', 'https://github.com/spotify/basic-pitch'],
  ['RMVPE', 'ทำนองเสียงร้อง', 'MIT / Apache-2.0', 'https://github.com/Dream-High/RMVPE'],
  ['Whisper (faster-whisper)', 'ฟังเนื้อร้อง', 'MIT', 'https://github.com/SYSTRAN/faster-whisper'],
  ['PaddleOCR', 'อ่านเนื้อร้อง/คอร์ดจากรูป', 'Apache-2.0', 'https://github.com/PaddlePaddle/PaddleOCR'],
  ['PptxGenJS', 'ส่งออก PowerPoint', 'MIT', 'https://github.com/gitbrent/PptxGenJS'],
  ['PyTorch, NumPy, SciPy, librosa, FastAPI', 'เครื่องมือพื้นฐาน', 'BSD / MIT / ISC', 'https://pytorch.org'],
  ['Bai Jamjuree, IBM Plex Sans Thai', 'ฟอนต์', 'SIL OFL 1.1', 'https://fonts.google.com'],
];
function docHTML(kind) {
  if (kind === 'terms') return [T('เงื่อนไขการใช้งานและลิขสิทธิ์'), `
    <p>${T('Lyrichord เป็นซอฟต์แวร์ฟรีและเปิดซอร์สโค้ดภายใต้สัญญาอนุญาต MIT ใช้ แก้ไข และแจกจ่ายต่อได้ โดยไม่มีการรับประกันใดๆ')}</p>
    <h3>${T('เพลงที่นำมาใช้')}</h3><p>${T('ใช้กับไฟล์เพลงที่คุณมีสิทธิ์ใช้เท่านั้น เช่น เพลงที่ซื้อมา เพลงที่คริสตจักรหรือวงของคุณเป็นเจ้าของ หรือเพื่อการฝึกซ้อมและการเรียนรู้ส่วนตัว')}</p>
    <h3>${T('ผลลัพธ์ (คอร์ด เนื้อร้อง ทำนอง)')}</h3><p>${T('คอร์ดและเนื้อร้องของเพลงที่มีลิขสิทธิ์ยังเป็นของผู้แต่งและผู้ถือสิทธิ์ อย่าเผยแพร่ ขาย หรือแชร์ต่อสาธารณะโดยไม่ได้รับอนุญาต การใช้ในพิธีนมัสการหรือฉายบนจอ ควรมีใบอนุญาตที่เหมาะสม เช่น CCLI หรือได้รับอนุญาตจากผู้แต่ง/สำนักพิมพ์')}</p>
    <h3>${T('ความถูกต้อง')}</h3><p>${T('ผลลัพธ์มาจาก AI และอาจคลาดเคลื่อน โปรดตรวจและแก้ก่อนนำไปใช้งานจริง')}</p>
    <h3>${T('ความรับผิดชอบ')}</h3><p>${T('ผู้ใช้รับผิดชอบการใช้งานของตนเองให้เป็นไปตามกฎหมายลิขสิทธิ์ ผู้พัฒนาไม่รับผิดชอบต่อการนำไปใช้ที่ละเมิดสิทธิ์ของผู้อื่น')}</p>`];
  if (kind === 'privacy') return [T('ความเป็นส่วนตัว'), `
    <p>${T('แอปทำงานบนคอมพิวเตอร์ของคุณ ไฟล์เพลง ผลการแกะ และสิ่งที่คุณแก้ เก็บไว้ในเครื่องของคุณเท่านั้น')}</p>
    <p>${T('แอปไม่มีบัญชีผู้ใช้ ไม่เก็บสถิติการใช้งาน ไม่มีโฆษณา และไม่ส่งข้อมูลของคุณให้ใคร')}</p>
    <p>${T('แอปไม่เชื่อมต่อออกไปภายนอก เว้นแต่คุณเปิดให้ใช้จากมือถือเอง และการเชื่อมต่อนั้นต้องใช้รหัสเข้าใช้')}</p>`];
  if (kind === 'credits') return [T('เครดิตซอฟต์แวร์และไลเซนส์'), `
    <p>${T('Lyrichord สร้างจากซอฟต์แวร์โอเพนซอร์สเหล่านี้ ขอบคุณผู้พัฒนาทุกท่าน')}</p>
    <table><tr><th>${T('ซอฟต์แวร์')}</th><th>${T('ใช้ทำ')}</th><th>${T('ไลเซนส์')}</th></tr>${CREDITS.map(([n, w, l, u]) => `<tr><td><a href="${u}" target="_blank" rel="noopener">${esc(n)}</a></td><td>${esc(T(w))}</td><td>${esc(l)}</td></tr>`).join('')}</table>
    <p style="margin-top:10px">${T('รายละเอียดไลเซนส์ของแต่ละส่วนอยู่ในไฟล์ THIRD_PARTY_NOTICES.md ที่มากับแอป')}</p>`];
  return [T('เกี่ยวกับแอปนี้'), `
    <p><b>${APP_NAME}</b> v${esc(APP_VERSION)}</p>
    <p>${T('แกะคอร์ด คีย์ ทำนอง และเนื้อร้องจากไฟล์เพลง แล้วเล่นตาม ซ้อม ขึ้นเวที และส่งออกได้ ทำงานในเครื่องของคุณ')}</p>
    <p>${T('แจกฟรีและเปิดซอร์สโค้ด (MIT) เพื่อเป็นประโยชน์กับพี่น้องและทุกคนที่รักดนตรี')}</p>`];
}
// ---- Wi-Fi mode: phones and tablets on the same network open this app (works without internet) ----
async function openLan() {
  $('#docTitle').textContent = T('ใช้บนมือถือ / iPad (Wi-Fi เดียวกัน)'); $('#docbody').innerHTML = `<p>${T('กำลังโหลด…')}</p>`; $('#docdlg').hidden = false;
  let j = null; try { const r = await fetch(api('lan')); j = r.ok ? await r.json() : null; } catch {}
  const steps = `<ol><li>${T('ให้มือถือหรือ iPad ต่อ Wi-Fi เดียวกับคอมเครื่องนี้ (Wi-Fi ในโบสถ์ หรือฮอตสปอตจากมือถือก็ได้ ไม่ต้องมีอินเทอร์เน็ต)')}</li>
    <li>${T('สแกน QR ด้วยกล้อง แล้วเปิดลิงก์ (iPhone: Safari · Android: Chrome)')}</li>
    <li>${T('ใช้ได้ตราบที่แอปบนคอมเปิดอยู่ เพิ่มไปยังหน้าจอโฮมไว้เปิดครั้งต่อไปได้')}</li></ol>`;
  let body;
  if (!j) body = `<p>${T('เปิดหน้านี้จากแอปบนคอมพิวเตอร์ (ปุ่มในหน้าต่าง Lyrichord) เพื่อดู QR')}</p>`;
  else if (!j.on) body = `<p>${T('โหมด Wi-Fi ปิดอยู่ (รุ่นนี้รับเฉพาะเครื่องนี้)')}</p>`;
  else if (!j.link) body = `<p>${T('ยังไม่ได้ต่อ Wi-Fi หรือเครือข่ายใด: ต่อ Wi-Fi หรือเปิดฮอตสปอตจากมือถือแล้วต่อคอมเข้าไป จากนั้นเปิดหน้านี้ใหม่')}</p>${steps}`;
  else body = `${steps}<div class="lanqr">${j.qr}<input readonly value="${esc(j.link)}" onclick="this.select()" aria-label="${T('ลิงก์สำหรับมือถือ')}"></div>
    <p class="hint">${T('ลิงก์มีรหัสเข้าใช้ อย่าส่งต่อให้คนนอกวง · ครั้งแรกคอมอาจถามว่าให้รับการเชื่อมต่อไหม ให้กดอนุญาต (Allow) · ผ่าน Wi-Fi แบบนี้ มือถือจะใช้ไมค์อัดเสียงไม่ได้ ส่วนอื่นใช้ได้ครบ')}</p>`;
  $('#docbody').innerHTML = body; $('#docclose').focus();
}
function openDoc(kind) {
  const [title, body] = docHTML(kind);
  $('#docTitle').textContent = title; $('#docbody').innerHTML = body; $('#docdlg').hidden = false; $('#docclose').focus();
}

// ---- consent on first use (Lyrichord Free) ----
const needConsent = () => EDITION === 'free' && store.get('cl-consent') !== '1';
function showConsent() {
  const m = $('#consent'); m.hidden = false;
  $('#cTitle').textContent = `${T('ยินดีต้อนรับสู่')} ${APP_NAME}`;
  document.querySelectorAll('#clang button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === LANG));
  const c = $('#cagree'); c.checked = false; $('#cgo').disabled = true;
}
$('#cagree').addEventListener('change', e => { $('#cgo').disabled = !e.target.checked; });
$('#cgo').addEventListener('click', () => {
  store.set('cl-consent', '1'); $('#consent').hidden = true;
  if (store.get('cl-tour') !== 'done') setTimeout(startTour, 300);
});
$('#clang').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) { setLang(b.dataset.lang); showConsent(); } });

// ---- wiring ----
$('#addbtn').addEventListener('click', () => { if (S.pro) { $('#adds').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('#file').click(); } else openAdd(); });
$('#libbtn2').addEventListener('click', () => { S.libOpen = !S.libOpen; store.set('cl-libopen', S.libOpen ? '1' : '0'); if (S.libOpen) loadLibrary(); else renderLibrary(); });
$('#lanitem').hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname);  // already on a phone
$('#addclose').addEventListener('click', closeAdd);
$('#addback').addEventListener('click', closeAdd);
// choosing a way in closes the window (the file picker opens on top of it)
$('#adds').addEventListener('click', e => { if (S.pro) return; if (e.target.closest('#addmic,#addtab,#adddemo,#libbtn')) closeAdd(); });
$('#file').addEventListener('change', () => closeAdd());
$('#setfile').addEventListener('change', () => closeAdd());
$('#drawclose').addEventListener('click', closeDrawer);
$('#drawback').addEventListener('click', closeDrawer);
$('#lanebtn').addEventListener('click', () => { setDock(S.dock === 'hide' ? 'normal' : 'hide'); laneBtn(); });
$('#prochk').addEventListener('change', e => setPro(e.target.checked));
$('#helpbtn').addEventListener('click', e => { e.stopPropagation(); const p = $('#helppop'); p.hidden = !p.hidden; $('#helpbtn').setAttribute('aria-expanded', !p.hidden); });
document.addEventListener('click', e => {
  const h = e.target.closest('[data-help]');
  if (h) { e.preventDefault(); $('#helppop').hidden = true; $('#helpbtn').setAttribute('aria-expanded', false); if (h.dataset.help === 'tour') startTour(); else if (h.dataset.help === 'lan') openLan(); else openDoc(h.dataset.help); return; }
  if (!e.target.closest('#helppop,#helpbtn')) { $('#helppop').hidden = true; $('#helpbtn').setAttribute('aria-expanded', false); }
});
$('#docclose').addEventListener('click', () => { $('#docdlg').hidden = true; });
$('#docdlg').addEventListener('click', e => { if (e.target.id === 'docdlg') $('#docdlg').hidden = true; });
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#docdlg').hidden) { $('#docdlg').hidden = true; return; }
  if (document.body.classList.contains('add-open')) closeAdd();
  if (!S.pro && document.body.classList.contains('tb-open')) closeDrawer();
});
