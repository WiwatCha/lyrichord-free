const MA=require('../web/analysis.js');
const nm=(c,f)=>MA.name(c,f,'advance');
(async()=>{
 const {samples,sr}=MA.synthDemo(); let t=Date.now();
 const r=await MA.analyze(samples,sr);
 let s='';r.chords.forEach((c,i)=>{if((i-r.phase)%4===0)s+=' |';s+=' '+nm(c,r.flats)});
 console.log('demo ms',Date.now()-t,'bpm',r.bpm,'key',MA.name({root:r.key.root,q:r.key.q,bass:-1},r.flats),'\n',s);
 // vocabulary test
 const QS=MA.QS.map(x=>x.q); const ev=[]; const truth=[]; const sb=0.6; let seed=3; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 let beat=0;
 for(let rep=0;rep<2;rep++) for(const qq of MA.QS){
   const root=Math.floor(rnd()*12), ivs=qq.ivs.map(x=>x[0]).sort((a,b)=>a-b);
   const t0=0.5+beat*sb; const pad=ivs.map(iv=>48+((root+iv)%12)+( (root+iv)%12<5?12:0)); // voice in 53..64ish
   for(const m of pad) ev.push({t:t0,dur:4*sb-0.05,midi:m,amp:0.06,harm:MA.PAD});
   ev.push({t:t0,dur:4*sb-0.05,midi:36+root,amp:0.2,harm:MA.BASS});
   for(let b=0;b<4;b++) ev.push({t:t0+b*sb,kick:1});
   truth.push({beat,root,q:qq.q}); beat+=4;
 }
 const y=MA.render(ev,1+beat*sb,22050); const r2=await MA.analyze(y,22050);
 let ok=0,okb=0,errs=[];
 for(const tr of truth){ const tm=0.5+(tr.beat+2)*sb; let i=0; while(i+1<r2.beats.length&&r2.beats[i+1]<=tm)i++;
   const c=r2.chords[i]; const good=c.root===tr.root&&c.q===tr.q; ok+=good; okb+=(c.root===tr.root&&MA.baseOf(c.q)===MA.baseOf(tr.q));
   if(!good) errs.push(MA.name({root:tr.root,q:tr.q,bass:-1},false)+'→'+nm(c,false)); }
 console.log(`vocab exact ${ok}/${truth.length}, basic ${okb}/${truth.length}`); console.log(errs.join('  '));
})();
