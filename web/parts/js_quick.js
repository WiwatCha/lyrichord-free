
// ================= quick start: reopen what was open, add many songs at once, ⌘K to find any song or command =================

// ---- the songs open on this device come back next time (from the library on the computer) ----
function rememberOpen() {
  if (rememberOpen.off) return;
  const a = A(), ids = [...new Set(S.sources.filter(s => s.jobId && s.status !== 'error').map(s => s.jobId))].slice(-12);
  store.set('cl-open', JSON.stringify({ ids, active: a ? (a.jobId || (a.kind === 'demo' ? 'demo' : '')) : '' }));
}
// true when at least one song came back (then the demo song is not opened)
async function restoreOpen() {
  let saved = null; try { saved = JSON.parse(store.get('cl-open') || 'null'); } catch {}
  if (!S.backend || !saved || !Array.isArray(saved.ids) || !saved.ids.length) return false;
  let lib = []; try { const r = await fetch(api('library')); if (r.ok) lib = (await r.json()).songs || []; } catch {}
  const have = new Map(lib.map(x => [x.id, x])), ids = saved.ids.filter(id => have.has(id) && !S.sources.some(s => s.jobId === id));
  if (!ids.length) return false;
  rememberOpen.off = true;
  let act = null;
  for (const id of ids) {
    const x = have.get(id), s = addSource(x.kind === LINKED ? LINKED : 'file', x.title, { server: true, vid: x.vid || undefined, fromLib: true });
    progressOf(s, 'กำลังเปิดจากคลังเพลง', 0.5); poll(s, id, null);
    if (id === saved.active || !act) act = s;
  }
  rememberOpen.off = false;
  switchTo(act.id);
  return true;
}

