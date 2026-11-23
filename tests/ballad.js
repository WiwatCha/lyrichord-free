// synthetic "First Love"-style ballad: 90 BPM, eighth-note piano arpeggios + hi-hat (the double-tempo trap),
// two chords per bar, slash chords, and a half-step key change for the last chorus
const MA = require('../web/analysis.js');
const N = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, Bb: 10, B: 11 };
const Q = { '': [0, 4, 7], m: [0, 3, 7], sus4: [0, 5, 7] };
function parse(c) { const m = c.match(/^([A-G][#b]?)(m|sus4)?(?:\/([A-G][#b]?))?$/); return { root: N[m[1]], q: m[2] || '', bass: m[3] ? N[m[3]] : N[m[1]] }; }
const tr = (c, k) => ({ root: (c.root + k) % 12, q: c.q, bass: (c.bass + k) % 12 });
const INTRO = 'G D/F# Em D C D G G';
const VERSE = 'G D/F# Em D C D G Gsus4 Em D C D Em Bm C C';
const CHORUS = 'G G D/F# D/F# Em Em D D C C D D G G D/F# D/F# Em Em D D C D G G';
function song() {
  const halves = []; // [chord, keyShift]
  const add = (str, k = 0) => str.split(' ').forEach(c => halves.push(tr(parse(c), k)));
  add(INTRO); add(VERSE); add(CHORUS); add(VERSE); add(CHORUS); add(CHORUS, 1);
  return halves;
}
function synth(sr = 22050, bpm = 90, o = {}) {
  const sb = 60 / bpm, lead = 1.5, ev = [], halves = song(), truth = [];
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  halves.forEach((c, h) => {
    const t0 = lead + h * 2 * sb; truth.push({ t0, t1: t0 + 2 * sb, ...c });
    const tones = Q[c.q].map(iv => c.root + iv), b = 36 + ((c.bass - 0 + 12) % 12) + (c.bass >= 8 ? -12 : 0) + 12;
    ev.push({ t: t0, dur: 2 * sb - 0.05, midi: b, amp: 0.18, harm: MA.BASS });
    // piano arpeggio in eighths: bass-ish, 5th, root+12, 3rd+12 ...
    const arp = [tones[0] + 48, tones[2] + 48, tones[0] + 60, tones[1] + 60].map(m => m > 72 ? m - 12 : m);
    for (let e = 0; e < 4; e++) ev.push({ t: t0 + e * sb / 2, dur: sb * 0.9, midi: arp[e % 4], amp: 0.07, harm: MA.PAD });
    for (let e = 0; e < 4; e++) ev.push({ t: t0 + e * sb / 2, hat: 1, gain: (o.hat || 1) * (e % 2 ? 0.9 : 1) });
    if (!o.noDrums) { if (h % 2 === 0) ev.push({ t: t0, kick: 1, gain: 0.5 }); else ev.push({ t: t0, snare: 1 }); }
    // a sung line: long chord tones with a passing note
    if (h >= 8) { const m = 60 + ((tones[h % 3] - 0) % 12) + (rnd() < 0.3 ? 2 : 0); ev.push({ t: t0 + sb * 0.5, dur: sb * 1.3, midi: m > 76 ? m - 12 : m, amp: 0.1, harm: MA.LEAD }); }
  });
  return { samples: MA.render(ev, lead + halves.length * 2 * sb + 2, sr), sr, truth, bpm };
}
// score a result: chord at the middle of every true half-bar (root + major/minor), and how many true changes the app also changes on
function score(res, truth) {
  const at = t => { let i = 0; while (i + 1 < res.beats.length && res.beats[i + 1] <= t) i++; return res.chords[i]; };
  const fam = c => !c || c.root < 0 ? 'N' : c.root + (/^m(?!aj)/.test(c.q) || c.q === 'dim' || c.q === 'm7b5' ? 'm' : '');
  let ok = 0, chg = 0, chgOk = 0, half = 0;
  truth.forEach((h, k) => {
    if (fam(at((h.t0 + h.t1) / 2)) === fam({ ...h, q: h.q === 'm' ? 'm' : '' })) ok++;
    half++;
    if (k && fam(truth[k - 1]) !== fam(h)) { chg++; const a = at(h.t0 - 0.3), b = at(h.t0 + 0.3); if (fam(a) !== fam(b)) chgOk++; }
  });
  return { bpm: res.bpm, chordOk: `${ok}/${half}`, changesFound: `${chgOk}/${chg}`, pct: Math.round(100 * ok / half) };
}
module.exports = { synth, score, song };
if (require.main === module) (async () => {
  const fs = require('fs');
  for (const [tag, o] of [['', {}], ['_hats', { hat: 4, noDrums: true }]]) {
    const { samples, sr, truth } = synth(22050, 90, o);
    fs.writeFileSync(__dirname + `/ballad${tag}.wav`, Buffer.from(MA.toWav(samples, sr)));
    fs.writeFileSync(__dirname + '/ballad_truth.json', JSON.stringify(truth));
    const r = await MA.analyze(samples, sr);
    console.log(`browser engine${tag}:`, score(r, truth), 'key', MA.name({ ...r.key, bass: -1 }, 0, 'very'));
  }
})();
