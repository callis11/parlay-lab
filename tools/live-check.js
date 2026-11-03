// Live-odds check: serve the repo (python3 -m http.server 8765), then node tools/live-check.js
// Fakes the clock 40 min after a kickoff and mocks ESPN's scoreboard for the started games:
//   game A: home team way ahead (ESPN 94%), game B: close (home 62%), game C: away team losing big (8%).
// Must hold everywhere (slate lists, 3 generators, Build rows, Top list, game cards, slip):
//   - nothing from a started game except a LIVE moneyline on a team at 25%+ (the losing-big team never shows up)
//   - no spread, total or player line from a started game
//   - the live leg's % is ESPN's number; when ESPN drops a team under the bar, the leg leaves after the next check
//   - with ESPN unreachable, started games are left out completely (as before this build)
const {chromium}=require('playwright');const fs=require('fs');
const SP=['','?nba','?cfb','?cbb'],DIRS={'':'','?nba':'nba/','?cfb':'cfb/','?cbb':'cbb/'},ABBR={LA:'LAR',WAS:'WSH'};
function board(games,meta,scen){ // scen[ev] = {h,a,hs,as,detail}
  return {events:games.map(g=>{const m=meta[g.id],s=scen[g.id];if(!m||!s)return null;const st={type:{state:s.state||'in',shortDetail:s.detail||'Q2 5:00'}};
    return {id:m.gid||('x'+g.id.slice(0,8)),date:g.t,status:st,competitions:[{status:st,competitors:[
      {homeAway:'home',score:String(s.hs),team:{abbreviation:ABBR[m.home]||m.home}},{homeAway:'away',score:String(s.as),team:{abbreviation:ABBR[m.away]||m.away}}],
      situation:s.h==null?{}:{lastPlay:{probability:{homeWinPercentage:s.h,awayWinPercentage:s.a}}}}]}}).filter(Boolean)};}
