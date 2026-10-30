// Backtest, step 1: pulls historical NFL odds from The Odds API, as they stood just before each kickoff.
// Run from the repo root: ODDS_API_KEY=... node backtest/fetch.js
//   LINES_SEASONS=2021,2022,2023,2024,2025   game lines (spread, moneyline, total): 30 credits per kickoff time
//   PROP_SEASONS=2025,2024,2023               player props: 10 credits per market per game
//   TEST=1                                    one game only (about 150 credits) to check everything works
//   RESERVE=15000                             stop before credits drop below this, so the live site keeps running
// Saves compact, gzipped files to backtest/raw/ and skips anything already pulled, so it can be re-run safely.

const fs = require("fs"), zlib = require("zlib");
const { getCSV, NFLVERSE } = require("../build-data.js");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }
const H = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_nfl";
const BOOKS = "fanduel,draftkings,betmgm,betrivers";
const FULL = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td", "player_receptions", "player_pass_tds", "player_rush_reception_yds",
  "player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate", "player_receptions_alternate"];
const MAIN = FULL.slice(0, 7); // 2023: main lines only, to save credits
const RESERVE = +(process.env.RESERVE || 15000), TEST = process.env.TEST === "1";
const LINES_SEASONS = (process.env.LINES_SEASONS || "2025,2024,2023,2022,2021").split(",").map(Number);
const PROP_SEASONS = (process.env.PROP_SEASONS || "2025,2024,2023").split(",").map(Number);
const BEFORE_MIN = 45; // snapshot 45 minutes before kickoff (inactives are out, lines are close to final)

let remaining = null, used = 0;
async function get(url) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(url);
    const r = res.headers.get("x-requests-remaining"), u = res.headers.get("x-requests-last"); if (r !== null) remaining = +r; if (u) used += +u;
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!res.ok) { const e = new Error(res.status + " " + (await res.text()).slice(0, 200)); e.status = res.status; throw e; }
    return res.json();
  }
  throw new Error("rate limited");
}
const file = n => "backtest/raw/" + n + ".json.gz";
const load = n => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file(n)))); } catch (e) { return {}; } };
const save = (n, o) => fs.writeFileSync(file(n), zlib.gzipSync(JSON.stringify(o)));
// US Eastern wall time -> UTC ISO (handles daylight saving)
function etToUtc(day, hm) {
  const [y, m, d] = day.split("-").map(Number), [hh, mm] = (hm || "13:00").split(":").map(Number);
  let t = Date.UTC(y, m - 1, d, hh + 5, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute), want = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(t + (want - shown)).toISOString();
}
// Keep only what the engine needs
const slim = ev => ({ id: ev.id, commence_time: ev.commence_time, home_team: ev.home_team, away_team: ev.away_team,
  bookmakers: (ev.bookmakers || []).map(b => ({ key: b.key, markets: (b.markets || []).map(m => ({ key: m.key, outcomes: m.outcomes.map(o => { const x = { name: o.name, price: o.price }; if (o.point !== undefined) x.point = o.point; if (o.description) x.description = o.description; return x; }) })) })) });

(async () => {
  const sched = (await getCSV(`${NFLVERSE}/schedules/games.csv`)).filter(g => g.game_type === "REG");
  const slots = season => { const s = {}; sched.filter(g => +g.season === season).forEach(g => { const k = etToUtc(g.gameday, g.gametime); (s[k] = s[k] || []).push(g); }); return Object.keys(s).sort().map(k => ({ kick: k, games: s[k] })); };

  // ---- game lines: one request per kickoff time covers every game starting then ----
  for (const season of LINES_SEASONS) {
    const name = "lines-" + season, out = load(name); let n = 0;
    for (const sl of slots(season)) {
      if (out[sl.kick]) continue;
      if (remaining !== null && remaining < RESERVE) { console.log("Reserve reached, stopping lines."); break; }
      const at = new Date(+new Date(sl.kick) - BEFORE_MIN * 6e4).toISOString().replace(/\.\d+Z$/, "Z");
      try {
        const j = await get(`${H}/odds?apiKey=${KEY}&date=${at}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american`);
        out[sl.kick] = { at: j.timestamp, events: (j.data || []).filter(e => Math.abs(new Date(e.commence_time) - new Date(sl.kick)) < 3 * 36e5).map(slim) };
        n++;
      } catch (e) { console.warn("lines", season, sl.kick, e.message); }
      if (n % 10 === 0) save(name, out);
      if (TEST) break;
    }
    save(name, out);
    console.log("Lines", season + ":", Object.keys(out).length, "kickoff times saved. Credits left:", remaining);
    if (TEST) break;
  }

  // ---- player props: one request per game ----
  for (const season of PROP_SEASONS) {
    const markets = season <= 2023 ? MAIN : FULL, name = "props-" + season, out = load(name), lines = load("lines-" + season); let n = 0, stop = false;
    for (const sl of slots(season)) {
      const evs = (lines[sl.kick] && lines[sl.kick].events) || [];
      for (const ev of evs) {
        if (out[ev.id]) continue;
        if (remaining !== null && remaining < RESERVE + markets.length * 10) { console.log("Reserve reached, stopping props."); stop = true; break; }
        const at = new Date(+new Date(ev.commence_time) - BEFORE_MIN * 6e4).toISOString().replace(/\.\d+Z$/, "Z");
        try {
          const j = await get(`${H}/events/${ev.id}/odds?apiKey=${KEY}&date=${at}&bookmakers=${BOOKS}&markets=${markets.join(",")}&oddsFormat=american`);
          out[ev.id] = Object.assign(slim(j.data || {}), { at: j.timestamp });
          n++;
        } catch (e) { console.warn("props", season, ev.id, e.message); out[ev.id] = { id: ev.id, error: e.status || "fail" }; }
        if (n % 10 === 0) save(name, out);
        if (TEST) break;
      }
      if (stop || TEST) break;
    }
    save(name, out);
    console.log("Props", season + ":", Object.keys(out).length, "games saved. Credits left:", remaining);
    if (stop || TEST) break;
  }
  console.log("Credits used this run:", used, "Remaining:", remaining);
})();
