// Records the site's auto-built parlays and grades them against final scores and box scores.
//   RECORD=true node picks.js   -> save/refresh slips that haven't kicked off yet (run after a fresh odds pull)
//   node picks.js               -> grade only
// A slip locks when its first game kicks off; the version saved at that point is the one graded.
// Prices are FanDuel's. Data: nflverse schedule (scores) and weekly player stats.

const fs = require("fs");
const Engine = require("./engine.js");

const BOOK = "fanduel";
// SPORT=nba grades the NBA page from nba/ files (ESPN box scores cached in nba/logs.json)
const SPORT = process.env.SPORT || "nfl";
const DIR = SPORT === "nfl" ? "" : SPORT + "/";
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
  const odds = readJSON(DIR + "odds.json", null), data = readJSON(DIR + "data.json", null);
  if (!odds || !data) { console.log("No odds/data to record from."); return; }
  const calib = readJSON(DIR + "calibration.json", null);
  const E = Engine.make(odds, data, BOOK, now, Object.assign({}, Engine.OPTS[SPORT], { calib }));
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
          return { n: l.n, a: l.a, p: l.p, p0: l.p0, kind: l.kind, t: l.t, pt: l.pt, line: l.line, player: l.player, label: l.label, td: l.td, time: l.time, gid: m.gid, away: m.away, home: m.home }; }),
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

// ---------- game report cards ----------
// For every game: our top "pieces" (high-chance alt lines), 10 straight over/under picks on main lines,
// and (NFL) 5 anytime TD picks. Rebuilt on each refresh until kickoff, then locked and graded.
// Every other rated prop and game line goes into gradebook.json so we learn from all of them, not just slip legs.
function buildCards(cards, book) {
  const odds = readJSON(DIR + "odds.json", null), data = readJSON(DIR + "data.json", null);
  if (!odds || !data) return 0;
  const calib = readJSON(DIR + "calibration.json", null);
  const E = Engine.make(odds, data, BOOK, now, Object.assign({}, Engine.OPTS[SPORT], { calib }));
  const dec = Engine.dec, imp = a => 1 / dec(a) / 1.045;
  let made = 0;
  for (const g of E.G) {
    const meta = data.games[g.id] || {};
    if (+new Date(g.t) <= now || !meta.gid) continue; // locked once the game starts
    if (SPORT === "cfb") { cards.book[g.id] = { gid: meta.gid, t: g.t, legs: ["ml-a", "ml-h", "sp-a", "sp-h", "ov", "un"].map(t => ({ kind: "g", t, pt: g.legs[t].pt, a: g.legs[t].a, p0: g.p0[t] })) }; made++; continue; } // no props: grade game lines only
    const props = E.P.filter(p => p.ev === g.id && p.healthy);
    const all = [], overs = [], mains = [], tds = [];
    for (const p of props) for (const r of p.rungs) {
      if (r.p === undefined || r.n < 6) continue;
      const base = { kind: "p", player: p.player, team: p.team, label: p.label, td: p.td, line: r.line };
      const over = Object.assign({}, base, { side: "over", a: r.a, p: r.p, p0: r.p0, nm: ENG_NAME(p, r, "over") });
      if (r.a >= -400 && r.a <= 250) all.push(over);
      if (p.td) tds.push(over); else overs.push(over);
      if (r.under !== undefined && !p.td) {
        const under = Object.assign({}, base, { side: "under", a: r.under, p: 1 - r.p, p0: r.p0 !== undefined ? 1 - r.p0 : undefined, nm: ENG_NAME(p, r, "under") });
        if (r.under >= -400 && r.under <= 250) all.push(under);
        mains.push({ over, under });
      }
    }
    ["ml-a", "ml-h", "sp-a", "sp-h", "ov", "un"].forEach(t => { const L = g.legs[t]; all.push({ kind: "g", t, pt: L.pt, a: L.a, p: g.p[t], p0: g.p0[t], nm: L.n }); });
    const onePer = (arr, n) => { const seen = {}, out = []; for (const x of arr) { const k = x.player + "|" + x.label; if (seen[k]) continue; seen[k] = 1; out.push(x); if (out.length === n) break; } return out; };
    const pieces = onePer(overs.filter(x => x.a >= -700 && x.a <= -110).sort((a, b) => b.p - a.p), 20);
    const straights = onePer(mains.map(m => {
      const eo = m.over.p * dec(m.over.a) - 1, eu = m.under.p * dec(m.under.a) - 1;
      return eo >= eu ? Object.assign({ edge: eo }, m.over) : Object.assign({ edge: eu }, m.under);
    }).sort((a, b) => b.edge - a.edge), 10);
    const tdPicks = onePer(tds.sort((a, b) => b.p - a.p), 5);
    const sec = legs => ({ legs: legs.map(l => ({ nm: l.nm, kind: l.kind, player: l.player, team: l.team, label: l.label, td: l.td, line: l.line, side: l.side, a: l.a, p: +(l.p || 0).toFixed(3) })),
      bookExp: +legs.reduce((s, l) => s + imp(l.a), 0).toFixed(2), ourExp: +legs.reduce((s, l) => s + (l.p || 0), 0).toFixed(2) });
    cards.cards[g.id] = { ev: g.id, gid: meta.gid, away: g.away, home: g.home, aa: meta.away, ha: meta.home, t: g.t, season: meta.season, week: meta.week, saved: now, status: "open",
      pieces: sec(pieces), straights: sec(straights), tds: SPORT === "nfl" ? sec(tdPicks) : null };
    cards.book[g.id] = { gid: meta.gid, t: g.t, legs: all.map(l => ({ kind: l.kind, t: l.t, pt: l.pt, player: l.player, label: l.label, td: l.td, line: l.line, side: l.side, a: l.a, p0: l.p0 })) };
    made++;
  }
  return made;
}
// Display name for a prop leg, e.g. "Jake Ferguson under 3.5 receptions" or "Bucky Irving 40+ rushing yds"
function ENG_NAME(p, r, side) {
  if (p.td) return p.player + " anytime TD";
  if (side === "under") return p.player + " under " + r.line + " " + Engine.unit(p.label, r.line);
  return p.player + " " + (r.line + 0.5) + "+ " + Engine.unit(p.label, r.line + 0.5);
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
    : SPORT === "nba" ? ({ "Points": r.pts, "Rebounds": r.reb, "Assists": r.ast, "Threes": r.fg3, "Pts + reb + ast": r.pts + r.reb + r.ast })[l.label]
    : ({ "Passing yards": +r.passing_yards, "Rushing yards": +r.rushing_yards, "Receiving yards": +r.receiving_yards, "Receptions": +r.receptions,
        "Passing TDs": +r.passing_tds, "Rush + rec yards": (+r.rushing_yards || 0) + (+r.receiving_yards || 0) })[l.label];
  l.actual = v;
  if (l.side === "under") return v < l.line ? "won" : v > l.line ? "lost" : "push";
  return v > l.line ? "won" : "lost";
}

