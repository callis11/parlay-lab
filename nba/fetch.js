// NBA: pulls game lines + player props from The Odds API and saves nba/odds.json
// Run from the repo root: ODDS_API_KEY=your_key node nba/fetch.js
//
// Cost per run: 3 credits for game lines + 7 per game starting in the next 18 hours (about 60 on a typical night).
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
  // Free: list of upcoming games
  const events = await get(`${BASE}/events?apiKey=${KEY}`);
  const soon = events.filter(e => { const t = +new Date(e.commence_time); return t > now - 3 * 36e5 && t < end; });
  if (!soon.length && process.env.FORCE !== "true") { console.log("No NBA games in the next", WINDOW_H, "hours: skipping."); process.exit(0); }

  const lines = await get(`${BASE}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american`);
  const old = readOld();
  let props = [], propsAt = new Date().toISOString();
  const upcoming = lines.filter(x => { const t = +new Date(x.commence_time); return t > now && t < end; });
  if (remaining !== null && remaining < MIN_CREDITS_FOR_PROPS + upcoming.length * MARKETS.length) {
    console.warn(`Only ${remaining} credits left: keeping the last props pull.`);
    props = (old && old.props) || []; propsAt = (old && old.propsAt) || null;
  } else {
    for (const g of upcoming) {
      try { props.push(await get(`${BASE}/events/${g.id}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=${MARKETS.join(",")}&oddsFormat=american`)); }
      catch (e) { console.warn("props failed for", g.id, e.message); }
    }
  }
  fs.writeFileSync("nba/odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), propsAt, creditsRemaining: remaining, lines, props }));
  console.log("Saved nba/odds.json:", lines.length, "games,", props.length, "prop events. Credits remaining:", remaining);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "fetched=true\n");
})();
