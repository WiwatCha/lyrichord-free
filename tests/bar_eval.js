// browser engine: bar-aware decoding on First Love-style songs (node tests/bar_eval.js)
const MA = require('../web/analysis.js'), B = require('./ballad.js'), S = require('./sheet_song.js'), fs = require('fs');
const fam = c => !c || c.root < 0 ? 'N' : c.root + MA.baseOf(c.q);
function score(r, truth) {
  const b = r.beats, at = t => { let i = 0; while (i + 1 < b.length && b[i + 1] <= t) i++; return r.chords[i]; };
  const tf = h => fam({ root: h.root, q: h.q });
  let ok = 0; truth.forEach(h => { if (fam(at(h.t0 + 0.75 * (h.t1 - h.t0))) === tf(h)) ok++; });
  const tchg = truth.filter((h, k) => k && tf(truth[k - 1]) !== tf(h)).map(h => h.t0);
  const found = tchg.filter(t => fam(at(t - .3)) !== fam(at(t + .3))).length;
  let fals = 0; for (let i = 1; i < r.chords.length; i++) if (r.chords[i].root >= 0 && fam(r.chords[i]) !== fam(r.chords[i - 1]) && b[i] > truth[0].t0 && b[i] < truth[truth.length - 1].t1 && !tchg.some(x => Math.abs(x - b[i]) < 0.3)) fals++;
  return `${ok}/${truth.length} chg ${found}/${tchg.length} false ${fals} ${r.bpm}bpm ${r.meter.num}/${r.meter.den}`;
}
(async () => {
  const songs = [['ballad', B.synth(22050, 90, {})], ['hats', B.synth(22050, 90, { hat: 4, noDrums: true })], ['sheet', S.synth()]];
  for (const [name, bar, rep] of [['before', false, false], ['bar-aware', true, false], ['bar+repeat', true, true]]) {
    MA.CFG.barAware = bar; MA.CFG.repeatVote = rep; const out = [];
    for (const [n, s] of songs) out.push(`${n}: ${score(await MA.analyze(s.samples, s.sr), s.truth)}`);
    console.log(name.padEnd(11), out.join(' | '));
  }
})();
