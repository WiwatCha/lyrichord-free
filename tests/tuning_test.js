// detuned recording: the whole demo song played 40 cents sharp
const MA = require('../web/analysis.js');
(async () => {
  for (const det of [0, 0.4, -0.3]) {
    MA.render.detune = det; const { samples, sr } = MA.synthDemo(); MA.render.detune = 0;
    for (const tune of [false, true]) {
      MA.CFG.tune = tune;
      const r = await MA.analyze(samples, sr);
      const bars = [], ph = 1; for (let i = ph; i + 3 < r.chords.length; i += 4) bars.push([0, 1, 2, 3].map(k => i + k));
      const lv = MA.levels(r.chords, bars, r.key, 4).very.slice(0, 8).map(b => MA.name(b[0].chord, 0, 'very')).join(' ');
      const notes = r.notes.filter(n => n.t0 < 20).map(n => n.midi).slice(0, 10).join(' ');
      console.log(`detune ${String(det * 100).padStart(4)}c  tuning-fix ${tune ? 'on ' : 'off'} -> est ${String(r.tuning).padStart(4)}c | bars: ${lv} | melody: ${notes}`);
    }
  }
})();
