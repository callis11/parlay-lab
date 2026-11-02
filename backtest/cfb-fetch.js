// College football history: game lines (spread, moneyline, total) from The Odds API as they stood shortly before kickoff,
// for every FBS game in past seasons. Kickoff times come from ESPN's scoreboard (free). One odds snapshot per kickoff
// window (games starting within 3 hours of the first one) covers every game in that window: 30 credits a snapshot.
// Run from the repo root (GitHub Actions; ESPN is blocked from the Claude container):
//   ODDS_API_KEY=... CFB_SEASONS=2025,2024,2023 RESERVE=40000 node backtest/cfb-fetch.js
//   TEST=1 = one snapshot only. Saves backtest/raw/cfb-lines-<season>.json.gz and skips windows already saved.
const fs = require("fs"), zlib = require("zlib");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }
const H = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const BOOKS = "fanduel,draftkings,betmgm,betrivers";
const SEASONS = (process.env.CFB_SEASONS || "2025,2024,2023").split(",").map(Number);
const RESERVE = +(process.env.RESERVE || 40000), TEST = process.env.TEST === "1", BEFORE_MIN = 45, WIN_H = 3;

let remaining = null, used = 0;
async function get(url, odds) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 parlay-lab" } });
    if (odds) { const r = res.headers.get("x-requests-remaining"), u = res.headers.get("x-requests-last"); if (r !== null) remaining = +r; if (u) used += +u; }
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!res.ok) { const e = new Error(res.status + " " + (await res.text()).slice(0, 200)); e.status = res.status; throw e; }
    return res.json();
  }
  throw new Error("rate limited");
}
const file = n => "backtest/raw/" + n + ".json.gz";
const load = n => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file(n)))); } catch (e) { return {}; } };
const save = (n, o) => fs.writeFileSync(file(n), zlib.gzipSync(JSON.stringify(o)));
const slim = ev => ({ id: ev.id, commence_time: ev.commence_time, home_team: ev.home_team, away_team: ev.away_team,
  bookmakers: (ev.bookmakers || []).map(b => ({ key: b.key, markets: (b.markets || []).map(m => ({ key: m.key, outcomes: m.outcomes.map(o => { const x = { name: o.name, price: o.price }; if (o.point !== undefined) x.point = o.point; return x; }) })) })) });

// Every FBS game of a season from ESPN (regular season weeks 1-16 + bowls), with final scores for grading later
async function season(year) {
  const games = {};
  const add = j => (j.events || []).forEach(e => { const c = e.competitions && e.competitions[0]; if (!c || !(c.status && c.status.type && c.status.type.completed)) return;
    const h = c.competitors.find(x => x.homeAway === "home"), a = c.competitors.find(x => x.homeAway === "away"); if (!h || !a) return;
    games[e.id] = { t: e.date, h: h.team.displayName, a: a.team.displayName, ha: h.team.abbreviation, aa: a.team.abbreviation, hs: +h.score, as: +a.score, neutral: !!c.neutralSite }; });
  for (let w = 1; w <= 16; w++) { try { add(await get(`${ESPN}?dates=${year}&seasontype=2&week=${w}&groups=80&limit=500`)); } catch (e) { console.warn("ESPN", year, w, e.message); } }
  try { add(await get(`${ESPN}?dates=${year}&seasontype=3&week=1&groups=80&limit=500`)); } catch (e) { console.warn("ESPN bowls", year, e.message); }
  return games;
}

(async () => {
  for (const year of SEASONS) {
    const name = "cfb-lines-" + year, out = load(name);
    out.games = Object.keys(out.games || {}).length ? out.games : await season(year);
    out.windows = out.windows || {};
    // ESPN lists unannounced kickoffs at midnight-ish Eastern: drop those (no reliable snapshot time)
    const kicks = [...new Set(Object.values(out.games).map(g => g.t).filter(t => !/T0[45]:00Z$/.test(t)))].sort();
    const wins = []; kicks.forEach(k => { const w = wins[wins.length - 1]; if (w && +new Date(k) - +new Date(w.start) < WIN_H * 36e5) w.end = k; else wins.push({ start: k, end: k }); });
    console.log(year + ":", Object.keys(out.games).length, "FBS games,", wins.length, "kickoff windows (", Object.keys(out.windows).length, "already saved)");
    let n = 0, stop = false;
    for (const w of wins) {
      if (out.windows[w.start]) continue;
      if (remaining !== null && remaining < RESERVE) { console.log("Reserve reached, stopping."); stop = true; break; }
      const at = new Date(+new Date(w.start) - BEFORE_MIN * 6e4).toISOString().replace(/\.\d+Z$/, "Z");
      try {
        const j = await get(`${H}/odds?apiKey=${KEY}&date=${at}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american`, true);
        const lo = +new Date(w.start) - 36e5, hi = +new Date(w.end) + 36e5;
        out.windows[w.start] = { at: j.timestamp, events: (j.data || []).filter(e => { const t = +new Date(e.commence_time); return t >= lo && t <= hi; }).map(slim) };
        n++;
      } catch (e) { console.warn("lines", year, w.start, e.message); }
      if (n % 10 === 0) save(name, out);
      if (TEST) { stop = true; break; }
    }
    save(name, out);
    const evs = Object.values(out.windows).reduce((s, w) => s + w.events.length, 0);
    console.log("College lines", year + ":", Object.keys(out.windows).length, "windows,", evs, "games with lines. Credits left:", remaining);
    if (stop) break;
  }
  console.log("Credits used this run:", used, "Remaining:", remaining);
})();
