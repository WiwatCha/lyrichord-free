const MA=require('../web/analysis.js');
const nm=(c,m)=>MA.name(c,false,m);
function bars(n,bpb,ph){const b=[];if(ph)b.push([...Array(ph).keys()]);for(let i=ph;i<n;i+=bpb)b.push([...Array(Math.min(bpb,n-i)).keys()].map(k=>i+k));return b;}
function show(lv,mode,key,n=10){return lv[mode].slice(0,n).map(segs=>segs.map(s=>nm(s.chord,mode==='very'?'very':'advance')).join(' ')).join(' | ');}
(async()=>{
 // 4/4 demo
 const {samples,sr}=MA.synthDemo(); const r=await MA.analyze(samples,sr);
 const m=MA.detectMeter(r.chords,r.accent,r.bpm); console.log('demo meter',m.num+'/'+m.den,'phase',m.phase);
 const B=bars(r.chords.length,m.bpb,m.phase); let lv=MA.levels(r.chords,B,r.key,m.bpb);
 console.log(' very :',show(lv,'very',r.key)); console.log(' roman:',lv.very.slice(1,9).map(s=>MA.roman(s[0].chord,r.key)).join('-'));
 console.log(' plus :',show(lv,'plus',r.key)); console.log(' adv  :',show(lv,'advance',r.key));
 // noisy copy
 let seed=5;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const noisy=r.chords.map(c=>{if(c.root<0||rnd()>0.35)return c;const opts=[{root:(c.root+7)%12,q:'sus4',bass:-1},{root:(c.root+9)%12,q:'m7',bass:-1},{root:c.root,q:'maj7',bass:-1},{root:(c.root+5)%12,q:'',bass:-1},{root:(c.root+4)%12,q:'m',bass:-1}];return opts[Math.floor(rnd()*opts.length)];});
 const m2=MA.detectMeter(noisy,r.accent,r.bpm);const B2=bars(noisy.length,m2.bpb,m2.phase);const lv2=MA.levels(noisy,B2,r.key,m2.bpb);
 console.log('noisy meter',m2.num+'/'+m2.den,'loop',lv2.loop); console.log(' raw  :',noisy.slice(1,21).map(c=>nm(c)).join(' '));
 console.log(' very :',show(lv2,'very',r.key,17));
 // 3/4 waltz: C C F G Am F G C x2 at 120bpm
 const sb=0.5, prog=[[0,''],[0,''],[5,''],[7,''],[9,'m'],[5,''],[7,''],[0,'']], ev=[]; let beat=0;
 for(let rep=0;rep<2;rep++)for(const [rt,q] of prog){const t0=0.5+beat*sb, ivs=q?[0,3,7]:[0,4,7];
   for(const iv of ivs)ev.push({t:t0,dur:3*sb-0.05,midi:48+((rt+iv)%12)+(((rt+iv)%12)<5?12:0),amp:0.06,harm:MA.PAD});
   ev.push({t:t0,dur:sb,midi:36+rt,amp:0.22,harm:MA.BASS});
   for(let b=0;b<3;b++)ev.push({t:t0+b*sb,kick:1,gain:b===0?1:0.35}); beat+=3;}
 const y=MA.render(ev,1+beat*sb,22050); const w=await MA.analyze(y,22050); const m3=MA.detectMeter(w.chords,w.accent,w.bpm);
 const B3=bars(w.chords.length,m3.bpb,m3.phase); const lv3=MA.levels(w.chords,B3,w.key,m3.bpb);
 console.log('waltz bpm',w.bpm,'meter',m3.num+'/'+m3.den,'phase',m3.phase); console.log(' very :',show(lv3,'very',w.key,10));
 console.log('spelling:',[3,10,1,6,8].map(r=>MA.name({root:r,q:'m7b5',bass:-1})).join(' '));
})();
