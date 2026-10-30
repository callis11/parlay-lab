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
    const t = x => ({ abbr: x.team.abbreviation, name: x.team.displayName, loc: x.team.location || x.team.shortDisplayName, score: +x.score || 0,
      rank: x.curatedRank && x.curatedRank.current && x.curatedRank.current <= 25 ? x.curatedRank.current : null,
      rec: (x.records || []).find(r => r.type === "total" || r.name === "overall") ? (x.records.find(r => r.type === "total" || r.name === "overall").summary) : (x.records && x.records[0] && x.records[0].summary) || null });
    // ESPN lists kickoff times not yet announced as midnight Eastern; flag those as TBD
    const tbd = (c.timeValid === false) || /T0[45]:00Z$/.test(ev.date);
    return { id: ev.id, t: ev.date, tbd, d: etDate(tbd ? new Date(+new Date(ev.date) + 6 * 36e5).toISOString() : ev.date), h: t(h), a: t(a), neutral: !!c.neutralSite, done: !!(ev.status && ev.status.type && ev.status.type.completed) };
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
  fs.writeFileSync(SP + "/data.json", JSON.stringify({ sport: SP, builtAt: new Date().toISOString(), oddsAt: odds.fetchedAt, games, names, props: [], next }));
  console.log("Saved " + SP + "/data.json:", matched, "of", (odds.lines || []).length, "odds games matched to ESPN");
})();
