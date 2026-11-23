// ================= recording what the mic hears: kept in this browser, saved as a file, analysed like any song =================
const DB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((ok, no) => {
    const r = indexedDB.open('lyrichord', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recs', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const run = (mode, f) => open().then(db => new Promise((ok, no) => {
    const t = db.transaction('recs', mode), q = f(t.objectStore('recs'));
    t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error);
  }));
  return { all: () => run('readonly', st => st.getAll()), put: v => run('readwrite', st => st.put(v)), del: id => run('readwrite', st => st.delete(id)) };
})();
// m4a first (plays everywhere, Safari and newer Chrome record it), then webm / ogg
const REC_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
const recExt = t => /mp4|aac|m4a/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : 'webm';
const mbs = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const recFile = r => r.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.' + recExt(r.type);
let recsLoaded = false;
async function loadRecs() {
  if (recsLoaded) return; recsLoaded = true;
  try { const all = await DB.all(); const have = new Set(S.recs.map(r => r.id)); S.recs = S.recs.concat(all.filter(r => !have.has(r.id))).sort((a, b) => b.at - a.at); } catch {}
  renderRecs();
}
async function startRec(s) {
  if (!window.MediaRecorder) return hint('เบราว์เซอร์นี้อัดเสียงไม่ได้ ลอง Chrome, Edge หรือ Safari รุ่นใหม่', true);
  if (!s.L) { await startLive(s); if (!s.L) return; }
  const type = REC_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const R = { chunks: [], t0: Date.now(), type };
  try { R.mr = new MediaRecorder(new MediaStream(s.L.stream.getAudioTracks()), type ? { mimeType: type, audioBitsPerSecond: 192000 } : {}); }
  catch (e) { console.error(e); return hint('เริ่มอัดเสียงไม่ได้', true); }
  R.mr.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
  R.mr.onstop = () => finishRec(R);
  R.mr.start(1000); s.rec = R;
  R.timer = setInterval(() => { const el = $('#rectime'); if (el && S.active === s.id) el.textContent = fmt((Date.now() - R.t0) / 1000); }, 250);
  renderRecBox(s);
}
function stopRec(s) {
  const R = s.rec; if (!R) return;
  clearInterval(R.timer); R.t1 = Date.now(); s.rec = null;
  try { if (R.mr.state !== 'inactive') R.mr.stop(); else finishRec(R); } catch { finishRec(R); }
  if (S.active === s.id) renderRecBox(s);
}
async function finishRec(R) {
  if (R.done) return; R.done = true;
  const type = ((R.mr && R.mr.mimeType) || R.type || 'audio/webm').split(';')[0], blob = new Blob(R.chunks, { type });
  if (!blob.size) return hint('ไม่มีเสียงถูกอัดไว้', true);
  const d = new Date(R.t0), p2 = n => String(n).padStart(2, '0');
  const rec = { id: 'rec' + R.t0, name: `${T('อัดเสียง')} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`,
    at: R.t0, dur: ((R.t1 || Date.now()) - R.t0) / 1000, type, blob };
  S.recs.unshift(rec);
  let kept = true; try { await DB.put(rec); } catch { kept = false; }
  renderRecs();
  hint(kept ? 'อัดเสียงแล้ว เก็บไว้ในแอปบนเครื่องนี้ กด "บันทึกเป็นไฟล์" เพื่อเก็บลงเครื่อง หรือ "แกะคอร์ด" ได้เลย'
    : 'อัดเสียงแล้ว แต่เบราว์เซอร์นี้ไม่ให้เก็บไว้ในแอป (เช่นโหมดส่วนตัว) กด "บันทึกเป็นไฟล์" ก่อนปิดหน้านี้');
}
function renderRecBox(s) {
  const el = $('#recbox'); if (!el) return;
  el.innerHTML = `<div class="recrow"><button class="recbtn${s.rec ? ' on' : ''}" id="recbtn"><i></i>${s.rec ? 'หยุดอัด' : 'อัดเสียง'}</button>
    <span class="rectime" id="rectime">${s.rec ? fmt((Date.now() - s.rec.t0) / 1000) : ''}</span>
    <span class="hint">อัดเพลงที่ได้ยิน เก็บไว้ในแอป บันทึกเป็นไฟล์ลงเครื่อง หรือส่งไปแกะคอร์ดได้</span></div>
    <div class="reclist" id="reclist"></div>`;
  renderRecs();
}
function renderRecs() {
  const el = $('#reclist'); if (!el) return;
  el.innerHTML = S.recs.length ? S.recs.map(r => `<div class="rec" data-rec="${esc(r.id)}"><div><b title="${esc(r.name)}">${esc(r.name)}</b><small>${fmt(r.dur)} · ${mbs(r.blob.size)} · ${recExt(r.type)}</small></div>
      <div class="acts"><button class="xbtn" data-ra="play">ฟัง</button><button class="xbtn" data-ra="save">บันทึกเป็นไฟล์</button><button class="xbtn" data-ra="use">แกะคอร์ด</button><button class="xbtn" data-ra="del" aria-label="ลบเสียงที่อัด">ลบ</button></div></div>`).join('')
    : '<p class="hint">ยังไม่มีเสียงที่อัดไว้</p>';
}
async function recClick(e) {
  const s = A();
  if (e.target.closest('#recbtn')) { if (s.rec) stopRec(s); else startRec(s); return; }
  const b = e.target.closest('[data-ra]'), row = b && b.closest('[data-rec]'); if (!row) return;
  const r = S.recs.find(x => x.id === row.dataset.rec); if (!r) return;
  const act = b.dataset.ra;
  if (act === 'play') {
    const old = row.querySelector('audio'); if (old) { old.pause(); URL.revokeObjectURL(old.src); old.remove(); return; }
    const au = document.createElement('audio'); au.controls = true; au.src = URL.createObjectURL(r.blob); row.append(au); au.play().catch(() => {});
  } else if (act === 'save') {
    const res = await saveFile(r.blob, recFile(r));
    hint(res === 'saved' ? `${T('บันทึกแล้ว')}: ${recFile(r)}` : 'บันทึกไม่สำเร็จ', res !== 'saved');
  } else if (act === 'use') {
    addFile(new File([r.blob], recFile(r), { type: r.type }));
  } else if (act === 'del') {
    if (!confirm(T('ลบเสียงที่อัดนี้ออกจากแอป? (ไฟล์ที่บันทึกลงเครื่องแล้วยังอยู่)'))) return;
    S.recs = S.recs.filter(x => x !== r); try { await DB.del(r.id); } catch {}
    renderRecs();
  }
}

