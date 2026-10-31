// NBA: builds nba/data.json from nba/odds.json + ESPN's public scoreboard and box scores.
// Run from the repo root after nba/fetch.js:  node nba/build.js   (Node 18+, no packages)
// Keeps a cache of finished games and player box scores in nba/logs.json so each run only fetches new games.

const fs = require("fs");
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const SEASON_START = "2026-10-01";   // current season (2026-27)
const BACKFILL_FROM = "2025-10-20";  // all of last season: player history at each line, vs-opponent records, team records against the spread
const LAST_N = 10, MIN_GAMES = 4, MAX_NEW_BOX = 700, MAX_NEW_LINES = 800;
const TH = require("../teamhist.js");

const MARKETS = {
  player_points: "Points", player_points_alternate: "Points",
  player_rebounds: "Rebounds", player_assists: "Assists",
  player_threes: "Threes", player_threes_alternate: "Threes",
  player_points_rebounds_assists: "Pts + reb + ast"
};
const STAT = { "Points": r => r.pts, "Rebounds": r => r.reb, "Assists": r => r.ast, "Threes": r => r.fg3, "Pts + reb + ast": r => r.pts + r.reb + r.ast };
const SD_FLOOR = { "Points": m => 0.2 * m + 3, "Rebounds": m => 0.25 * m + 1.5, "Assists": m => 0.25 * m + 1.2, "Threes": m => 0.4 * m + 0.8, "Pts + reb + ast": m => 0.18 * m + 4 };

const norm = s => (s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const nick = n => (n || "").trim().split(" ").pop().toLowerCase();
const etDate = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
const toAm = p => p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
function overProb(vals, line, label, raw) {
  const n = vals.length, hits = raw.filter(v => v > line).length, adjHits = vals.filter(v => v > line).length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.max(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1)), SD_FLOOR[label](mean));
  return { p: 0.5 * (adjHits + 1) / (n + 2) + 0.5 * (1 - normCdf((line - mean) / sd)), hits, n };
}
async function getJSON(url) { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 parlay-lab" } }); if (!r.ok) throw new Error(r.status + " " + url); return r.json(); }
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; console.warn(e.message); } } })); return out; }
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

// ---------- ESPN parsing ----------
function parseScoreboard(j) {
  return (j.events || []).map(ev => {
    const c = ev.competitions && ev.competitions[0]; if (!c) return null;
    const h = c.competitors.find(x => x.homeAway === "home"), a = c.competitors.find(x => x.homeAway === "away"); if (!h || !a) return null;
    return { id: ev.id, t: ev.date, d: etDate(ev.date), h: h.team.abbreviation, a: a.team.abbreviation, hn: h.team.name || h.team.displayName, an: a.team.name || a.team.displayName,
      hs: +h.score || 0, as: +a.score || 0, done: !!(ev.status && ev.status.type && ev.status.type.completed) };
  }).filter(Boolean);
}
function parseBox(j) {
  const rows = [];
  for (const tb of (j.boxscore && j.boxscore.players) || []) {
    const st = tb.statistics && tb.statistics[0]; if (!st) continue;
    const lab = (st.labels || st.names || []).map(x => String(x).toUpperCase());
    const keys = (st.keys || []).map(x => String(x).toLowerCase());
    const ix = (l, k) => { let i = lab.indexOf(l); if (i < 0) i = keys.findIndex(x => x.startsWith(k)); return i; };
    const iMin = ix("MIN", "minutes"), iPts = ix("PTS", "points"), iReb = ix("REB", "rebounds"), iAst = ix("AST", "assists"), i3 = ix("3PT", "threepoint");
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats || !a.stats.length) continue;
      const v = a.stats, min = parseInt(v[iMin]) || 0; if (!min) continue;
      rows.push([a.athlete.displayName, tb.team.abbreviation, min, +v[iPts] || 0, +v[iReb] || 0, +v[iAst] || 0, parseInt(String(v[i3] || "0").split("-")[0]) || 0]);
    }
  }
  return rows;
}
function parseInjuries(j) {
  const out = {};
  for (const t of j.injuries || []) for (const x of t.injuries || []) {
    const name = x.athlete && x.athlete.displayName; if (!name) continue;
    const s = x.status || (x.type && x.type.description) || "";
    out[norm(name)] = /out/i.test(s) ? "Out" : /doubt/i.test(s) ? "Doubtful" : /question/i.test(s) ? "Questionable" : /day/i.test(s) ? "Day-to-day" : s;
  }
  return out;
}

