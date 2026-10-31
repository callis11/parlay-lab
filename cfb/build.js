// College football: builds cfb/data.json from cfb/odds.json + ESPN's public FBS scoreboard
// (school names, AP ranks, records, final scores for grading). Run from the repo root after cfb/fetch.js.

const fs = require("fs");
// SPORT=cbb builds men's college basketball (cbb/) from ESPN's Division I scoreboard instead
const SP = process.env.SPORT === "cbb" ? "cbb" : "cfb";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/" + (SP === "cbb" ? "basketball/mens-college-basketball" : "football/college-football");
const GROUPS = SP === "cbb" ? 50 : 80, BACK = SP === "cbb" ? -3 : -4, AHEAD = SP === "cbb" ? 5 : 9;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const etDate = t => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/\bst\b\.?/g, "state").replace(/[^a-z0-9]/g, "");
async function getJSON(u) { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 parlay-lab" } }); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); }

function parse(j) {
  return (j.events || []).map(ev => {
    const c = ev.competitions && ev.competitions[0]; if (!c) return null;
    const side = w => c.competitors.find(x => x.homeAway === w);
    const h = side("home"), a = side("away"); if (!h || !a) return null;
    const t = x => ({ id: x.team.id, conf: x.team.conferenceId || null, abbr: x.team.abbreviation, name: x.team.displayName, loc: x.team.location || x.team.shortDisplayName, score: +x.score || 0, h1: x.linescores && x.linescores.length >= 2 ? +(x.linescores[0].value != null ? x.linescores[0].value : x.linescores[0].displayValue) : null,
      rank: x.curatedRank && x.curatedRank.current && x.curatedRank.current <= 25 ? x.curatedRank.current : null,
      rec: (x.records || []).find(r => r.type === "total" || r.name === "overall") ? (x.records.find(r => r.type === "total" || r.name === "overall").summary) : (x.records && x.records[0] && x.records[0].summary) || null });
    // ESPN lists kickoff times not yet announced as midnight Eastern; flag those as TBD
    const tbd = (c.timeValid === false) || /T0[45]:00Z$/.test(ev.date);
    const ad = c.venue && c.venue.address;
    return { venue: !c.neutralSite && ad && ad.city ? { city: ad.city, state: ad.state || "" } : null, id: ev.id, t: ev.date, tbd, d: etDate(tbd ? new Date(+new Date(ev.date) + 6 * 36e5).toISOString() : ev.date), h: t(h), a: t(a), neutral: !!c.neutralSite, done: !!(ev.status && ev.status.type && ev.status.type.completed) };
  }).filter(Boolean);
}

(async () => {
  const odds = readJSON(SP + "/odds.json", null);
  if (!odds) { console.log("No " + SP + "/odds.json yet."); return; }
  const logs = readJSON(SP + "/logs.json", { games: {} });
  // Scoreboards from 4 days ago through 9 days ahead (covers grading and the coming week)
  const days = [];
  for (let i = BACK; i <= AHEAD; i++) days.push(new Date(Date.now() + i * 864e5).toISOString().slice(0, 10).replace(/-/g, ""));
  for (const d of days) {
    try { parse(await getJSON(`${ESPN}/scoreboard?dates=${d}&groups=${GROUPS}&limit=500`)).forEach(g => { logs.games[g.id] = g; }); }
    catch (e) { console.warn("scoreboard", d, e.message); }
  }
  for (const id in logs.games) if (new Date(logs.games[id].t) < Date.now() - 60 * 864e5) delete logs.games[id];
  fs.writeFileSync(SP + "/logs.json", JSON.stringify(logs));
  const all = Object.values(logs.games);
  console.log("ESPN games cached:", all.length);

  // Where each school is from ("Durham, NC"): its home arena/stadium from the scoreboards, else ESPN's team page (cached)
  const ST = { Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE","District of Columbia":"DC",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY" };
  const place = (city, st) => city + (st ? ", " + (ST[st] || st) : "");
  const places = readJSON(SP + "/places.json", {});
  all.forEach(g => { if (g.venue && !places[g.h.abbr]) places[g.h.abbr] = place(g.venue.city, g.venue.state); });
  // One-time backfill: last season's home games give nearly every school's home city
  for (const k in places) if (!places[k]) delete places[k];
  if (!places._backfilled) {
    const back = SP === "cbb" ? ["20260110","20260113","20260117","20260120","20260124","20260127","20260131","20260203","20260207","20260210","20260214","20260221","20260228"]
      : ["20250906","20250913","20250920","20250927","20251004","20251011","20251018","20251025","20251101","20251108","20251115","20251122"];
    for (const d of back) {
      try { parse(await getJSON(`${ESPN}/scoreboard?dates=${d}&groups=${GROUPS}&limit=500`)).forEach(g => { if (g.venue && !places[g.h.abbr]) places[g.h.abbr] = place(g.venue.city, g.venue.state); }); }
      catch (e) { console.warn("backfill", d, e.message); }
    }
    places._backfilled = true;
  }
  const looked = 0;
  fs.writeFileSync(SP + "/places.json", JSON.stringify(places));
  console.log("Places known:", Object.keys(places).length - 1);

  // Match each odds game to ESPN by school names and kickoff time
  const hist0 = readJSON(SP + "/history.json", {});
  const games = {}, names = {}; let matched = 0;
  const same = (oddsName, team) => { const o = norm(oddsName); return o === norm(team.name) || (norm(team.loc).length > 3 && o.startsWith(norm(team.loc)) && o.length - norm(team.loc).length < 18); };
  for (const ev of odds.lines || []) {
    const t = +new Date(ev.commence_time);
    const cands = all.filter(g => Math.abs(+new Date(g.t) - t) < (g.tbd ? 30 : 12) * 36e5);
    let g = cands.find(g => same(ev.home_team, g.h) && same(ev.away_team, g.a));
    if (!g) g = cands.find(g => norm(ev.home_team) === norm(g.h.name) || norm(ev.away_team) === norm(g.a.name));
    // Neutral-site games: the books and ESPN sometimes list home and away the other way round
    let flip = false;
    if (!g) { g = cands.find(g => same(ev.home_team, g.a) && same(ev.away_team, g.h)); flip = !!g; }
    if (!g) continue;
    if (flip) g = Object.assign({}, g, { h: g.a, a: g.h, neutral: true });
    matched++;
    const nm = x => (x.rank ? "#" + x.rank + " " : "") + x.loc;
    names[ev.home_team] = nm(g.h); names[ev.away_team] = nm(g.a);
    const b = (ev.bookmakers || []).find(x => x.key === "fanduel") || (ev.bookmakers || [])[0];
    const m = k => b && (b.markets || []).find(x => x.key === k), o = (mk, n) => mk && mk.outcomes.find(x => x.name === n);
    const sp = o(m("spreads"), ev.home_team), tt = o(m("totals"), "Over");
    const now = b ? { at: odds.fetchedAt, spread: sp ? sp.point : null, total: tt ? tt.point : null } : null;
    if (now && !hist0[ev.id]) hist0[ev.id] = { open: now, t: ev.commence_time };
    games[ev.id] = { away: g.a.abbr, home: g.h.abbr, gid: g.id, date: g.d, season: "2026", week: g.d, neutral: g.neutral, h2h: null,
      rec: { [g.a.abbr]: { wl: g.a.rec ? g.a.rec.split("-").map(Number) : null, rank: g.a.rank, games: 0 }, [g.h.abbr]: { wl: g.h.rec ? g.h.rec.split("-").map(Number) : null, rank: g.h.rank, games: 0 } },
      open: hist0[ev.id] && hist0[ev.id].open, now };
  }
  for (const id in hist0) if (new Date(hist0[id].t) < Date.now() - 14 * 864e5) delete hist0[id];
  fs.writeFileSync(SP + "/history.json", JSON.stringify(hist0));
  // Each team's next game, for the pinned team's "plays next" note
  const next = {};
  all.filter(g => !g.done && +new Date(g.t) > Date.now() - 3 * 36e5).sort((a, b) => a.t.localeCompare(b.t)).forEach(g => {
    if (!next[g.h.abbr]) next[g.h.abbr] = { t: g.t, tbd: g.tbd, day: g.d, opp: g.a.loc, home: true };
    if (!next[g.a.abbr]) next[g.a.abbr] = { t: g.t, tbd: g.tbd, day: g.d, opp: g.h.loc, home: false };
  });
  // Conference names (for the Teams tab filter): ESPN's conference list, with a fallback for the big ones
  const CONF_FALLBACK = SP === "cbb" ? { 2: "ACC", 4: "Big East", 7: "Big Ten", 8: "Big 12", 23: "SEC", 62: "American", 44: "Mountain West", 29: "WCC", 3: "A-10" }
    : { 1: "ACC", 4: "Big 12", 5: "Big Ten", 8: "SEC", 9: "Pac-12", 12: "C-USA", 15: "MAC", 17: "Mountain West", 18: "FBS Indep.", 37: "Sun Belt", 151: "American" };
  const confName = Object.assign({}, CONF_FALLBACK);
  try { const cj = await getJSON(`${ESPN}/scoreboard/conferences`); (cj.conferences || []).forEach(c => { if (c.groupId) confName[c.groupId] = c.shortName || c.name; }); console.log("Conferences:", (cj.conferences || []).length); }
  catch (e) { console.warn("conference list", e.message); }
  const conf = {};
  all.forEach(g => [g.a, g.h].forEach(x => { if (x.conf && confName[x.conf] && !/^(FBS|NCAA|Division)/i.test(confName[x.conf])) conf[x.abbr] = confName[x.conf]; }));
  // Every school we've seen, for the My teams picker
  const teamsAll = {}; all.forEach(g => [g.a, g.h].forEach(x => { if (x.abbr && x.loc) teamsAll[x.abbr] = x.loc; }));
  // ---------- team history: records against the spread and on totals, this season and last ----------
  // Scoreboards for both seasons are scanned once (a few dozen days a run), then each finished game's ESPN summary gives
  // its closing line (pick center). Capped per run so the history fills in over a few refreshes.
  const TH = require("../teamhist.js"), LH = readJSON(SP + "/lines.json", { scanned: {}, g: {}, l: {} });
  const SEASONS = SP === "cbb" ? { cur: ["2026-11-02", "2027-04-10"], prev: ["2025-11-03", "2026-04-07"] } : { cur: ["2026-08-22", "2027-01-25"], prev: ["2025-08-23", "2026-01-20"] };
  const todayET = etDate(Date.now()), dates = [];
  for (const k of ["cur", "prev"]) for (let d = new Date(SEASONS[k][0] + "T12:00:00Z"); etDate(d) <= SEASONS[k][1] && etDate(d) < todayET; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = etDate(d); if (!LH.scanned[ds]) dates.push([ds, k]); }
  const scanNow = dates.slice(0, +(process.env.SCAN_MAX || 120));
  for (const [ds, k] of scanNow) {
    try { parse(await getJSON(`${ESPN}/scoreboard?dates=${ds.replace(/-/g, "")}&groups=${GROUPS}&limit=500`)).forEach(g => { if (g.done) LH.g[g.id] = [g.d, k === "cur" ? 1 : 0, g.h.abbr, g.a.abbr, g.h.score, g.a.score]; });
      if (Date.now() - new Date(ds + "T12:00:00Z") > 3 * 864e5) LH.scanned[ds] = 1; } catch (e) { console.warn("season scan", ds, e.message); }
  }
  // newest finished games in our window too
  all.filter(g => g.done).forEach(g => { if (!LH.g[g.id]) LH.g[g.id] = [g.d, g.d >= SEASONS.cur[0] ? 1 : 0, g.h.abbr, g.a.abbr, g.h.score, g.a.score]; });
  const soon = new Set(Object.values(games).flatMap(g => [g.away, g.home]));
  const needL = Object.keys(LH.g).filter(id => !LH.l[id]).sort((x, y) => { const X = LH.g[x], Y = LH.g[y], px = (X[1] ? 2 : 0) + (soon.has(X[2]) || soon.has(X[3]) ? 1 : 0), py = (Y[1] ? 2 : 0) + (soon.has(Y[2]) || soon.has(Y[3]) ? 1 : 0); return py - px || (Y[0] > X[0] ? 1 : -1); })
    .slice(0, +(process.env.LINES_MAX || 900));
  let gotL = 0; const q = needL.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const id = q.shift();
    try { const L = TH.espnLine(await getJSON(`${ESPN}/summary?event=${id}`)); LH.l[id] = [L.sp, L.tot]; gotL++; } catch (e) { /* try again next run */ } } }));
  fs.writeFileSync(SP + "/lines.json", JSON.stringify(LH));
  console.log("Team history:", Object.keys(LH.g).length, "games,", Object.keys(LH.l).length, "with lines (", gotL, "new;", dates.length - scanNow.length, "days left to scan)");
  const thRows = Object.keys(LH.g).map(id => { const g = LH.g[id], L = LH.l[id] || [null, null]; return { d: g[0], cur: !!g[1], h: g[2], a: g[3], hs: g[4], as: g[5], sp: L[0], tot: L[1] }; });
  const glist = Object.values(games), th = TH.build(thRows, glist.flatMap(g => [g.away, g.home]), glist.map(g => [g.away, g.home]),
    { curLabel: SP === "cbb" ? "2026–27" : "2026", prevLabel: SP === "cbb" ? "2025–26" : "2025" });
  fs.writeFileSync(SP + "/data.json", JSON.stringify({ th, teams: teamsAll, conf, sport: SP, builtAt: new Date().toISOString(), oddsAt: odds.fetchedAt, games, names, props: [], next, places: Object.fromEntries(Object.values(games).flatMap(g => [g.away, g.home]).map(a => [a, places[a] || ""])) }));
  console.log("Saved " + SP + "/data.json:", matched, "of", (odds.lines || []).length, "odds games matched to ESPN");
})();