// ================= song sets (.lyrichord): the analysis, every edit and (optionally) the audio in one JSON file, opens on any device =================
const blobB64 = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(b); });
const b64Blob = (b64, type) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
async function songEntry(s, withAudio) {
  const res = { ...s.res }; delete res.lyrics_pending;
  const e = { name: s.name, kind: s.kind === LINKED ? LINKED : 'file', vid: s.vid || null, res, saved: savedData(s), audio: null };
  if (withAudio && s.url) { try { const b = await (await fetch(s.url)).blob(); e.audio = { type: b.type || 'audio/mpeg', b64: await blobB64(b) }; } catch (err) { console.error(err); } }
  return e;
}
async function exportSet(all) {
  const list = (all ? S.sources : [A()]).filter(s => ready(s) && s.kind !== 'demo');
  if (!list.length) return exHint('ยังไม่มีเพลงที่วิเคราะห์เสร็จให้บันทึก', true);
  const withAudio = $('#setaudio').checked; exHint('กำลังเตรียมไฟล์…');
  const songs = []; for (const s of list) songs.push(await songEntry(s, withAudio));
  const blob = new Blob([JSON.stringify({ lyrichord: 1, app: APP_VERSION, at: new Date().toISOString(), songs })], { type: 'application/json' });
  const name = (list.length === 1 ? list[0].name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'song' : `Lyrichord ${list.length} songs`) + '.lyrichord';
  const r = await saveFile(blob, name);
  exHint(r === 'saved' ? `${T('บันทึกแล้ว')}: ${name} (${mbs(blob.size)})` : 'บันทึกไม่สำเร็จ', r !== 'saved');
}
async function importSet(f) {
  let d; try { d = JSON.parse(await f.text()); } catch { d = null; }
  if (!d || !d.lyrichord || !Array.isArray(d.songs)) return hint(`${f.name}: ${T('ไม่ใช่ไฟล์ชุดเพลงของ Lyrichord')}`, true);
  let n = 0, noAudio = 0;
  for (const e of d.songs) {
    const r = e && e.res;
    if (!r || !Array.isArray(r.chords) || !Array.isArray(r.beats) || r.chords.length !== r.beats.length || !r.key) continue;
    let url = null;
    if (e.audio && e.audio.b64) { try { url = URL.createObjectURL(b64Blob(e.audio.b64, e.audio.type || 'audio/mpeg')); } catch {} }
    if (!url) noAudio++;
    const s = addSource(e.kind === LINKED && e.vid ? LINKED : 'file', String(e.name || T('เพลง')), { vid: e.vid || undefined, imported: true });
    if (!n) switchTo(s.id);
    finish(s, r, url, e.saved && typeof e.saved === 'object' ? e.saved : null); save(s); n++;
  }
  if (!n) return hint(`${f.name}: ${T('ไม่พบเพลงในไฟล์นี้')}`, true);
  hint(`${T('เปิดชุดเพลงแล้ว')} ${n} ${T('เพลง')}` + (noAudio ? ` · ${noAudio} ${T('เพลงไม่มีไฟล์เสียงมาด้วย (ดูและแก้ได้ แต่เล่นตามไม่ได้)')}` : ''));
}