(async () => {
  const odds = readJSON("nba/odds.json", null);
  if (!odds) { console.log("No nba/odds.json yet."); return; }
  const logs = readJSON("nba/logs.json", { games: {}, box: {}, scanned: {} }); logs.lines = logs.lines || {};

  // ---------- 1. scoreboards by month (finished months scanned once) ----------
  const months = []; const today = etDate(new Date().toISOString());
  for (let d = new Date(BACKFILL_FROM + "T12:00:00Z"); etDate(d.toISOString()).slice(0, 7) <= today.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    const m = d.toISOString().slice(0, 7).replace("-", "");
    if (m.slice(4) >= "07" && m.slice(4) <= "09") continue; // offseason
    const recent = m >= today.slice(0, 7).replace("-", "") || +m >= +today.slice(0, 7).replace("-", "") - 1;
    if (!logs.scanned[m] || recent) months.push(m);
  }
  // Also next month, so games in the first days of a new month get matched too
  const nx = new Date(today + "T12:00:00Z"); nx.setUTCMonth(nx.getUTCMonth() + 1);
  const nm = nx.toISOString().slice(0, 7).replace("-", ""); if (!months.includes(nm) && !(nm.slice(4) >= "07" && nm.slice(4) <= "09")) months.push(nm);
  const sbs = await pool(months, 3, m => getJSON(`${ESPN}/scoreboard?dates=${m}&limit=1000`));
  for (let i = 0; i < months.length; i++) {
    let gs = sbs[i] ? parseScoreboard(sbs[i]) : [];
    // If the whole-month request comes back empty, fall back to one request per day
    if (!gs.length) {
      const m = months[i], days = [];
      for (let d = 1; d <= 31; d++) { const ds = m + String(d).padStart(2, "0"); if (ds <= today.replace(/-/g, "")) days.push(ds); }
      (await pool(days, 4, ds => getJSON(`${ESPN}/scoreboard?dates=${ds}`))).forEach(j => { if (j) gs = gs.concat(parseScoreboard(j)); });
    }
    gs.forEach(g => { logs.games[g.id] = g; });
    if (gs.length) logs.scanned[months[i]] = new Date().toISOString();
  }
  console.log("scoreboards:", months.join(","), "games cached:", Object.keys(logs.games).length);

  // ---------- 2. box scores for finished games we don't have ----------
  const need = Object.values(logs.games).filter(g => g.done && !logs.box[g.id]).sort((a, b) => b.t.localeCompare(a.t)).slice(0, MAX_NEW_BOX);
  const boxes = await pool(need, 6, g => getJSON(`${ESPN}/summary?event=${g.id}`));
  boxes.forEach((j, i) => { if (j) { const rows = parseBox(j); if (rows.length) logs.box[need[i].id] = rows; const L = TH.espnLine(j); logs.lines[need[i].id] = [L.sp, L.tot]; } });
  console.log("new box scores:", boxes.filter(Boolean).length, "of", need.length);
  // Closing lines (ESPN pick center) for finished games boxed before we saved lines
  const needL = Object.values(logs.games).filter(g => g.done && logs.box[g.id] && !logs.lines[g.id]).sort((a, b) => b.t.localeCompare(a.t)).slice(0, MAX_NEW_LINES);
  const ls = await pool(needL, 6, g => getJSON(`${ESPN}/summary?event=${g.id}`));
  ls.forEach((j, i) => { if (j) { const L = TH.espnLine(j); logs.lines[needL[i].id] = [L.sp, L.tot]; } });
  console.log("closing lines:", Object.keys(logs.lines).length, "games (", ls.filter(Boolean).length, "new)");
  fs.writeFileSync("nba/logs.json", JSON.stringify(logs));

  // ---------- 3. player logs, team records, opponent factors ----------
  const games = Object.values(logs.games).filter(g => g.done && logs.box[g.id]).sort((a, b) => a.t.localeCompare(b.t));
  const isCur = g => g.d >= SEASON_START;
  const byPlayer = {}, teamLast = {}, oppTot = {}; // oppTot[label][team] = [per-game totals]
  for (const g of games) {
    const per = {}; // team -> {label: total}
    for (const r of logs.box[g.id]) {
      const [name, team, min, pts, reb, ast, fg3] = r, opp = team === g.h ? g.a : g.h;
      const row = { gid: g.id, d: g.d, cur: isCur(g), team, opp, min, pts, reb, ast, fg3 };
      (byPlayer[norm(name)] = byPlayer[norm(name)] || []).push(row);
      if (row.cur) { per[team] = per[team] || {}; for (const L in STAT) per[team][L] = (per[team][L] || 0) + STAT[L](row); }
    }
    if (isCur(g)) { teamLast[g.h] = g.id; teamLast[g.a] = g.id;
      for (const team in per) { const opp = team === g.h ? g.a : g.h; for (const L in per[team]) ((oppTot[L] = oppTot[L] || {})[opp] = oppTot[L][opp] || []).push(per[team][L]); } }
  }
  const oppF = {};
  for (const L in oppTot) {
    const avg = {}; for (const t in oppTot[L]) if (oppTot[L][t].length >= 3) avg[t] = oppTot[L][t].reduce((a, b) => a + b, 0) / oppTot[L][t].length;
    const ts = Object.keys(avg), lg = ts.reduce((a, t) => a + avg[t], 0) / Math.max(ts.length, 1);
    oppF[L] = {}; ts.forEach(t => { oppF[L][t] = Math.min(1.12, Math.max(0.88, 1 + 0.5 * (avg[t] / lg - 1))); });
  }
  function history(name) {
    const all = byPlayer[norm(name)] || [], cur = all.filter(r => r.cur), prev = all.filter(r => !r.cur);
    return cur.length >= 6 ? cur.slice(-LAST_N) : prev.slice(-(LAST_N - cur.length)).concat(cur);
  }
  function record(t) {
    const gs = games.filter(g => isCur(g) && (g.h === t || g.a === t));
    const res = gs.map(g => { const my = g.h === t ? g.hs : g.as, op = g.h === t ? g.as : g.hs; return { w: my > op, my, op }; });
    const l10 = res.slice(-10);
    return { wl: [res.filter(x => x.w).length, res.filter(x => !x.w).length], l10: [l10.filter(x => x.w).length, l10.filter(x => !x.w).length],
      ppg: res.length ? +(res.reduce((a, x) => a + x.my, 0) / res.length).toFixed(1) : null, papg: res.length ? +(res.reduce((a, x) => a + x.op, 0) / res.length).toFixed(1) : null, games: res.length };
  }

  // ---------- 4. games from the odds file, matched to ESPN ----------
  let hist0 = readJSON("nba/history.json", {});
  function snap(ev) {
    const b = (ev.bookmakers || []).find(x => x.key === "fanduel") || (ev.bookmakers || [])[0]; if (!b) return null;
    const m = k => (b.markets || []).find(x => x.key === k), o = (mk, n) => mk && mk.outcomes.find(x => x.name === n);
    const sp = o(m("spreads"), ev.home_team), tt = o(m("totals"), "Over"), mh = o(m("h2h"), ev.home_team), ma = o(m("h2h"), ev.away_team);
    return { at: odds.fetchedAt, spread: sp ? sp.point : null, total: tt ? tt.point : null, mlH: mh ? mh.price : null, mlA: ma ? ma.price : null };
  }
  const out = {}, all = Object.values(logs.games);
  const injNeed = [];
  for (const ev of odds.lines || []) {
    const t = +new Date(ev.commence_time);
    const g = all.find(x => nick(x.hn) === nick(ev.home_team) && nick(x.an) === nick(ev.away_team) && Math.abs(+new Date(x.t) - t) < 12 * 36e5);
    if (!g) continue;
    const h2h = games.filter(x => (x.h === g.h && x.a === g.a) || (x.h === g.a && x.a === g.h)).slice(-5).reverse()
      .map(x => ({ date: x.d, away: x.a, as: x.as, home: x.h, hs: x.hs }));
    out[ev.id] = { away: g.a, home: g.h, gid: g.id, date: g.d, season: SEASON_START.slice(0, 4), week: g.d, h2h, rec: { [g.a]: record(g.a), [g.h]: record(g.h) } };
    const now = snap(ev); if (now) { if (!hist0[ev.id]) hist0[ev.id] = { open: now, t: ev.commence_time }; out[ev.id].open = hist0[ev.id].open; out[ev.id].now = now; }
    if (t > Date.now() - 3 * 36e5 && t < Date.now() + 36 * 36e5) injNeed.push([ev.id, g.id]);
  }
  // Injury reports for upcoming games (from each game's ESPN summary)
  const injRes = await pool(injNeed, 6, x => getJSON(`${ESPN}/summary?event=${x[1]}`));
  const injury = {}; injRes.forEach(j => { if (j) Object.assign(injury, parseInjuries(j)); });
  console.log("injury tags:", Object.keys(injury).length);

  // ---------- 5. props ----------
  const props = [];
  for (const ev of odds.props || []) {
    const G = out[ev.id] || {};
    const lines = {};
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const label = MARKETS[m.key]; if (!label) continue;
      for (const o of m.outcomes) {
        if ((o.name !== "Over" && o.name !== "Under") || o.point === undefined) continue;
        const L = lines[o.description + "|" + label] = lines[o.description + "|" + label] || { player: o.description, label, rows: {}, un: {} };
        if (o.name === "Under") { (L.un[o.point] = L.un[o.point] || {})[bk.key] = o.price; continue; }
        (L.rows[o.point] = L.rows[o.point] || {})[bk.key] = o.price;
        if (o.link) ((L.lk = L.lk || {})[o.point] = L.lk[o.point] || {})[bk.key] = o.link;
      }
    }
    for (const L of Object.values(lines)) {
      const hist = history(L.player), raw = hist.map(STAT[L.label]);
      const last = hist[hist.length - 1], team = last ? last.team : null;
      const opp = team && G.home ? (team === G.home ? G.away : team === G.away ? G.home : null) : null;
      const f = opp && oppF[L.label] && oppF[L.label][opp] ? +oppF[L.label][opp].toFixed(3) : 1;
      const vals = raw.map(v => v * f);
      const missedLast = !!(team && teamLast[team] && (!last || !last.cur || last.gid !== teamLast[team]));
      const ladder = Object.keys(L.rows).map(Number).sort((a, b) => a - b).map(line => {
        const r = { line, prices: L.rows[line] };
        if (L.un[line]) r.under = L.un[line];
        if (L.lk && L.lk[line]) r.links = L.lk[line];
        if (vals.length >= MIN_GAMES) { const x = overProb(vals, line, L.label, raw); r.p = +x.p.toFixed(3); r.hits = x.hits; r.n = x.n; r.fair = toAm(x.p);
          const allG = (byPlayer[norm(L.player)] || []).map(STAT[L.label]); r.since = [allG.filter(v => v > line).length, allG.length];
          if (opp) { const vg = (byPlayer[norm(L.player)] || []).filter(z => z.opp === opp).map(STAT[L.label]); if (vg.length) r.vs = [vg.filter(v => v > line).length, vg.length]; } }
        return r;
      });
      props.push({ event: ev.id, player: L.player, team, opp, oppF: f, windF: 1, injury: injury[norm(L.player)] || "", missedLast, label: L.label, td: false, ladder,
        recent: raw.slice(-5), avg: raw.length ? +(raw.reduce((a, b) => a + b, 0) / raw.length).toFixed(1) : null });
    }
  }
  for (const id in hist0) if (new Date(hist0[id].t) < Date.now() - 7 * 864e5) delete hist0[id];
  fs.writeFileSync("nba/history.json", JSON.stringify(hist0));
  // Each team's next scheduled game (for "plays next" notes when a team isn't in today's lines)
  const next = {};
  Object.values(logs.games).filter(g => !g.done && +new Date(g.t) > Date.now() - 3 * 36e5).sort((a, b) => a.t.localeCompare(b.t)).forEach(g => {
    if (!next[g.h]) next[g.h] = { t: g.t, opp: g.a, home: true, name: g.hn };
    if (!next[g.a]) next[g.a] = { t: g.t, opp: g.h, home: false, name: g.an };
  });
  // Team history: records against the spread and on totals from ESPN's closing lines, this season and last
  const thRows = Object.values(logs.games).filter(g => g.done).map(g => { const L = logs.lines[g.id] || [null, null]; return { d: g.d, cur: g.d >= SEASON_START, h: g.h, a: g.a, hs: g.hs, as: g.as, sp: L[0], tot: L[1] }; });
  const gl = Object.values(out), th = TH.build(thRows, gl.flatMap(g => [g.away, g.home]), gl.map(g => [g.away, g.home]), { curLabel: "2026–27", prevLabel: "2025–26" });
  fs.writeFileSync("nba/data.json", JSON.stringify({ sport: "nba", builtAt: new Date().toISOString(), oddsAt: odds.fetchedAt, games: out, props, next, th }));
  console.log("Saved nba/data.json:", Object.keys(out).length, "games,", props.length, "props (", props.filter(p => p.ladder.some(l => l.p !== undefined)).length, "rated)");
})();
