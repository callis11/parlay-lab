// Signal study, step 3: scores every past pick by the signs that held up (see HANDOFF "Signal study"), prints hit vs book by
// score, each sign alone, and a weekly parlay simulation. Needs backtest/study-rows.json.gz. Run: node backtest/study-rules.js
const fs=require("fs"),zlib=require("zlib");
const R=JSON.parse(zlib.gunzipSync(fs.readFileSync("backtest/study-rows.json.gz")));
const dec=a=>a>0?1+a/100:1+100/-a,imp=a=>1/dec(a),mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,pct=x=>(100*x).toFixed(1);
const P=R.filter(r=>r.k==="p");const band=a=>a<=-300?"big":a<=-150?"fav":a<130?"even":a<300?"dog":"long";const hold={};
for(const r of P)if(r.nv==null){const k=r.mkt+"|"+r.side+"|"+band(r.a);const h=hold[k]=hold[k]||{n:0,d:0};h.n++;h.d+=imp(r.a)-r.won;}
for(const r of P)r.bk=r.nv!=null?r.nv:Math.max(.02,imp(r.a)-hold[r.mkt+"|"+r.side+"|"+band(r.a)].d/hold[r.mkt+"|"+r.side+"|"+band(r.a)].n);
const S=P.filter(r=>r.healthy&&r.a>=-700&&r.a<=250&&r.bp>=.45);
// score each pick: +1 per good sign, -1 per bad sign
function flags(r){const f=[];const ov=r.side==="over",un=r.side==="under",windy=!r.dome&&r.wind!=null&&r.wind>=15;
 if(ov&&windy)f.push("-wind");if(un&&windy)f.push("+wind");
 if(un&&/Rush|Recept/.test(r.mkt))f.push("+under-type");
 if(un&&r.tsp>=4.5)f.push("+dog-under");if(ov&&r.tsp>=4.5)f.push("-dog-over");
 if(ov&&r.pass>=.61&&/Pass|Rece/.test(r.mkt))f.push("-passheavy");
 if(ov&&r.home)f.push("+home");if(ov&&!r.home&&!r.dome)f.push("-away-outdoor");
 if(un&&r.oppF<.98)f.push("+under-vs-D");if(ov&&r.oppF>1.01)f.push("+over-vs-softD");
 if(r.wk<=4||r.gp<=2)f.push("-early");
 if(ov&&r.rest>=8&&r.rest<=10)f.push("+rest");
 if(r.rp-r.bk>=.12)f.push("-hist-too-high");
 if(ov&&/Rece/.test(r.mkt)&&r.tgt3>=.2)f.push("-star-over");
 if(r.missed)f.push("-missed");
 if(r.lmv!=null&&r.lmv>0)f.push("+line-toward");if(r.lmv!=null&&r.lmv<0)f.push("-line-against");
 if(r.pmv!=null&&r.pmv<=-3)f.push("-price-against");
 return f;}
for(const r of S){r.f=flags(r);r.sc=r.f.filter(x=>x[0]==="+").length-r.f.filter(x=>x[0]==="-").length;}
const row=(label,L)=>{if(L.length<100)return;const per=[2023,2024,2025].map(s=>{const X=L.filter(r=>r.s===s);return X.length<60?"  ·  ":((100*mean(X.map(r=>r.won-r.bk)))>=0?"+":"")+(100*mean(X.map(r=>r.won-r.bk))).toFixed(1);});
 console.log(label.padEnd(34),String(L.length).padStart(6),"hit",pct(mean(L.map(r=>r.won))),"book",pct(mean(L.map(r=>r.bk))),"gap",((100*mean(L.map(r=>r.won-r.bk)))>=0?"+":"")+(100*mean(L.map(r=>r.won-r.bk))).toFixed(1),per.join(" "));};
console.log("Net score = good signs minus bad signs (all site-type picks)");
for(const s of [-3,-2,-1,0,1,2,3])row("score "+s,S.filter(r=>r.sc===s));
row("score >= 2",S.filter(r=>r.sc>=2));row("score <= -1",S.filter(r=>r.sc<=-1));
console.log("\nSafe-parlay range (book 65-90%):");
for(const s of [-2,-1,0,1,2])row("score "+(s===2?">=2":s===-2?"<=-2":s),S.filter(r=>r.bk>=.65&&r.bk<.9&&(s===2?r.sc>=2:s===-2?r.sc<=-2:r.sc===s)));
console.log("\nEach sign on its own:");
const all=[...new Set(S.flatMap(r=>r.f))].sort();for(const k of all)row(k,S.filter(r=>r.f.includes(k)));
// parlay sim: per week, 3 safest by book among score>=1 vs 3 safest by book overall (main lines, one per player, book 65-90%)
let a=[0,0],b=[0,0],a5=[0,0],b5=[0,0];const weeks=[...new Set(S.map(r=>r.s+"|"+r.wk))];
const top=(L,k)=>{const seen={},o=[];for(const r of L.sort((x,y)=>y.bk-x.bk)){if(seen[r.player])continue;seen[r.player]=1;o.push(r);if(o.length===k)break;}return o;};
for(const w of weeks){const L=S.filter(r=>r.s+"|"+r.wk===w&&r.bk>=.65&&r.bk<.9);if(L.length<30)continue;
 const base3=top(L.slice(),3),rule3=top(L.filter(r=>r.sc>=1),3),base5=top(L.slice(),5),rule5=top(L.filter(r=>r.sc>=1),5);
 if(rule3.length<3||rule5.length<5)continue;a[0]++;b[0]++;a5[0]++;b5[0]++;if(base3.every(r=>r.won))a[1]++;if(rule3.every(r=>r.won))b[1]++;if(base5.every(r=>r.won))a5[1]++;if(rule5.every(r=>r.won))b5[1]++;}
console.log(`\nWeekly 3-pick parlay, safest main lines: book-only ${a[1]}/${a[0]} (${pct(a[1]/a[0])}%) vs rules ${b[1]}/${b[0]} (${pct(b[1]/b[0])}%)`);
console.log(`Weekly 5-pick: book-only ${a5[1]}/${a5[0]} (${pct(a5[1]/a5[0])}%) vs rules ${b5[1]}/${b5[0]} (${pct(b5[1]/b5[0])}%)`);
// same sim but 3 and 5 picks with the HIGHEST rule score first (ties by book), vs book only, and by season
for(const season of [2023,2024,2025]){let a=[0,0],b=[0,0];for(const w of weeks){if(!w.startsWith(season))continue;const L=S.filter(r=>r.s+"|"+r.wk===w&&r.bk>=.65&&r.bk<.9);if(L.length<30)continue;
 const base=top(L.slice(),4);const seen={},rule=[];for(const r of L.sort((x,y)=>(y.sc-x.sc)||(y.bk-x.bk))){if(seen[r.player])continue;seen[r.player]=1;rule.push(r);if(rule.length===4)break;}
 if(rule.length<4)continue;a[0]++;b[0]++;if(base.every(r=>r.won))a[1]++;if(rule.every(r=>r.won))b[1]++;}
 console.log(`${season} weekly 4-pick: safest-by-book ${a[1]}/${a[0]} won, best-signs-first ${b[1]}/${b[0]} won`);}
