// Builds data.json for the site from odds.json + free nflverse data + Open-Meteo weather.
// Run after fetch-odds.js:  node build-data.js   (Node 18+, no packages needed)
// Adds: matchup history (head-to-head with spread/total results), season ATS and O/U records,
// game-time weather for outdoor stadiums, and player prop ladders with hit %, fair odds and edge.

const fs = require("fs");

const SEASON = 2026;
const LAST_N = 10;          // recent games used for player hit %
const MIN_GAMES = 4;        // need at least this many games to rate a prop
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";

const TEAM = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LA", "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS"
};
// Home stadium coordinates (approximate) for weather lookups
const STADIUM = {
  ARI: [33.528, -112.263], ATL: [33.755, -84.401], BAL: [39.278, -76.623], BUF: [42.774, -78.787],
  CAR: [35.226, -80.853], CHI: [41.862, -87.617], CIN: [39.095, -84.516], CLE: [41.506, -81.700],
  DAL: [32.748, -97.093], DEN: [39.744, -105.020], DET: [42.340, -83.046], GB: [44.501, -88.062],
  HOU: [29.685, -95.411], IND: [39.760, -86.164], JAX: [30.324, -81.637], KC: [39.049, -94.484],
  LV: [36.091, -115.184], LAC: [33.953, -118.339], LA: [33.953, -118.339], MIA: [25.958, -80.239],
  MIN: [44.974, -93.258], NE: [42.091, -71.264], NO: [29.951, -90.081], NYG: [40.813, -74.074],
  NYJ: [40.813, -74.074], PHI: [39.901, -75.168], PIT: [40.447, -80.016], SF: [37.403, -121.970],
  SEA: [47.595, -122.332], TB: [27.976, -82.503], TEN: [36.166, -86.771], WAS: [38.908, -76.865]
};
const MARKETS = {
  player_pass_yds: { label: "Passing yards", stat: r => +r.passing_yards },
  player_pass_yds_alternate: { label: "Passing yards", stat: r => +r.passing_yards },
  player_rush_yds: { label: "Rushing yards", stat: r => +r.rushing_yards },
  player_rush_yds_alternate: { label: "Rushing yards", stat: r => +r.rushing_yards },
  player_reception_yds: { label: "Receiving yards", stat: r => +r.receiving_yards },
  player_reception_yds_alternate: { label: "Receiving yards", stat: r => +r.receiving_yards },
  player_anytime_td: { label: "Anytime TD", stat: r => (+r.rushing_tds || 0) + (+r.receiving_tds || 0), td: true },
  player_receptions: { label: "Receptions", stat: r => +r.receptions },
  player_receptions_alternate: { label: "Receptions", stat: r => +r.receptions },
  player_pass_tds: { label: "Passing TDs", stat: r => +r.passing_tds },
  player_rush_reception_yds: { label: "Rush + rec yards", stat: r => (+r.rushing_yards || 0) + (+r.receiving_yards || 0) }
};
// Which defensive stat each market is adjusted by, and how much spread to assume at minimum
const CAT = { "Passing yards": "pass", "Rushing yards": "rush", "Receiving yards": "rec", "Receptions": "recs", "Passing TDs": "ptd", "Rush + rec yards": "rr" };
const CAT_STAT = { pass: r => +r.passing_yards, rush: r => +r.rushing_yards, rec: r => +r.receiving_yards, recs: r => +r.receptions, ptd: r => +r.passing_tds, rr: r => (+r.rushing_yards || 0) + (+r.receiving_yards || 0) };
const SD_FLOOR = { "Receptions": m => 0.25 * m + 0.8, "Passing TDs": m => 0.35 * m + 0.4 };
const WIND_HIT = { "Passing yards": 0.93, "Receiving yards": 0.93, "Receptions": 0.95, "Passing TDs": 0.93, "Rush + rec yards": 0.97 };

// ---------- helpers ----------
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
async function getText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(res.status + " " + url);
  return res.text();
}
async function getCSV(url) { try { return parseCSV(await getText(url)); } catch (e) { console.warn("skip:", e.message); return []; } }
const norm = s => (s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const toDec = a => a > 0 ? 1 + a / 100 : 1 + 100 / -a;
const toAm = p => { if (p <= 0 || p >= 1) return null; return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p); };
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