// ================= song library: every song analysed on the Mac, with its edits, from any device (Mac, iPhone, iPad) =================
function syncEdits(s) {
  if (!s || !s.jobId || !S.backend || s.status !== 'ready') return;
  clearTimeout(s.syncT);
  s.syncT = setTimeout(async () => {
    try { await fetch(api(`library/${s.jobId}/edits`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(savedData(s)) }); }
    catch { hint('บันทึกที่แก้ไว้ลง Mac ไม่สำเร็จ (ยังเก็บไว้ในเครื่องนี้)', true); }
  }, 800);
}
async function loadLibrary() {
  if (!S.backend) { S.lib = null; renderLibrary(); return; }
  clearTimeout(loadLibrary.t);
  loadLibrary.t = setTimeout(async () => {
    try { const r = await fetch(api('library')); if (!r.ok) throw 0; S.lib = (await r.json()).songs || []; } catch { S.lib = null; }
    if (S.lib && S.lib.length && store.get('cl-libopen') !== '0' && !loadLibrary.shown) { loadLibrary.shown = true; S.libOpen = true; }
    renderLibrary();
  }, 300);
}
function when(t) {
  if (!t) return '';
  const d = new Date(t * 1000), now = new Date(), p2 = n => String(n).padStart(2, '0'), hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(now) - day(d)) / 864e5);
  return diff === 0 ? `${T('วันนี้')} ${hm}` : diff === 1 ? `${T('เมื่อวาน')} ${hm}` : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
