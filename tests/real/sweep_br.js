// browser engine on the real songs: same metrics as sweep_be.py (reference matched by time, verified 17-100 s)
const MA = require('../../web/analysis.js'), fs = require('fs'), { execFileSync } = require('child_process');
const load = n => { const b = fs.readFileSync(`/tmp/real/${n}.f32`); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const grid = JSON.parse(process.env.GRID || '[{}]');
(async () => {
  const songs = { fl: load('fl'), fm: load('fm') }, ref = JSON.parse(fs.readFileSync('/tmp/real/out/fl_ref2.json'));
  for (const g of grid) {
    for (const [k, v] of Object.entries(g)) if (k in MA.CFG) MA.CFG[k] = v; else MA.P[k] = v;
    const out = [JSON.stringify(g)];
    for (const n of ['fl', 'fm']) {
      const r = await MA.analyze(songs[n], 22050); fs.writeFileSync(`/tmp/real/out/${n}_brs.json`, JSON.stringify(r));
      const e = JSON.parse(execFileSync('python3', ['-c', `import json,sys; sys.path.insert(0,'tests/real'); import eval_real as E; r=json.load(open('/tmp/real/out/${n}_brs.json')); print(json.dumps(E.evaluate(r, E.sheet_chords('tests/real/${n === 'fl' ? 'first_love' : 'fly_me'}_sheet.txt'), ${n === 'fl' ? 0 : 9})))`]).toString());
      let extra = '';
      if (n === 'fl') {
        const at = t => { let i = 0; while (i + 1 < r.beats.length && r.beats[i + 1] <= t) i++; return r.chords[i]; };
        let ok = 0, rok = 0, tot = 0;
        ref.ref.forEach((x, i) => { const t = ref.beats[i]; if (!x || t <= 17 || t >= 100) return; const c = at(t + 0.1); tot++; if (c.root === x[0]) { rok++; if ((MA.baseOf(c.q) === 'm') === x[1]) ok++; } });
        extra = ` REF ${(ok / tot).toFixed(2)}/root ${(rok / tot).toFixed(2)}`;
      }
      out.push(`${n}: bpm ${r.bpm} pal ${e.palette.toFixed(2)} rec ${e.seq_recall.toFixed(2)} prec ${e.seq_precision.toFixed(2)} chg ${e.changes}${extra}`);
    }
    console.log(out.join(' | '));
  }
})();
