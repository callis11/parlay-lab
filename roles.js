// NFL player roles for player bets: depth chart spot (ESPN, via nflverse, refreshed twice a day)
// and how much each player actually plays (snap counts from Pro Football Reference, via nflverse).
// "Starts" here = games where he played 50%+ of his side's snaps (offense, or defense for defenders).
// Official games-started counts aren't in the free data; 50%+ snaps is the honest stand-in and says the same thing.
// Saved to roles.json and rebuilt at most every ROLES_HOURS (default 6), since the depth chart file is large (~70 MB).
const fs = require("fs");
const FIRST = 2013; // snap counts start in 2013
const OFF = { QB: 1, RB: 1, FB: 1, WR: 1, TE: 1 };
const DEFPOS = /^(L|R|N|W|S|M)?(DE|DT|NT|OLB|ILB|LB|MLB|CB|NB|SS|FS|EDGE)$/;
const parseLines = (text, cb) => { // fast CSV for these simple files (no quoted commas in the columns we use)
  const lines = text.split("\n"), head = lines[0].replace(/\r$/, "").split(",");
  for (let i = 1; i < lines.length; i++) { const l = lines[i]; if (!l) continue; const v = l.replace(/\r$/, "").split(","); if (v.length !== head.length) continue; const o = {}; head.forEach((h, j) => o[h] = v[j]); cb(o); } };

async function build(NFLVERSE, SEASON, norm, getText) {
  const hours = +(process.env.ROLES_HOURS || 6);
  let old = null; try { old = JSON.parse(fs.readFileSync("roles.json", "utf8")); } catch (e) {}
  if (old && old.season === SEASON && Date.now() - new Date(old.at) < hours * 36e5 && process.env.ROLES !== "true") return old;
  const out = { at: new Date().toISOString(), season: SEASON, depthAt: null, snapsWeek: 0, p: {} };
  // ---- snap counts: this season per game, career totals by PFR id ----
  const career = {}, cname = {}, cur = {};
  for (let y = FIRST; y <= SEASON; y++) {
    let text = ""; try { text = await getText(`${NFLVERSE}/snap_counts/snap_counts_${y}.csv`); } catch (e) { console.warn("roles: skip snaps", y, e.message); continue; }
    parseLines(text, r => {
      if (r.game_type !== "REG" && r.game_type !== "POST") return;
      const off = +r.offense_pct || 0, def = +r.defense_pct || 0, pct = Math.max(off, def); if (!(+r.offense_snaps || +r.defense_snaps)) return;
      const C = career[r.pfr_player_id] = career[r.pfr_player_id] || { g: 0, g50: 0 }; C.g++; if (pct >= 0.5) C.g50++; cname[norm(r.player)] = r.pfr_player_id;
      if (y === SEASON && r.game_type === "REG") { const k = norm(r.player); (cur[k] = cur[k] || { id: r.pfr_player_id, team: r.team, pos: r.position, w: [] }).w.push([+r.week, pct]); cur[k].team = r.team; if (+r.week > out.snapsWeek) out.snapsWeek = +r.week; }
    });
  }
  for (const k in cur) { const P = cur[k], w = P.w.sort((a, b) => a[0] - b[0]).map(x => x[1]), l3 = w.slice(-3), C = career[P.id] || { g: 0, g50: 0 };
    out.p[k] = { team: P.team, pos: P.pos, sl: +w[w.length - 1].toFixed(2), s3: +(l3.reduce((a, b) => a + b, 0) / l3.length).toFixed(2), sa: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2),
      gp: w.length, g50: w.filter(x => x >= 0.5).length, cg: C.g, c50: C.g50, last5: w.slice(-5).map(x => Math.round(x * 100)) }; }
  // ---- depth chart: newest snapshot per team ----
  let dtext = ""; try { dtext = await getText(`${NFLVERSE}/depth_charts/depth_charts_${SEASON}.csv`); } catch (e) { console.warn("roles: skip depth", e.message); }
  if (dtext) {
    const rows = [], latest = {};
    parseLines(dtext, r => { if (r.pos_grp === "Special Teams") return; rows.push(r); if (!latest[r.team] || r.dt > latest[r.team]) latest[r.team] = r.dt; });
    const slots = {}, best = {};
    rows.forEach(r => { if (r.dt !== latest[r.team]) return;
      const pos = r.pos_abb, off = !!OFF[pos], def = DEFPOS.test(pos); if (!off && !def) return;
      const sk = r.team + "|" + pos; (slots[sk] = slots[sk] || {})[r.pos_slot] = 1;
      const k = norm(r.player_name), rk = +r.pos_rank; if (!best[k] || rk < best[k].rk || (off && !best[k].off)) best[k] = { team: r.team, pos, rk, off };
      if (!out.depthAt || r.dt > out.depthAt) out.depthAt = r.dt; });
    for (const k in best) { const b = best[k], n = Object.keys(slots[b.team + "|" + b.pos] || {}).length || 1, P = out.p[k] = out.p[k] || { team: b.team };
      P.dc = b.pos + b.rk; P.st = b.rk <= n ? 1 : 0; P.dteam = b.team;
      if (P.gp === undefined) { const C = career[cname[k]] || { g: 0, g50: 0 }; P.gp = 0; P.g50 = 0; P.cg = C.g; P.c50 = C.g50; } }
  }
  console.log("roles:", Object.keys(out.p).length, "players, snaps through week", out.snapsWeek, ", depth chart", out.depthAt);
  return out;
}
module.exports = { build };