(async()=>{const b=await chromium.launch();let fails=0;
for(const sp of (process.env.ONLY?[process.env.ONLY]:SP)){const nm=sp.replace('?','')||'nfl';const meta=JSON.parse(fs.readFileSync(DIRS[sp]+'data.json')).games;
  let p=await b.newPage({viewport:{width:390,height:844}});
  await p.goto('http://localhost:8765/'+sp);await p.evaluate(()=>{localStorage.clear();localStorage.age21='yes';localStorage.tour1='seen';localStorage.setup1='done'});
  await p.goto('http://localhost:8765/'+sp);await p.waitForTimeout(2500);
  const games=await p.evaluate(()=>GAMES.map(g=>({id:g.id,t:g.t,away:g.away,home:g.home})));await p.close();
  const ts=[...new Set(games.map(g=>+new Date(g.t)))].sort((a,b)=>a-b).filter((t,i,a)=>i<a.length-1&&t>Date.now()-2*864e5);
  // a kickoff with at least 3 games (so we get a blowout, a close one and a collapse) and later games still to come
  const T0=ts.find(t=>games.filter(g=>+new Date(g.t)===t).length>=3)||ts[0];if(!T0){console.log(nm,'no slate with later games; skipped');continue}
  const T=T0+40*6e4,started=games.filter(g=>+new Date(g.t)<=T&&+new Date(g.t)>T-4*36e5),scen={};
  const S=started.filter(g=>+new Date(g.t)===T0).slice(0,3);S.forEach((g,i)=>{scen[g.id]=[{h:.94,a:.06,hs:28,as:3},{h:.62,a:.38,hs:17,as:14},{h:.92,a:.08,hs:31,as:7}][i]});
  const closeId=S[1]&&S[1].id,blowId=S[0]&&S[0].id,collapseId=S[2]&&S[2].id;
  for(const mode of ['espn','down']){
    p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
    let drop=false;
    await p.route('**/site.api.espn.com/**',r=>{if(mode==='down')return r.abort();const sc=JSON.parse(JSON.stringify(scen));if(drop&&closeId)sc[closeId]={h:.2,a:.8,hs:17,as:24};r.fulfill({contentType:'application/json',body:JSON.stringify(board(started,meta,sc))})});
    await p.route('**/sports.core.api.espn.com/**',r=>r.abort());
    await p.clock.install({time:new Date(T)});
    await p.goto('http://localhost:8765/'+sp);await p.evaluate(()=>{localStorage.age21='yes';localStorage.tour1='seen';localStorage.setup1='done';localStorage.removeItem('slip_nfl');localStorage.removeItem('slip_nba');localStorage.removeItem('slip_cfb');localStorage.removeItem('slip_cbb')});
    await p.goto('http://localhost:8765/'+sp);await p.clock.runFor(4000);await p.waitForTimeout(800);
    // wait for the first ESPN check to finish (a real phone gets it a moment after the page opens)
    for(let i=0;i<20&&!(await p.evaluate(()=>LIVE.at>0&&!LIVE.busy));i++){await p.clock.runFor(1000);await p.waitForTimeout(250)}
    const check=async(label)=>p.evaluate(({mode,closeId,blowId,collapseId})=>{const now=Date.now(),gt={};GAMES.forEach(g=>gt[g.id]=+new Date(g.t));PROPS.forEach(x=>gt[x.ev]=+new Date(x.g.t));
      const started=id=>gt[id]!=null&&gt[id]<=now,bad=[],live=[];let n={slips:0,pool:0,build:0};
      const chk=(where,l)=>{if(!started(l.ev))return;const ok=l.live&&l.kind==='g'&&/^ml-/.test(l.t)&&l.p>=Engine.LIVE_MIN&&mode==='espn'&&!legStarted(l);if(ok)live.push(where+': '+l.n+' '+Math.round(l.p*100)+'% '+l.a);else bad.push(where+': '+l.n+(l.live?' (live '+Math.round(l.p*100)+'%)':''))};
      try{slateList().forEach(s=>{(s.list()||[]).forEach(sl=>{if(!sl)return;n.slips++;(sl.l||[]).forEach(l=>chk('slate '+s.label+' / '+(sl.n||''),l))})})}catch(e){bad.push('slateList error '+e.message)}
      ['par','ply','tm'].forEach(cx=>{try{if(!GENS[cx])return;GENS[cx].games='all';const P=genPool(cx);(P.pool||[]).forEach(x=>{n.pool++;chk('generator '+cx+' '+GENS[cx].style,x.leg)})}catch(e){bad.push('genPool '+cx+' '+e.message)}});
      try{BLD.mode='full';BLD.game='';BLD.win='';buildRows().forEach(r=>{n.build++;chk('build',r.leg)})}catch(e){bad.push('buildRows error '+e.message)}
      try{BLD.mode='top';const h=topListHTML();if(/started/.test(h)&&mode!=='espn')bad.push('top list mentions started')}catch(e){bad.push('topList error '+e.message)}
      // the collapsing team (8%) must never be offered; the blowout leader (94%) is too lopsided for parlays (est. price about -2400) but may show on its game card
      const names=live.join(' ');const collapse=GAMES.filter(g=>g.id===collapseId)[0];if(collapse&&new RegExp(collapse.away+' ML').test(names))bad.push('collapsing team offered: '+collapse.away);
      // game card buttons: started games only have live ML buttons enabled
      try{renderGames();document.querySelectorAll('#games .card').forEach(c=>{const id=c.id.replace('gc-','');if(!started(id))return;c.querySelectorAll('button.pick:not([disabled])').forEach(bt=>{if(!/ml-/.test(bt.dataset.t)||!bt.classList.contains('live'))bad.push('game card enabled '+bt.dataset.t)})})}catch(e){bad.push('renderGames '+e.message)}
      return{n,bad:bad.slice(0,8),nbad:bad.length,live:live.slice(0,6),nlive:live.length,sig:LIVE.sig,fail:LIVE.fail,at:LIVE.at}},{mode,closeId,blowId,collapseId});
    let r=await check('first');
    let okLive=mode!=='espn'||r.nlive>0;
    // slip: the live leg from the close game can be added; after ESPN drops that team to 20% and the next minute's check, it leaves
    let slipNote='';
    if(mode==='espn'&&closeId){
      const s1=await p.evaluate(({id,cid})=>{const g=GAMES.filter(x=>x.id===id)[0],gc=GAMES.filter(x=>x.id===cid)[0];if(!g||!gc)return 'no game '+id+' of '+GAMES.length;try{const L=gameLeg(g,'ml-h'),La=gameLeg(gc,'ml-a');SLIP[L.k]=L;renderSlip();return (L.live?'live '+Math.round(L.p*100)+'% '+L.a:'NOT LIVE')+' | collapsing away leg started='+legStarted(La)+' | home started='+legStarted(L)}catch(e){return 'ERR '+e.stack.slice(0,300)}},{id:closeId,cid:collapseId});
      drop=true;await p.clock.runFor(61000);await p.waitForTimeout(800);
      const s2=await p.evaluate((id)=>{const g=GAMES.filter(x=>x.id===id)[0];if(!g)return{err:'gone '+id+' GAMES='+GAMES.length+' url='+location.href+' '+GAMES.map(x=>x.id.slice(0,6)).join(',')};const L=gameLeg(g,'ml-h');const inPools=['par','ply','tm'].some(cx=>GENS[cx]&&genPool(cx).pool.some(x=>x.leg.ev===id&&x.leg.t==='ml-h'));const inSlates=slateList().some(s=>(s.list()||[]).some(sl=>sl&&sl.l.some(l=>l.ev===id&&l.t==='ml-h')));
        renderSlip();const txt=($("panel")||{}).textContent||'';return {started:legStarted(L),inPools,inSlates,wp:g.live&&g.live.wp&&g.live.wp.h,removeMsg:/remove it/.test(txt)}},closeId);
      slipNote=' | slip: '+s1+(s2.err?' ERR '+s2.err:'')+' → after drop to 20%: started='+s2.started+' inPools='+s2.inPools+' inSlates='+s2.inSlates+' wp='+s2.wp+' removeMsg='+s2.removeMsg;
      if(!/^live/.test(s1)||!/collapsing away leg started=true/.test(s1)||!s2.started||s2.inPools||s2.inSlates||!s2.removeMsg)okLive=false;
    }
    const ok=r.nbad===0&&okLive&&!errs.length;if(!ok)fails++;
    console.log(`${nm} [${mode}] ${started.length} started: ${r.n.slips} slips, ${r.n.pool} gen picks, ${r.n.build} build rows | live legs offered: ${r.nlive} ${r.live.join(' ; ')}${slipNote} | ${ok?'PASS':'FAIL'} ${r.bad.join(' ; ')} ${errs.join(';')}`);
    await p.close()}}
console.log(fails?fails+' FAILED':'ALL PASS');await b.close()})();