// Probability the stat goes over the line: half empirical hit rate (smoothed), half normal fit
// vals are already adjusted for opponent and weather; raw is used only for the displayed hit count
function overProb(vals, line, label, raw) {
  const n = vals.length, hits = (raw || vals).filter(v => v > line).length, adjHits = vals.filter(v => v > line).length;
  const emp = (adjHits + 1) / (n + 2);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const floor = (SD_FLOOR[label] || (m => 0.25 * m + 5))(mean);
  const sd = Math.max(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1)), floor);
  const fit = 1 - normCdf((line - mean) / sd);
  return { p: 0.5 * emp + 0.5 * fit, hits, n, mean };
}

(async () => {
  const odds = JSON.parse(fs.readFileSync("odds.json", "utf8"));
  const [sched, statsNow, statsPrev, injuries] = await Promise.all([
    getCSV(`${NFLVERSE}/schedules/games.csv`),
    getCSV(`${NFLVERSE}/stats_player/stats_player_week_${SEASON}.csv`),
    getCSV(`${NFLVERSE}/stats_player/stats_player_week_${SEASON - 1}.csv`),
    getCSV(`${NFLVERSE}/injuries/injuries_${SEASON}.csv`)
  ]);
  console.log("injury rows:", injuries.length);
  console.log("schedule rows:", sched.length, "player rows:", statsNow.length, statsPrev.length);

  // ---------- team history ----------
  const done = sched.filter(g => g.result !== "" && g.game_type);
  function gameResult(g) {
    const res = +g.result, spr = g.spread_line === "" ? null : +g.spread_line, tot = g.total_line === "" ? null : +g.total_line;
    let cover = null, ou = null;
    if (spr !== null) cover = res > spr ? g.home_team : res < spr ? g.away_team : "PUSH";
    if (tot !== null) ou = +g.total > tot ? "O" : +g.total < tot ? "U" : "P";
    return { season: +g.season, week: g.week, away: g.away_team, home: g.home_team, as: +g.away_score, hs: +g.home_score, spread: spr, total: tot, cover, ou, temp: g.temp === "" ? null : +g.temp, wind: g.wind === "" ? null : +g.wind };
  }
  function teamRecord(t) {
    const r = { ats: [0, 0, 0], ou: [0, 0, 0], pf: 0, pa: 0, g: 0 };
    done.filter(g => +g.season === SEASON && g.game_type === "REG" && (g.home_team === t || g.away_team === t)).forEach(g => {
      const x = gameResult(g); const home = x.home === t;
      r.g++; r.pf += home ? x.hs : x.as; r.pa += home ? x.as : x.hs;
      if (x.cover) r.ats[x.cover === "PUSH" ? 2 : x.cover === t ? 0 : 1]++;
      if (x.ou) r.ou[x.ou === "O" ? 0 : x.ou === "U" ? 1 : 2]++;
    });
    return { ats: r.ats, ou: r.ou, ppg: r.g ? +(r.pf / r.g).toFixed(1) : null, papg: r.g ? +(r.pa / r.g).toFixed(1) : null, games: r.g };
  }

  // ---------- weather ----------
  async function weather(home, iso, roof, neutral) {
    if (neutral) return { note: "Neutral site" };
    if (roof === "dome" || roof === "closed") return { roof: "dome" };
    const c = STADIUM[home]; if (!c) return null;
    const hoursOut = (new Date(iso) - Date.now()) / 36e5;
    if (hoursOut > 15 * 24 || hoursOut < -6) return { roof };
    try {
      const day = iso.slice(0, 10);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&hourly=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&start_date=${day}&end_date=${new Date(new Date(iso).getTime() + 864e5).toISOString().slice(0, 10)}`;
      const w = JSON.parse(await getText(url)).hourly;
      const hr = iso.slice(0, 13) + ":00"; let i = w.time.indexOf(hr); if (i < 0) i = 0;
      return { roof: roof || "outdoors", temp: Math.round(w.temperature_2m[i]), wind: Math.round(w.wind_speed_10m[i]), rain: w.precipitation_probability[i] };
    } catch (e) { console.warn("weather skip", home, e.message); return { roof }; }
  }

  // ---------- players ----------
  const byPlayer = {};
  [...statsPrev, ...statsNow].filter(r => r.season_type === "REG").forEach(r => {
    const k = norm(r.player_display_name); (byPlayer[k] = byPlayer[k] || []).push(r);
  });
  for (const k in byPlayer) byPlayer[k].sort((a, b) => (+a.season - +b.season) || (+a.week - +b.week));
  // Favor this season: use up to the last 10 games this season, topping up from last season only if fewer than 6
  function history(name) {
    const all = byPlayer[norm(name)] || [];
    const cur = all.filter(r => +r.season === SEASON), prev = all.filter(r => +r.season === SEASON - 1);
    return cur.length >= 6 ? cur.slice(-LAST_N) : prev.slice(-(LAST_N - cur.length)).concat(cur);
  }
  // Each team's most recent game this season, to spot players who missed it
  const teamLast = {};
  statsNow.filter(r => r.season_type === "REG").forEach(r => { if (!teamLast[r.team] || +r.week > teamLast[r.team].week) teamLast[r.team] = { week: +r.week, gid: r.game_id }; });

  // ---------- opponent defense: how much each team allows vs league average ----------
  const allowed = {}; // cat -> team -> {gid: total}
  statsNow.filter(r => r.season_type === "REG").forEach(r => {
    for (const c in CAT_STAT) { const t = ((allowed[c] = allowed[c] || {})[r.opponent_team] = allowed[c][r.opponent_team] || {}); t[r.game_id] = (t[r.game_id] || 0) + (CAT_STAT[c](r) || 0); }
  });
  const defFactor = {}; // cat -> team -> factor
  for (const c in allowed) {
    const avg = {}; for (const t in allowed[c]) { const v = Object.values(allowed[c][t]); avg[t] = v.reduce((a, b) => a + b, 0) / v.length; }
    const lg = Object.values(avg).reduce((a, b) => a + b, 0) / Math.max(Object.keys(avg).length, 1);
    defFactor[c] = {}; for (const t in avg) defFactor[c][t] = Math.min(1.15, Math.max(0.85, 1 + 0.5 * (avg[t] / lg - 1)));
  }

  // ---------- injury report (latest status for the game's week) ----------
  const inj = {};
  injuries.forEach(r => {
    const k = norm(r.full_name) + "|" + r.week;
    const dnp = /did not participate/i.test(r.practice_status), lim = /limited/i.test(r.practice_status);
    inj[k] = r.report_status || (dnp ? "Did not practice" : lim ? "Limited practice" : "");
  });

  // ---------- line movement: remember the first line we saw for each game ----------
  let hist0 = {}; try { hist0 = JSON.parse(fs.readFileSync("history.json", "utf8")); } catch (e) {}
  function snap(ev) {
    const b = (ev.bookmakers || []).find(x => x.key === "fanduel") || (ev.bookmakers || [])[0]; if (!b) return null;
    const m = k => (b.markets || []).find(x => x.key === k), o = (mk, n) => mk && mk.outcomes.find(x => x.name === n);
    const sp = o(m("spreads"), ev.home_team), tt = o(m("totals"), "Over"), mh = o(m("h2h"), ev.home_team), ma = o(m("h2h"), ev.away_team);
    return { at: odds.fetchedAt, spread: sp ? sp.point : null, total: tt ? tt.point : null, mlH: mh ? mh.price : null, mlA: ma ? ma.price : null };
  }

  // ---------- games ----------
  const games = {}; const props = [];
  for (const ev of odds.lines || []) {
    const away = TEAM[ev.away_team], home = TEAM[ev.home_team]; if (!away || !home) continue;
    const t = new Date(ev.commence_time);
    const row = sched.find(g => +g.season === SEASON && g.away_team === away && g.home_team === home && Math.abs(new Date(g.gameday + "T12:00:00Z") - t) < 2.5 * 864e5);
    const h2h = done.filter(g => (g.home_team === home && g.away_team === away) || (g.home_team === away && g.away_team === home))
      .sort((a, b) => (+b.season - +a.season) || (+b.week - +a.week)).slice(0, 6).map(gameResult);
    games[ev.id] = {
      away, home, h2h, gid: row ? row.game_id : null, season: SEASON, week: row ? +row.week : null,
      rec: { [away]: teamRecord(away), [home]: teamRecord(home) },
      div: row ? row.div_game === "1" : false,
      weather: await weather(home, ev.commence_time, row ? row.roof : null, row ? row.location === "Neutral" : false),
      stadium: row ? row.stadium : null
    };
    const now = snap(ev);
    if (now) { if (!hist0[ev.id]) hist0[ev.id] = { open: now, t: ev.commence_time }; games[ev.id].open = hist0[ev.id].open; games[ev.id].now = now; }
  }

  // ---------- props ----------
  for (const ev of odds.props || []) {
    const G = games[ev.id] || {};
    const windy = G.weather && G.weather.wind >= 15;
    const lines = {}; // player|label -> {player, label, td, rows:{line: {book: price}}}
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const M = MARKETS[m.key]; if (!M) continue;
      for (const o of m.outcomes) {
        const isUnder = !M.td && o.name === "Under";
        if (!isUnder && (M.td ? o.name !== "Yes" : o.name !== "Over")) continue;
        const key = o.description + "|" + M.label, line = M.td ? 0.5 : o.point;
        const L = lines[key] = lines[key] || { player: o.description, label: M.label, td: !!M.td, stat: M.stat, rows: {}, un: {} };
        if (isUnder) { (L.un[line] = L.un[line] || {})[bk.key] = o.price; continue; } // main lines also have an Under price
        (L.rows[line] = L.rows[line] || {})[bk.key] = o.price;
        if (o.link) ((L.lk = L.lk || {})[line] = L.lk[line] || {})[bk.key] = o.link; // each book's add-to-bet-slip link
      }
    }
    for (const L of Object.values(lines)) {
      const hist = history(L.player);
      const raw = hist.map(L.stat);
      const team = hist.length ? hist[hist.length - 1].team : null;
      const opp = team && G.home ? (team === G.home ? G.away : team === G.away ? G.home : null) : null;
      const cat = CAT[L.label];
      const oppF = opp && cat && defFactor[cat] && defFactor[cat][opp] ? +defFactor[cat][opp].toFixed(3) : 1;
      const windF = windy ? (WIND_HIT[L.label] || 1) : 1;
      const vals = raw.map(v => v * oppF * windF);
      const injury = inj[norm(L.player) + "|" + G.week] || "";
      const last = hist[hist.length - 1];
      const missedLast = !!(team && teamLast[team] && (!last || +last.season !== SEASON || last.game_id !== teamLast[team].gid));
      const ladder = Object.keys(L.rows).map(Number).sort((a, b) => a - b).map(line => {
        const out = { line, prices: L.rows[line] };
        if (L.un[line]) out.under = L.un[line];
        if (L.lk && L.lk[line]) out.links = L.lk[line];
        if (vals.length >= MIN_GAMES) {
          const r = L.td ? { p: (raw.filter(v => v > 0).length + 1) / (raw.length + 2), hits: raw.filter(v => v > 0).length, n: raw.length } : overProb(vals, line, L.label, raw);
          out.p = +r.p.toFixed(3); out.hits = r.hits; out.n = r.n; out.fair = toAm(r.p);
        }
        return out;
      });
      props.push({
        event: ev.id, player: L.player, team, opp, oppF, windF, injury, missedLast, label: L.label, td: L.td, ladder,
        recent: raw.slice(-5), avg: raw.length ? +(raw.reduce((a, b) => a + b, 0) / raw.length).toFixed(1) : null
      });
    }
  }

  // Keep history only for games from the last 3 weeks
  for (const id in hist0) if (new Date(hist0[id].t) < Date.now() - 21 * 864e5) delete hist0[id];
  fs.writeFileSync("history.json", JSON.stringify(hist0));
  fs.writeFileSync("data.json", JSON.stringify({ builtAt: new Date().toISOString(), oddsAt: odds.fetchedAt, games, props }));
  const rated = props.filter(p => p.ladder.some(l => l.p !== undefined)).length;
  console.log("Saved data.json:", Object.keys(games).length, "games,", props.length, "props (", rated, "rated)");
})();
