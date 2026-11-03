// Backtest, step 2: replays past NFL seasons through the same engine the site uses, then grades everything.
// Run from the repo root (no API key needed): node backtest/replay.js
// For each week it builds the board as of 1 hour before that week's first kickoff, using only stats from games
// already played (no peeking), the books' prices 45 minutes before each kickoff, and FanDuel's price when it has one.
// Writes backtest/results.json (report card), backtest/teams.json (team prop history for the site)
// and backtest/graded-legs.json (feeds the live model's learning).

const fs = require("fs"), zlib = require("zlib");
const Engine = require("../engine.js");
const { buildData, getCSV, norm, TEAM, NFLVERSE } = require("../build-data.js");
const BOOK = "fanduel";
TEAM["Washington Football Team"] = "WAS"; // 2021 name
const load = n => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync("backtest/raw/" + n + ".json.gz"))); } catch (e) { return null; } };
const dec = Engine.dec;
const CAL = process.env.CALIB === "1" ? JSON.parse(fs.readFileSync("calibration.json", "utf8")) : null;
const newTeam = () => ({ ats: [0, 0], ou: [0, 0], props: {}, vs: {}, players: {}, pvs: {}, parlays: {} });

function grade(l, g, rows) {
  if (!g || g.result === "") return null;
  const hs = +g.home_score, as = +g.away_score;
  if (l.kind === "g") {
    if (l.t === "ml-h" || l.t === "ml-a") { const m = l.t === "ml-h" ? hs - as : as - hs; return m > 0 ? "won" : m < 0 ? "lost" : "push"; }
    if (l.t === "sp-h" || l.t === "sp-a") { const m = (l.t === "sp-h" ? hs - as : as - hs) + l.pt; return m > 0 ? "won" : m < 0 ? "lost" : "push"; }
    const tot = hs + as; if (tot === l.pt) return "push";
    return (l.t === "ov") === (tot > l.pt) ? "won" : "lost";
  }
  const r = (rows || []).find(x => norm(x.player_display_name) === norm(l.player));
  if (!r) return "void";
  const v = l.td ? (+r.rushing_tds || 0) + (+r.receiving_tds || 0)
    : (Engine.NFL_STAT[l.label] ? Engine.NFL_STAT[l.label](r) : undefined);
  if (v === undefined || isNaN(v)) return "void";
  l.actual = v;
  if (l.side === "under") return v < l.line ? "won" : v > l.line ? "lost" : "push";
  return v > l.line ? "won" : "lost";
}
const pBucket = p => Math.min(9, Math.floor(p * 10)); // 0-10%, 10-20%, ... 90-100%
const imp = a => 1 / dec(a);

