// "very simple" level on the real songs: per-beat root+major/minor against the bass-checked references,
// for the exact rule (new) and the loop-forcing rule (old), on each engine's output (node tests/real/very_eval.js tag...)
const MA = require('../../web/analysis.js'), fs = require('fs');
const REF = { fl: ['fl_ref2.json', 17, 100], fm: ['fm_ref.json', 31, 175] };
for (const tag of process.argv.slice(2)) for (const n of ['fl', 'fm']) {
  const r = JSON.parse(fs.readFileSync(`/tmp/real/out/${n}_${tag}.json`)), [rf, t0, t1] = REF[n], R = JSON.parse(fs.readFileSync('/tmp/real/out/' + rf));
  const bpb = r.meter.bpb, starts = r.bar_starts || Array.from({ length: Math.ceil(r.beats.length / bpb) }, (_, k) => r.meter.phase % bpb + k * bpb).filter(x => x < r.beats.length);
  const bars = []; if (starts[0] > 0) bars.push([...Array(starts[0]).keys()]);
  starts.forEach((s, k) => { const e = k + 1 < starts.length ? starts[k + 1] : r.beats.length; bars.push(Array.from({ length: e - s }, (_, j) => s + j)); });
  const out = [];
  for (const exact of [true, false]) {
    MA.CFG.veryExact = exact; const lv = MA.levels(r.chords, bars, r.key, bpb, []);
    const per = new Array(r.beats.length); lv.very.forEach(segs => segs.forEach(g => { for (let i = g.start; i < g.start + g.len; i++) per[i] = g.chord; }));
    let ok = 0, n2 = 0;
    R.ref.forEach((x, i) => { const t = R.beats[i]; if (!x || t <= t0 || t >= t1) return; let k = 0; while (k + 1 < r.beats.length && r.beats[k + 1] <= t + 0.1) k++; const c = per[k]; n2++; if (c && c.root === x[0] && (MA.baseOf(c.q) === 'm') === x[1]) ok++; });
    out.push(`${exact ? 'exact' : 'loop '} ${(ok / n2).toFixed(2)}`);
  }
  console.log(`${tag.padEnd(9)} ${n}: very-simple per-beat vs reference: ${out.join(' | ')}`);
}