function renderLibrary() {
  const btn = $('#libbtn'), pan = $('#libpanel'); if (!btn) return;
  btn.hidden = !S.lib; $('#libn').textContent = S.lib ? S.lib.length : '';
  btn.setAttribute('aria-expanded', !!S.libOpen);
  pan.hidden = !(S.lib && S.libOpen);
  if (pan.hidden) return;
  if (S.libTab === 'sets') { renderSets(); return; }
  const q = (S.libQ || '').trim().toLowerCase(), open = new Set(S.sources.filter(s => s.jobId).map(s => s.jobId));
  const rows = S.lib.filter(x => !q || (x.title || '').toLowerCase().includes(q));
  $('#liblist').innerHTML = !S.lib.length ? `<p class="hint">${T('ยังไม่มีเพลงในคลัง: เพลงที่แกะแล้วจะถูกเก็บไว้ที่นี่เอง พร้อมทุกอย่างที่แก้')}</p>`
    : !rows.length ? `<p class="hint">${T('ไม่พบเพลงที่ค้นหา')}</p>`
    : rows.map(x => {
      const key = x.key ? MA.name({ root: x.key.root, q: x.key.q, bass: -1 }) : '—';
      const tags = [x.edited ? `<span class="ltag e">${T('แก้ไว้')}</span>` : '', x.lyrics ? `<span class="ltag">${T('มีเนื้อร้อง')}</span>` : '', open.has(x.id) ? `<span class="ltag o">${T('เปิดไว้แล้ว')}</span>` : ''].join('');
      return `<div class="lrow" data-lib="${esc(x.id)}"><span class="ic k-${x.kind === LINKED ? LINKED : 'file'}">${svgI(x.kind === LINKED ? LINKED : 'file')}</span>
        <div class="lmain"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${T('คีย์')} ${key} · ${fmt(x.duration)} · ${x.bpm || '—'} BPM · ${when(x.updated)}</small><span class="ltags">${tags}</span></div>
        <div class="lacts"><button class="sbtn sm pri" data-la="open">${open.has(x.id) ? T('ไปที่เพลง') : T('เปิด')}</button><button class="zb" data-la="ren" aria-label="${T('เปลี่ยนชื่อ')}" title="${T('เปลี่ยนชื่อ')}">✎</button><button class="zb" data-la="del" aria-label="${T('ลบจากคลัง')}" title="${T('ลบจากคลัง')}">🗑</button></div></div>`;
    }).join('');
}
function openLib(id) {
  const ex = S.sources.find(s => s.jobId === id); if (ex) { switchTo(ex.id); return; }
  const x = (S.lib || []).find(v => v.id === id) || { title: id, kind: 'upload' };
  const s = addSource(x.kind === LINKED ? LINKED : 'file', x.title, { server: true, vid: x.vid || undefined, fromLib: true });
  switchTo(s.id); progressOf(s, 'กำลังเปิดจากคลังเพลง', 0.5);
  poll(s, id, null);
}
async function libAction(e) {
  const b = e.target.closest('[data-la]'), row = b && b.closest('[data-lib]'); if (!row) return;
  const id = row.dataset.lib, x = (S.lib || []).find(v => v.id === id); if (!x) return;
  if (b.dataset.la === 'open') { openLib(id); if (innerWidth <= 700) { S.libOpen = false; renderLibrary(); } return; }
  if (b.dataset.la === 'ren') {
    const t = prompt(T('ชื่อเพลง'), x.title); if (!t || !t.trim() || t.trim() === x.title) return;
    const r = await fetch(api('library/' + id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t.trim() }) });
    if (!r.ok) return hint('เปลี่ยนชื่อไม่สำเร็จ', true);
    S.sources.filter(s => s.jobId === id).forEach(s => { s.name = t.trim(); }); renderSources(); loadLibrary(); return;
  }
  if (b.dataset.la === 'del') {
    if (!confirm(`${T('ลบ')} "${x.title}" ${T('ออกจากคลังเพลงถาวร? (ไฟล์เสียงในคลังและทุกอย่างที่แก้จะหายไป ไฟล์ต้นฉบับในเครื่องของคุณไม่เกี่ยว)')}`)) return;
    const r = await fetch(api('library/' + id), { method: 'DELETE' }), j = await r.json().catch(() => ({}));
    if (!r.ok) return hint(T(j.detail) || 'ลบไม่สำเร็จ', true);
    S.sources.filter(s => s.jobId === id).forEach(s => removeSource(s.id));
    hint(`${T('ลบแล้ว')}: ${x.title}`); loadLibrary();
  }
}

