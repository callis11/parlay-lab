// Team history for game lines, the same for every sport: straight-up, against the spread and over/under records
// for this season and last season, home/away splits, the last 5 games, and recent meetings between two teams.
// Each sport's builder passes finished games as rows and saves the result in its data.json as `th`.
//
// row: { d: "2026-10-25", cur: true (this season) / false (last season), h, a (team codes), hs, as (scores),
//        sp: home team's closing spread (negative = home favored, null if unknown), tot: closing total (or null) }

function rec() { return { su: [0, 0], ats: [0, 0, 0], ou: [0, 0, 0], n: 0 }; }
function add(R, won, cov, ou) {
  R.n++; R.su[won ? 0 : 1]++;
  if (cov !== null) R.ats[cov > 0 ? 0 : cov < 0 ? 1 : 2]++;
  if (ou !== null) R.ou[ou > 0 ? 0 : ou < 0 ? 1 : 2]++;
}
function trim(R) { const o = { su: R.su, n: R.n }; if (R.ats[0] + R.ats[1] + R.ats[2]) o.ats = R.ats; if (R.ou[0] + R.ou[1] + R.ou[2]) o.ou = R.ou; return o; }

// rows: finished games. teams: list of team codes to keep (the ones playing soon). pairs: [[away, home], ...] for meetings.
function build(rows, teams, pairs, opts) {
  opts = opts || {};
  const keep = new Set(teams), T = {}, meet = {};
  const get = t => T[t] = T[t] || { cur: rec(), prev: rec(), home: rec(), away: rec(), l5: [] };
  rows = rows.filter(r => r && r.h && r.a && r.hs != null && r.as != null).sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
  const pairSet = new Set((pairs || []).map(p => [p[0], p[1]].sort().join("|")));
  for (const r of rows) {
    const margin = r.hs - r.as, hasSp = r.sp !== null && r.sp !== undefined && !isNaN(r.sp), hasTot = r.tot !== null && r.tot !== undefined && !isNaN(r.tot);
    const covH = hasSp ? margin + r.sp : null, ou = hasTot ? r.hs + r.as - r.tot : null;
    for (const side of ["h", "a"]) {
      const t = r[side]; if (!keep.has(t)) continue;
      const X = get(t), won = side === "h" ? margin > 0 : margin < 0, cov = covH === null ? null : side === "h" ? covH : -covH;
      add(r.cur ? X.cur : X.prev, won, cov, ou);
      if (r.cur) {
        add(side === "h" ? X.home : X.away, won, cov, ou);
        X.l5.push({ d: r.d, opp: side === "h" ? r.a : r.h, at: side === "h" ? "vs" : "@", r: (won ? "W " : margin === 0 ? "T " : "L ") + (side === "h" ? r.hs + "-" + r.as : r.as + "-" + r.hs),
          c: cov === null ? null : cov > 0 ? "cover" : cov < 0 ? "miss" : "push", o: ou === null ? null : ou > 0 ? "O" : ou < 0 ? "U" : "P",
          sp: hasSp ? (side === "h" ? r.sp : -r.sp) : null });
        if (X.l5.length > 5) X.l5.shift();
      }
    }
    const pk = [r.a, r.h].sort().join("|");
    if (pairSet.has(pk)) {
      const M = meet[pk] = meet[pk] || [];
      M.push({ d: r.d, h: r.h, a: r.a, hs: r.hs, as: r.as, sp: hasSp ? r.sp : null, tot: hasTot ? r.tot : null,
        cover: covH === null ? null : covH > 0 ? r.h : covH < 0 ? r.a : "push", ou: ou === null ? null : ou > 0 ? "O" : ou < 0 ? "U" : "P" });
      if (M.length > (opts.meetN || 5)) M.shift();
    }
  }
  const out = {};
  for (const t in T) { const X = T[t]; out[t] = { cur: trim(X.cur), prev: trim(X.prev), home: trim(X.home), away: trim(X.away), l5: X.l5.slice().reverse() }; }
  for (const k in meet) meet[k].reverse();
  return { builtAt: new Date().toISOString(), cur: opts.curLabel || "this season", prev: opts.prevLabel || "last season", teams: out, meet };
}

// ESPN game summary -> closing line from its pick center (DraftKings first): { sp: home spread, tot }
function espnLine(summary) {
  const pc = (summary && summary.pickcenter) || [];
  const p = pc.find(x => x.provider && /draft/i.test(x.provider.name)) || pc[0];
  if (!p) return { sp: null, tot: null };
  const tot = p.overUnder != null && !isNaN(+p.overUnder) ? +p.overUnder : null;
  let sp = null;
  if (p.spread != null && !isNaN(+p.spread)) {
    const m = Math.abs(+p.spread), hf = p.homeTeamOdds && p.homeTeamOdds.favorite, af = p.awayTeamOdds && p.awayTeamOdds.favorite;
    sp = m === 0 ? 0 : hf ? -m : af ? m : null;
    if (sp === null && p.details) { const comp = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {}, home = (comp.competitors || []).find(c => c.homeAway === "home");
      const ab = home && home.team && home.team.abbreviation; sp = ab && p.details.indexOf(ab + " ") === 0 ? -m : m; }
  }
  return { sp, tot };
}

module.exports = { build, espnLine };
