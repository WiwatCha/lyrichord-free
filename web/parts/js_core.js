// ================= sources =================
function addSource(kind, name, extra = {}) {
  const s = { id: 'src' + (++S.seq), kind, name, status: 'analyzing', progress: 0, stage: '', res: null, chords: [], orig: [], tr: 0, pos: 0, url: null,
    bars: [], beatBar: [], lv: null, lyrics: [], hist: [], seqNotes: [], ...extra };
  S.sources.push(s); renderSources(); return s;
}
function removeSource(id) {
  const s = S.sources.find(x => x.id === id); if (!s) return;
  if (s.L) stopLive(s);
  if (s.url && s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
  s.dead = true; S.sources = S.sources.filter(x => x.id !== id);
  if (S.active === id) { S.active = null; const n = S.sources[S.sources.length - 1]; if (n) switchTo(n.id); else renderAll(); }
  renderSources();
}
function metaText(s) {
  if (isLive(s)) return s.status === 'live' ? '<span class="pulse"></span>กำลังฟังสด' : `หยุดแล้ว · ${s.seqNotes.length} โน้ต`;
  if (s.status === 'analyzing') return esc(s.stage === 'รอคิว' ? 'รอคิวต่อจากงานก่อนหน้า' : T(s.stage) || 'กำลังวิเคราะห์') + ` ${Math.round(s.progress * 100)}%`;
  if (s.status === 'error') return esc(T(s.error) || 'ผิดพลาด');
  const L = s.lyStat;
  if (L && (L.kind === 'listen' || L.kind === 'relisten')) return `${T('แผ่นโน้ตพร้อม')} · <span class="pulse"></span>${T('ฟังเนื้อร้อง')}${L.p != null ? ' ' + Math.round(L.p * 100) + '%' : ''}`;
  return `${fmt(s.res.duration)} · คีย์ ${MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 })} · ${s.meter.num}/${s.meter.den}`;
}
function renderSources() {
  $('#srcs').innerHTML = S.sources.map(s => `
    <div class="src k-${s.kind}${s.id === S.active ? ' on' : ''}" role="listitem" tabindex="0" data-id="${s.id}" aria-current="${s.id === S.active}">
      ${s.id === S.active ? '<span class="badge">กำลังใช้</span>' : ''}
      <span class="ic">${svgI(s.kind)}</span>
      <span class="nm" title="${esc(s.name)}">${esc(s.name)}</span>
      <button class="x" data-x="${s.id}" aria-label="ลบ ${esc(s.name)}">✕</button>
      <span class="mt${s.status === 'error' ? ' err' : ''}">${metaText(s)}</span>
      ${s.status === 'analyzing' ? `<span class="mini" style="grid-column:2"><i style="width:${Math.round(s.progress * 100)}%"></i></span>` : ''}
    </div>`).join('');  rememberOpen();
}
function switchTo(id) {
  const prev = A(), next = S.sources.find(s => s.id === id); if (!next) return;
  closePops(); stopTap();
  if (prev && prev !== next) { if (isLive(prev) && prev.L) stopLive(prev); if (!isLive(prev)) prev.pos = audio.currentTime || 0; }
  audio.pause();
  S.active = id; S.cur = -2; S.lastKey = '';
  if (ready(next) && next.url) { if (audio.dataset.src !== next.id) { audio.src = next.url; audio.dataset.src = next.id; } try { audio.currentTime = next.pos || 0; } catch {} }
  renderSources(); renderAll(); undoButtons();
}
function renderAll() {
  const s = A();
  $('#sheetview').hidden = !ready(s); $('#liveview').hidden = !isLive(s); $('#waitview').hidden = !(s && !isLive(s) && s.status !== 'ready') && !!s;
  $('#tp').classList.toggle('off', !ready(s));
  $('#lypanel').hidden = !(S.lyPanel && ready(s));
  renderLyStat();
  document.body.classList.toggle('nosong', !s);
  if (!s) { $('#sheetview').hidden = true; $('#waitview').hidden = false; $('#waitview').className = 'wait'; $('#waitview').innerHTML = welcomeHTML(); setNow(null); drawRoll(0); return; }
  const key = s.res ? s.res.key : null;
  $('#key').textContent = key ? MA.name({ root: key.root, q: key.q, bass: -1 }, 0, 'very', s.tr) : '—';
  // the relative major / minor shares every note: say it, so a song starting on F#m in A is not misread
  $('#keyrel').textContent = key ? `(${T(key.q === 'm' ? 'เมเจอร์สัมพันธ์' : 'ไมเนอร์สัมพันธ์')} ${MA.name(key.q === 'm' ? { root: (key.root + 3) % 12, q: '', bass: -1 } : { root: (key.root + 9) % 12, q: 'm', bass: -1 }, 0, 'very', s.tr)})` : '';
  $('#keyv').innerHTML = (key ? MA.name({ root: key.root, q: key.q, bass: -1 }, 0, 'very', s.tr) : '—') + `<small>${s.tr ? (s.tr > 0 ? '+' : '') + s.tr : 'คีย์เดิม'}</small>`;
  $('#bpm').textContent = s.res ? s.res.bpm : '—';
  $('#tsig').textContent = s.meter ? `${s.meter.num}/${s.meter.den}` : '—';
  $('#meter').value = s.meter ? String(s.meter.bpb) : '4';
  $('#eng').textContent = isLive(s) ? 'ฟังสดในเบราว์เซอร์' : !s.res ? (s.server ? 'หลังบ้าน' : 'เบราว์เซอร์') : s.res.engine === 'server' ? (s.res.separated ? 'หลังบ้าน · แยกเสียงแล้ว' : 'หลังบ้าน · ไม่ได้แยกเสียง') + (s.res.chord_engine === 'btc' ? ' · AI คอร์ด' : '') : 'วิเคราะห์ในเบราว์เซอร์';
  const tn = !isLive(s) && s.res && Math.round(s.res.tuning || 0);
  if (tn && Math.abs(tn) >= 8) $('#eng').textContent += ` · ${'ชดเชยจูน'} ${tn > 0 ? '+' : ''}${tn} ${'เซนต์'}`;
  const tb = $('#tunebtn'), canTune = !isLive(s) && s.status === 'ready' && s.res && (s.jobId || s.samples);
  tb.hidden = !canTune; $('#bpmhalf').hidden = $('#bpmdbl').hidden = !canTune;
  if (canTune) { $('#bpmhalf').classList.toggle('on', s.res.tempo === 'half'); $('#bpmdbl').classList.toggle('on', s.res.tempo === 'double'); }
  if (canTune) {
    const on = s.res.tune !== 'off';
    tb.innerHTML = `${'ปรับจูนอัตโนมัติ'}: <b>${on ? 'เปิดอยู่' : 'ปิดอยู่'}</b>`;
    tb.title = on ? 'คอร์ดดูเพี้ยนครึ่งเสียงทั้งเพลง? กดเพื่อแกะใหม่โดยไม่ปรับจูน' : 'กดเพื่อแกะใหม่โดยให้แอปตรวจและปรับจูนเอง';
  }
  if (isLive(s)) { renderLive(); setNow(s.liveCur || null, null, 0, -1, 4); drawRoll(0); return; }
  if (s.status !== 'ready') { renderWait(); setNow(null); drawRoll(0); return; }
  $('#seek').max = s.res.duration;
  renderLyStat(); renderCapo();
  if (STAGE && STAGE.on) renderStageBar();
  if (S.lyPanel) renderLyPanel();
  renderSheet();
}
function renderWait() {
  const s = A(), w = $('#waitview');
  w.className = 'wait k-' + s.kind;
  w.innerHTML = s.status === 'error'
    ? `<div><p class="lab">วิเคราะห์ไม่สำเร็จ</p><p style="margin:0 0 12px">${esc(T(s.error))}</p>${s.retry ? '<button class="sbtn" id="retry">ลองอีกครั้ง</button>' : ''}</div>`
    : `<div class="bigp">${Math.round(s.progress * 100)}%</div><span class="mini"><i style="width:${Math.round(s.progress * 100)}%"></i></span><p style="margin:0">${esc(T(s.stage) || 'กำลังวิเคราะห์')}</p><p class="hint">ระหว่างรอ สลับไปใช้แหล่งเสียงอื่นได้ ผลของแต่ละแหล่งจะไม่ปนกัน</p>`;
  const r = $('#retry'); if (r) r.onclick = () => s.retry();
}
function progressOf(s, stage, p) {
  if (s.dead) return;
  s.stage = stage; s.progress = p;
  const card = document.querySelector(`.src[data-id="${s.id}"]`);
  if (card) { card.querySelector('.mt').innerHTML = metaText(s); const i = card.querySelector('.mini i'); if (i) i.style.width = Math.round(p * 100) + '%'; }
  if (S.active === s.id && s.status === 'analyzing') renderWait();
}

// ================= loading =================
async function analyzeInBrowser(s, samples, sr, url, opts = {}) {
  s.samples = { mono: samples, sr };
  try { finish(s, await MA.analyze(samples, sr, p => progressOf(s, 'กำลังฟังและแกะเพลงในเบราว์เซอร์', p), opts), url); }
  catch (e) { console.error(e); fail(s, 'วิเคราะห์ไม่สำเร็จ'); }
}
async function decode(file) {
  const ab = await file.arrayBuffer(), ac = new OfflineAudioContext(1, 44100, 44100), buf = await ac.decodeAudioData(ab);
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return { mono, sr: buf.sampleRate };
}
async function addFile(f, opts = {}) {
  if (!f) return;
  const s = addSource('file', f.name.replace(/\.[^.]+$/, ''), { server: !!S.backend }), url = URL.createObjectURL(f);
  if (!opts.bg) switchTo(s.id);  // several songs at once: the first one shows, the others wait their turn
  if (S.backend) { s.retry = () => { s.status = 'analyzing'; s.progress = 0; renderAll(); serverUpload(s, f, url); }; return serverUpload(s, f, url, opts.queued); }
  progressOf(s, 'กำลังเปิดไฟล์', 0.02);
  try { const { mono, sr } = await decode(f); await analyzeInBrowser(s, mono, sr, url); }
  catch { URL.revokeObjectURL(url); fail(s, 'เปิดไฟล์นี้ไม่ได้ ลองไฟล์ mp3, wav หรือ m4a'); }
}
async function addDemo() {
  // "Amazing Grace" (public domain): known everywhere, clear chords, 3/4; synthesized in the page, no file needed
  const s = addSource('demo', 'Amazing Grace');
  switchTo(s.id);
  const { samples, sr } = MA.synthGrace();
  const url = URL.createObjectURL(new Blob([MA.toWav(samples, sr)], { type: 'audio/wav' }));
  await analyzeInBrowser(s, samples, sr, url);
  if (!s.lyEdited && !s.lines.length && s.status === 'ready') {
    s.lines = MA.graceLines(); s.lySrc = 'manual'; s.lyFile = ''; s.lyCache = null;
    if (S.active === s.id) renderSheet();
  }
}
// backend address: the page's own server (localhost), or a backend set for the online page (?api=...&key=..., kept)
const API = (() => {
  // the key may also come after # (online page): a home-screen icon keeps it there, and # never reaches a server
  const q = new URLSearchParams(location.search), hk = new URLSearchParams(location.hash.slice(1)).get('key'); let b = q.get('api'), k = q.get('key') ?? hk;
  try {
    if (b !== null) localStorage.setItem('lyricord.api', b); else b = localStorage.getItem('lyricord.api');
    if (k !== null) localStorage.setItem('lyricord.key', k); else k = localStorage.getItem('lyricord.key');
  } catch {}
  if (q.has('api') || q.has('key')) { q.delete('api'); q.delete('key'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); }
  // online page: keep the key in the address (after #) so "Add to Home Screen" saves it; on iPhone a home-screen
  // app does not share Safari's storage, so without this the icon would open without the key
  // the same on another device of the Wi-Fi (the page opened at this computer's network address)
  const remoteHost = !/^(localhost|127\.|\[::1\])/.test(location.hostname) && /^https?:/.test(location.protocol);
  if ((ONLINE_PAGE || remoteHost) && k && hk !== k) history.replaceState(null, '', location.pathname + location.search + '#key=' + encodeURIComponent(k));
  return { base: (b || '').trim().replace(/\/+$/, ''), key: (k || '').trim() };
})();
function apiURL(path) {
  const u = new URL(path, API.base ? API.base + '/' : location.href);
  if (API.key) u.searchParams.set('key', API.key);
  return u.toString();
}
const api = p => apiURL('api/' + p);
function setBackend(base, key) {
  try { localStorage.setItem('lyricord.api', base || ''); localStorage.setItem('lyricord.key', key || ''); } catch {}
  location.reload();
}
// online page: ask our own site where the Mac at home is today (its tunnel address changes at every start).
// The Mac files it under SHA-256(access key); only a device that has the key can look it up.
async function findBackend() {
  if (!ONLINE_PAGE || !API.key || !(window.crypto && crypto.subtle)) return;
  try {
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(API.key)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('where?h=' + h, { cache: 'no-store', signal: ctl.signal }); clearTimeout(to);
    const j = r.ok ? await r.json() : {};
    S.macFound = !!j.url;
    if (j.url && j.url !== API.base) { API.base = j.url; try { localStorage.setItem('lyricord.api', j.url); } catch {} }
  } catch { S.macFound = false; }
}
async function checkBackend() {
  if (!/^https?:/.test(location.protocol)) return null;
  await findBackend();
  if (ONLINE_PAGE && API.key && !API.base) { S.backendErr = 'nomac'; return null; }
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), API.base ? 8000 : 2500);
    const r = await fetch(api('health'), { signal: ctl.signal }); clearTimeout(to);
    if (!r.ok) { S.backendErr = API.base ? 'down' : ''; return null; }
    const j = await r.json();
    if (j && j.ok && j.key_ok === false) { S.backendErr = 'key'; return null; }
    return j && j.ok ? j : null;
  } catch { S.backendErr = API.base ? 'down' : ''; return null; }
}
async function poll(s, id, url) {
  s.jobId = id;
  while (!s.dead) {
    let j;
    try { const r = await fetch(api('jobs/' + id)); j = await r.json(); if (!r.ok) throw new Error(j.detail); }
    catch (e) { return fail(s, (e && e.message) || 'ติดต่อหลังบ้านไม่ได้'); }
    if (j.status === 'done') { if (j.title && s.kind === 'file' && s.fromLib) s.name = j.title; return finish(s, j.result, url || apiURL(j.audio_url), j.edits && Object.keys(j.edits).length ? j.edits : null); }
    if (j.status === 'error') return fail(s, j.error);
    progressOf(s, j.stage, j.progress);
    await new Promise(r => setTimeout(r, 900));
  }
}
// analyse the same song again with other settings: auto-tuning on/off, or beats counted half / double
// (lyrics are kept; chord edits are kept unless the beat grid changes, since they are stored per beat)
async function reanalyze(s, change) {
  if (!s || s.status !== 'ready') return;
  if (s.lyPending) return hint('กำลังฟังเนื้อร้องอยู่ รอให้เสร็จก่อนแล้วค่อยแกะใหม่');
  const opts = { tune: s.res.tune === 'off' ? 'off' : 'auto', tempo: s.res.tempo || 'auto', ...change }, tune = opts.tune;
  if (opts.tempo !== (s.res.tempo || 'auto') && s.skey) {
    let d; try { d = JSON.parse(store.get('cl:' + s.skey) || 'null'); } catch { d = null; }
    if (d) { d.edits = {}; d.sheetChords = null; d.meter = null; store.set('cl:' + s.skey, JSON.stringify(d)); }
    // the Mac's copy too: chord edits are per beat and the beats are about to change
    if (s.jobId && S.backend) { const e = { ...savedData(s), edits: {}, sheetChords: null, meter: null, instAt: null }; try { await fetch(api(`library/${s.jobId}/edits`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) }); } catch {} }
    s.meterUser = false;
  }
  const keep = { lines: s.lines, lySrc: s.lySrc, lyFile: s.lyFile, lyEdited: s.lyEdited }; // lyrics do not depend on the analysis
  s.status = 'analyzing'; s.progress = 0; renderAll();
  if (s.jobId) {
    try {
      const r = await fetch(api(`jobs/${s.jobId}/reanalyze`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }), j = await r.json();
      if (!r.ok) throw new Error(j.detail);
      await poll(s, s.jobId, s.url);
    } catch (e) { fail(s, (e && e.message) || 'ติดต่อหลังบ้านไม่ได้'); }
  } else if (s.samples) await analyzeInBrowser(s, s.samples.mono, s.samples.sr, s.url, opts);
  if (s.status === 'ready') { Object.assign(s, keep); s.lyCache = null; if (S.active === s.id) renderAll(); }
  if (s.status === 'ready') hint('tempo' in change ? `${'แกะใหม่แล้ว'} · ${s.res.bpm} BPM` : tune === 'off' ? 'แกะใหม่แล้ว โดยไม่ปรับจูน' : 'แกะใหม่แล้ว โดยให้แอปตรวจและปรับจูนเอง');
}
async function serverUpload(s, f, url, queued) {
  progressOf(s, 'กำลังส่งไฟล์ไปหลังบ้าน', 0.01);
  try {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(api('jobs/upload'), { method: 'POST', body: fd }), j = await r.json();
    if (queued) queued();  // the server has it in its queue (several songs: the next upload may start)
    if (!r.ok) throw new Error(j.detail);
    if (j.from_library) {
      const open = S.sources.find(x => x !== s && x.jobId === j.id && x.status === 'ready');
      if (open) { removeSource(s.id); switchTo(open.id); URL.revokeObjectURL(url); }
      else await poll(s, j.id, url);
      hint('เพลงนี้เคยแกะไว้แล้ว เปิดจากคลังเพลงพร้อมที่แก้ไว้ (ไม่ต้องรอแกะใหม่)'); return;
    }
    await poll(s, j.id, url);
  } catch (e) { fail(s, (e && e.message) || 'ส่งไฟล์ไม่สำเร็จ'); }
}