// ================= guitar capo: which fret makes the song's chords easiest to hold =================
// open shapes a beginner plays without a barre (root pitch classes per quality); F and Bm are a light barre
const OPEN_SHAPES = { '': [0, 2, 4, 7, 9], m: [2, 4, 9], '7': [0, 2, 4, 7, 9, 11], m7: [2, 4, 9], maj7: [0, 2, 5, 7, 9], sus4: [2, 4, 9], sus2: [2, 9], '2': [0, 2, 7], add9: [0, 2, 7], '6': [0, 2, 7, 9] };
function shapeCost(root, q, bass) {
  const base = MA.baseOf(q);
  let c = (OPEN_SHAPES[q] || []).includes(root) ? 1 : (q === '' && root === 5) || (base === 'm' && q === 'm' && root === 11) ? 2 : q === '' || q === 'm' ? 3 : 3.5;
  if (bass >= 0 && bass !== root) c += 0.4;
  return c;
}
function capoPlan(s) {
  const k = S.level + '|' + trOf(s); if (s.capoPlanK === k) return s.capoPlanV;
  const segs = segsOf(s).flat().filter(g => g.chord.root >= 0), shown = q => S.level === 'very' ? MA.baseOf(q) : S.level === 'plus' ? MA.PLUS[q] ?? q : q;
  const plan = [];
  for (let capo = 0; capo <= 7; capo++) {
    const t = trOf(s) - capo; let sum = 0, n = 0;
    for (const g of segs) { const c = g.chord; sum += g.len * shapeCost(mod(c.root + t), shown(c.q), S.level === 'very' || c.bass < 0 ? -1 : mod(c.bass + t)); n += g.len; }
    // a high capo sounds thin and is less usual: a small cost per fret, more above the 5th
    plan.push({ capo, cost: (n ? sum / n : 0) + 0.03 * capo + (capo > 5 ? 0.3 : 0), key: MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 }, 0, 'very', t) });
  }
  const best = plan.reduce((a, b) => b.cost < a.cost - 1e-9 ? b : a);
  const rec = best.capo && best.cost <= plan[0].cost - 0.3 ? best.capo : 0;  // only when it is clearly easier
  s.capoPlanK = k; s.capoPlanV = { plan, rec };
  return s.capoPlanV;
}
const ease = c => c <= 1.4 ? T('ง่าย') : c <= 2.2 ? T('ปานกลาง') : T('ยาก (ทาบเยอะ)');
function renderCapo() {
  const s = A(), sel = $('#capo'), hb = $('#capohint'), on = S.inst === 'guitar' && ready(s);
  sel.hidden = !on; hb.hidden = true; if (!on) return;
  const { plan, rec } = capoPlan(s), cur = s.capo || 0;
  sel.innerHTML = plan.map(p => `<option value="${p.capo}"${p.capo === cur ? ' selected' : ''}>${p.capo ? `${T('คาโป้')} ${p.capo} · ${T('จับแบบ')} ${p.key}` : `${T('ไม่ใส่คาโป้')} · ${p.key}`} · ${ease(p.cost)}${p.capo === rec ? ' ★' : ''}</option>`).join('');
  if (cur) { hb.hidden = false; hb.className = 'pill capohint on'; hb.textContent = `${T('คาโป้')} ${cur} · ${T('จับแบบ')} ${plan[cur].key} ✕`; hb.title = T('กดเพื่อถอดคาโป้'); }
  else if (rec) { hb.hidden = false; hb.className = 'pill capohint'; hb.textContent = `${T('แนะนำ: คาโป้')} ${rec} ${T('จับแบบ')} ${plan[rec].key} (${T('คอร์ดง่ายขึ้น')})`; hb.title = `${ease(plan[0].cost)} → ${ease(plan[rec].cost)}`; }
}
function setCapo(v) {
  const s = A(); if (!ready(s)) return;
  s.capo = Math.max(0, Math.min(7, v | 0)); S.lastKey = ''; save(s); renderAll();
  hint(s.capo ? `${T('ใส่คาโป้ช่องที่')} ${s.capo}: ${T('ชื่อคอร์ดและรูปจับเป็นท่าที่จับจริง เสียงยังตรงกับเพลง')}` : T('ถอดคาโป้แล้ว'));
}
