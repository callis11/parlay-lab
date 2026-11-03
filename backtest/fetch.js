// Backtest, step 1: pulls historical NFL odds from The Odds API, as they stood just before each kickoff.
// Run from the repo root: ODDS_API_KEY=... node backtest/fetch.js
//   LINES_SEASONS=2021,2022,2023,2024,2025   game lines (spread, moneyline, total): 30 credits per kickoff time
//   PROP_SEASONS=2025,2024,2023               player props: 10 credits per market per game
//   TEST=1                                    one game only (about 150 credits) to check everything works
//   RESERVE=15000                             stop before credits drop below this, so the live site keeps running
//   GAMES=POST                                playoff games instead of the regular season (REG, POST or REG,POST); saved in the same season files
//   ALT_ONLY=2023                             only add the four alternate-line markets to games already in props-2023 (40 credits per game)
//   OPEN=2025                                 opening snapshot of the 7 main prop markets for games already in props-2025 (70 credits per game),
//                                             taken 72 h before kickoff but no earlier than Tuesday noon ET of that week; saved to open-2025
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
const GAMES = (process.env.GAMES || "REG").toUpperCase().split(","), POST = ["WC", "DIV", "CON", "SB"];
const TYPES = GAMES.flatMap(t => t === "POST" ? POST : [t]);
const ALT_ONLY = process.env.ALT_ONLY ? +process.env.ALT_ONLY : null, ALTS = FULL.slice(7);
const OPEN = process.env.OPEN ? +process.env.OPEN : null;
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
  const sched = (await getCSV(`${NFLVERSE}/schedules/games.csv`)).filter(g => TYPES.includes(g.game_type));
  const slots = season => { const s = {}; sched.filter(g => +g.season === season && g.gameday && +new Date(g.gameday) < Date.now() - 864e5).forEach(g => { const k = etToUtc(g.gameday, g.gametime); (s[k] = s[k] || []).push(g); }); return Object.keys(s).sort().map(k => ({ kick: k, games: s[k] })); };

  // ---- OPEN: opening prices for games already saved, then stop ----
  if (OPEN) {
    const src = load("props-" + OPEN), name = "open-" + OPEN, out = load(name); let n = 0;
    const tueNoon = iso => { // Tuesday 12:00 ET of the week holding this kickoff (NFL weeks run Tue..Mon)
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
      const back = { Tue: 0, Wed: 1, Thu: 2, Fri: 3, Sat: 4, Sun: 5, Mon: 6 }[p.weekday];
      const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)); d.setUTCDate(d.getUTCDate() - back);
      return etToUtc(d.toISOString().slice(0, 10), "12:00"); };
    for (const id in src) {
      const ev = src[id];
      if (ev.error || !ev.commence_time || out[id]) continue;
      if (remaining !== null && remaining < RESERVE + MAIN.length * 10) { console.log("Reserve reached, stopping open snapshots."); break; }
      const at = new Date(Math.max(+new Date(ev.commence_time) - 72 * 36e5, +new Date(tueNoon(ev.commence_time)))).toISOString().replace(/\.\d+Z$/, "Z");
      try {
        const j = await get(`${H}/events/${id}/odds?apiKey=${KEY}&date=${at}&bookmakers=${BOOKS}&markets=${MAIN.join(",")}&oddsFormat=american`);
        out[id] = Object.assign(slim(j.data || {}), { at: j.timestamp, asked: at }); n++;
      } catch (e) { console.warn("open", id, e.message); out[id] = { id, error: e.status || "fail", asked: at }; }
      if (n % 10 === 0) save(name, out);
      if (TEST) break;
    }
    save(name, out);
    const ok = Object.values(out).filter(e => !e.error), withP = ok.filter(e => (e.bookmakers || []).some(b => b.markets.length));
    console.log("Open", OPEN + ":", ok.length, "games saved (" + withP.length + " had props posted),", Object.values(out).filter(e => e.error).length, "errors, of", Object.keys(src).length + ". Credits used:", used, "Remaining:", remaining);
    return;
  }

  // ---- ALT_ONLY: add alternate lines to games already saved (same snapshot time), then stop ----
  if (ALT_ONLY) {
    const name = "props-" + ALT_ONLY, out = load(name); let n = 0;
    for (const id in out) {
      const ev = out[id];
      if (ev.error || ev.alt || !ev.commence_time) continue;
      if (remaining !== null && remaining < RESERVE + ALTS.length * 10) { console.log("Reserve reached, stopping alt lines."); break; }
      const at = new Date(+new Date(ev.commence_time) - BEFORE_MIN * 6e4).toISOString().replace(/\.\d+Z$/, "Z");
      try {
        const j = slim((await get(`${H}/events/${id}/odds?apiKey=${KEY}&date=${at}&bookmakers=${BOOKS}&markets=${ALTS.join(",")}&oddsFormat=american`)).data || {});
        for (const b of j.bookmakers) {
          let mine = ev.bookmakers.find(x => x.key === b.key);
          if (!mine) ev.bookmakers.push(mine = { key: b.key, markets: [] });
          for (const m of b.markets) if (!mine.markets.some(x => x.key === m.key)) mine.markets.push(m);
        }
        ev.alt = 1; n++;
      } catch (e) { console.warn("alt", id, e.message); }
      if (n % 10 === 0) save(name, out);
      if (TEST) break;
    }
    save(name, out);
    console.log("Alt lines", ALT_ONLY + ":", Object.values(out).filter(e => e.alt).length, "of", Object.keys(out).length, "games. Credits used:", used, "Remaining:", remaining);
    return;
  }

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
