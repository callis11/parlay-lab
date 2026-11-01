// College football player props: ESPN box scores → player game logs → the same ratings the NFL props use.
// Used by cfb/build.js (ratings for the site) and picks.js (grading). Box scores are cached in cfb/box.json.
const { overProb, MARKETS } = require("../build-data.js");

const LAST_N = 10, MIN_GAMES = 4;
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

// One ESPN summary → [{player_display_name, team, passing_yards, ...}] using nflverse field names (so NFL_STAT works)
function boxRows(sum) {
  const by = {};
  for (const tm of (sum && sum.boxscore && sum.boxscore.players) || []) {
    const team = tm.team && tm.team.abbreviation;
    for (const gp of tm.statistics || []) {
      for (const a of gp.athletes || []) {
        const nm = a.athlete && a.athlete.displayName; if (!nm) continue;
        const r = by[team + "|" + nm] = by[team + "|" + nm] || { player_display_name: nm, team };
        const v = {}; (gp.keys || []).forEach((k, i) => { v[k] = (a.stats || [])[i]; });
        const n = x => { const f = parseFloat(String(x == null ? "" : x).split(/[\/-]/)[0]); return isFinite(f) ? f : 0; };
        const n2 = x => { const p = String(x == null ? "" : x).split(/[\/-]/); const f = parseFloat(p[1]); return isFinite(f) ? f : 0; };
        if (gp.name === "passing") { r.completions = n(v["completions/passingAttempts"]); r.attempts = n2(v["completions/passingAttempts"]); r.passing_yards = n(v.passingYards); r.passing_tds = n(v.passingTouchdowns); r.passing_interceptions = n(v.interceptions); }
        if (gp.name === "rushing") { r.carries = n(v.rushingAttempts); r.rushing_yards = n(v.rushingYards); r.rushing_tds = n(v.rushingTouchdowns); }
        if (gp.name === "receiving") { r.receptions = n(v.receptions); r.receiving_yards = n(v.receivingYards); r.receiving_tds = n(v.receivingTouchdowns); }
      }
    }
  }
  // Anyone listed in the box played: fill the stats they didn't record with 0
  return Object.values(by).map(r => Object.assign({ completions: 0, attempts: 0, passing_yards: 0, passing_tds: 0, passing_interceptions: 0, carries: 0, rushing_yards: 0, rushing_tds: 0, receptions: 0, receiving_yards: 0, receiving_tds: 0 }, r));
}

// Ratings for every prop in cfb/odds.json props (raw Odds API event odds), shaped like the NFL props in data.json
// games: odds event id → {away, home, gid}; box: {games:{espnId:{t, rows}}}
function rateProps(oddsProps, games, box) {
  const hist = {}; // norm(name) → rows in time order
  Object.keys(box.games).map(id => box.games[id]).sort((a, b) => a.t.localeCompare(b.t)).forEach(g => g.rows.forEach(r => { (hist[norm(r.player_display_name)] = hist[norm(r.player_display_name)] || []).push(Object.assign({ t: g.t }, r)); }));
  const teamLast = {}; // each team's latest box score before now
  Object.keys(box.games).forEach(id => { const g = box.games[id]; new Set(g.rows.map(r => r.team)).forEach(t => { if (!teamLast[t] || g.t > teamLast[t]) teamLast[t] = g.t; }); });
  const out = [];
  for (const ev of oddsProps || []) {
    const G = games[ev.id]; if (!G) continue;
    const lines = {};
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const M = MARKETS[m.key]; if (!M) continue;
      for (const o of m.outcomes || []) {
        const isUnder = !M.td && o.name === "Under";
        if (!isUnder && (M.td ? o.name !== "Yes" : o.name !== "Over")) continue;
        const key = o.description + "|" + M.label, line = M.td ? 0.5 : o.point;
        const L = lines[key] = lines[key] || { player: o.description, label: M.label, td: !!M.td, stat: M.stat, rows: {}, un: {} };
        if (isUnder) { (L.un[line] = L.un[line] || {})[bk.key] = o.price; continue; }
        (L.rows[line] = L.rows[line] || {})[bk.key] = o.price;
        if (o.link) ((L.lk = L.lk || {})[line] = L.lk[line] || {})[bk.key] = o.link;
      }
    }
    for (const L of Object.values(lines)) {
      const all = (hist[norm(L.player)] || []).filter(r => r.t < ev.commence_time && (r.team === G.away || r.team === G.home));
      const last = all.slice(-LAST_N), raw = last.map(L.stat);
      const team = all.length ? all[all.length - 1].team : null, opp = team ? (team === G.home ? G.away : G.home) : null;
      const ladder = Object.keys(L.rows).map(Number).sort((a, b) => a - b).map(line => {
        const o = { line, prices: L.rows[line] };
        if (L.un[line]) o.under = L.un[line];
        if (L.lk && L.lk[line]) o.links = L.lk[line];
        if (raw.length >= MIN_GAMES) {
          const r = L.td ? { p: (raw.filter(v => v > 0).length + 1) / (raw.length + 2), hits: raw.filter(v => v > 0).length, n: raw.length } : overProb(raw, line, L.label, raw);
          o.p = +r.p.toFixed(3); o.hits = r.hits; o.n = r.n;
          const allV = all.map(L.stat); if (allV.length > raw.length) o.since = [allV.filter(v => L.td ? v > 0 : v > line).length, allV.length];
        }
        return o;
      });
      const missedLast = !!(team && teamLast[team] && teamLast[team] < ev.commence_time && all[all.length - 1].t !== teamLast[team]);
      out.push({ event: ev.id, player: L.player, team, opp, oppF: 1, windF: 1, injury: "", missedLast, label: L.label, td: L.td, ladder,
        recent: raw.slice(-5), avg: raw.length ? +(raw.reduce((a, b) => a + b, 0) / raw.length).toFixed(1) : null });
    }
  }
  return out;
}

module.exports = { boxRows, rateProps, norm };