// ================= live: mic / tab =================
function addLive(kind) {
  const ex = S.sources.find(s => s.kind === kind);
  const s = ex || addSource(kind, kind === 'mic' ? 'ไมโครโฟน' : 'เสียงจากแท็บ', { status: 'stopped' });
  switchTo(s.id); startLive(s);
}
async function startLive(s) {
  if (s.L) return;
  audio.pause();
  let stream;
  try {
    stream = s.kind === 'mic'
      ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (e) {
    hint(s.kind === 'mic'
      ? 'ใช้ไมค์ไม่ได้: ต้องเปิดแอปผ่าน http://localhost หรือ https:// แล้วกดอนุญาตไมค์ (ในหน้า claude.ai ใช้ไมค์ไม่ได้)'
      : 'แชร์เสียงจากแท็บไม่ได้: ใช้ Chrome บนคอมพิวเตอร์ เลือกแท็บที่เล่นเพลง และติ๊ก "แชร์เสียงในแท็บ"', true);
    s.status = 'stopped'; renderSources(); renderAll(); return;
  }
  if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); hint('ไม่มีเสียงมาด้วย ตอนเลือกแท็บให้ติ๊ก "แชร์เสียงในแท็บ"', true); return; }
  if (S.active !== s.id || s.dead) { stream.getTracks().forEach(t => t.stop()); return; }
  hint('');
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.4; src.connect(an);
  const db = new Float32Array(an.frequencyBinCount), td = new Float32Array(2048);
  const L = { stream, ctx, an, pc: new Array(12).fill(0), bs: new Array(12).fill(0), cand: null, cnt: 0, nCand: -1, nCnt: 0, lastNote: -1, quiet: 0, trail: [], t0: performance.now(), k: 0 };
  s.L = L; s.status = 'live'; renderSources(); renderAll();
  stream.getTracks().forEach(t => t.addEventListener('ended', () => stopLive(s)));
  L.timer = setInterval(() => {
    an.getFloatTimeDomainData(td);
    const m = MA.acfPitch(td, ctx.sampleRate), now = (performance.now() - L.t0) / 1000, ok = m >= 40 && m <= 96;
    L.trail.push({ t: now, m: ok ? m : -1 }); while (L.trail.length && now - L.trail[0].t > 10) L.trail.shift();
    s.liveMidi = ok ? m : -1;
    if (ok) {
      const rm = Math.round(m); L.quiet = 0;
      if (rm === L.nCand) L.nCnt++; else { L.nCand = rm; L.nCnt = 0; }
      if (L.nCnt === 3 && rm !== L.lastNote) { L.lastNote = rm; s.seqNotes.push(rm); if (s.seqNotes.length > 64) s.seqNotes.shift(); if (S.active === s.id) renderSeq(); }
    } else if (++L.quiet > 5) L.lastNote = -1;
    if (++L.k % 2 === 0) {
      an.getFloatFrequencyData(db);
      const { pc, bs } = MA.liveProfiles(db, ctx.sampleRate, an.fftSize);
      for (let k = 0; k < 12; k++) { L.pc[k] = 0.75 * L.pc[k] + 0.25 * pc[k]; L.bs[k] = 0.75 * L.bs[k] + 0.25 * bs[k]; }
      let c = null;
      if (L.pc.reduce((a, b) => a + b, 0) > 0.05) { const b = MA.bestChord(L.pc, L.bs); if (b.score > 0.6) c = { root: b.root, q: S.level === 'advance' ? b.q : S.level === 'plus' ? MA.PLUS[b.q] : MA.baseOf(b.q), bass: -1 }; }
      if (c && L.cand && same(c, L.cand)) L.cnt++; else { L.cand = c; L.cnt = 0; }
      if (c && L.cnt === 3 && !(s.liveCur && same(s.liveCur, c))) { s.liveCur = c; s.hist.push(c); if (s.hist.length > 40) s.hist.shift(); if (S.active === s.id) renderHist(); }
    }
    if (S.active === s.id) { setNow(s.liveCur || null, null, 0, -1, 4); renderTuner(s); drawRoll(0); }
  }, 50);
}
function stopLive(s) {
  const L = s.L; if (!L) return;
  if (s.rec) stopRec(s);
  clearInterval(L.timer); L.stream.getTracks().forEach(t => t.stop()); L.ctx.close();
  s.L = null; s.status = 'stopped'; s.liveMidi = -1;
  renderSources(); if (S.active === s.id) renderAll();
}
function renderLive() {
  const s = A();
  $('#liveview').innerHTML = `
    <div class="ph" style="margin:0"><strong>${s.status === 'live' ? `<span class="pulse k-${s.kind}"></span>กำลังฟังจาก ${s.kind === 'mic' ? 'ไมค์' : 'แท็บ'}` : 'หยุดฟังแล้ว'}</strong>
      <button class="sbtn ${s.status === 'live' ? '' : 'pri'}" id="livebtn">${s.status === 'live' ? 'หยุดฟัง' : 'เริ่มฟังอีกครั้ง'}</button></div>
    <div class="liveg">
      <div class="lc"><p class="lab">โน้ตที่ได้ยินตอนนี้ (แม่น)</p><div class="lnote" id="lnote">—</div><div id="lsol" class="hint" style="font-size:16px">&nbsp;</div>
        <div class="tuner"><i id="needle"></i></div><div class="hint" id="cents">ร้องหรือเล่นทีละโน้ต</div></div>
      <div class="lc"><p class="lab">คอร์ดที่เดาได้ (แม่นน้อยกว่า)</p><div class="seq" id="hist" style="justify-content:center"></div></div>
    </div>
    <div><div class="ph" style="margin:0 0 6px"><p class="lab" style="margin:0">โน้ตที่จับได้ทีละตัว (ล่าสุดอยู่ท้าย)</p><button class="xbtn" id="clrseq">ล้าง</button></div><div class="seq" id="seq"></div></div>
    <p class="note">ระหว่างฟังสด เพลงจากไฟล์จะหยุดเองเพื่อไม่ให้เสียงปนกัน เส้นทำนองแบบสดแสดงในแถบด้านล่าง</p>
    <div class="recbox" id="recbox"></div>`;
  renderRecBox(s); loadRecs();
  $('#livebtn').onclick = () => { if (s.L) stopLive(s); else startLive(s); };
  $('#clrseq').onclick = () => { s.seqNotes = []; renderSeq(); };
  renderSeq(); renderHist(); renderTuner(s);
}
function renderSeq() { const s = A(), el = $('#seq'); if (!el) return; el.innerHTML = s.seqNotes.length ? s.seqNotes.slice(-32).map(m => `<span>${NAMES[mod(m)]}<small>${T(SOL[mod(m)])}</small></span>`).join('') : '<span class="hint" style="background:none;font-weight:400;font-size:13px">ยังไม่มีโน้ต</span>'; }
function renderHist() { const s = A(), el = $('#hist'); if (!el) return; el.innerHTML = s.hist.length ? s.hist.slice(-12).map(c => `<span style="color:hsl(${hue(c.root)} 80% 70%)">${nm(c, s)}</span>`).join('') : '<span class="hint" style="background:none;font-weight:400;font-size:13px">ยังไม่ได้ยินคอร์ด</span>'; }
function renderTuner(s) {
  const el = $('#lnote'); if (!el) return;
  const m = s.liveMidi ?? -1;
  if (m < 0) { el.textContent = '—'; $('#lsol').innerHTML = '&nbsp;'; $('#needle').style.left = '50%'; $('#cents').textContent = 'ร้องหรือเล่นทีละโน้ต'; return; }
  const rm = Math.round(m), c = Math.round((m - rm) * 100);
  el.textContent = NAMES[mod(rm)] + (Math.floor(rm / 12) - 1); $('#lsol').textContent = T(SOL[mod(rm)]);
  $('#needle').style.left = `calc(${50 + c}% - 2px)`;
  $('#cents').textContent = Math.abs(c) <= 10 ? 'ตรงเสียงแล้ว' : c < 0 ? `ต่ำไป ${-c} เซนต์` : `สูงไป ${c} เซนต์`;
}

