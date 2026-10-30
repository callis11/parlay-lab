// College football: pulls game lines (spread, moneyline, total) for every FBS game from The Odds API.
// Run from the repo root: ODDS_API_KEY=your_key node cfb/fetch.js
// Cost per run: about 3 credits no matter how many games (one request, three markets).

const fs = require("fs");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }
const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf";
const BOOKS = "fanduel,draftkings,betmgm,betrivers";

function readOld() { try { return JSON.parse(fs.readFileSync("cfb/odds.json", "utf8")); } catch (e) { return null; } }

(async () => {
  // Automatic runs skip if odds were pulled in the last 45 minutes (two timers, one refresh)
  if (process.env.AUTO_GUARD === "true") { const o = readOld(); if (o && Date.now() - new Date(o.fetchedAt) < 45 * 60e3) { console.log("College odds already pulled at", o.fetchedAt, "- skipping"); process.exit(0); } }
  const res = await fetch(`${BASE}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true&includeSids=true`);
  const remaining = res.headers.get("x-requests-remaining");
  if (!res.ok) { console.error("Odds API error", res.status, (await res.text()).slice(0, 200)); process.exit(1); }
  const lines = await res.json();
  fs.writeFileSync("cfb/odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), creditsRemaining: remaining === null ? null : +remaining, lines, props: [] }));
  console.log("Saved cfb/odds.json:", lines.length, "games. Credits remaining:", remaining);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "fetched=true\n");
})();