// ---- many songs at once: several files, a whole folder, or a folder dropped on the page ----
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus|wma|caf|mp4|m4v|mov|webm)$/i;
const isAudio = f => AUDIO_EXT.test(f.name) || /^audio\//.test(f.type);
const MAX_ADD = 50;
async function addFiles(list) {
  const all = [...list], sets = all.filter(f => /\.lyrichord$/i.test(f.name));
  const songs = all.filter(f => !/\.lyrichord$/i.test(f.name) && isAudio(f) && !f.name.startsWith('.'))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
  for (const f of sets) importSet(f);
  if (!songs.length) { if (!sets.length && all.length) hint('ไม่พบไฟล์เพลงในที่เลือก (mp3, m4a, wav, flac …)', true); return; }
  const take = songs.slice(0, MAX_ADD);
  if (take.length === 1) return addFile(take[0]);
  // with the computer's backend the songs queue there and each lands in the library; in the browser alone, one by one
  // uploads one after another so the computer's queue keeps the name order; the analysis itself is not waited for
  if (S.backend) (async () => { for (const [i, f] of take.entries()) await new Promise(ok => { addFile(f, { bg: i > 0, queued: ok }).finally(ok); }); })();
  else (async () => { for (const [i, f] of take.entries()) await addFile(f, { bg: i > 0 }); })();
  hint(`${take.length} ${'เพลงเข้าคิวแกะแล้ว แกะทีละเพลงต่อกันเอง'}${S.backend ? ` · ${'เสร็จแล้วอยู่ในคลังเพลง'}` : ''}${songs.length > MAX_ADD ? ` · ${'รับครั้งละ'} ${MAX_ADD} ${'เพลง'}` : ''}`);
}
// files and folders dropped on the page (a folder is read through, sub-folders too)
async function droppedFiles(dt) {
  const entries = [...(dt.items || [])].map(i => i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if (!entries.length || entries.every(e => e.isFile)) return [...dt.files];
  const out = [];
  const walk = async e => {
    if (e.isFile) { try { out.push(await new Promise((ok, no) => e.file(ok, no))); } catch {} return; }
    if (!e.isDirectory || out.length > 500) return;
    const r = e.createReader();
    for (;;) { const b = await new Promise(ok => r.readEntries(ok, () => ok([]))); if (!b.length) break; for (const x of b) await walk(x); }
  };
  for (const e of entries) await walk(e);
  return out;
}

// ---- ⌘K / Ctrl+K: find a song (open or in the library) or a command, by typing a few letters ----
function cmdList() {
  const s = A(), on = ready(s), has = c => !c.when || c.when();
  const songs = [];
  for (const x of S.sources) songs.push({ g: 'เพลงที่เปิดอยู่', label: x.name, sub: metaText(x), icon: x.kind, run: () => switchTo(x.id) });
  for (const x of S.lib || []) if (!S.sources.some(v => v.jobId === x.id))
    songs.push({ g: 'คลังเพลง', label: x.title, sub: `${T('คีย์')} ${x.key ? MA.name({ root: x.key.root, q: x.key.q, bass: -1 }) : '—'} · ${fmt(x.duration)}`, icon: x.kind === LINKED ? LINKED : 'file', run: () => openLib(x.id) });
  const C = [
    { label: 'เพิ่มเพลง (ไฟล์)', kw: 'add file open', run: () => S.pro ? $('#file').click() : openAdd() },
    { label: 'เพิ่มทั้งโฟลเดอร์', kw: 'folder many', run: () => $('#folder').click() },
        { label: 'คลังเพลง', kw: 'library songs', run: () => $('#libbtn2').click() },
    { label: 'เปิดโฟลเดอร์รับเพลง', kw: 'inbox watch folder drop', when: () => !!(S.inbox && S.inbox.folder), run: () => openInbox() },
    { label: 'เล่น / หยุด', kw: 'play pause', keys: 'Space', when: () => on, run: () => togglePlay() },
    { label: 'เปลี่ยนคีย์ขึ้นครึ่งเสียง', kw: 'key up transpose +', when: () => on, run: () => $('#tru').click() },
    { label: 'เปลี่ยนคีย์ลงครึ่งเสียง', kw: 'key down transpose -', when: () => on, run: () => $('#trd').click() },
    { label: 'ระดับคอร์ด: พื้นฐาน', kw: 'easy chords level', run: () => setLevel('very') },
    { label: 'ระดับคอร์ด: มาตรฐาน', kw: 'normal chords level', run: () => setLevel('plus') },
    { label: 'ระดับคอร์ด: ละเอียด', kw: 'advanced chords level', run: () => setLevel('advance') },
    { label: 'รูปคอร์ดเปียโน', kw: 'piano', run: () => setInst('piano') },
    { label: 'รูปคอร์ดกีตาร์ (และคาโป้)', kw: 'guitar capo', run: () => setInst('guitar') },
    { label: 'แผ่นโน้ตแบบอ่านโน้ต', kw: 'sheet lyrics read', run: () => setDisp('lyric') },
    { label: 'แผ่นโน้ตแบบตารางคอร์ด', kw: 'sheet chords grid', run: () => setDisp('chord') },
    { label: 'โหมดเวที', kw: 'stage live big', when: () => on, run: () => $('#stagebtn').click() },
    { label: 'เนื้อร้อง: นำเข้า / แก้', kw: 'lyrics words import edit', when: () => on, run: () => $('#lybtn').click() },
    { label: 'วนแถวนี้', kw: 'loop repeat', when: () => on, run: () => $('#loop').click() },
    { label: 'ความเร็ว 75%', kw: 'speed slow', when: () => on, run: () => $('[data-rate="0.75"]').click() },
    { label: 'ความเร็ว 100%', kw: 'speed normal', when: () => on, run: () => $('[data-rate="1"]').click() },
    { label: 'ส่งออก PDF', kw: 'export pdf print', when: () => on, run: () => $('#pdf').click() },
    { label: 'ส่งออก PowerPoint', kw: 'export pptx slides', when: () => on, run: () => $('#pptx').click() },
    { label: 'ส่งออก MusicXML', kw: 'export musescore score', when: () => on, run: () => $('#xmlbtn').click() },
    { label: 'ส่งออก MIDI', kw: 'export midi', when: () => on, run: () => $('#midbtn').click() },
    { label: 'บันทึกชุดเพลง (.lyrichord)', kw: 'save set backup', when: () => on, run: () => $('#setone').click() },
    { label: 'ย้อนกลับ', kw: 'undo', keys: '⌘Z', run: () => undoStep(true) },
    { label: 'ใช้บน iPhone / iPad จากที่ไหนก็ได้', kw: 'phone online qr', when: () => !$('#mobgrp').hidden && !document.body.classList.contains('free'), run: () => openOnline() },
    { label: 'ใช้บนมือถือ / iPad (Wi-Fi เดียวกัน)', kw: 'phone wifi qr lan', when: () => !$('#lanitem').hidden, run: () => openLan() },
    { label: 'โหมดขั้นสูง: แสดงเครื่องมือทั้งหมด', kw: 'advanced pro toolbar', run: () => setPro(!S.pro) },
    { label: 'วิธีใช้ (ทัวร์ 1 นาที)', kw: 'help tour guide', run: () => startTour() },
  ].filter(has).map(c => ({ ...c, g: 'คำสั่ง', cmd: true, icon: '' }));
  return songs.concat(C);
}
const CMDK = { list: [], shown: [], at: 0 };
function openCmdk() {
  if (STAGE.on) return;
  closePops(); if (!S.pro) { closeAdd(); closeDrawer(); }
  if (S.backend && !S.lib) loadLibrary();
  CMDK.list = cmdList(); $('#cmdk').hidden = false; const q = $('#cmdq'); q.value = ''; renderCmdk(); q.focus();
}
const closeCmdk = () => { $('#cmdk').hidden = true; };
function renderCmdk() {
  const words = $('#cmdq').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = c => { const h = `${c.label} ${c.kw || ''} ${c.sub || ''}`.toLowerCase(); return words.every(w => h.includes(w)); };
  CMDK.shown = CMDK.list.filter(hit).slice(0, 40); CMDK.at = Math.min(CMDK.at, Math.max(0, CMDK.shown.length - 1)); if (!words.length) CMDK.at = 0;
  let g = '';
  $('#cmdl').innerHTML = !CMDK.shown.length ? `<p class="hint cmdnone">${'ไม่พบ ลองพิมพ์คำอื่น'}</p>` : CMDK.shown.map((c, i) => {
    const head = c.g !== g ? `<p class="cmdg">${esc(T(c.g))}</p>` : ''; g = c.g;
    return `${head}<button class="cmdi${i === CMDK.at ? ' on' : ''}" role="option" aria-selected="${i === CMDK.at}" data-ci="${i}">${c.icon ? `<span class="ic k-${c.icon}">${svgI(c.icon)}</span>` : '<span class="cmdic">›</span>'}<span class="cmdt"><b>${esc(c.label)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>${c.keys ? `<kbd>${c.keys}</kbd>` : ''}</button>`;
  }).join('');
  $('#cmdl .cmdi.on')?.scrollIntoView({ block: 'nearest' });
}
function runCmdk(i) { const c = CMDK.shown[i]; if (!c) return; closeCmdk(); c.run(); }
$('#cmdq').addEventListener('input', () => { CMDK.at = 0; renderCmdk(); });
$('#cmdq').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = CMDK.shown.length; if (n) { CMDK.at = (CMDK.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderCmdk(); } }
  else if (e.key === 'Enter') { e.preventDefault(); runCmdk(CMDK.at); }
  else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
});
$('#cmdl').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (b) runCmdk(+b.dataset.ci); });
$('#cmdk').addEventListener('click', e => { if (e.target.id === 'cmdk') closeCmdk(); });
$('#cmdbtn').addEventListener('click', openCmdk);
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#cmdk').hidden ? openCmdk() : closeCmdk(); }
});
$('#folder').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (!S.pro) closeAdd(); addFiles(f); });
