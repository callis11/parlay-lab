// Credit pacer (Nov 10, 2026). Every Odds API fetcher asks this file how hard it may spend.
// Owner's rule: protect the NFL; trim every other sport first, and touch the NFL only if the math says we have to.
//
// How it works: credits left (newest count any of our odds files saw) vs what the rest of the month needs until the plan
// resets on the 1st (UTC). The weekly costs below are estimates from the Nov 4–10 commit history; if we really spend
// less, credits stay higher and the level drops back on its own. Override any of them with env vars of the same name.
//
//   level 0  room for everything (other sports still use their lean Nov 10 defaults)
//   level 1  other sports at minimum: college football props 6 games, college live only for Michigan State,
//            no college basketball first-half lines. NFL unchanged.
//   level 2  other sports' player props off (NBA and college football keep game lines). NFL unchanged.
//   level 3  first NFL trim: "more market types" (attempts, tackles, kicking...) once a day instead of every 6 hours.
//   level 4  NFL props refresh at most every 2 hours (game lines and live prices every run).
//
// Run `node budget.js` to print today's level.
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const FILES = ["odds.json", "nba/odds.json", "cfb/odds.json", "cbb/odds.json", "live.json", "cfb/live.json"];
const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? +process.env[k] : d);
const RESERVE = num("PACE_RESERVE", 1000);          // never plan to go below this
const NFL_FULL = num("PACE_NFL_WEEK", 4600);        // NFL as it runs today (pre-game + live), per week
const NFL_TRIM = num("PACE_NFL_TRIM_WEEK", 3600);   // NFL with more market types once a day
const OTHER_LEAN = num("PACE_OTHER_WEEK", 1500);    // NBA + college with the Nov 10 lean defaults
const OTHER_MIN = num("PACE_OTHER_MIN_WEEK", 900);  // NBA + college at level 1
const OTHER_LINES = num("PACE_OTHER_LINES_WEEK", 300); // NBA + college game lines only (level 2+)

function read(f) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) { return null; } }
function credits() {
  let cr = null, at = 0;
  FILES.forEach(f => { const j = read(f); if (j && j.creditsRemaining != null) { const t = +new Date(j.fetchedAt || 0); if (t > at) { at = t; cr = +j.creditsRemaining; } } });
  return cr;
}
function daysToReset(now) {
  const d = new Date(now), next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return (next - now) / 864e5;
}
function pace(now, cr) {
  now = now || Date.now(); if (cr === undefined) cr = credits();
  if (process.env.PACE_LEVEL !== undefined && process.env.PACE_LEVEL !== "") return { level: +process.env.PACE_LEVEL, credits: cr, forced: true };
  if (cr === null) return { level: 0, credits: null };
  const w = daysToReset(now) / 7, need = x => Math.round(RESERVE + x * w);
  const needs = [NFL_FULL + OTHER_LEAN, NFL_FULL + OTHER_MIN, NFL_FULL + OTHER_LINES, NFL_TRIM + OTHER_LINES].map(need);
  let level = 0; while (level < 4 && cr < needs[level]) level++;
  return { level, credits: cr, daysLeft: +(w * 7).toFixed(1), needs, perDay: Math.round((cr - RESERVE) / Math.max(1, w * 7)) };
}
function note(p, who) {
  const say = ["room for everything", "other sports at minimum", "other sports' props off", "+ NFL extra markets once a day", "+ NFL props every 2 h"][p.level];
  console.log(`[pace] ${who || ""} level ${p.level} (${say}): ${p.credits} credits, ${p.daysLeft} days to reset, about ${p.perDay}/day to spend`);
  return p;
}
module.exports = { pace, note, credits, daysToReset };
if (require.main === module) { const p = pace(); note(p, "now"); console.log(JSON.stringify(p)); }