(async () => {
  const store = readJSON(DIR + "picks.json", { slips: {} });
  const cards = readJSON(DIR + "cards.json", { cards: {} });
  cards.book = readJSON(DIR + "gradebook.json", {});
  const graded = readJSON(DIR + "graded-legs.json", { legs: [] }); // compact history of every graded leg: [category, estimate, won 1/0, time]
  if (process.env.RECORD === "true") { record(store); console.log("Report cards built:", buildCards(cards)); }

  const open = Object.values(store.slips).filter(s => !["won", "lost", "push"].includes(s.status) && s.lock <= now);
  const openCards = Object.values(cards.cards).filter(c => c.status !== "graded" && +new Date(c.t) <= now);
  const openBook = Object.keys(cards.book).filter(id => +new Date(cards.book[id].t) <= now);
  if (open.length || openCards.length || openBook.length) {
    const games = {}, stats = {};
    if (SPORT === "cfb") {
      const logs = readJSON("cfb/logs.json", { games: {} });
      for (const id in logs.games) { const g = logs.games[id]; games[id] = { result: g.done ? "final" : "", home_score: g.h.score, away_score: g.a.score }; }
    } else if (SPORT === "nba") {
      const logs = readJSON("nba/logs.json", { games: {}, box: {} });
      for (const id in logs.games) { const g = logs.games[id]; games[id] = { result: g.done ? "final" : "", home_score: g.hs, away_score: g.as }; }
      for (const id in logs.box) stats[id] = logs.box[id].map(r => ({ player_display_name: r[0], pts: r[3], reb: r[4], ast: r[5], fg3: r[6] }));
    } else {
      const seasons = [...new Set(open.map(s => s.season).concat(openCards.map(c => c.season)).filter(Boolean))];
      const sched = await getCSV(`${NFLVERSE}/schedules/games.csv`);
      (sched || []).forEach(g => { games[g.game_id] = g; });
      for (const yr of seasons) {
        const rows = await getCSV(`${NFLVERSE}/stats_player/stats_player_week_${yr}.csv`);
        (rows || []).forEach(r => { (stats[r.game_id] = stats[r.game_id] || []).push(r); });
      }
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
    // Report cards
    for (const c of openCards) {
      let pending = false;
      for (const k of ["pieces", "straights", "tds"]) {
        const sec = c[k]; if (!sec) continue;
        sec.legs.forEach(l => { l.gid = c.gid; l.result = gradeLeg(l, games, stats); delete l.gid; if (l.result === "pending") pending = true; });
        sec.hit = sec.legs.filter(l => l.result === "won").length; sec.graded = sec.legs.filter(l => l.result === "won" || l.result === "lost").length;
      }
      if (!pending) { c.status = "graded"; c.graded = now; } else c.status = "live";
    }
    // Every rated leg: grade, keep only the compact result for learning
    for (const id of openBook) {
      const b = cards.book[id]; let pending = false; const out = [];
      for (const l of b.legs) {
        l.gid = b.gid; const r = gradeLeg(l, games, stats);
        if (r === "pending") { pending = true; break; }
        if ((r === "won" || r === "lost") && l.p0 !== undefined && l.p0 !== null) out.push([Engine.category(l), +l.p0.toFixed(3), r === "won" ? 1 : 0, +new Date(b.t)]);
      }
      if (!pending) { graded.legs.push(...out); delete cards.book[id]; }
    }
  }
  // Keep about a season of graded legs and 60 days of cards
  graded.legs = graded.legs.filter(x => x[3] > now - 200 * 864e5);
  for (const id in cards.cards) if (+new Date(cards.cards[id].t) < now - 60 * 864e5) delete cards.cards[id];
  const all = Object.values(store.slips);

  // ---------- learn from results ----------
  // For each kind of leg (market + price range), compare how often it hit with our raw estimate.
  // The correction is shrunk toward "no change" until there are lots of results, and capped at +/-25%.
  const K = 40, MIN_LEGS = 15, byCat = {}, byStrategy = {};
  // Learn from every graded leg in the gradebook; if there are none yet, use the slip legs
  const useBook = graded.legs.length > 0;
  if (useBook) for (const x of graded.legs) { const c = byCat[x[0]] = byCat[x[0]] || { n: 0, hits: 0, exp: 0 }; c.n++; c.exp += x[1]; c.hits += x[2]; }
  for (const s of all) {
    if (!["won", "lost", "push"].includes(s.status)) continue;
    if (!useBook) for (const l of s.legs) {
      if (l.result !== "won" && l.result !== "lost") continue;
      const est = l.p0 !== undefined && l.p0 !== null ? l.p0 : l.p; if (est === undefined || est === null) continue;
      const c = byCat[Engine.category(l)] = byCat[Engine.category(l)] || { n: 0, hits: 0, exp: 0 };
      c.n++; c.exp += est; if (l.result === "won") c.hits++;
    }
    if (s.status !== "push") {
      const st = byStrategy[s.name] = byStrategy[s.name] || { n: 0, w: 0, profit: 0 };
      st.n++; if (s.status === "won") { st.w++; st.profit += 10 * (s.dec - 1); } else st.profit -= 10;
    }
  }
  for (const k in byCat) {
    const c = byCat[k], m = c.exp / c.n;
    c.rate = +(c.hits / c.n).toFixed(3); c.est = +m.toFixed(3);
    if (c.n >= MIN_LEGS) c.factor = +Math.min(1.25, Math.max(0.75, ((c.hits + K * m) / (c.n + K)) / m)).toFixed(3);
  }
  for (const k in byStrategy) { const st = byStrategy[k]; st.profit = +st.profit.toFixed(2); st.roi = +(st.profit / (10 * st.n)).toFixed(3); }
  // Estimate vs reality: group every graded leg by what we predicted
  const buckets = {};
  for (const x of graded.legs) { const b = Math.min(9, Math.floor(x[1] * 10)); const k = b * 10; const o = buckets[k] = buckets[k] || { n: 0, hits: 0, est: 0 }; o.n++; o.hits += x[2]; o.est += x[1]; }
  for (const k in buckets) { const o = buckets[k]; o.rate = +(o.hits / o.n).toFixed(3); o.est = +(o.est / o.n).toFixed(3); }
  fs.writeFileSync(DIR + "calibration.json", JSON.stringify({ updated: new Date(now).toISOString(), legsGraded: graded.legs.length, byCat, byStrategy, buckets }));
  const book = cards.book; delete cards.book;
  cards.updated = new Date(now).toISOString();
  fs.writeFileSync(DIR + "cards.json", JSON.stringify(cards));
  fs.writeFileSync(DIR + "gradebook.json", JSON.stringify(book));
  fs.writeFileSync(DIR + "graded-legs.json", JSON.stringify(graded));
  const counts = all.reduce((c, s) => (c[s.status] = (c[s.status] || 0) + 1, c), {});
  store.updated = new Date(now).toISOString();
  fs.writeFileSync(DIR + "picks.json", JSON.stringify(store));
  console.log("picks.json:", all.length, "slips", JSON.stringify(counts));
})();
