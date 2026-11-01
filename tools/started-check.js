// Run: serve the repo (python3 -m http.server 8765), then node tools/started-check.js. Fakes the clock 40 min after a kickoff on each sport.
// Started-games check: fake the clock mid-slate and make sure nothing offered to bet uses a started game
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();let fails=0;
for(const sp of ['','?nba','?cfb','?cbb']){
  const nm=sp.replace('?','')||'nfl';
  let p=await b.newPage({viewport:{width:390,height:844}});
  await p.goto('http://localhost:8765/'+sp);await p.evaluate(()=>{localStorage.clear();localStorage.age21='yes';localStorage.tour1='seen';localStorage.setup1='done'});
  await p.goto('http://localhost:8765/'+sp);await p.waitForTimeout(2500);
  // pick a time 40 min after a kickoff that still has later games
  const ts=await p.evaluate(()=>[...new Set(GAMES.map(g=>+new Date(g.t)))].sort((a,b)=>a-b));
  await p.close();
  const cand=ts.filter((t,i)=>i<ts.length-1&&t>Date.now()-2*864e5);if(!cand.length){console.log(nm,'no slate with later games; skipped');continue}
  for(const k of [...new Set([cand[0],cand[Math.floor(cand.length/2)]])]){
    const T=k+40*6e4;p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
    await p.clock.install({time:new Date(T)});
    await p.goto('http://localhost:8765/'+sp);await p.evaluate(()=>{localStorage.age21='yes';localStorage.tour1='seen';localStorage.setup1='done'});
    await p.goto('http://localhost:8765/'+sp);await p.clock.runFor(3000);await p.waitForTimeout(500);
    const r=await p.evaluate(()=>{const now=Date.now(),gt={};GAMES.forEach(g=>gt[g.id]=+new Date(g.t));PROPS.forEach(x=>gt[x.ev]=+new Date(x.g.t));
      const started=id=>gt[id]!=null&&gt[id]<=now,bad=[];let n={slips:0,pool:0,build:0,props:0};
      const chk=(where,ev,name)=>{if(started(ev))bad.push(where+': '+name)};
      try{slateList().forEach(s=>{(s.list()||[]).forEach(sl=>{if(!sl)return;n.slips++;(sl.l||sl.legs||[]).forEach(l=>chk('slate '+s.label+' / '+(sl.n||''),l.ev,l.n))})})}catch(e){bad.push('slateList error '+e.message)}
      ['par','ply','tm'].forEach(cx=>{try{if(!GENS[cx])return;const P=genPool(cx);(P.pool||[]).forEach(x=>{n.pool++;chk('generator '+cx,x.leg.ev,x.leg.n)})}catch(e){}});
      try{buildRows().forEach(r=>{n.build++;chk('build',r.leg.ev||(r.g&&r.g.id),r.leg.n)})}catch(e){bad.push('buildRows error '+e.message)}
      // Players tab list: what renderProps shows (PROPS filtered by chip)
      try{PROPS.forEach(x=>{if(started(x.ev)){n.props++}})}catch(e){}
      return{now:new Date(now).toString().slice(0,21),started:Object.keys(gt).filter(started).length,upcoming:Object.keys(gt).filter(i=>!started(i)).length,n,bad:bad.slice(0,8),nbad:bad.length}});
    // Players tab: rendered prop rows for started games?
    let shownStarted=0;
    if(sp===''||sp==='?nba'){shownStarted=await p.evaluate(()=>{const now=Date.now();const evs=new Set(PROPS.filter(x=>+new Date(x.g.t)<=now).map(x=>x.player));
      try{renderProps()}catch(e){};return [...document.querySelectorAll('#props .pname,#props h3')].filter(e=>evs.has(e.textContent.trim())).length})}
    const ok=r.nbad===0;if(!ok)fails++;
    console.log(`${nm} @ ${r.now}: ${r.started} started / ${r.upcoming} upcoming | checked ${r.n.slips} slips, ${r.n.pool} generator picks, ${r.n.build} Build rows | started-game props still in PROPS: ${r.n.props}, shown on Players: ${shownStarted} | ${ok?'PASS':'FAIL'} ${r.bad.join(' ; ')} ${errs.join(';')}`);
    await p.close()}}
console.log(fails?fails+' FAILED':'ALL PASS');await b.close()})();
