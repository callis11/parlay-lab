// NBA: pulls game lines + player props from The Odds API and saves nba/odds.json
// Run from the repo root: ODDS_API_KEY=your_key node nba/fetch.js
//
// Cost per run: 3 credits for game lines + 7 per game, bought once per game (Nov 10 credit pacer; was every run).
// The schedule check uses The Odds API's free events list, so days without games cost nothing.

const fs = require("fs");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }

const BASE = "https://api.the-odds-api.com/v4/sports/basketball_nba";
const BOOKS = "fanduel,draftkings,betmgm,betrivers";
const MARKETS = ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists",
  "player_points_alternate", "player_threes_alternate"];
const WINDOW_H = 18; // props only for tonight's games, so the afternoon run doesn't also pay for tomorrow
const MIN_CREDITS_FOR_PROPS = 600; // leave room for the NFL

let remaining = null;
async function get(url) {
  const res = await fetch(url);
  const r = res.headers.get("x-requests-remaining"); if (r !== null) remaining = +r;
  if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 200));
  return res.json();
}
function readOld() { try { return JSON.parse(fs.readFileSync("nba/odds.json", "utf8")); } catch (e) { return null; } }

(async () => {
  const now = Date.now(), end = now + WINDOW_H * 36e5;
  // Automatic runs skip if odds were pulled in the last 45 minutes (two timers, one refresh)
  if (process.env.AUTO_GUARD === "true") { const o = readOld(); if (o && now - new Date(o.fetchedAt) < 45 * 60e3) { console.log("NBA odds already pulled at", o.fetchedAt, "- skipping"); process.exit(0); } }
  // Free: list of upcoming games
  const events = await get(`${BASE}/events?apiKey=${KEY}`);
  const soon = events.filter(e => { const t = +new Date(e.commence_time); return t > now - 3 * 36e5 && t < end; });
  if (!soon.length && process.env.FORCE !== "true") { console.log("No NBA games in the next", WINDOW_H, "hours: skipping."); process.exit(0); }

  const lines = await get(`${BASE}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true&includeSids=true`);
  const old = readOld();
  // Credit pacer (budget.js, Nov 10): each game's props are bought once, by the last scheduled run before tip-off.
  // Runs before 2 PM ET (morning + after-game runs) only buy games tipping within 7 hours (weekend day games);
  // the 4:35 PM run buys tonight's games. Games keep their props once bought. Level 2+: no new NBA props.
  const PACE = require("../budget.js").note(require("../budget.js").pace(), "NBA");
  const etHour = +new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }) % 24;
  const buyBy = etHour < 14 ? now + 7 * 36e5 : end;
  let props = ((old && old.props) || []).filter(p => +new Date(p.commence_time) > now - 12 * 36e5), propsAt = (old && old.propsAt) || null;
  const have = new Set(props.map(p => p.id));
  const upcoming = lines.filter(x => { const t = +new Date(x.commence_time); return t > now && t < end; });
  const buy = upcoming.filter(x => process.env.FORCE === "true" || (!have.has(x.id) && +new Date(x.commence_time) < buyBy));
  if (PACE.level >= 2 && process.env.FORCE !== "true") console.log("Credit pacer level 2+: no new NBA props (game lines still update).");
  else if (remaining !== null && remaining < MIN_CREDITS_FOR_PROPS + buy.length * MARKETS.length) console.warn(`Only ${remaining} credits left: keeping the last props pull.`);
  else {
    for (const g of buy) {
      try { const j = await get(`${BASE}/events/${g.id}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=${MARKETS.join(",")}&oddsFormat=american&includeLinks=true&includeSids=true`);
        props = props.filter(p => p.id !== g.id); props.push(j); propsAt = new Date().toISOString(); }
      catch (e) { console.warn("props failed for", g.id, e.message); }
    }
    console.log("NBA props bought for", buy.length, "games;", upcoming.length - buy.length, "reused or left for the afternoon run.");
  }
  fs.writeFileSync("nba/odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), propsAt, creditsRemaining: remaining, pace: PACE.level, lines, props }));
  console.log("Saved nba/odds.json:", lines.length, "games,", props.length, "prop events. Credits remaining:", remaining);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "fetched=true\n");
})();
