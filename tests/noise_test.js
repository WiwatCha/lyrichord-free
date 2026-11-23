const MA=require('../web/analysis.js');
(async()=>{const {samples,sr}=MA.synthDemo();const r=await MA.analyze(samples,sr);const truth=['C','G','Am','F','C','G','G','C'];
for(const rate of [0.2,0.35,0.5]){let ok=0,n=0,okRaw=0;
 for(let sd=1;sd<=10;sd++){let seed=sd*7919;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const noisy=r.chords.map(c=>{if(c.root<0||rnd()>rate)return c;const o=[{root:(c.root+7)%12,q:'sus4'},{root:(c.root+9)%12,q:'m7'},{root:c.root,q:'maj7'},{root:(c.root+5)%12,q:''},{root:(c.root+4)%12,q:'m'}][Math.floor(rnd()*5)];return {...o,bass:-1};});
  const ph=1,bars=[[0]];for(let i=ph;i<noisy.length;i+=4)bars.push([0,1,2,3].map(k=>i+k).filter(k=>k<noisy.length));
  const lv=MA.levels(noisy,bars,r.key,4);
  for(let b=1;b<=16;b++){const t=truth[(b-1)%8];n++;if(MA.name(lv.very[b][0].chord,0,'very')===t)ok++;
   // raw = majority triad per bar without loop smoothing
   const cnt={};bars[b].forEach(i=>{const k=MA.name(noisy[i],0,'very');cnt[k]=(cnt[k]||0)+1});const mx=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];if(mx===t)okRaw++;}}
 console.log(`noise ${rate*100}%: very-simple ${ok}/${n} bars correct  (plain majority vote ${okRaw}/${n})`);}})();
