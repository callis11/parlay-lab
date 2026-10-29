// Pulls NFL game lines + player props from The Odds API and saves odds.json
// Run: ODDS_API_KEY=your_key node fetch-odds.js   (Node 18+)
// Never put the key in the website's page code. Keep it in an env variable.

const fs = require("fs");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }

const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
// Verify these market keys against the provider's docs; edit to save credits.
const PROP_MARKETS = [
  "player_pass_yds", "player_rush_yds", "player_reception_yds",
  "player_anytime_td",
  "player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate"
];

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + " " + (await res.text()));
  console.log("credits remaining:", res.headers.get("x-requests-remaining"));
  return res.json();
}

(async () => {
  const lines = await get(`${BASE}/odds?apiKey=${KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`);
  const weekEnd = Date.now() + 7*24*3600*1000;
  const props = [];
  // Props only for games in the next 7 days, to save credits
  for (const g of lines.filter(x => new Date(x.commence_time) < weekEnd)) {
    try {
      const p = await get(`${BASE}/events/${g.id}/odds?apiKey=${KEY}&regions=us&markets=${PROP_MARKETS.join(",")}&oddsFormat=american`);
      props.push(p);
    } catch (e) { console.warn("props failed for", g.id, e.message); }
  }
  fs.writeFileSync("odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), lines, props }, null, 1));
  console.log("Saved odds.json:", lines.length, "games");
})();
