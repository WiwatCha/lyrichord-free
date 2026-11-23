const MA=require('../web/analysis.js');const fs=require('fs');
const d=MA.synthDemo(44100);fs.writeFileSync(require('path').join(__dirname,'demo.wav'),Buffer.from(MA.toWav(d.samples,44100)));
const ev=[],truth=[],sb=0.6;let seed=3;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;let beat=0;
for(let rep=0;rep<2;rep++)for(const qq of MA.QS){const root=Math.floor(rnd()*12),ivs=qq.ivs.map(x=>x[0]);
 const t0=0.5+beat*sb;for(const iv of ivs){const pc=(root+iv)%12;ev.push({t:t0,dur:4*sb-0.05,midi:48+pc+(pc<5?12:0),amp:0.06,harm:MA.PAD});}
 ev.push({t:t0,dur:4*sb-0.05,midi:36+root,amp:0.2,harm:MA.BASS});for(let b=0;b<4;b++)ev.push({t:t0+b*sb,kick:1});
 truth.push({t:t0+2*sb,root,q:qq.q});beat+=4;}
fs.writeFileSync(require('path').join(__dirname,'vocab.wav'),Buffer.from(MA.toWav(MA.render(ev,1+beat*sb,44100),44100)));fs.writeFileSync(require('path').join(__dirname,'vocab_truth.json'),JSON.stringify(truth));