(async () => {
  const sched = await getCSV(`${NFLVERSE}/schedules/games.csv`);
  const STUDY = process.env.STUDY === "1", ST = []; // STUDY=1: test the "rarely clears this line" note, write nothing
  // STUDY=2: the signal study. Writes one row per site-type pick (props and game lines) with everything we knew before
  // kickoff (history, snaps, targets, opponent, weather, team situation, price) to backtest/study-rows.json.gz, then stop.
  // Read it with: node backtest/study.js
  const STUDY2 = process.env.STUDY === "2", ROWS = [];
  const nvp = (x, y) => { const px = imp(x), py = imp(y); return px / (px + py); };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const seasons = [2021, 2022, 2023, 2024, 2025].filter(s => load("lines-" + s) && (!(STUDY || STUDY2) || load("props-" + s)));
  const R = { builtAt: new Date().toISOString(), seasons: {}, legs: { byCat: {}, byP: {}, byMarket: {} }, slips: {}, teamParlays: {}, cards: { pieces: [0, 0, 0, 0], straights: [0, 0, 0, 0], tds: [0, 0, 0, 0] }, games: { ats: {}, fav: {} } };
  const teams = {}; // team -> stats for the Teams page
  const graded = [];
  // Same-game pairs: for each kind of pair, how often each leg hit and how often both did (main lines and game lines)
  const PAIRS = {}, slipLog = [];
  const pairAdd = (k, a, b) => { const x = PAIRS[k] = PAIRS[k] || { n: 0, a: 0, b: 0, ab: 0 }; x.n++; x.a += a; x.b += b; x.ab += a * b; };
  const add = (o, k, won, a, p) => { const x = o[k] = o[k] || { n: 0, w: 0, profit: 0, exp: 0, book: 0 }; x.n++; if (won) x.w++; x.profit += won ? 10 * (dec(a) - 1) : -10; if (p !== undefined) x.exp += p; x.book += imp(a); };

  for (const season of seasons) {
    const lines = load("lines-" + season), props = load("props-" + season) || {};
    const [statsNow, statsPrev, injuries] = await Promise.all([
      getCSV(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`),
      getCSV(`${NFLVERSE}/stats_player/stats_player_week_${season - 1}.csv`),
      getCSV(`${NFLVERSE}/injuries/injuries_${season}.csv`)]);
    let long = null;
    if (STUDY) { const prev2 = await getCSV(`${NFLVERSE}/stats_player/stats_player_week_${season - 2}.csv`); long = {};
      [].concat(prev2, statsPrev, statsNow).forEach(r => { if (r.season_type && r.season_type !== "REG") return; (long[norm(r.player_display_name)] = long[norm(r.player_display_name)] || []).push(r); }); }
    // STUDY=2 extras: snap counts (PFR via nflverse), team pace / pass rate, and every player's weekly rows in order
    let SN = null, TS = null, PH = null, REST = null, OPENX = null;
    if (STUDY2) {
      // Opening prop prices (backtest/raw/open-<season>, fetch.js OPEN mode): per event, player|label -> main line + prices (FanDuel, else DraftKings)
      const op = load("open-" + season); OPENX = {};
      const KEYS = { player_pass_yds: "Passing yards", player_rush_yds: "Rushing yards", player_reception_yds: "Receiving yards", player_anytime_td: "Anytime TD", player_receptions: "Receptions", player_pass_tds: "Passing TDs", player_rush_reception_yds: "Rush + rec yards" };
      if (op) for (const id in op) { const ev = op[id]; if (ev.error) continue; const X = OPENX[id] = {};
        for (const bk of ["fanduel", "draftkings", "betmgm", "betrivers"]) { const b = (ev.bookmakers || []).find(x => x.key === bk); if (!b) continue;
          for (const m of b.markets) { const lab = KEYS[m.key]; if (!lab) continue;
            for (const o of m.outcomes) { const k = norm(o.description || "") + "|" + lab; if (X[k]) continue; // first book wins
              if (m.key === "player_anytime_td") { if (o.name === "Yes") X[k] = { bk, line: 0.5, a: o.price }; continue; }
              if (o.name !== "Over") continue; const un = m.outcomes.find(u => u.name === "Under" && u.description === o.description && u.point === o.point);
              X[k] = { bk, line: o.point, a: o.price, u: un ? un.price : undefined }; } } } }
      const [sn1, sn0, ts1, ts0] = await Promise.all([
        getCSV(`${NFLVERSE}/snap_counts/snap_counts_${season}.csv`), getCSV(`${NFLVERSE}/snap_counts/snap_counts_${season - 1}.csv`),
        getCSV(`${NFLVERSE}/stats_team/stats_team_week_${season}.csv`), getCSV(`${NFLVERSE}/stats_team/stats_team_week_${season - 1}.csv`)]);
      SN = {}; [].concat(sn0, sn1).forEach(r => { if (r.game_type !== "REG") return; (SN[norm(r.player)] = SN[norm(r.player)] || []).push({ s: +r.season, w: +r.week, pct: +r.offense_pct, team: r.team }); });
      for (const k in SN) SN[k].sort((a, b) => (a.s - b.s) || (a.w - b.w));
      TS = {}; [].concat(ts0, ts1).forEach(r => { if (r.season_type !== "REG") return; const att = +r.attempts || 0, car = +r.carries || 0;
        (TS[r.team] = TS[r.team] || []).push({ s: +r.season, w: +r.week, plays: att + car + (+r.sacks_suffered || 0), pass: att + car ? att / (att + car) : null, pts: null }); });
      for (const k in TS) TS[k].sort((a, b) => (a.s - b.s) || (a.w - b.w));
      PH = {}; [].concat(statsPrev, statsNow).forEach(r => { if (r.season_type !== "REG") return; (PH[norm(r.player_display_name)] = PH[norm(r.player_display_name)] || []).push(r); });
      for (const k in PH) PH[k].sort((a, b) => (+a.season - +b.season) || (+a.week - +b.week));
      // days since each team's previous game (bye = 13+)
      REST = {}; const tg = {}; sched.filter(g => +g.season === season && g.game_type === "REG").forEach(g => { [g.away_team, g.home_team].forEach(t => (tg[t] = tg[t] || []).push({ w: +g.week, d: new Date(g.gameday + "T12:00:00Z") })); });
      for (const t in tg) { tg[t].sort((a, b) => a.w - b.w); tg[t].forEach((g, i) => { REST[t + "|" + g.w] = i ? Math.round((g.d - tg[t][i - 1].d) / 864e5) : 7; }); }
    }
    const before = (arr, wk, key) => { const sk = key || "season", wkk = key ? "w" : "week"; return (arr || []).filter(x => (+x[sk] < season) || (+x[sk] === season && +x[wkk] < wk)); };
    const byGid = {}; statsNow.forEach(r => { (byGid[r.game_id] = byGid[r.game_id] || []).push(r); });
    const games = {}; sched.forEach(g => { games[g.game_id] = g; });
    // group every saved kickoff into its NFL week
    const weeks = {}, best = {};
    // a game can show up in two kickoff snapshots (1 PM and 4 PM are 3 hours apart): keep the one taken right before it
    for (const kick in lines) for (const ev of lines[kick].events) { const d = Math.abs(new Date(ev.commence_time) - new Date(kick)); if (!best[ev.id] || d < best[ev.id].d) best[ev.id] = { d, ev }; }
    for (const id in best) { const ev = best[id].ev; {
      const a = TEAM[ev.away_team], h = TEAM[ev.home_team];
      const row = sched.find(g => +g.season === season && g.game_type !== "" && g.away_team === a && g.home_team === h);
      if (!row) continue;
      (weeks[row.week] = weeks[row.week] || []).push({ ev, row, props: props[ev.id] && !props[ev.id].error ? props[ev.id] : null });
    } }
    const S = R.seasons[season] = { weeks: 0, games: 0, propGames: 0, legs: 0, slips: 0 };
    for (const wk of Object.keys(weeks).map(Number).sort((a, b) => a - b)) {
      const W = weeks[wk], first = Math.min(...W.map(x => +new Date(x.ev.commence_time))), now = first - 36e5;
      const odds = { fetchedAt: new Date(now).toISOString(), lines: W.map(x => x.ev), props: W.filter(x => x.props).map(x => x.props) };
      const data = await buildData(odds, { season, asOf: first, sched, statsNow, statsPrev, injuries, hist0: {} });
      // CALIB=1 replays with the model's learned corrections, like the live site uses now
      const E = Engine.make(odds, data, BOOK, now, Object.assign({}, Engine.OPTS.nfl, { calib: CAL }));
      S.weeks++; S.games += W.length; S.propGames += odds.props.length;
      const meta = id => { const m = data.games[id] || {}; return { gid: m.gid, away: m.away, home: m.home }; };
      const rawMap = {}; if (STUDY2) (data.props || []).forEach(p => { rawMap[p.event + "|" + p.player + "|" + p.label] = p; });

      const perGame = {}; // ev -> [{info, won}]
      const pg = (ev, info, won) => (perGame[ev] = perGame[ev] || []).push({ info, won });
      // ---- every rated leg (like the live gradebook) ----
      for (const g of E.G) {
        const m = meta(g.id), G0 = games[m.gid];
        ["ml-a", "ml-h", "sp-a", "sp-h", "ov", "un"].forEach(t => {
          const L = g.legs[t], leg = { kind: "g", t, pt: L.pt, a: L.a, p: g.p0[t] };
          const res = grade(leg, G0); if (res !== "won" && res !== "lost") return;
          const won = res === "won", cat = Engine.category(leg);
          if (STUDY2) { const other = { "ml-a": "ml-h", "ml-h": "ml-a", "sp-a": "sp-h", "sp-h": "sp-a", "ov": "un", "un": "ov" }[t], O = g.legs[other];
            const W = (data.games[g.id] || {}).weather || {}, side = /-a$/.test(t) ? m.away : /-h$/.test(t) ? m.home : null, oppT = side === m.away ? m.home : m.away;
            const pace = (tm, k) => mean(before(TS && TS[tm], +wk, "s").slice(-3).map(x => x[k]).filter(x => x != null));
            ROWS.push({ k: "g", s: season, wk: +wk, t, pt: L.pt, a: L.a, nv: O ? +nvp(L.a, O.a).toFixed(4) : null, bp: leg.p, won: won ? 1 : 0,
              home: side ? (side === m.home ? 1 : 0) : null, hsp: g.legs["sp-h"].pt, tot: g.legs["ov"].pt, div: (data.games[g.id] || {}).div ? 1 : 0,
              rest: side ? REST[side + "|" + wk] : null, orest: side ? REST[oppT + "|" + wk] : null, restH: REST[m.home + "|" + wk], restA: REST[m.away + "|" + wk],
              wind: W.wind == null ? null : W.wind, dome: W.roof === "dome" ? 1 : 0, temp: W.temp == null ? null : W.temp,
              pace: side ? pace(side, "plays") : null, opace: side ? pace(oppT, "plays") : null, paceH: pace(m.home, "plays"), paceA: pace(m.away, "plays"),
              passH: pace(m.home, "pass"), passA: pace(m.away, "pass") }); }
          add(R.legs.byCat, cat, won, L.a, leg.p); add(R.legs.byMarket, cat.split("|")[0], won, L.a, leg.p);
          if (leg.p !== undefined) add(R.legs.byP, pBucket(leg.p), won, L.a, leg.p);
          graded.push([cat, +(leg.p || 0).toFixed(3), won ? 1 : 0, first]);
          pg(g.id, Engine.legInfo(Object.assign({ ev: g.id }, leg), m), won ? 1 : 0);
        });
        // team over/under record
        const tr = grade({ kind: "g", t: "ov", pt: g.legs["ov"].pt }, G0);
        if (tr === "won" || tr === "lost") [m.away, m.home].forEach(t => { const T = teams[t] = teams[t] || newTeam(); T.ou[tr === "won" ? 0 : 1]++; });
        // team ATS / favorites (5 seasons of game lines)
        const res = grade({ kind: "g", t: "sp-h", pt: g.legs["sp-h"].pt }, G0);
        if (res === "won" || res === "lost") { const cov = res === "won" ? m.home : m.away, other = res === "won" ? m.away : m.home;
          [cov, other].forEach(t => { const T = teams[t] = teams[t] || newTeam(); T.ats[t === cov ? 0 : 1]++; }); }
      }
      const pieces = {}, straights = {}, tds = {};
      for (const p of E.P) {
        const g = E.G.find(x => x.id === p.ev); if (!g) continue;
        const m = meta(p.ev), rows = byGid[m.gid];
        if (!rows) continue;
        const opp = p.team === m.home ? m.away : m.home;
        for (const r of p.rungs) {
          const sides = [{ side: "over", a: r.a, p: r.p }];
          if (r.under !== undefined && !p.td) sides.push({ side: "under", a: r.under, p: r.p === undefined ? undefined : 1 - r.p });
          for (const sd of sides) {
            const leg = { kind: "p", player: p.player, label: p.label, td: p.td, line: r.line, side: sd.side, a: sd.a, p: sd.p };
            const res = grade(leg, games[m.gid], rows); if (res !== "won" && res !== "lost") continue;
            const won = res === "won";
            if (r.under !== undefined || p.td) pg(p.ev, Engine.legInfo({ kind: "p", ev: p.ev, player: p.player, team: p.team, label: p.label, td: p.td, side: sd.side, p: sd.p }), won ? 1 : 0);
            // team history: main lines only (the ones with an under price), overs
            if (sd.side === "over" && (r.under !== undefined || p.td) && p.team) {
              const T = teams[p.team] = teams[p.team] || newTeam();
              const k = p.label; (T.props[k] = T.props[k] || [0, 0])[won ? 0 : 1]++;
              if (opp) { const v = T.vs[opp] = T.vs[opp] || {}; (v[k] = v[k] || [0, 0])[won ? 0 : 1]++; }
              const P = T.players[p.player] = T.players[p.player] || {}; (P[k] = P[k] || [0, 0])[won ? 0 : 1]++;
              if (opp) { const V = (T.pvs[p.player] = T.pvs[p.player] || {})[opp] = (T.pvs[p.player] || {})[opp] || [0, 0]; V[won ? 0 : 1]++; }
            }
            if (sd.p === undefined || r.n < 6) continue;
            if (sd.a < -400 || sd.a > 250) { if (!(p.td || sd.side === "over")) continue; }
            if (STUDY && long) { const rows0 = (long[norm(p.player)] || []).filter(x => +x.season < season || (+x.season === season && +x.week < +wk));
              const vals = rows0.map(x => p.td ? (+x.rushing_tds || 0) + (+x.receiving_tds || 0) : (Engine.NFL_STAT[p.label] ? Engine.NFL_STAT[p.label](x) : undefined)).filter(v => v !== undefined && !isNaN(v));
              const hit = vals.filter(v => sd.side === "under" ? v < r.line : p.td ? v > 0 : v > r.line).length;
              if (vals.length >= 8) ST.push([sd.p, won ? 1 : 0, hit / vals.length, sd.a, p.healthy ? 1 : 0, sd.side]); }
            if (STUDY2) {
              const rp = rawMap[p.ev + "|" + p.player + "|" + p.label], rr = rp && rp.ladder.find(x => x.line === r.line);
              const stat = p.td ? (x => (+x.rushing_tds || 0) + (+x.receiving_tds || 0)) : Engine.NFL_STAT[p.label];
              const hrows = before(PH && PH[norm(p.player)], +wk), hv = stat ? hrows.map(stat).filter(v => v !== undefined && !isNaN(v)) : [];
              const last10 = hv.slice(-10), last3 = hv.slice(-3), avg = mean(last10), avg3 = mean(last3);
              const sdv = last10.length > 2 ? Math.sqrt(mean(last10.map(v => (v - avg) * (v - avg)))) : null;
              const cur = hrows.filter(x => +x.season === season), gp = cur.length;
              const ts = k => mean(hrows.slice(-3).map(x => +x[k]).filter(x => !isNaN(x))), tsS = k => mean(cur.map(x => +x[k]).filter(x => !isNaN(x)));
              const sn = before(SN && SN[norm(p.player)], +wk, "s"), snC = sn.filter(x => x.s === season);
              const snL = sn.length ? sn[sn.length - 1].pct : null, sn3 = mean(sn.slice(-3).map(x => x.pct)), snS = mean(snC.map(x => x.pct));
              const W = (data.games[p.ev] || {}).weather || {}, isHome = p.team === m.home, oppT = isHome ? m.away : m.home;
              const tsp = isHome ? g.legs["sp-h"].pt : g.legs["sp-a"].pt;
              const pace = (tm, k) => mean(before(TS && TS[tm], +wk, "s").slice(-3).map(x => x[k]).filter(x => x != null));
              const over = sd.side === "over";
              // market move since the open, in the pick's favor: line move (as % of the line) and price move (points of implied chance)
              const ox = OPENX && OPENX[p.ev] && OPENX[p.ev][norm(p.player) + "|" + p.label], main = (!p.td && r.under !== undefined) || p.td;
              let lmv = null, pmv = null, oln = null;
              if (ox) { oln = ox.line; const dir = over || p.td ? 1 : -1;
                const mr = p.rungs.find(x => x.under !== undefined), mc = mr ? mr.line : null; // the closing main line for this player + stat
                if (!p.td && mc !== null) lmv = +((mc - ox.line) / Math.max(1, ox.line) * dir).toFixed(4); // + = the main number moved toward this side
                if (main && (p.td || r.line === ox.line)) { const ca = over || p.td ? r.a : r.under, oa = over || p.td ? ox.a : ox.u; if (ca !== undefined && oa !== undefined) pmv = +((imp(ca) - imp(oa)) * 100).toFixed(2); } }
              const rate = arr => arr.length ? arr.filter(v => p.td ? v > 0 : over ? v > r.line : v < r.line).length / arr.length : null;
              ROWS.push({ k: "p", s: season, wk: +wk, player: p.player, team: p.team, ev: p.ev, mkt: p.label, td: p.td ? 1 : 0, side: p.td ? "td" : sd.side, line: r.line, a: sd.a,
                nv: (!p.td && r.under !== undefined) ? +(over ? nvp(r.a, r.under) : nvp(r.under, r.a)).toFixed(4) : null,
                bp: sd.p, rp: rr && rr.p !== undefined ? (over || p.td ? rr.p : 1 - rr.p) : null, n: r.n, won: won ? 1 : 0, act: leg.actual,
                avg, avg3, sdv, gp, h10: rate(last10), h3: rate(last3), since: rate(hv), hn: hv.length,
                vs: rate(hrows.filter(x => x.opponent_team === oppT).map(stat).filter(v => !isNaN(v))), vsn: hrows.filter(x => x.opponent_team === oppT).length,
                tgt3: ts("target_share"), tgtS: tsS("target_share"), ay3: ts("air_yards_share"), car3: ts("carries"), att3: ts("attempts"),
                snL, sn3, snS, snN: sn.length, g50: snC.length ? snC.filter(x => x.pct >= 0.5).length / snC.length : null,
                oppF: p.oppF, inj: p.injury ? 1 : 0, injT: p.injury || "", missed: p.missedLast ? 1 : 0, healthy: p.healthy ? 1 : 0,
                home: isHome ? 1 : 0, tsp, tot: g.legs["ov"].pt, rest: REST[p.team + "|" + wk], orest: REST[oppT + "|" + wk],
                wind: W.wind == null ? null : W.wind, dome: W.roof === "dome" ? 1 : 0, temp: W.temp == null ? null : W.temp,
                pace: pace(p.team, "plays"), opace: pace(oppT, "plays"), pass: pace(p.team, "pass"), opass: pace(oppT, "pass"),
                main: main ? 1 : 0, oln, lmv, pmv, obk: ox ? ox.bk : null });
            }
            const cat = Engine.category(leg);
            add(R.legs.byCat, cat, won, sd.a, sd.p); add(R.legs.byMarket, cat.split("|")[0], won, sd.a, sd.p); add(R.legs.byP, pBucket(sd.p), won, sd.a, sd.p);
            graded.push([cat, +sd.p.toFixed(3), won ? 1 : 0, first]);
            // the live report card's sections, rebuilt per game
            const gk = p.ev, item = { k: p.player + "|" + p.label, p: sd.p, a: sd.a, won, edge: sd.p * dec(sd.a) - 1 };
            if (p.td) (tds[gk] = tds[gk] || []).push(item);
            else if (sd.side === "over" && sd.a >= -700 && sd.a <= -110 && p.healthy) (pieces[gk] = pieces[gk] || []).push(item);
            if (!p.td && r.under !== undefined && p.healthy) (straights[gk] = straights[gk] || []).push(item);
          }
        }
      }
      for (const ev in perGame) { const L = perGame[ev];
        for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const k = Engine.pairKey(L[i].info, L[j].info); if (!k) continue;
          // keep the pair's order stable so "a" and "b" mean the same role every time
          const swap = L[i].info.role > L[j].info.role; pairAdd(k, swap ? L[j].won : L[i].won, swap ? L[i].won : L[j].won); } }
      const sect = (src, n, key, sort) => { for (const gk in src) { const seen = {}; src[gk].sort(sort).filter(x => !seen[x.k] && (seen[x.k] = 1)).slice(0, n).forEach(x => { const c = R.cards[key]; c[0]++; if (x.won) c[1]++; c[2] += x.p; c[3] += imp(x.a); }); } };
      sect(pieces, 20, "pieces", (a, b) => b.p - a.p); sect(straights, 10, "straights", (a, b) => b.edge - a.edge); sect(tds, 5, "tds", (a, b) => b.p - a.p);

      // ---- the site's parlays, graded at $10 each ----
      const gradeSlip = s => {
        let won = true, d = 1;
        for (const l of s.l) { const m = meta(l.ev), res = grade(Object.assign({}, l), games[m.gid], byGid[m.gid]);
          if (res === null) return null; if (res === "lost") won = false; if (res === "won") d *= dec(l.a); }
        return { won, d, ch: Engine.chance(s.l) };
      };
      const seenSlip = {};
      for (const grp of E.allParlays()) for (const s of grp.slips) {
        const key = s.l.map(l => l.k + "|" + (l.t || "") + "|" + (l.line || "")).sort().join();
        if (seenSlip[key]) continue; seenSlip[key] = 1;
        const r = gradeSlip(s); if (!r) continue;
        S.slips++;
        const x = R.slips[s.n] = R.slips[s.n] || { n: 0, w: 0, profit: 0, exp: 0, legs: 0 };
        x.n++; if (r.won) x.w++; x.profit += r.won ? 10 * (r.d - 1) : -10; x.exp += r.ch || 0; x.legs += s.l.length;
        slipLog.push({ name: s.n, ch: r.ch, legs: s.l.map(l => Object.assign({}, l)), metas: Object.fromEntries(s.l.map(l => [l.ev, meta(l.ev)])) });
      }
      // every team's own parlays (like the Lions page), so each team has a history
      const playing = new Set(); Object.values(data.games).forEach(m => { playing.add(m.away); playing.add(m.home); });
      for (const t of playing) {
        const ts = E.teamSlips(t); if (!ts.g) continue;
        for (const s of ts.l) { const r = gradeSlip(s); if (!r) continue;
          const T = teams[t] = teams[t] || newTeam();
          const nm = s.n.replace(/^\S+\s/, ""), x = T.parlays[nm] = T.parlays[nm] || [0, 0, 0]; x[0]++; if (r.won) x[1]++; x[2] += r.won ? 10 * (r.d - 1) : -10; }
      }
      S.legs = graded.length;
      process.stdout.write(`${season} W${wk}: ${W.length} games, ${odds.props.length} with props\n`);
    }
  }
  // ---- correlations ----
  const corr = { builtAt: R.builtAt, note: "rho = how strongly two legs from the same game win or lose together (0 = independent). n = past pairs.", pairs: {} };
  for (const k in PAIRS) { const x = PAIRS[k]; if (x.n < 50) continue;
    const pa = x.a / x.n, pb = x.b / x.n, pab = x.ab / x.n, den = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
    if (!den) continue; corr.pairs[k] = { n: x.n, rho: +((pab - pa * pb) / den).toFixed(3), both: +pab.toFixed(3), a: +pa.toFixed(3), b: +pb.toFixed(3) }; }
  // Re-score every past slip with the correlation adjustment, so the site's slip-type correction only fixes what's left
  for (const k in R.slips) { R.slips[k].expRaw = R.slips[k].exp; R.slips[k].exp = 0; }
  for (const x of slipLog) { if (x.ch == null) continue; const a = Engine.corrAdj(x.legs, ev => x.metas[ev], corr); R.slips[x.name].exp += Math.min(0.99, x.ch * a.f); }
  if (STUDY) { studyReport(ST); return; }
  if (STUDY2) { fs.writeFileSync("backtest/study-rows.json.gz", zlib.gzipSync(JSON.stringify(ROWS))); console.log("study rows:", ROWS.length, "-> backtest/study-rows.json.gz (not committed). Next: node backtest/study.js"); return; }
  fs.writeFileSync("backtest/corr.json", JSON.stringify(corr, null, 1));
  // round
  const r2 = o => { for (const k in o) for (const f of ["profit", "exp", "book"]) if (typeof o[k][f] === "number") o[k][f] = +o[k][f].toFixed(2); };
  r2(R.legs.byCat); r2(R.legs.byP); r2(R.legs.byMarket); r2(R.slips); for (const k in R.slips) R.slips[k].expRaw = +R.slips[k].expRaw.toFixed(2);
  R.cards = Object.fromEntries(Object.entries(R.cards).map(([k, c]) => [k, { n: c[0], w: c[1], ours: +c[2].toFixed(1), book: +c[3].toFixed(1) }]));
  // team file: keep players with at least 4 graded main lines
  for (const t in teams) { const T = teams[t]; for (const p in T.players) { const tot = Object.values(T.players[p]).reduce((a, b) => a + b[0] + b[1], 0); if (tot < 4) { delete T.players[p]; delete T.pvs[p]; } }
    for (const k in T.parlays) T.parlays[k][2] = +T.parlays[k][2].toFixed(2); }
  fs.writeFileSync("backtest/results.json", JSON.stringify(R, null, 1));
  fs.writeFileSync("backtest/teams.json", JSON.stringify({ builtAt: R.builtAt, seasons: Object.keys(R.seasons), teams }));
  fs.writeFileSync("backtest/graded-legs.json", JSON.stringify({ legs: graded }));
  console.log("Done:", JSON.stringify(R.seasons), "legs graded:", graded.length);
})();

// STUDY=1 report: picks whose long-run record at this line is 15+ points under our % ("Heads up") vs the rest
function studyReport(ST) {
  const grp = (f, label) => { const L = ST.filter(f), n = L.length, w = L.reduce((a, x) => a + x[1], 0), e = L.reduce((a, x) => a + x[0], 0);
    console.log(label.padEnd(44), "n", String(n).padStart(6), " hit", (100 * w / n).toFixed(1) + "%", " we said", (100 * e / n).toFixed(1) + "%", " gap", (100 * (w - e) / n).toFixed(1)); };
  const site = x => x[4] && x[3] >= -700 && x[3] <= 250 && x[0] >= 0.45;
  for (const gap of [0.10, 0.15, 0.20, 0.25]) {
    console.log("--- note when long-run rate < our % minus " + gap + " (site-type picks: healthy, -700..+250, 45%+) ---");
    grp(x => site(x) && x[2] < x[0] - gap, "with note");
    grp(x => site(x) && !(x[2] < x[0] - gap), "without note");
  }
  for (const b of [[0.45, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1]]) {
    grp(x => site(x) && x[0] >= b[0] && x[0] < b[1] && x[2] < x[0] - 0.15, "note, we said " + b.join("-"));
    grp(x => site(x) && x[0] >= b[0] && x[0] < b[1] && !(x[2] < x[0] - 0.15), "no note, we said " + b.join("-"));
  }
}
