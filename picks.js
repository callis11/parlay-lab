// Records the site's auto-built parlays and grades them against final scores and box scores.
//   RECORD=true node picks.js   -> save/refresh slips that haven't kicked off yet (run after a fresh odds pull)
//   node picks.js               -> grade only
// A slip locks when its first game kicks off; the version saved at that point is the one graded.
// Prices are FanDuel's. Data: nflverse schedule (scores) and weekly player stats.

const fs = require("fs");
const Engine = require("./engine.js");

const BOOK = "fanduel";
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
const now = Date.now();

const norm = s => (s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
async function getCSV(url) {
  try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return parseCSV(await r.text()); }
  catch (e) { console.warn("skip", url, e.message); return null; }
}
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

// ---------- record ----------
function record(store) {
  const odds = readJSON("odds.json", null), data = readJSON("data.json", null);
  if (!odds || !data) { console.log("No odds/data to record from."); return; }
  const E = Engine.make(odds, data, BOOK, now);
  const seen = {}; // groupKey -> ids made this run
  let added = 0, updated = 0;
  for (const grp of E.allParlays()) {
    for (const s of grp.slips) {
      const first = s.l.slice().sort((a, b) => new Date(a.time) - new Date(b.time))[0];
      const meta = data.games[first.ev] || {};
      if (!meta.week) continue;
      const gkey = `${meta.season}-W${meta.week}|${grp.group}`, id = `${gkey}|${s.n}`;
      (seen[gkey] = seen[gkey] || {})[id] = 1;
      const old = store.slips[id];
      const lock = Math.min(...s.l.map(l => +new Date(l.time)));
      if (old && old.lock <= now) continue; // already locked
      if (lock <= now) continue;
      const evs = {}; let sg = false; s.l.forEach(l => { if (evs[l.ev]) sg = true; evs[l.ev] = 1; });
      store.slips[id] = {
        id, season: meta.season, week: meta.week, group: grp.group, name: s.n, desc: s.d, sg, lock, saved: now,
        legs: s.l.map(l => { const m = data.games[l.ev] || {};
          return { n: l.n, a: l.a, kind: l.kind, t: l.t, pt: l.pt, line: l.line, player: l.player, label: l.label, td: l.td, time: l.time, gid: m.gid, away: m.away, home: m.home }; }),
        status: "open"
      };
      old ? updated++ : added++;
    }
  }
  // Drop unlocked slips the current lines no longer produce (same week and group only)
  let dropped = 0;
  for (const id in store.slips) {
    const s = store.slips[id], gk = `${s.season}-W${s.week}|${s.group}`;
    if (seen[gk] && !seen[gk][id] && s.lock > now) { delete store.slips[id]; dropped++; }
  }
  console.log(`Recorded: ${added} new, ${updated} refreshed, ${dropped} dropped`);
}

// ---------- grade ----------
function gradeLeg(l, games, stats) {
  const g = l.gid && games[l.gid];
  if (!g || g.result === "") return "pending";
  const hs = +g.home_score, as = +g.away_score;
  if (l.kind === "g") {
    if (l.t === "ml-h" || l.t === "ml-a") { const m = l.t === "ml-h" ? hs - as : as - hs; return m > 0 ? "won" : m < 0 ? "lost" : "push"; }
    if (l.t === "sp-h" || l.t === "sp-a") { const m = (l.t === "sp-h" ? hs - as : as - hs) + l.pt; return m > 0 ? "won" : m < 0 ? "lost" : "push"; }
    const tot = hs + as; if (tot === l.pt) return "push";
    return (l.t === "ov") === (tot > l.pt) ? "won" : "lost";
  }
  const rows = stats[l.gid];
  if (!rows) return "pending"; // box score not posted yet
  const r = rows.find(x => norm(x.player_display_name) === norm(l.player));
  if (!r) return "void"; // player didn't play: books void the leg
  const v = l.td ? (+r.rushing_tds || 0) + (+r.receiving_tds || 0)
    : l.label === "Passing yards" ? +r.passing_yards : l.label === "Rushing yards" ? +r.rushing_yards : +r.receiving_yards;
  l.actual = v;
  return v > l.line ? "won" : "lost";
}

(async () => {
  const store = readJSON("picks.json", { slips: {} });
  if (process.env.RECORD === "true") record(store);

  const open = Object.values(store.slips).filter(s => !["won", "lost", "push"].includes(s.status) && s.lock <= now);
  if (open.length) {
    const seasons = [...new Set(open.map(s => s.season))];
    const sched = await getCSV(`${NFLVERSE}/schedules/games.csv`);
    const games = {}; (sched || []).forEach(g => { games[g.game_id] = g; });
    const stats = {};
    for (const yr of seasons) {
      const rows = await getCSV(`${NFLVERSE}/stats_player/stats_player_week_${yr}.csv`);
      (rows || []).forEach(r => { (stats[r.game_id] = stats[r.game_id] || []).push(r); });
    }
    for (const s of open) {
      s.legs.forEach(l => { l.result = gradeLeg(l, games, stats); });
      const res = s.legs.map(l => l.result);
      if (res.includes("lost")) s.status = "lost";
      else if (res.includes("pending")) s.status = "pending";
      else if (res.every(r => r === "void" || r === "push")) s.status = "push";
      else s.status = "won";
      s.dec = s.legs.filter(l => l.result === "won").reduce((d, l) => d * Engine.dec(l.a), 1);
      if (s.status !== "pending") s.graded = now;
    }
  }
  const all = Object.values(store.slips);
  const counts = all.reduce((c, s) => (c[s.status] = (c[s.status] || 0) + 1, c), {});
  store.updated = new Date(now).toISOString();
  fs.writeFileSync("picks.json", JSON.stringify(store));
  console.log("picks.json:", all.length, "slips", JSON.stringify(counts));
})();
