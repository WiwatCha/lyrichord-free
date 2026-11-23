// ================= notation export: MusicXML (MuseScore, Sibelius, Finale, Dorico) and MIDI (GarageBand, Logic, ...) =================
// The melody, the chords of the current level and the lyrics, in the key shown (capo ignored: notation is at sounding pitch).
// Times become beats through the beat grid, so the notes sit in the bars the app found (pickup and odd bars kept).
function beatPos(s, t) {
  const b = s.res.beats, n = b.length;
  if (n < 2) return 0;
  if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
  if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m; }
  return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
}
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];  // major key root pc -> key signature (C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B)
const SHARP_SP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SP = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const XKIND = { '': 'major', m: 'minor', '2': 'major', sus2: 'suspended-second', sus4: 'suspended-fourth', '6': 'major-sixth', m6: 'minor-sixth', '7': 'dominant',
  maj7: 'major-seventh', m7: 'minor-seventh', '7sus4': 'suspended-fourth', '9': 'dominant-ninth', maj9: 'major-ninth', m9: 'minor-ninth', '11': 'dominant-11th',
  m11: 'minor-11th', '13': 'dominant-13th', dim: 'diminished', dim7: 'diminished-seventh', m7b5: 'half-diminished', aug: 'augmented' };
function scoreModel(s) {
  const tr = trOf(s), key = s.res.key, kRoot = mod(key.root + tr), majRoot = key.q === 'm' ? mod(kRoot + 3) : kRoot;
  const fifths = FIFTHS[majRoot], spell = fifths < 0 ? FLAT_SP : SHARP_SP;
  const { num, den, bpb } = s.meter, DPB = den === 8 ? 2 : 4;  // grid: a sixteenth note; divisions per beat
  const shown = q => S.level === 'very' ? MA.baseOf(q) : S.level === 'plus' ? MA.PLUS[q] ?? q : q;
  const spoken = s.res.spoken || [], inSpeech = t => spoken.some(([a, b]) => a <= t && t < b);
  const g = t => Math.round(beatPos(s, t) * DPB);  // time -> grid units from beat 0
  // melody: one line, overlaps clipped, at least one sixteenth long
  let notes = s.res.notes.filter(n => !inSpeech((n.t0 + n.t1) / 2)).map(n => ({ a: g(n.t0), b: Math.max(g(n.t0) + 1, g(n.t1)), midi: Math.round(n.midi) + tr, ly: '' }))
    .sort((x, y) => x.a - y.a);
  const mel = [];
  for (const n of notes) { if (mel.length && n.a < mel[mel.length - 1].b) { const p = mel[mel.length - 1]; if (n.a <= p.a) continue; p.b = n.a; } if (n.b > n.a) mel.push(n); }
  // lyrics: each word on the note it is sung on (the note starting nearest to it, within a beat)
  s.lines.forEach((ln, k) => {
    const ws = segWords(ln.text); let off = 0;
    ws.forEach(w => { const t = charTime(s, k, off); off += w.length; const word = w.trim(); if (!word || t == null) return;
      const p = g(t); let best = null, bd = DPB + 1;
      for (const n of mel) { const d = Math.abs(n.a - p); if (d < bd) { bd = d; best = n; } if (n.a > p + DPB) break; }
      if (best) best.ly += (best.ly && /[A-Za-z0-9]$/.test(best.ly) && /^[A-Za-z0-9]/.test(word) ? ' ' : '') + word; });
  });
  // chords of the level shown
  const chords = segsOf(s).flat().filter(x => x.chord.root >= 0).map(x => ({ a: x.start * DPB, c: x.chord, q: shown(x.chord.q) }));
  // bars: as found (the first may be a pickup); the last is filled up to a full bar
  const bars = s.bars.map((b, i) => ({ a: b[0] * DPB, len: (i === s.bars.length - 1 ? bpb : b.length) * DPB, beats: b.length }));
  return { tr, key, kRoot, fifths, spell, num, den, bpb, DPB, mel, chords, bars, bpm: s.res.bpm };
}
const xesc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// durations in sixteenths (with DPB 4) that one note symbol can show; longer or odd ones are tied pieces
const DUR = [[16, 'whole', 0], [12, 'half', 1], [8, 'half', 0], [6, 'quarter', 1], [4, 'quarter', 0], [3, 'eighth', 1], [2, 'eighth', 0], [1, '16th', 0]];
function durPieces(len) { const out = []; let r = len; for (const [d, t, dot] of DUR) while (r >= d) { out.push([d, t, dot]); r -= d; } return out; }
function musicXML(s) {
  const M = scoreModel(s), DIVQ = 4, scale = 1;  // 4 divisions per quarter: one grid unit (a sixteenth) = one division
  const parts = [];
  let tsNow = null;
  M.bars.forEach((bar, mi) => {
    const a = bar.a, e = a + bar.len, items = [];  // notes and rests in this bar, in grid units
    let cur = a;
    for (const n of M.mel) {
      if (n.b <= a || n.a >= e) continue;
      const na = Math.max(n.a, a), nb = Math.min(n.b, e);
      if (na > cur) items.push({ a: cur, b: na, rest: true });
      items.push({ a: na, b: nb, n, tieIn: n.a < a, tieOut: n.b > e });
      cur = nb;
    }
    if (cur < e) items.push({ a: cur, b: e, rest: true });
    let x = `<measure number="${mi + 1}"${mi === 0 && bar.beats < M.bpb ? ' implicit="yes"' : ''}>`;
    const ts = bar.len / M.DPB;  // beats in this bar
    if (mi === 0) {
      x += `<attributes><divisions>${DIVQ}</divisions><key><fifths>${M.fifths}</fifths><mode>${M.key.q === 'm' ? 'minor' : 'major'}</mode></key>` +
        `<time><beats>${M.num}</beats><beat-type>${M.den}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
        `<direction placement="above"><direction-type><metronome><beat-unit>${M.den === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${Math.round(M.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(M.den === 8 ? M.bpm / 2 : M.bpm)}"/></direction>`;
      tsNow = M.bpb;
    } else if (ts !== tsNow && !(mi === M.bars.length - 1)) {  // an odd bar in the middle: its own time signature, then back
      x += `<attributes><time><beats>${ts}</beats><beat-type>${M.den}</beat-type></time></attributes>`; tsNow = ts;
    } else if (tsNow !== M.bpb && ts === M.bpb) { x += `<attributes><time><beats>${M.num}</beats><beat-type>${M.den}</beat-type></time></attributes>`; tsNow = M.bpb; }
    // chord symbols: before the note or rest that is sounding when the chord starts
    const chordsHere = M.chords.filter(c => c.a >= a && c.a < e);
    items.forEach(it => {
      for (const c of chordsHere) if (c.a >= it.a && c.a < it.b) {
        // spelled like the key signature (Db in a flat key, C# in a sharp one)
        const [st, al] = M.spell[mod(c.c.root + M.tr)], bass = S.level !== 'very' && c.c.bass >= 0 && c.c.bass !== c.c.root ? M.spell[mod(c.c.bass + M.tr)] : null;
        x += `<harmony><root><root-step>${st}</root-step>${al ? `<root-alter>${al}</root-alter>` : ''}</root><kind text="${xesc(c.q)}">${XKIND[c.q] || 'major'}</kind>` +
          (bass ? `<bass><bass-step>${bass[0]}</bass-step>${bass[1] ? `<bass-alter>${bass[1]}</bass-alter>` : ''}</bass>` : '') +
          (c.a > it.a ? `<offset>${(c.a - it.a) * scale}</offset>` : '') + `</harmony>`;
      }
      const ps = durPieces(it.b - it.a);
      ps.forEach(([d, type, dot], k) => {
        if (it.rest) { x += `<note><rest/><duration>${d * scale}</duration><type>${type}</type>${dot ? '<dot/>' : ''}</note>`; return; }
        const [st, al] = M.spell[mod(it.n.midi)], oct = Math.floor(it.n.midi / 12) - 1;
        const tStop = k > 0 || it.tieIn, tStart = k < ps.length - 1 || it.tieOut;
        x += `<note><pitch><step>${st}</step>${al ? `<alter>${al}</alter>` : ''}<octave>${oct}</octave></pitch><duration>${d * scale}</duration>` +
          (tStop ? '<tie type="stop"/>' : '') + (tStart ? '<tie type="start"/>' : '') + `<type>${type}</type>${dot ? '<dot/>' : ''}` +
          ((tStop || tStart) ? `<notations>${tStop ? '<tied type="stop"/>' : ''}${tStart ? '<tied type="start"/>' : ''}</notations>` : '') +
          (k === 0 && !it.tieIn && it.n.ly ? `<lyric number="1"><syllabic>single</syllabic><text>${xesc(it.n.ly)}</text></lyric>` : '') + `</note>`;
      });
    });
    if (mi === M.bars.length - 1) x += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    parts.push(x + '</measure>');
  });
  const title = xesc(s.name), keyName = MA.name({ root: M.key.root, q: M.key.q, bass: -1 }, 0, 'very', M.tr);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>${title}</work-title></work><identification><encoding><software>Lyrichord ${xesc(APP_VERSION)}</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding>` +
    `<miscellaneous><miscellaneous-field name="key">${xesc(keyName)}</miscellaneous-field></miscellaneous></identification>` +
    `<part-list><score-part id="P1"><part-name>${xesc(T('ทำนอง'))}</part-name></score-part></part-list><part id="P1">${parts.join('\n')}</part></score-partwise>\n`;
}

// ---- MIDI (type 1): tempo and key, the melody (with lyric events), the chords as block chords with their names ----
function midiFile(s) {
  const M = scoreModel(s), PPQ = 480, TPU = PPQ / 4;  // ticks per grid unit (a sixteenth)
  const pad = M.bars.length && M.bars[0].beats < M.bpb ? (M.bpb - M.bars[0].beats) * M.DPB : 0;  // pickup: the first full bar starts on a bar line
  const tick = u => Math.max(0, Math.round((u + pad) * TPU));
  const vlq = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const utf8 = str => [...new TextEncoder().encode(str)];
  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
  const track = (evs, name) => {  // evs: [tick, bytes]
    evs = [[0, meta(0x03, utf8(name))], ...evs].sort((x, y) => x[0] - y[0] || (x[2] || 0) - (y[2] || 0));
    const out = []; let last = 0;
    for (const [t, bytes] of evs) { out.push(...vlq(t - last), ...bytes); last = t; }
    out.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, ...[24, 16, 8, 0].map(sh => (out.length >> sh) & 255), ...out];
  };
  const qbpm = M.den === 8 ? M.bpm / 2 : M.bpm, us = Math.round(60e6 / qbpm);
  const t0 = track([[0, meta(0x51, [us >> 16 & 255, us >> 8 & 255, us & 255])], [0, meta(0x58, [M.num, Math.log2(M.den), 24, 8])],
    [0, meta(0x59, [M.fifths & 255, M.key.q === 'm' ? 1 : 0])], [0, meta(0x01, utf8(`${s.name} · Lyrichord`))]], 'Lyrichord');
  const mel = [];
  for (const n of M.mel) {
    if (n.ly) mel.push([tick(n.a), meta(0x05, utf8(n.ly)), 0]);
    mel.push([tick(n.a), [0x90, n.midi & 127, 96], 1], [tick(n.b), [0x80, n.midi & 127, 0], -1]);
  }
  const ch = [], tones = c => (MA.QS.find(x => x.q === c.q) || MA.QS[0]).ivs.map(([iv]) => iv);
  M.chords.forEach((c, i) => {
    const end = i + 1 < M.chords.length ? M.chords[i + 1].a : M.bars.length ? M.bars[M.bars.length - 1].a + M.bars[M.bars.length - 1].len : c.a + 4 * M.DPB;
    const root = mod(c.c.root + M.tr), bass = (S.level !== 'very' && c.c.bass >= 0 ? mod(c.c.bass + M.tr) : root) + 36;
    const keys = [bass, ...tones({ q: c.q }).map(iv => 55 + mod(root + iv - 7))];
    ch.push([tick(c.a), meta(0x01, utf8(MA.name(c.c, 0, lmode(), M.tr))), 0]);
    for (const k of keys) ch.push([tick(c.a), [0x91, k, 70], 1], [tick(end), [0x81, k, 0], -1]);
  });
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, PPQ >> 8, PPQ & 255];
  return new Uint8Array([...head, ...t0, ...track(mel, 'Melody'), ...track(ch, 'Chords')]);
}
async function exportScore(kind) {
  const s = A(); if (!ready(s)) return exHint('เลือกเพลงที่วิเคราะห์เสร็จแล้วก่อน', true);
  const key = MA.name({ root: s.res.key.root, q: s.res.key.q, bass: -1 }, 0, 'very', s.tr);
  const base = `${s.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'lead-sheet'} (${key})`;
  const blob = kind === 'xml' ? new Blob([musicXML(s)], { type: 'application/vnd.recordare.musicxml+xml' }) : new Blob([midiFile(s)], { type: 'audio/midi' });
  const name = base + (kind === 'xml' ? '.musicxml' : '.mid');
  const r = await saveFile(blob, name);
  exHint(r === 'saved' ? `${T('บันทึกแล้ว')}: ${name}` : 'บันทึกไม่สำเร็จ', r !== 'saved');
}
