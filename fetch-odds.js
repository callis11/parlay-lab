// Pulls NFL game lines + player props from The Odds API and saves odds.json
// Run: ODDS_API_KEY=your_key node fetch-odds.js   (Node 18+)
// Never put the key in the website's page code. Keep it in an env variable.
//
// Cost per run (The Odds API credits): 1 for game lines + 1 per prop market per game in the next 7 days.
// With 11 prop markets and ~14 games that's about 155 credits.

const fs = require("fs");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }

const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
// The four books the site shows. Up to 10 books costs the same as one region.
const BOOKS = "fanduel,draftkings,betmgm,betrivers";
const CORE_MARKETS = [
  "player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td",
  "player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate"
];
const EXTRA_MARKETS = ["player_receptions", "player_receptions_alternate", "player_pass_tds", "player_rush_reception_yds"];
// Stop pulling props when credits get this low, so game lines keep updating until the plan resets
const MIN_CREDITS_FOR_PROPS = 400;

let remaining = null;
async function get(url) {
  const res = await fetch(url);
  const r = res.headers.get("x-requests-remaining");
  if (r !== null) remaining = +r;
  if (!res.ok) { const e = new Error(res.status + " " + (await res.text()).slice(0, 200)); e.status = res.status; throw e; }
  return res.json();
}
function readOld() { try { return JSON.parse(fs.readFileSync("odds.json", "utf8")); } catch (e) { return null; } }

(async () => {
  const old = readOld();
  const lines = await get(`${BASE}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true&includeSids=true`);
  console.log("credits remaining after game lines:", remaining);
  const weekEnd = Date.now() + 7 * 24 * 3600 * 1000;
  // Only buy props for games that haven't kicked off (Sunday afternoon pulls skip the 1 PM games, etc.)
  const upcoming = lines.filter(x => new Date(x.commence_time) < weekEnd && new Date(x.commence_time) > Date.now());
  const started = new Set(lines.filter(x => new Date(x.commence_time) <= Date.now()).map(x => x.id));
  let props = [], markets = CORE_MARKETS.concat(EXTRA_MARKETS), propsAt = new Date().toISOString();

  if (remaining !== null && remaining < MIN_CREDITS_FOR_PROPS + upcoming.length * markets.length) {
    console.warn(`Only ${remaining} credits left: keeping the last props pull instead of spending more.`);
    props = (old && old.props) || [];
    propsAt = (old && (old.propsAt || old.fetchedAt)) || null;
  } else {
    for (const g of upcoming) {
      try {
        props.push(await get(`${BASE}/events/${g.id}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=${markets.join(",")}&oddsFormat=american&includeLinks=true&includeSids=true`));
      } catch (e) {
        // If the provider rejects one of the newer market names, fall back to the core list
        if (e.status === 422 && markets !== CORE_MARKETS) {
          console.warn("Extra markets rejected, falling back to core markets:", e.message);
          markets = CORE_MARKETS;
          try { props.push(await get(`${BASE}/events/${g.id}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=${markets.join(",")}&oddsFormat=american&includeLinks=true&includeSids=true`)); }
          catch (e2) { console.warn("props failed for", g.id, e2.message); }
        } else console.warn("props failed for", g.id, e.message);
      }
    }
  }
  // Games already underway keep the props from the last pull before kickoff
  if (old && old.props) for (const p of old.props) if (started.has(p.id) && !props.some(x => x.id === p.id)) props.push(p);
  fs.writeFileSync("odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), propsAt, creditsRemaining: remaining, lines, props }));
  console.log("Saved odds.json:", lines.length, "games,", props.length, "prop events. Credits remaining:", remaining);
})();
