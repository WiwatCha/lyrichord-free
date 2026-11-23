// ================= export: one layout -> PDF (own writer) or PowerPoint (editable boxes) =================
const PG = { W: 595.28, H: 841.89, M: 34 };
const LIGHT = { ink: '#17171c', mut: '#6b6c75', card: '#ffffff' };
const PDF_FONTS = { L: 'PlexL,"IBM Plex Sans Thai",sans-serif', C: 'BaiL,"Bai Jamjuree","IBM Plex Sans Thai",sans-serif', face: null };
const PPT_FONTS = { L: 'Tahoma,sans-serif', C: 'Tahoma,sans-serif', face: 'Tahoma' };
function hsl2hex(h, s, l) {
  s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
const mctx = document.createElement('canvas').getContext('2d');
function measure(text, size, bold, fam) { mctx.font = `${bold ? 700 : 400} ${size}px ${fam}`; return mctx.measureText(text).width; }
function wrapWords(words, size, bold, fam, maxW) {
  const lines = []; let cur = [], w = 0;
  for (const wd of words) { const ww = measure(wd, size, bold, fam); if (w + ww > maxW && cur.length && wd.trim()) { lines.push(cur); cur = []; w = 0; } if (!cur.length && !wd.trim()) continue; cur.push(wd); w += ww; }
  if (cur.length) lines.push(cur);
  return lines;
}
function buildLayout(s, mode, sc, F, opts, paginate, cols = 1) {
  const { W, H, M } = PG, pages = [[]], GAP = 20; let y = M, page = pages[0], col = 0, colTop = M;
  const add = it => page.push(it), bottom = H - M - 12, colW = cols === 2 ? (W - 2 * M - GAP) / 2 : W - 2 * M;
  const cx = () => M + col * (colW + GAP);
  const newPage = () => { page = []; pages.push(page); y = M; col = 0; colTop = M; };
  const ensure = h => { if (paginate && y + h > bottom && y > colTop + 1) { if (cols === 2 && col === 0) { col = 1; y = colTop; } else newPage(); } };
  const key = MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 }, 0, 'very', s.tr);
  // header
  const ts = 20 * sc;
  for (const l of wrapWords(segWords(s.name), ts, true, F.L, W - 2 * M).slice(0, 2)) { y += ts; add({ t: 'text', x: M, y, s: ts, bold: true, text: l.join('').trim(), color: LIGHT.ink, f: 'L' }); y += ts * 0.2; }
  const ms = 9 * sc; y += ms * 1.3;
  add({ t: 'text', x: M, y, s: ms, text: `คีย์ ${key}${s.tr ? ` (เปลี่ยนคีย์ ${s.tr > 0 ? '+' : ''}${s.tr})` : ''}${capoOf(s) ? `  ·  ${T('กีตาร์: คาโป้')} ${capoOf(s)}` : ''}  ·  ${s.res.bpm} BPM  ·  ${s.meter.num}/${s.meter.den}  ·  คอร์ด ${T(LV_NAME[S.level])}  ·  ${mode === 'lyric' ? 'เน้นเนื้อร้อง' : 'เน้นคอร์ด'}`, color: LIGHT.mut, f: 'L' });
  y += 8 * sc;
  // chord shapes: under the title (top, full width), or after the song (end: lyrics and chords come first; in the
  // column where the song ended, so a two-column page does not start a new page for them), or none
  const diagBlock = whole => {
    const u = uniqueChords(s), gtr = S.inst !== 'piano', cw = (gtr ? 40 : 66) * sc, chh = (gtr ? 46 : 30) * sc, ls = 9 * sc, gap = 6 * sc;
    const x0 = () => whole ? M : cx(), per = Math.max(1, Math.floor(((whole ? W - 2 * M : colW) + gap) / (cw + gap))), rowH = ls * 1.3 + chh + gap;
    if (!u.length) return;
    if (!whole) {
      const hs = 9.5 * sc; y += 6 * sc; ensure(hs * 1.8 + rowH);
      add({ t: 'text', x: x0(), y: y + hs, s: hs, bold: true, text: T('คอร์ดที่ใช้ในเพลง'), color: LIGHT.mut, f: 'L' }); y += hs * 1.8;
    }
    for (let k = 0; k < u.length; k++) {
      if (k % per === 0) { if (k) y += rowH; ensure(rowH); }
      const x = x0() + (k % per) * (cw + gap), [l, c] = u[k];
      add({ t: 'text', x, y: y + ls, s: ls, bold: true, text: l, color: LIGHT.ink, f: 'C', w: cw, align: 'center' });
      add({ t: 'img', x, y: y + ls * 1.3, w: cw, h: chh, chord: c, gtr });
    }
    y += ls * 1.3 + chh + 12 * sc;
  };
  if (opts.diag === 'top') diagBlock(true);
  if (mode === 'chord') {
    const bw = (W - 2 * M) / 4, chH = 20 * sc, lsz = 8.5 * sc, tags = S.level === 'advance' ? [] : rowTags(s), pieces = barPieces(s);
    for (let r = 0; r < s.bars.length; r += 4) {
      const rowBars = s.bars.slice(r, r + 4).map((b, j) => r + j), tg = tags[r / 4];
      const lyl = rowBars.map(bi => { const t = pieces[bi].map(p => p.text).join(' '); return t ? wrapWords(segWords(t), lsz, false, F.L, bw - 8) : []; });
      const lyH = Math.max(0, ...lyl.map(l => l.length)) * lsz * 1.3, rh = (tg ? 10 * sc : 0) + chH + 4 + lyH + 7 * sc;
      ensure(rh);
      if (tg) { add({ t: 'text', x: M, y: y + 7.5 * sc, s: 7.5 * sc, text: `${tg.letter}  ${tg.prog}`, color: LIGHT.mut, f: 'L' }); y += 10 * sc; }
      rowBars.forEach((bi, j) => {
        const bx = M + j * bw, bar = s.bars[bi];
        add({ t: 'line', x1: bx, y1: y, x2: bx, y2: y + chH + 4 + lyH, color: '#c9c7bf', lw: 1 });
        add({ t: 'text', x: bx + 2, y: y + 6 * sc, s: 5.5 * sc, text: String(bi + 1), color: '#9a9aa2', f: 'L' });
        for (const g of segsOf(s)[bi]) {
          const sx = bx + 4 + (g.start - bar[0]) * (bw - 6) / bar.length, sw = g.len * (bw - 6) / bar.length - 3, lab = nm(g.chord, s);
          if (g.chord.root >= 0) add({ t: 'rect', x: sx, y: y + 2, w: sw, h: chH - 2, fill: hsl2hex(hue(g.chord.root + ctr(s)), 80, 88), r: 3 });
          let fs = 12.5 * sc; while (measure(lab, fs, true, F.C) > sw - 4 && fs > 6) fs -= 0.5;
          add({ t: 'text', x: sx, y: y + chH / 2 + fs * 0.38 + 1, s: fs, bold: true, text: lab, w: sw, align: 'center', color: g.chord.root >= 0 ? hsl2hex(hue(g.chord.root + ctr(s)), 65, 24) : LIGHT.mut, f: 'C' });
        }
        lyl[j].forEach((l, k) => add({ t: 'text', x: bx + 4, y: y + chH + 4 + lsz * (1 + k * 1.3), s: lsz, text: l.join('').trim(), color: LIGHT.ink, f: 'L' }));
      });
      y += chH + 4 + lyH + 7 * sc;
    }
  } else {
    const LS = 14 * sc, CS = 11 * sc, maxW = colW;
    colTop = y;
    for (const it of lyricItems(s)) {
      if (it.type === 'brk') { y += 7 * sc; continue; }
      if (it.type === 'inst') {
        const h = CS * 1.6; ensure(h);
        // instrumental: section name on the first row, then the bars as | G D/F# | Em D |  (no lyrics)
        const tag = T(it.label || 'ดนตรี'), tagW = Math.max(measure(T('ดนตรี'), 8 * sc, true, F.L), measure('Instru', 8 * sc, true, F.L), measure(tag, 8 * sc, true, F.L)) + 8 * sc;
        let x = cx(); if (it.head) add({ t: 'text', x, y: y + CS, s: 8 * sc, bold: true, text: tag, color: '#2f6fb0', f: 'L' }); x += tagW;
        add({ t: 'text', x, y: y + CS, s: CS, text: '|', color: '#7aa7d6', f: 'C' }); x += measure('| ', CS, false, F.C);
        it.bars.forEach(bi => {
          for (const g of segsOf(s)[bi]) if (g.chord.root >= 0) { const lab = nm(g.chord, s); add({ t: 'text', x, y: y + CS, s: CS, bold: true, text: lab, color: hsl2hex(hue(g.chord.root + ctr(s)), 70, 36), f: 'C' }); x += measure(lab + '  ', CS, true, F.C); }
          add({ t: 'text', x, y: y + CS, s: CS, text: '|', color: '#7aa7d6', f: 'C' }); x += measure('| ', CS, false, F.C);
        });
        y += h; continue;
      }
      const vis = wrapWords(it.words.map((w, j) => ({ w, j })).map(o => o.w), LS, false, F.L, maxW);
      let j0 = 0; const groups = vis.map(v => { const g = { words: v, start: j0 }; j0 += v.length; return g; });
      // map wrapped words back to original word indexes (wrapWords may skip leading spaces)
      let wi = 0; for (const g of groups) { g.idx = []; for (const w of g.words) { while (wi < it.words.length && it.words[wi] !== w) wi++; g.idx.push(wi++); } }
      const tot = groups.reduce((a, g) => a + (g.idx.some(i => it.anchors[i].length) ? CS * 1.25 : 0) + LS * 1.32, 0) + 3 * sc;
      ensure(Math.min(tot, H));
      for (const g of groups) {
        const hasC = g.idx.some(i => it.anchors[i].length);
        ensure((hasC ? CS * 1.25 : 0) + LS * 1.32);
        let x = cx(), lastR = -1;
        if (hasC) {
          for (const i of g.idx) {
            for (const a of it.anchors[i]) {
              const lab = nm(a.chord, s), cx = Math.max(x, lastR + 3 * sc);
              add({ t: 'text', x: cx, y: y + CS, s: CS, bold: true, text: lab, color: hsl2hex(hue(a.chord.root + ctr(s)), 70, 36), f: 'C' });
              lastR = cx + measure(lab, CS, true, F.C);
            }
            x += measure(it.words[i], LS, false, F.L);
          }
          y += CS * 1.25;
        }
        add({ t: 'text', x: cx(), y: y + LS, s: LS, text: g.idx.map(i => it.words[i]).join('').trimEnd(), color: LIGHT.ink, f: 'L', lyric: true, w: colW });
        y += LS * 1.32;
      }
      y += 3 * sc;
    }
  }
  if (opts.diag === 'end') diagBlock(false);
  return { pages, height: y + 12, cols };
}
// biggest text that fits one A4 page; lyric view may use two columns; otherwise extra pages at 100%
function fitLayout(s, mode, F, opts) {
  const minSc = mode === 'lyric' ? 0.75 : 0.8, tries = [[1, 1.7]].concat(mode === 'lyric' ? [[2, 1.15]] : []);
  for (const [cols, top] of tries) for (let sc = top; sc >= minSc - 1e-6; sc -= 0.03) { const L = buildLayout(s, mode, sc, F, opts, true, cols); if (L.pages.length === 1) return { ...L, sc }; }
  return { ...buildLayout(s, mode, 1.0, F, opts, true, mode === 'lyric' ? 2 : 1), sc: 1.0 };
}
const svgImg = svg => new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
async function chordImages(s, pages) {
  const map = new Map();
  for (const p of pages) for (const it of p) if (it.t === 'img') { const k = nm(it.chord, s) + it.gtr; if (!map.has(k)) map.set(k, await svgImg(it.gtr ? guitar(it.chord, { small: true, col: LIGHT }) : piano(it.chord, { small: true, col: LIGHT }))); it.key = k; }
  return map;
}
async function renderPages(s, L, F) {
  const K = 2.2, imgs = await chordImages(s, L.pages), out = [];
  L.pages.forEach((items, pi) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(PG.W * K); cv.height = Math.round(PG.H * K);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.scale(K, K); g.textBaseline = 'alphabetic';
    for (const it of items) {
      if (it.t === 'rect') { g.fillStyle = it.fill; g.beginPath(); g.roundRect(it.x, it.y, it.w, it.h, it.r || 0); g.fill(); }
      else if (it.t === 'line') { g.strokeStyle = it.color; g.lineWidth = it.lw; g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke(); }
      else if (it.t === 'img') { const im = imgs.get(it.key); if (im) { const r = Math.min(it.w / im.width, it.h / im.height), w = im.width * r, h = im.height * r; g.drawImage(im, it.x + (it.w - w) / 2, it.y, w, h); } }
      else { g.fillStyle = it.color; g.font = `${it.bold ? 700 : 400} ${it.s}px ${F[it.f]}`; g.textAlign = it.align === 'center' ? 'center' : 'left'; g.fillText(it.text, it.align === 'center' ? it.x + it.w / 2 : it.x, it.y); }
    }
    g.textAlign = 'left'; g.fillStyle = '#9a9aa2'; g.font = `400 7px ${F.L}`; g.fillText(`${s.name} · หน้า ${pi + 1}/${L.pages.length} · Lyrichord`, PG.M, PG.H - 16);
    out.push(cv);
  });
  return out;
}
async function pdfBlob(canvases) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const n = canvases.length, total = 3 + 3 * n;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  offs[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offs[2] = len; push(`2 0 obj\n<< /Type /Pages /Kids [${canvases.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);
  for (let i = 0; i < n; i++) {
    const cv = canvases[i], jpg = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const po = 3 + 3 * i, co = po + 1, io = po + 2, content = `q ${PG.W} 0 0 ${PG.H} 0 0 cm /Im0 Do Q`;
    offs[po] = len; push(`${po} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PG.W} ${PG.H}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`);
    offs[co] = len; push(`${co} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    offs[io] = len; push(`${io} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
  }
  const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + offs.slice(1, total).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
function loadScript(srcs) {
  return srcs.reduce((p, src) => p.catch(() => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => { sc.remove(); no(); }; document.head.append(sc); })), Promise.reject());
}
async function saveFile(blob, filename) {
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) { try { await dl.save({ filename, data: blob }); return 'saved'; } catch (e) { return e && e.code === 'declined' ? 'declined' : 'failed'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000); return 'saved';
}
const exName = (s, mode, ext) => `${s.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'lead-sheet'} (${MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 }, 0, 'very', s.tr)}, ${mode === 'lyric' ? 'เนื้อร้อง' : 'คอร์ด'}).${ext}`;
function exHint(t, err) { $('#exhint').textContent = t; $('#exhint').className = 'hint' + (err ? ' err' : ''); hint(t, err); }
async function exportPDF() {
  const s = A(); if (!ready(s)) return exHint('เลือกเพลงที่วิเคราะห์เสร็จแล้วก่อน', true);
  const mode = S.exMode || S.disp; exHint('กำลังสร้าง PDF…');
  await document.fonts.ready; await Promise.all(['400 12px PlexL', '700 12px PlexL', '700 12px BaiL'].map(f => document.fonts.load(f, 'กขC').catch(() => {})));
  const L = fitLayout(s, mode, PDF_FONTS, { diag: S.exDiag }), cvs = await renderPages(s, L, PDF_FONTS);
  const r = await saveFile(await pdfBlob(cvs), exName(s, mode, 'pdf'));
  exHint(r === 'saved' ? `สร้าง PDF แล้ว ${cvs.length} หน้า${L.cols === 2 ? ' แบบ 2 คอลัมน์' : ''} (ขนาดตัวอักษร ${Math.round(L.sc * 100)}%)` : r === 'declined' ? 'ยกเลิกการบันทึก' : 'บันทึกไฟล์ไม่ได้ในหน้านี้', r === 'failed');
}
async function exportPPTX() {
  const s = A(); if (!ready(s)) return exHint('เลือกเพลงที่วิเคราะห์เสร็จแล้วก่อน', true);
  const mode = S.exMode || S.disp; exHint('กำลังสร้าง PowerPoint…');
  try { if (!window.PptxGenJS) await loadScript(['assets/vendor/pptxgen.bundle.js', 'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js']); }
  catch { return exHint('โหลดตัวสร้าง PowerPoint ไม่ได้ (เปิดผ่านหลังบ้านเพื่อใช้แบบออฟไลน์)', true); }
  const L = fitLayout(s, mode, PPT_FONTS, { diag: S.exDiag }), imgs = await chordImages(s, L.pages);
  const png = new Map(); for (const [k, im] of imgs) if (im) { const c = document.createElement('canvas'); c.width = im.width * 3; c.height = im.height * 3; const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); png.set(k, c.toDataURL('image/png')); }
  const pptx = new window.PptxGenJS(); pptx.defineLayout({ name: 'A4P', width: 8.27, height: 11.69 }); pptx.layout = 'A4P'; pptx.title = s.name; pptx.author = 'Lyrichord'; pptx.company = 'Lyrichord';
  const I = v => v / 72, hex = c => c.replace('#', '').toUpperCase();
  L.pages.forEach((items, pi) => {
    const sl = pptx.addSlide(); sl.background = { color: 'FFFFFF' };
    for (const it of items) {
      if (it.t === 'rect') sl.addShape(pptx.ShapeType.roundRect, { x: I(it.x), y: I(it.y), w: I(it.w), h: I(it.h), fill: { color: hex(it.fill) }, line: { color: hex(it.fill), width: 0 }, rectRadius: 0.06 });
      else if (it.t === 'line') sl.addShape(pptx.ShapeType.line, { x: I(it.x1), y: I(it.y1), w: Math.max(0.001, I(it.x2 - it.x1)), h: I(it.y2 - it.y1), line: { color: hex(it.color), width: it.lw } });
      else if (it.t === 'img') { const d = png.get(it.key); if (d) sl.addImage({ data: d, x: I(it.x), y: I(it.y), w: I(it.w), h: I(it.h), sizing: { type: 'contain', w: I(it.w), h: I(it.h) } }); }
      else {
        const w = it.w || measure(it.text, it.s, it.bold, PPT_FONTS[it.f]) + it.s * (it.lyric ? 1.2 : 0.8);
        sl.addText(it.text, { x: I(it.x), y: I(it.y - it.s * 0.98), w: I(Math.min(w, PG.W - it.x - 4)), h: I(it.s * 1.35), fontFace: PPT_FONTS.face, fontSize: Math.round(it.s * 10) / 10, bold: !!it.bold, color: hex(it.color), align: it.align === 'center' ? 'center' : 'left', valign: 'middle', margin: 0, wrap: false });
      }
    }
    sl.addText(`${s.name} · หน้า ${pi + 1}/${L.pages.length} · Lyrichord`, { x: I(PG.M), y: I(PG.H - 24), w: 4, h: 0.15, fontFace: 'Tahoma', fontSize: 7, color: '9A9AA2', margin: 0 });
  });
  const blob = await pptx.write({ outputType: 'blob' });
  const r = await saveFile(blob, exName(s, mode, 'pptx'));
  exHint(r === 'saved' ? `สร้าง PowerPoint แล้ว ${L.pages.length} สไลด์ (A4 แนวตั้ง) · คอร์ดและเนื้อร้องเป็นกล่องข้อความแยกกัน แก้ต่อได้` : r === 'declined' ? 'ยกเลิกการบันทึก' : 'บันทึกไฟล์ไม่ได้ในหน้านี้', r === 'failed');
}
function exportText() {
  const s = A(); if (!ready(s)) return '';
  const mode = S.exMode || S.disp;
  let txt = `${s.name}\nคีย์ ${$('#key').textContent} · ${s.res.bpm} BPM · ${s.meter.num}/${s.meter.den}\n\n`;
  if (mode === 'lyric' && s.lines.length) {
    for (const it of lyricItems(s)) {
      if (it.type === 'brk') { txt += '\n'; continue; }
      if (it.type === 'inst') { txt += `[${T(it.label || 'ดนตรี')}] | ` + it.bars.map(bi => segsOf(s)[bi].filter(g => g.chord.root >= 0).map(g => nm(g.chord, s)).join(' ')).join(' | ') + ' |\n'; continue; }
      txt += it.words.map((w, j) => it.anchors[j].map(a => `[${nm(a.chord, s)}]`).join('') + w).join('').trim() + '\n';
    }
  } else {
    const pieces = barPieces(s);
    for (let r = 0; r < s.bars.length; r += 4) {
      txt += s.bars.slice(r, r + 4).map((b, k) => '| ' + segsOf(s)[r + k].map(g => nm(g.chord, s) + ' .'.repeat(g.len - 1)).join(' ') + ' ').join('') + '|\n';
      const ly = s.bars.slice(r, r + 4).map((b, k) => pieces[r + k].map(p => p.text).join(' ')).filter(Boolean).join(' / '); if (ly) txt += '  ' + ly + '\n';
    }
  }
  return txt;
}
