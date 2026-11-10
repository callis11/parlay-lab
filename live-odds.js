// Live moneylines for games in progress (The Odds API), saved for the site's live picks.
// Run: SPORT=nfl|cfb ODDS_API_KEY=... node live-odds.js   (Node 18+)
//
// Cost: 1 credit per run (moneylines only, 4 books = 1 region), and only when a game is on right now.
// With no game on it exits without calling the API (free). Started by the Cloudflare timer every 5 minutes
// during game windows (schedule.json, workflow live.yml).
//
// Output: live.json (NFL) or cfb/live.json:
//   { fetchedAt, creditsRemaining, events: { <event id>: { t, away, home, books: { fanduel: { a: -310, h: +250 }, ... } } } }
// The site only trusts a price that is less than 12 minutes old; otherwise it falls back to its estimate.
const fs = require("fs");
const SP = process.env.SPORT === "cfb" ? "cfb" : "nfl";
const DIR = SP === "nfl" ? "" : SP + "/";
const KEY_SPORT = SP === "cfb" ? "americanfootball_ncaaf" : "americanfootball_nfl";
const BOOKS = "fanduel,draftkings,betmgm,betrivers";
const LIVE_H = +(process.env.LIVE_H || 4.5);       // a game counts as "on" from kickoff until this many hours after
const MIN_CREDITS = +(process.env.LIVE_MIN_CREDITS || 3000); // stop live pulls below this, so pre-game pulls keep running

function read(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } }
function out(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }

(async () => {
  const odds = read(DIR + "odds.json"), now = Date.now();
  const on = ((odds && odds.lines) || []).filter(e => { const t = +new Date(e.commence_time); return t <= now && t > now - LIVE_H * 36e5; });
  if (!on.length) { console.log(SP, "no game on right now: no pull (free)"); out("fetched", "false"); return; }
  // Credit pacer (budget.js, Nov 10). College only (the owner protects the NFL): pull while Michigan State or a ranked
  // team is playing (level 1+: Michigan State only), at most every 10 minutes. One pull still prices every game on.
  if (SP === "cfb" && process.env.FORCE !== "true") {
    const P = require("./budget.js").note(require("./budget.js").pace(), "cfb live"), data = read("cfb/data.json") || {};
    const nm = t => (data.names && data.names[t]) || t, msu = t => /^Michigan St/.test(t), ranked = t => /^#\d+/.test(nm(t));
    const key = on.filter(e => msu(e.home_team) || msu(e.away_team) || (P.level < 1 && (ranked(e.home_team) || ranked(e.away_team))));
    if (!key.length) { console.log("cfb: no", P.level < 1 ? "Michigan State or ranked" : "Michigan State", "game on: no live pull (credit pacer)"); out("fetched", "false"); return; }
    const last = read(DIR + "live.json");
    if (last && Date.now() - new Date(last.fetchedAt) < 9.5 * 6e4) { console.log("cfb: live prices are under 10 minutes old: no pull (credit pacer)"); out("fetched", "false"); return; }
  }
  // Credits are shared by every sport: use the newest count any of our files saw
  let cr = null, crAt = 0;
  ["odds.json", "nba/odds.json", "cfb/odds.json", "cbb/odds.json", "live.json", "cfb/live.json"].forEach(f => { const j = read(f); if (j && j.creditsRemaining != null) { const at = +new Date(j.fetchedAt || 0); if (at > crAt) { crAt = at; cr = j.creditsRemaining; } } });
  if (cr !== null && cr < MIN_CREDITS && process.env.FORCE !== "true") { console.log(`Only ${cr} credits left (under ${MIN_CREDITS}): skipping live pulls`); out("fetched", "false"); return; }
  const KEY = process.env.ODDS_API_KEY; if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/${KEY_SPORT}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h&oddsFormat=american`);
  const rem = res.headers.get("x-requests-remaining");
  if (!res.ok) { console.error("live pull failed:", res.status, (await res.text()).slice(0, 200)); out("fetched", "false"); return; }
  const list = await res.json(), ids = new Set(on.map(e => e.id)), events = {};
  list.forEach(e => {
    if (!ids.has(e.id) && +new Date(e.commence_time) > now) return; // only games that have started
    const books = {};
    (e.bookmakers || []).forEach(b => { const m = (b.markets || []).filter(x => x.key === "h2h")[0]; if (!m) return;
      const a = m.outcomes.filter(o => o.name === e.away_team)[0], h = m.outcomes.filter(o => o.name === e.home_team)[0];
      if (a && h) books[b.key] = { a: a.price, h: h.price, at: m.last_update || b.last_update || null }; });
    if (Object.keys(books).length) events[e.id] = { t: e.commence_time, away: e.away_team, home: e.home_team, books };
  });
  const file = { fetchedAt: new Date().toISOString(), creditsRemaining: rem === null ? null : +rem, events };
  fs.writeFileSync(DIR + "live.json", JSON.stringify(file));
  console.log(SP, `live prices for ${Object.keys(events).length} of ${on.length} games on; credits left ${rem}`);
  out("fetched", "true");
})();
