// auto-tuning must never make things worse: in-tune songs, tuning that drifts mid-song,
// and recordings pitched about half a semitone off (where the direction of the fix is ambiguous)
const MA = require('../web/analysis.js');
const TRUTH = 'C2 G/B Am7 Fmaj7 C Gsus4 G7 C'.split(' ');
const score = r => { let ok = 0, n = 0;
  for (let b = 0; b < 16; b++) { const i = 1 + b * 4; if (i + 3 >= r.chords.length) break; n++;
    if (MA.name(r.chords[i + 1], 0, 'advance') === TRUTH[b % 8] || MA.name(r.chords[i], 0, 'advance') === TRUTH[b % 8]) ok++; }
  return `${ok}/${n}`; };
(async () => {
  const demo = det => { MA.render.detune = det; const d = MA.synthDemo(); MA.render.detune = 0; return d; };
  const cases = [['in tune', demo(0).samples], ['+20c', demo(0.2).samples], ['+48c', demo(0.48).samples], ['-48c', demo(-0.48).samples]];
  // drifting: first third 45 cents sharp, the rest in tune
  const a = demo(0.45).samples, b = demo(0).samples, mix = Float32Array.from(b); mix.set(a.subarray(0, Math.floor(a.length / 3)));
  cases.push(['drift', mix]);
  const sr = demo(0).sr;
  for (const [name, x] of cases) {
    const off = await MA.analyze(x, sr, () => {}, { tune: 'off' }), auto = await MA.analyze(x, sr);
    console.log(`${name.padEnd(8)} est ${String(auto.tuning_est).padStart(4)}c -> applied ${String(auto.tuning).padStart(4)}c (${auto.tune_note.padEnd(8)}) | bars correct: tuning off ${score(off)}  auto ${score(auto)}`);
  }
})();
