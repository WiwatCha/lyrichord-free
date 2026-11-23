// audio that follows tests/first_love_sheet.txt chord by chord (each chord = 2 beats at 90 BPM), for testing sheet import
const MA = require('../web/analysis.js'), fs = require('fs');
const N = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const Q = { '': [0, 4, 7], m: [0, 3, 7], sus4: [0, 5, 7] };
function parse(c) { const m = c.match(/^([A-G][#b]?)(m|sus4)?(?:\/([A-G][#b]?))?$/); return { root: N[m[1]], q: m[2] || '', bass: m[3] ? N[m[3]] : N[m[1]], name: c }; }
const SEQ = (`G D/F# Em D C D G Gsus4 G ` +
  `G D/F# Em D C D G Gsus4 G Em D C D Em Bm C G D/F# Em D C D G D/F# Em D C D G Gsus4 G ` +
  `D/F# C Bm C Am D ` +
  `G D/F# Em D C D G Gsus4 G Em D C D Em Bm C G D/F# Em D C D G D/F# Em D C D C D D# ` +
  `G# D#/G Fm D# C# D# G# D#/G Fm D# C# D# G# ` +
  `G# Fm C# D# G# G#sus4 G#`).split(' ').map(parse);
function synth(sr = 22050) {
  const sb = 60 / 90, lead = 1.5, ev = [], truth = [];
  SEQ.forEach((c, h) => {
    const t0 = lead + h * 2 * sb; truth.push({ t0, t1: t0 + 2 * sb, root: c.root, q: c.q, bass: c.bass, name: c.name });
    const tones = Q[c.q].map(iv => c.root + iv);
    ev.push({ t: t0, dur: 2 * sb - 0.05, midi: 36 + c.bass + (c.bass >= 8 ? 0 : 12), amp: 0.18, harm: MA.BASS });
    const arp = [tones[0] + 48, tones[2] + 48, tones[0] + 60, tones[1] + 60].map(m => m > 72 ? m - 12 : m);
    for (let e = 0; e < 4; e++) ev.push({ t: t0 + e * sb / 2, dur: sb * 0.9, midi: arp[e], amp: 0.07, harm: MA.PAD });
    for (let e = 0; e < 4; e++) ev.push({ t: t0 + e * sb / 2, hat: 1, gain: e % 2 ? 0.9 : 1 });
    if (h % 2 === 0) ev.push({ t: t0, kick: 1, gain: 0.5 }); else ev.push({ t: t0, snare: 1 });
    if (h >= 9) ev.push({ t: t0 + sb * 0.25, dur: sb * 1.5, midi: 60 + (tones[h % 3] % 12), amp: 0.1, harm: MA.LEAD });
  });
  return { samples: MA.render(ev, lead + SEQ.length * 2 * sb + 2, sr), sr, truth };
}
module.exports = { synth, SEQ };
if (require.main === module) { const { samples, sr, truth } = synth(); fs.writeFileSync(__dirname + '/sheet_song.wav', Buffer.from(MA.toWav(samples, sr))); fs.writeFileSync(__dirname + '/sheet_song_truth.json', JSON.stringify(truth)); console.log('chords', SEQ.length, 'seconds', (samples.length / sr).toFixed(1)); }