// ================= diagrams =================
const DCOL = { ink: 'var(--ink)', mut: 'var(--mut)', card: 'var(--card)' };
function chordPcs(c, s) {
  const tr = ctr(s), q = S.level === 'very' ? MA.baseOf(c.q) : c.q;
  return MA.QS.find(x => x.q === q).ivs.map(([iv]) => mod(c.root + tr + iv));
}
function piano(c, o = {}) {
  const col = o.col || DCOL, s = A(), W = 24, H = 120, wk = [0,2,4,5,7,9,11], bk = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
  const VH = o.bare ? H + 2 : H + 22;
  if (!c || c.root < 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * 14 + 2} ${VH}"></svg>`;
  const tones = chordPcs(c, s), root = mod(c.root + ctr(s)), bass = S.level !== 'very' && c.bass >= 0 ? mod(c.bass + ctr(s)) : root;
  const hc = d => `hsl(${hue(root)} 62% ${d}%)`;
  let o2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * 14 + 2} ${VH}" role="img" aria-label="ตำแหน่งบนเปียโน" font-family="sans-serif">`;
  const on = (oc, pc) => oc === 0 ? pc === bass : tones.includes(pc);
  for (let oc = 0; oc < 2; oc++) wk.forEach((pc, i) => {
    const x = 1 + (oc * 7 + i) * W, h = on(oc, pc);
    o2 += `<rect x="${x}" y="1" width="${W}" height="${H}" rx="3" fill="${h ? hc(50) : (o.col ? '#fff' : col.card)}" stroke="${col.mut}" stroke-width=".8"/>`;
    if (h) o2 += `<text x="${x + W / 2}" y="${H - 10}" font-size="12" font-weight="700" text-anchor="middle" fill="#fff">${NAMES[pc]}</text>`;
  });
  for (let oc = 0; oc < 2; oc++) for (const pc in bk) {
    const x = 1 + (oc * 7 + bk[pc]) * W + W * 0.66, h = on(oc, +pc);
    o2 += `<rect x="${x}" y="1" width="${W * 0.68}" height="${H * 0.6}" rx="2" fill="${h ? hc(36) : col.ink}"/>`;
    if (h) o2 += `<text x="${x + W * 0.34}" y="${H * 0.6 - 8}" font-size="9" font-weight="700" text-anchor="middle" fill="#fff">${NAMES[pc]}</text>`;
  }
  if (!o.small) o2 += `<text x="${W * 3.5}" y="${H + 17}" font-size="12" text-anchor="middle" fill="${col.mut}">มือซ้าย (เบส)</text><text x="${W * 10.5}" y="${H + 17}" font-size="12" text-anchor="middle" fill="${col.mut}">มือขวา (คอร์ด)</text>`;
  return o2 + '</svg>';
}
const OPEN = [40, 45, 50, 55, 59, 64], voiceCache = {};
function voicing(c, s) {
  const tr = ctr(s), root = mod(c.root + tr), q = S.level === 'very' ? MA.baseOf(c.q) : c.q;
  const bass = S.level !== 'very' && c.bass >= 0 ? mod(c.bass + tr) : root, key = root + q + '/' + bass;
  if (key in voiceCache) return voiceCache[key];
  if ((q === '' || q === 'm') && bass === root) return (voiceCache[key] = SHAPES[q][root]);
  const tones = MA.QS.find(x => x.q === q).ivs.map(([iv]) => mod(root + iv));
  const optional = new Set([mod(root + 7)]); if (/11|13/.test(q)) optional.add(mod(root + 2)); if (q === '13') optional.add(mod(root + 5));
  const need = tones.filter(t => !optional.has(t)); if (!tones.includes(bass)) tones.push(bass);
  let best = null, bestScore = Infinity;
  for (let base = 1; base <= 10; base++) {
    const opts = OPEN.map(o => { const a = [-1]; if (tones.includes(mod(o))) a.push(0); for (let f = base; f < base + 4; f++) if (tones.includes(mod(o + f))) a.push(f); return a; });
    const cur = [];
    const rec = i => {
      if (i === 6) {
        const snd = cur.map((f, k) => f < 0 ? -1 : OPEN[k] + f), on = snd.filter(v => v >= 0);
        if (on.length < 4) return;
        const first = cur.findIndex(f => f >= 0); if (cur.slice(first, 5).some(f => f < 0)) return;
        if (mod(snd[first]) !== bass) return;
        const pcs = new Set(on.map(mod)); if (!need.every(t => pcs.has(t))) return;
        const fr = cur.filter(f => f > 0); if (!fr.length && base > 1) return;
        const mn = fr.length ? Math.min(...fr) : 0, mx = fr.length ? Math.max(...fr) : 0;
        const fingers = fr.length - Math.max(0, fr.filter(f => f === mn).length - 1); if (fingers > 4 || mx - mn > 3) return;
        const sc = mn * 0.9 + (mx - mn) * 0.6 - on.length * 0.7 - cur.filter(f => f === 0).length * 0.3 + fingers * 0.25 - [...pcs].filter(t => optional.has(t)).length * 0.3;
        if (sc < bestScore) { bestScore = sc; best = cur.slice(); }
        return;
      }
      for (const f of opts[i]) { cur.push(f); rec(i + 1); cur.pop(); }
    };
    rec(0);
  }
  return (voiceCache[key] = best);
}
function guitar(c, o = {}) {
  const col = o.col || DCOL, s = A();
  if (!c || c.root < 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 200"></svg>`;
  const f = voicing(c, s);
  if (!f) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 200" font-family="sans-serif"><text x="85" y="100" font-size="12" text-anchor="middle" fill="${col.mut}">ไม่มีท่าจับง่ายๆ</text></svg>`;
  const pos = f.filter(v => v > 0), mx = pos.length ? Math.max(...pos) : 0;
  const base = mx > 4 ? Math.min(...pos) : 1, X0 = 30, DX = 24, Y0 = 34, DY = 30;
  const hc = `hsl(${hue(c.root + ctr(s))} 62% 44%)`;
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 ${o.small ? 190 : 200}" role="img" aria-label="วิธีจับคอร์ดกีตาร์" font-family="sans-serif">`;
  g += base === 1 ? `<rect x="${X0}" y="${Y0 - 5}" width="${DX * 5}" height="6" fill="${col.ink}"/>` : `<text x="${X0 - 10}" y="${Y0 + DY / 2 + 5}" font-size="14" text-anchor="end" fill="${col.mut}">${base}</text>`;
  for (let i = 0; i <= 5; i++) g += `<line x1="${X0}" x2="${X0 + DX * 5}" y1="${Y0 + i * DY}" y2="${Y0 + i * DY}" stroke="${col.mut}" stroke-width="1"/>`;
  for (let i = 0; i < 6; i++) g += `<line x1="${X0 + i * DX}" x2="${X0 + i * DX}" y1="${Y0}" y2="${Y0 + 5 * DY}" stroke="${col.mut}" stroke-width="${1.8 - i * 0.2}"/>`;
  f.forEach((v, i) => {
    const x = X0 + i * DX;
    if (v < 0) g += `<text x="${x}" y="${Y0 - 12}" font-size="15" text-anchor="middle" fill="${col.mut}">×</text>`;
    else if (v === 0) g += `<circle cx="${x}" cy="${Y0 - 17}" r="6" fill="none" stroke="${col.mut}" stroke-width="1.6"/>`;
    else g += `<circle cx="${x}" cy="${Y0 + (v - base + 0.5) * DY}" r="10.5" fill="${hc}"/><text x="${x}" y="${Y0 + (v - base + 0.5) * DY + 4}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${NAMES[mod(OPEN[i] + v)]}</text>`;
    if (!o.small && v >= 0) g += `<text x="${x}" y="${Y0 + 5 * DY + 18}" font-size="11" text-anchor="middle" fill="${col.mut}">${NAMES[mod(OPEN[i] + v)]}</text>`;
  });
  return g + '</svg>';
}
function setNow(c, nextC, until, pos, len) {
  const s = A(), big = $('#big'), dc = c && c.root >= 0 ? c : nextC, k = (c ? nm(c) : '') + '>' + (dc ? nm(dc) : '') + '|' + ctr(s) + S.level + S.inst;
  if (k !== S.lastKey) {
    S.lastKey = k;
    const lab = c && c.root >= 0 ? nm(c) : '—', rn = c && c.root >= 0 && s && s.res && S.level !== 'advance' ? MA.roman(c, s.res.key) : '';
    big.innerHTML = `<span class="fn">${esc(lab)}</span>${rn ? `<span class="rn">${rn}</span>` : ''}`;
    big.className = 'big ' + (!c || c.root < 0 ? 'nc' : minorish(c) ? 'mi' : '');
    if (c) big.style.setProperty('--h', hue(c.root + ctr(s)));
    fitBig();
    $('#diag').className = 'diag ' + (S.inst === 'guitar' ? 'gtr' : 'pno');
    $('#diag').innerHTML = S.inst === 'piano' ? piano(dc, { col: LIGHT, small: true, bare: true }) : guitar(dc, { col: LIGHT, small: true });
    $('#diag').parentElement.hidden = !(dc && dc.root >= 0);
    $('#tones').textContent = dc && dc.root >= 0 ? (dc !== c ? `เตรียมคอร์ดแรก ${nm(dc)} · ` : '') + 'โน้ตในคอร์ด: ' + MA.QS.find(x => x.q === (S.level === 'very' ? MA.baseOf(dc.q) : S.level === 'plus' ? MA.PLUS[dc.q] ?? dc.q : dc.q)).ivs.map(([iv]) => `${NAMES[mod(dc.root + iv + ctr(s))]} (${IV_NAME[iv]})`).join(' · ') : '';
    $('#mnow').textContent = lab;
  }
  const nl = nextC ? nm(nextC) : '—';
  $('#nextc').textContent = nl; $('#mnext').textContent = nextC ? '→ ' + nl : '';
  $('#nexttxt').textContent = nextC && until ? `ถัดไปในอีก ${until} จังหวะ` : 'ถัดไป';
  $('#dots').innerHTML = pos >= 0 ? Array.from({ length: len || 4 }, (_, i) => `<i class="${i === pos ? 'on' : ''}"></i>`).join('') : '';
}
// the chord name fills the card: largest size that fits its width (same look for C, Asus4 and F#m7b5)
function fitBig() {
  const fn = $('#big .fn'); if (!fn) return;
  fn.style.fontSize = ''; let size = parseFloat(getComputedStyle(fn).fontSize);
  while (fn.scrollWidth > fn.clientWidth + 1 && size > 12) { size -= 1; fn.style.fontSize = size + 'px'; }
}

// ================= playback sync =================
function beatAt(s, t) {
  const b = s.res.beats; let lo = 0, hi = b.length - 1;
  if (t < b[0]) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
  return lo;
}
const noteAt = (s, t) => { for (const x of s.res.notes) if (x.t0 <= t && t < x.t1) return x.midi; return -1; };
const probe = document.createElement('span'); probe.hidden = true; document.body.append(probe);
function cssColor(v) { probe.style.color = `var(${v})`; probe.hidden = false; const c = getComputedStyle(probe).color; probe.hidden = true; return c; }
function drawRoll(t) {
  const cv = $('#roll'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const s = A(), ink = cssColor('--ink'), mut = cssColor('--mut'), line = cssColor('--line');
  const NV = document.body.classList.contains('navy'), HEAD = NV ? '#2ed3c6' : '#ff2f68', HEADG = NV ? 'rgb(46 211 198/.8)' : 'rgb(255 47 104/.8)';
  g.textBaseline = 'middle';
  const LEFT = 40, TOP = 24;
  const lanes = (lo, hi, Y) => {
    g.font = '500 12px "IBM Plex Sans Thai",sans-serif';
    const step = (H - TOP) / (hi - lo) < 15 ? 12 : 1;
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const nat = [0, 2, 4, 5, 7, 9, 11].includes(mod(m + trOf(s))); if (!nat || (step === 12 && mod(m + trOf(s)) !== 0)) continue;
      g.strokeStyle = line; g.globalAlpha = mod(m + trOf(s)) === 0 ? 1 : 0.45; g.beginPath(); g.moveTo(LEFT, Y(m)); g.lineTo(W, Y(m)); g.stroke(); g.globalAlpha = 1;
      if (mod(m + trOf(s)) === 0 || (H - TOP) / (hi - lo) >= 15) { g.fillStyle = mut; g.fillText(NAMES[mod(m + trOf(s))] + (mod(m + trOf(s)) === 0 ? Math.floor((m + trOf(s)) / 12) - 1 : ''), 4, Y(m)); }
    }
  };
  if (s && isLive(s)) {
    const tr = s.L ? s.L.trail : [], now = tr.length ? tr[tr.length - 1].t : 0, span = 8, lo = 45, hi = 84;
    const X = v => LEFT + (v - (now - span)) / span * (W - LEFT - 10), Y = m => TOP + (hi - m) / (hi - lo) * (H - TOP - 6);
    lanes(lo, hi, Y);
    g.strokeStyle = HEAD; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath(); let pen = false;
    for (const p of tr) { if (p.m < 0) { pen = false; continue; } if (!pen) { g.moveTo(X(p.t), Y(p.m)); pen = true; } else g.lineTo(X(p.t), Y(p.m)); }
    g.stroke();
    if (s.liveMidi >= 0) { g.fillStyle = ink; g.font = '700 16px "Bai Jamjuree",sans-serif'; g.fillText(NAMES[mod(Math.round(s.liveMidi))], Math.min(W - 30, X(now) + 8), Y(s.liveMidi)); }
    if (!tr.length) { g.fillStyle = mut; g.font = '14px "IBM Plex Sans Thai",sans-serif'; g.fillText('กดเริ่มฟัง แล้วร้องหรือเล่นทีละโน้ต', LEFT + 8, H / 2); }
    return;
  }
  if (!ready(s)) { g.fillStyle = mut; g.font = '14px "IBM Plex Sans Thai",sans-serif'; g.fillText('ยังไม่มีทำนอง', 12, H / 2); return; }
  // r18 play-along lane, top to bottom: chord blocks, the lyrics where they are sung, the melody (piano keys on the left)
  const tr = ctr(s), notes = s.res.notes, span = W < 520 ? 5 : W < 900 ? 8 : 10, t0 = t - span * 0.3, t1 = t0 + span;
  const lyWait = !s.lines.length && s.lyStat && s.lyStat.kind === 'listen';
  const CH = H < 190 ? 30 : H < 320 ? 40 : 52, LY = s.lines.length || lyWait ? (H < 190 ? 22 : H < 320 ? 28 : 34) : 0, RT = CH + LY + 4, KL = 40;
  let lo = 127, hi = 0; for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
  if (lo > hi) { lo = 60; hi = 72; } if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = Math.ceil(c + 6); }
  lo -= 1; hi += 1;
  const X = v => KL + (v - t0) / span * (W - KL), Y = m => RT + (hi - m) / (hi - lo) * (H - RT - 6), rowH = (H - RT - 6) / (hi - lo);
  // piano keys: one row per semitone, C labelled
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const pc = mod(m + trOf(s)), blk = [1, 3, 6, 8, 10].includes(pc), y = Y(m) - rowH / 2;
    g.fillStyle = blk ? (NV ? '#1b2c4d' : '#1a1e27') : (NV ? '#dfe8f7' : '#e6eaf1'); g.fillRect(2, y, KL - 8, Math.max(1, rowH - 0.5));
    if (pc === 0 && rowH >= 7) { g.fillStyle = '#0b0d12'; g.font = `500 ${Math.min(11, rowH + 2)}px "Bai Jamjuree",sans-serif`; g.fillText(NAMES[0] + (Math.floor((m + trOf(s)) / 12) - 1), 5, Y(m)); }
    if (!blk) { g.strokeStyle = line; g.globalAlpha = pc === 0 ? 0.9 : 0.35; g.beginPath(); g.moveTo(KL, Y(m)); g.lineTo(W, Y(m)); g.stroke(); g.globalAlpha = 1; }
  }
  const b = s.res.beats;
  // beat and bar lines
  for (let i = Math.max(0, beatAt(s, t0)); i < b.length && b[i] <= t1; i++) {
    const x = X(b[i]); if (x < KL) continue; const bar = s.bars[s.beatBar[i]], first = bar && bar[0] === i;
    g.strokeStyle = first ? 'rgb(255 255 255/.22)' : 'rgb(255 255 255/.06)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  // chord blocks: the one sounding now outlined and larger, the ones played already dimmed
  g.save(); g.beginPath(); g.rect(KL, 0, W - KL, CH); g.clip();
  s.bars.forEach((bar, bi) => {
    const st = b[bar[0]]; if (st > t1 || (b[bar[bar.length - 1] + 1] ?? s.res.duration) < t0) return;
    for (const sg of segsOf(s)[bi]) {
      const c = sg.chord; if (c.root < 0) continue;
      const ta = b[sg.start], tb = b[sg.start + sg.len] ?? s.res.duration, x0 = X(ta) + 2, x1 = X(tb) - 2, now = ta <= t && t < tb, past = tb <= t;
      if (x1 < KL || x0 > W) continue;
      g.globalAlpha = past ? 0.35 : 1; g.fillStyle = `hsl(${hue(c.root + tr)} 78% 66%)`;
      g.beginPath(); g.roundRect(x0, 4, Math.max(4, x1 - x0), CH - 8, 9); g.fill();
      if (now) { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke(); }
      const lab = nm(c, s), fs = Math.round((CH - 8) * (now ? 0.62 : 0.5));
      g.font = `700 ${fs}px "Bai Jamjuree",sans-serif`; g.fillStyle = '#0b0d12';
      if (g.measureText(lab).width < x1 - x0 - 8) g.fillText(lab, Math.max(KL + 4, x0 + 8), CH / 2);
      g.globalAlpha = 1;
    }
  });
  g.restore();
  // lyrics under the chords: each word at the time it is sung (the word being sung bold and white)
  if (LY && lyWait) {
    g.fillStyle = 'rgb(124 196 255/.07)'; g.fillRect(KL, CH, W - KL, LY);
    g.font = `500 ${Math.round(LY * 0.48)}px "IBM Plex Sans Thai",sans-serif`; g.fillStyle = 'rgb(124 196 255/.85)';
    g.fillText(`${T('กำลังฟังเนื้อร้อง')}${s.lyStat.p != null ? ' ' + Math.round(s.lyStat.p * 100) + '%' : ''} · ${T('เนื้อร้องจะขึ้นตรงนี้เมื่อฟังเสร็จ')}`, KL + 10, CH + LY / 2 + 1);
  } else if (LY) {
    g.fillStyle = 'rgb(255 255 255/.03)'; g.fillRect(KL, CH, W - KL, LY);
    const fsL = Math.round(LY * 0.52), words = [];
    s.lines.forEach((ln, k) => {
      const [la, lb] = lineSpan(s, k); if (lb < t0 - 2 || la > t1) return;
      const ws = segWords(ln.text), ts = []; let off = 0; for (const w of ws) { ts.push(charTime(s, k, off)); off += w.length; }
      ws.forEach((w, j) => { if (w.trim()) words.push({ w: w.trim(), a: ts[j], b: j + 1 < ws.length ? ts[j + 1] : lb }); });
    });
    // a word that would run into the one before it is left out (the word being sung always shows)
    let lastEnd = -1e9;
    for (const o of words) {
      const x = Math.max(KL + 2, X(o.a) + 2); if (x > W) break;
      const now = o.a <= t && t < o.b;
      g.font = `${now ? 700 : 400} ${fsL}px "IBM Plex Sans Thai",sans-serif`;
      const wd = g.measureText(o.w).width;
      if (X(o.b) < KL || (!now && x < lastEnd + 6)) continue;
      g.fillStyle = now ? '#fff' : o.b <= t ? 'rgb(201 208 221/.45)' : mut;
      g.fillText(o.w, x, CH + LY / 2 + 1); lastEnd = x + wd;
    }
    g.strokeStyle = line; g.beginPath(); g.moveTo(KL, CH + LY); g.lineTo(W, CH + LY); g.stroke();
  }
  g.strokeStyle = line; g.beginPath(); g.moveTo(KL, CH); g.lineTo(W, CH); g.stroke();
  const nh = Math.max(12, Math.min(24, rowH - 1));
  for (const n of notes) {
    if (n.t1 < t0 || n.t0 > t1) continue;
    const i = beatAt(s, (n.t0 + n.t1) / 2), sg = i >= 0 ? segAt(s, i) : null, c = sg && sg.chord;
    const inChord = c && c.root >= 0 && MA.tones(c, lmode()).includes(mod(n.midi));
    const x = Math.max(KL, X(n.t0)), w = Math.max(4, X(n.t1) - x - 1), y = Y(n.midi), active = n.t0 <= t && t < n.t1, past = n.t1 <= t;
    g.fillStyle = active ? '#7be05a' : inChord ? `hsl(${hue(c.root + tr)} 62% 50%)` : mut;
    g.globalAlpha = active ? 1 : past ? 0.4 : 0.88;
    if (active) { g.shadowColor = 'rgb(123 224 90/.8)'; g.shadowBlur = 12; }
    g.beginPath(); g.roundRect(x, y - nh / 2, w, nh, 4); g.fill(); g.shadowBlur = 0; g.globalAlpha = 1;
    const lab = noteName(n.midi);
    g.font = `700 ${active ? 14 : 12}px "Bai Jamjuree",sans-serif`;
    if (w > 24) { g.fillStyle = active ? '#0b0d12' : '#fff'; g.fillText(lab, x + 5, y + 1); } else if (!past) { g.fillStyle = ink; g.fillText(lab, x, y - nh / 2 - 7); }
  }
  const px = X(t); g.strokeStyle = HEAD; g.lineWidth = 2; g.shadowColor = HEADG; g.shadowBlur = 10; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.shadowBlur = 0;
}
let raf = 0;
const loop = () => { tick(); raf = audio.paused ? 0 : requestAnimationFrame(loop); };
const setPlayIcon = () => { $('#pi').innerHTML = audio.paused ? '<path d="M7 4l13 8-13 8z"/>' : '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; $('#play').setAttribute('aria-label', audio.paused ? 'เล่น' : 'หยุด'); };
audio.addEventListener('play', () => { setPlayIcon(); if (!raf) raf = requestAnimationFrame(loop); });
audio.addEventListener('pause', () => { setPlayIcon(); tick(); });
audio.addEventListener('seeked', () => tick(true));
audio.addEventListener('loadedmetadata', () => tick(true));
audio.addEventListener('ended', setPlayIcon);
async function togglePlay() {
  const s = A(); if (!ready(s)) return;
  if (!s.url) return hint('ชุดเพลงนี้ไม่ได้รวมไฟล์เสียงมา จึงเล่นตามไม่ได้ (ดู แก้ และส่งออกได้ตามปกติ)', true);
  if (audio.dataset.src !== s.id) { audio.src = s.url; audio.dataset.src = s.id; }
  try { if (audio.paused) await audio.play(); else audio.pause(); } catch { hint('เบราว์เซอร์ไม่ยอมเล่นเสียง ลองกดอีกครั้ง', true); }
}

// ================= chord editor =================
function closePops() { $('#ed').hidden = true; S.edit = null; if ($('#led')) closeLed(); }
function placePop(pop, anchor) {
  const wr = $('#sheetcard').getBoundingClientRect(), cr = anchor.getBoundingClientRect();
  pop.hidden = false;
  pop.style.top = (cr.bottom - wr.top + 6) + 'px';
  pop.style.left = Math.max(4, Math.min(cr.left - wr.left, wr.width - pop.offsetWidth - 4)) + 'px';
}
function openEd(chip) {
  const s = A(), st = +chip.dataset.s, len = +chip.dataset.len, seg = segAt(s, st);
  closePops();
  S.edit = { beats: [...Array(len).keys()].map(k => st + k), c: { ...(seg ? seg.chord : s.chords[st]) }, twins: twinBeats(s, st, len), rep: store.get('cl-rep') !== '0' };
  drawEd(); placePop($('#ed'), chip);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) $('#edtxt').focus({ preventScroll: true });
}
// the same spot in every other row that repeats this row's progression (rows compared at the "very simple" level)
function twinBeats(s, st, len) {
  const bi = s.beatBar[st]; if (bi == null) return [];
  const r = Math.floor(bi / 4), p = bi - r * 4, off = st - s.bars[bi][0];
  const key = rr => s.lv.very.slice(rr * 4, rr * 4 + 4).map(b => b[0].chord.root < 0 ? 'N' : b[0].chord.root + MA.baseOf(b[0].chord.q)).join(',');
  const k0 = key(r), out = [];
  if (!k0.replace(/N|,/g, '')) return out;
  for (let rr = 0; rr * 4 < s.bars.length; rr++) {
    if (rr === r || key(rr) !== k0) continue;
    const b2 = s.bars[rr * 4 + p]; if (!b2 || b2.length !== s.bars[bi].length) continue;
    out.push([...Array(len).keys()].map(k => b2[off + k]).filter(i => i != null));
  }
  return out;
}
// quick choices in the chord editor: what the AI almost chose for these beats, and the chords of the song's key
function aiAlts(s, beats, cur) {
  const A = s.res.alts; if (!A || !beats.length) return [];
  const sum = new Map();
  for (const i of beats) for (const [r, m, p] of A[i] || []) { const k = r * 2 + m; sum.set(k, (sum.get(k) || 0) + p / beats.length); }
  const curK = cur.root < 0 ? -1 : cur.root * 2 + (minorish(cur) ? 1 : 0);
  return [...sum.entries()].filter(([k, p]) => k !== curK && p >= 0.1).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, p]) => ({ c: { root: k >> 1, q: k & 1 ? 'm' : '', bass: -1 }, p }));
}
function keyChords(s) {
  const k = s.res.key, minor = k.q === 'm';
  const steps = minor ? [[0, 'm'], [3, ''], [5, 'm'], [7, 'm'], [7, ''], [8, ''], [10, '']] : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm']];
  return steps.map(([d, q]) => ({ root: mod(k.root + d), q, bass: -1 }));
}
function drawEd() {
  const s = A(), c = S.edit.c, disp = c.root < 0 ? -1 : mod(c.root + ctr(s)), qs = LV_Q[S.level];
  const curQ = S.level === 'very' ? MA.baseOf(c.q) : S.level === 'plus' ? MA.PLUS[c.q] : c.q;
  const same2 = (a, b) => a.root === b.root && MA.baseOf(a.q) === MA.baseOf(b.q);
  const alts = aiAlts(s, S.edit.beats, s.chords[S.edit.beats[0]] || c), kc = keyChords(s);
  const qb = (x, i, kind, extra = '') => `<button data-${kind}="${i}" class="${kind === 'ai' ? 'ai' : ''}${c.root >= 0 && same2(c, x) ? ' sel' : ''}">${esc(nm(x, s))}${extra}</button>`;
  $('#ed').innerHTML = `<strong>แก้คอร์ด</strong> <span class="hint">(${{ very: 'พื้นฐาน', plus: 'มาตรฐาน', advance: 'ละเอียด' }[S.level]})</span>
    <input class="txt" id="edtxt" placeholder="พิมพ์ชื่อคอร์ด เช่น F#m7 แล้วกด Enter" autocomplete="off" autocapitalize="characters" spellcheck="false">
    ${alts.length ? `<div class="qrow"><span class="lab2">AI แนะนำ</span>${alts.map((a, i) => qb(a.c, i, 'ai', `<small>${Math.round(a.p * 100)}%</small>`)).join('')}</div>` : ''}
    <div class="qrow"><span class="lab2">คอร์ดในคีย์</span>${kc.map((x, i) => qb(x, i, 'kc')).join('')}</div>
    <div class="g">${NAMES.map((n, r) => `<button data-r="${r}" class="${r === disp ? 'sel' : ''}">${n}</button>`).join('')}</div>
    <div class="qg">${qs.map(q => `<button data-q="${q}" class="${c.root >= 0 && q === curQ ? 'sel' : ''}">${T(QLABEL[q]) ?? q}</button>`).join('')}<button data-q="N" class="${c.root < 0 ? 'sel' : ''}">ไม่มีคอร์ด</button></div>
    ${S.level !== 'very' ? `<label class="hint" style="display:flex;gap:8px;align-items:center">โน้ตเบส <select id="edbass"><option value="-1">ตามราก</option>${NAMES.map((n, r) => `<option value="${r}"${c.bass >= 0 && mod(c.bass + ctr(s)) === r ? ' selected' : ''}>/${n}</option>`).join('')}</select></label>` : ''}
    ${S.edit.twins.length ? `<label class="chk" style="margin-top:6px"><input type="checkbox" id="edrep" ${S.edit.rep ? 'checked' : ''}> แก้ทุกท่อนที่ซ้ำกันด้วย (อีก ${S.edit.twins.length} จุด)</label>` : ''}
    <div class="acts"><button data-act="reset">คืนค่าเดิม</button><button data-act="done" class="sel">เสร็จ</button></div>`;
  S.edit.alts = alts; S.edit.kc = kc;
  const rp = $('#edrep'); if (rp) rp.onchange = () => { S.edit.rep = rp.checked; store.set('cl-rep', rp.checked ? '1' : '0'); };
  const sel = $('#edbass'); if (sel) sel.onchange = () => { c.bass = +sel.value < 0 ? -1 : mod(+sel.value - ctr(s)); applyEd(); };
  const tx = $('#edtxt');
  tx.onkeydown = e => {
    if (e.key === 'Escape') { closePops(); return; }
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = tx.value.trim(); if (!v) return;
    if (/^(n|nc|n\.c\.?|-|—)$/i.test(v)) { Object.assign(c, { root: -1, q: '', bass: -1 }); applyEd(); return; }
    const p = parseChordName(v.charAt(0).toUpperCase() + v.slice(1));
    if (!p) { hint(`อ่านชื่อคอร์ด "${v}" ไม่ออก ลองแบบ Am, F#m7, G/B`, true); return; }
    Object.assign(c, { root: mod(p.root - ctr(s)), q: p.q, bass: p.bass < 0 ? -1 : mod(p.bass - ctr(s)) }); applyEd();
    hint(`เปลี่ยนเป็น ${nm(c, s)} แล้ว`);
  };
}
function applyEd() {
  const s = A(), E = S.edit, top = $('#ed').style.top, left = $('#ed').style.left;
  E.beats.concat(E.rep ? E.twins.flat() : []).forEach(i => s.chords[i] = { ...E.c });
  rebuild(s); save(s); renderSheet(); drawEd(); $('#ed').hidden = false; $('#ed').style.top = top; $('#ed').style.left = left;
}
$('#ed').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !S.edit) return;
  const s = A(), c = S.edit.c;
  if (b.dataset.ai != null || b.dataset.kc != null) { const x = b.dataset.ai != null ? S.edit.alts[+b.dataset.ai].c : S.edit.kc[+b.dataset.kc]; Object.assign(c, { root: x.root, q: x.q, bass: -1 }); }
  else if (b.dataset.r != null) { c.root = mod(+b.dataset.r - ctr(s)); if (c.bass === c.root) c.bass = -1; if (c.q === undefined) c.q = ''; }
  else if (b.dataset.q != null) { if (b.dataset.q === 'N') { c.root = -1; c.q = ''; c.bass = -1; } else { if (c.root < 0) c.root = s.res.key.root; c.q = b.dataset.q; if (S.level === 'very') c.bass = -1; } }
  else if (b.dataset.act === 'reset') { S.edit.beats.concat(S.edit.rep ? S.edit.twins.flat() : []).forEach(i => s.chords[i] = { ...s.orig[i] }); rebuild(s); save(s); closePops(); renderSheet(); return; }
  else if (b.dataset.act === 'done') { closePops(); return; }
  else return;
  applyEd();
});

