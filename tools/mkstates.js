const fs=require("fs"),out=process.argv[2]||"states.json";
const topo=JSON.parse(fs.readFileSync(path+"/node_modules/us-atlas/states-10m.json"));
const tc=require("topojson-client");
const fc=tc.feature(topo,topo.objects.states);
// FIPS -> postal
const F={"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY","72":"PR"};
// keep every ring, simplify by dropping points closer than ~0.02 deg, round to 0.01
const simp=ring=>{const o=[];let l=null;for(const [x,y] of ring){const p=[Math.round(x*100)/100,Math.round(y*100)/100];if(!l||Math.abs(p[0]-l[0])+Math.abs(p[1]-l[1])>=0.03){o.push(p);l=p}}if(o.length<4)return null;return o};
const S={};for(const f of fc.features){const ab=F[f.id];if(!ab)continue;const g=f.geometry,polys=g.type==="Polygon"?[g.coordinates]:g.coordinates;
  S[ab]=polys.map(p=>p.map(simp).filter(Boolean)).filter(p=>p.length).map(p=>p.map(r=>r.flat()));}
fs.writeFileSync(out,JSON.stringify(S));console.log(Object.keys(S).length,"states",fs.statSync(out).size,"bytes");
