// Signal study, step 2: reads backtest/study-rows.json.gz (made by STUDY=2 CALIB=1 node backtest/replay.js) and asks,
// for every trait we knew before kickoff: did picks with this trait hit more or less often than the book's price said?
// "gap" = actual hit rate minus the book's no-vig chance, in points. A real edge shows the same sign in every season.
// Then an out-of-sample test: learn the gaps on 2023-24, score 2025 picks, and see if the top picks by our score
// win more often than the top picks by the book alone (that's what makes parlays win).
const fs = require("fs"), zlib = require("zlib");
const ROWS = JSON.parse(zlib.gunzipSync(fs.readFileSync("backtest/study-rows.json.gz")));
const dec = a => a > 0 ? 1 + a / 100 : 1 + 100 / -a, imp = a => 1 / dec(a);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = x => (100 * x).toFixed(1).padStart(5);
const P = ROWS.filter(r => r.k === "p"), G = ROWS.filter(r => r.k === "g");
const SEASONS = [...new Set(ROWS.map(r => r.s))].sort();

// Book chance with the vig removed. Main lines: from both sides. Alt lines and TDs: the raw implied chance minus the
// average overround of that market/side/price band (so each band is fair on average and only the trait moves the needle).
const band = a => a <= -300 ? "big" : a <= -150 ? "fav" : a < 130 ? "even" : a < 300 ? "dog" : "long";
const hold = {};
for (const r of P) if (r.nv == null) { const k = r.mkt + "|" + r.side + "|" + band(r.a); const h = hold[k] = hold[k] || { n: 0, d: 0 }; h.n++; h.d += imp(r.a) - r.won; }
for (const r of P) r.bk = r.nv != null ? r.nv : Math.max(0.02, imp(r.a) - hold[r.mkt + "|" + r.side + "|" + band(r.a)].d / hold[r.mkt + "|" + r.side + "|" + band(r.a)].n);
for (const r of G) r.bk = r.nv;
for (const r of ROWS) r.res = r.won - r.bk;

// Site-type universe: the picks a parlay would actually use
const SITE = P.filter(r => r.healthy && r.a >= -700 && r.a <= 250 && r.bp >= 0.45);
console.log(`Rows: ${P.length} prop picks (${SITE.length} site-type: healthy, -700..+250, 45%+), ${G.length} game lines. Seasons ${SEASONS.join(", ")}.`);
console.log("gap = hit% minus book's no-vig % (points). + means picks with this trait beat the book. Per-season gaps show whether it holds up.\n");

function table(title, rows, f, buckets) {
  // buckets: [[label, test]] or a number -> quantiles of f
  let B = buckets;
  if (typeof buckets === "number") {
    const v = rows.map(f).filter(x => x != null && !isNaN(x)).sort((a, b) => a - b); if (v.length < 200) return;
    const q = []; for (let i = 1; i < buckets; i++) q.push(v[Math.floor(v.length * i / buckets)]);
    B = []; for (let i = 0; i <= q.length; i++) { const lo = i ? q[i - 1] : -Infinity, hi = i < q.length ? q[i] : Infinity;
      B.push([(i ? ">=" + (+lo.toFixed(2)) : "lowest") + (i < q.length ? " <" + (+hi.toFixed(2)) : " (highest)"), x => { const y = f(x); return y != null && !isNaN(y) && y >= lo && y < hi; }]); }
  }
  console.log("== " + title);
  console.log("  " + "bucket".padEnd(30) + "n".padStart(7) + "  hit%  book%   gap " + SEASONS.map(s => String(s).padStart(6)).join(""));
  for (const [label, test] of B) {
    const L = rows.filter(test); if (L.length < 100) continue;
    const per = SEASONS.map(s => { const X = L.filter(r => r.s === s); return X.length < 60 ? "   ·  " : ((100 * mean(X.map(r => r.res))) >= 0 ? "+" : "") + (100 * mean(X.map(r => r.res))).toFixed(1).padStart(5); });
    const gap = 100 * mean(L.map(r => r.res));
    console.log("  " + label.padEnd(30) + String(L.length).padStart(7) + " " + pct(mean(L.map(r => r.won))) + " " + pct(mean(L.map(r => r.bk))) + " " + (gap >= 0 ? "+" : "") + gap.toFixed(1).padStart(4) + " " + per.join(""));
  }
  console.log();
}
const yes = k => [["no", r => !r[k]], ["yes", r => !!r[k]]];
const OV = SITE.filter(r => r.side === "over"), UN = SITE.filter(r => r.side === "under"), TD = SITE.filter(r => r.td);

// ---------- 1. Our own history vs the book ----------
table("Our history-only % minus book % (do we know better than the book?)", SITE, r => r.rp - r.bk, 5);
table("Games of history used (n)", SITE, r => r.n, [["6-7", r => r.n <= 7], ["8-9", r => r.n <= 9 && r.n > 7], ["10", r => r.n >= 10]]);
table("Last-10 hit rate at this line minus book %", SITE, r => r.h10 - r.bk, 5);
table("Last-3 hit rate at this line minus book %", SITE, r => r.h3 - r.bk, 5);
table("Long-run (2 seasons) hit rate at this line minus book %", SITE.filter(r => r.hn >= 12), r => r.since - r.bk, 5);
table("vs this opponent hit rate minus book % (3+ games)", SITE.filter(r => r.vsn >= 3), r => r.vs - r.bk, 4);

// ---------- 2. Form and line placement ----------
table("Overs: last-3 average vs the line, as % of line", OV.filter(r => !r.td), r => (r.avg3 - r.line) / Math.max(1, r.line), 5);
table("Unders: last-3 average vs the line, as % of line", UN, r => (r.avg3 - r.line) / Math.max(1, r.line), 5);
table("Overs: last-3 avg minus last-10 avg (hot or cold), % of line", OV.filter(r => !r.td), r => (r.avg3 - r.avg) / Math.max(1, r.line), 5);
table("Unders: last-3 avg minus last-10 avg (hot or cold), % of line", UN, r => (r.avg3 - r.avg) / Math.max(1, r.line), 5);
table("Overs: how streaky (std dev / avg over last 10)", OV.filter(r => !r.td && r.avg > 0), r => r.sdv / r.avg, 5);
table("Unders: how streaky (std dev / avg over last 10)", UN.filter(r => r.avg > 0), r => r.sdv / r.avg, 5);
table("Games played this season so far", SITE, r => r.gp, [["0-2", r => r.gp <= 2], ["3-5", r => r.gp <= 5 && r.gp > 2], ["6-9", r => r.gp <= 9 && r.gp > 5], ["10+", r => r.gp >= 10]]);

// ---------- 3. Role and playing time ----------
table("Overs: snap share last game", OV, r => r.snL, 5);
table("Unders: snap share last game", UN, r => r.snL, 5);
table("Overs: snap share, last 3 games", OV, r => r.sn3, 5);
table("Overs: snap share last 3 minus season (role growing or shrinking)", OV.filter(r => r.snS != null), r => r.sn3 - r.snS, 5);
table("Unders: snap share last 3 minus season (role growing or shrinking)", UN.filter(r => r.snS != null), r => r.sn3 - r.snS, 5);
table("Overs: share of games this season with 50%+ snaps", OV.filter(r => r.g50 != null), r => r.g50, 4);
table("Overs (receiving): target share last 3", OV.filter(r => /Rece/.test(r.mkt)), r => r.tgt3, 5);
table("Overs (receiving): target share last 3 minus season", OV.filter(r => /Rece/.test(r.mkt) && r.tgtS != null), r => r.tgt3 - r.tgtS, 5);
table("Overs (receiving): air-yards share last 3", OV.filter(r => /Rece/.test(r.mkt)), r => r.ay3, 5);
table("Anytime TD: snap share last 3", TD, r => r.sn3, 5);
table("Anytime TD: last-3 TD rate minus book", TD, r => r.h3 - r.bk, 4);

// ---------- 4. Injuries ----------
table("Injury report listing", SITE, null, yes("inj"));
table("Missed team's last game", P.filter(r => r.a >= -700 && r.a <= 250), null, yes("missed"));
table("Overs: injury listing text", OV.filter(r => r.inj), null, [["Questionable", r => /quest/i.test(r.injT)], ["Probable/limited", r => /prob|limit/i.test(r.injT)], ["Doubtful/out", r => /doubt|out/i.test(r.injT)], ["other", r => !/quest|prob|limit|doubt|out/i.test(r.injT)]]);

// ---------- 5. Opponent, weather, situation ----------
table("Overs: opponent defense factor (what they allow vs league)", OV, r => r.oppF, 5);
table("Unders: opponent defense factor", UN, r => r.oppF, 5);
table("Overs: opponent pace, plays per game (last 3)", OV, r => r.opace, 5);
table("Overs: own team pace, plays per game (last 3)", OV, r => r.pace, 5);
table("Overs (passing/receiving): own team pass rate last 3", OV.filter(r => /Pass|Rece/.test(r.mkt)), r => r.pass, 5);
table("Overs (rushing): own team pass rate last 3", OV.filter(r => /Rush/.test(r.mkt)), r => r.pass, 5);
table("Overs: own team's spread (minus = favored)", OV, r => r.tsp, 5);
table("Unders: own team's spread (minus = favored)", UN, r => r.tsp, 5);
table("Overs: game total", OV, r => r.tot, 5);
table("Unders: game total", UN, r => r.tot, 5);
table("Overs: home or away", OV, null, [["away", r => !r.home], ["home", r => !!r.home]]);
table("Overs: days of rest (own team)", OV.filter(r => r.rest), null, [["short (4-6)", r => r.rest <= 6], ["normal (7)", r => r.rest === 7], ["long (8-10)", r => r.rest >= 8 && r.rest <= 10], ["bye (11+)", r => r.rest >= 11]]);
table("Overs: wind (outdoor games)", OV.filter(r => r.wind != null && !r.dome), r => r.wind, [["calm <10", r => r.wind < 10], ["10-14", r => r.wind >= 10 && r.wind < 15], ["15-19", r => r.wind >= 15 && r.wind < 20], ["20+", r => r.wind >= 20]]);
table("Overs (passing/receiving): wind", OV.filter(r => r.wind != null && !r.dome && /Pass|Rece/.test(r.mkt)), r => r.wind, [["calm <10", r => r.wind < 10], ["10-14", r => r.wind >= 10 && r.wind < 15], ["15+", r => r.wind >= 15]]);
table("Overs: temperature (outdoor)", OV.filter(r => r.temp != null && !r.dome), r => r.temp, [["under 32", r => r.temp < 32], ["32-49", r => r.temp >= 32 && r.temp < 50], ["50-69", r => r.temp >= 50 && r.temp < 70], ["70+", r => r.temp >= 70]]);
table("Overs: dome", OV, null, yes("dome"));
table("Week of season", SITE, r => r.wk, [["1-4", r => r.wk <= 4], ["5-9", r => r.wk <= 9 && r.wk > 4], ["10-14", r => r.wk <= 14 && r.wk > 9], ["15-18", r => r.wk <= 18 && r.wk > 14], ["playoffs", r => r.wk > 18]]);
table("Market and side", SITE, null, [...new Set(SITE.map(r => r.mkt + " " + r.side))].sort().map(k => [k, r => r.mkt + " " + r.side === k]));
table("Price band", SITE, null, [["-700..-300", r => r.a <= -300], ["-299..-150", r => r.a > -300 && r.a <= -150], ["-149..+129", r => r.a > -150 && r.a < 130], ["+130..+250", r => r.a >= 130]]);

// ---------- 6. Game lines ----------
const SP = G.filter(r => /^sp/.test(r.t)), TOT = G.filter(r => r.t === "ov" || r.t === "un"), ML = G.filter(r => /^ml/.test(r.t));
table("Spreads: home or away side", SP, null, [["away", r => r.t === "sp-a"], ["home", r => r.t === "sp-h"]]);
table("Spreads: favorite or dog side", SP, null, [["favorite", r => r.pt < 0], ["dog", r => r.pt > 0]]);
table("Spreads: size of the line (abs)", SP, r => Math.abs(r.pt), [["0-2.5", r => Math.abs(r.pt) <= 2.5], ["3-6.5", r => Math.abs(r.pt) >= 3 && Math.abs(r.pt) <= 6.5], ["7-9.5", r => Math.abs(r.pt) >= 7 && Math.abs(r.pt) <= 9.5], ["10+", r => Math.abs(r.pt) >= 10]]);
table("Spreads: this side's rest vs opponent's", SP.filter(r => r.rest && r.orest), r => r.rest - r.orest, [["less rest", r => r.rest < r.orest], ["same", r => r.rest === r.orest], ["more rest", r => r.rest > r.orest]]);
table("Spreads: division game", SP, null, yes("div"));
table("Moneyline: favorite or dog", ML, null, [["favorite", r => r.bk > 0.5], ["dog", r => r.bk <= 0.5]]);
table("Moneyline: home or away", ML, null, [["away", r => r.t === "ml-a"], ["home", r => r.t === "ml-h"]]);
table("Totals: over or under", TOT, null, [["over", r => r.t === "ov"], ["under", r => r.t === "un"]]);
table("Totals (over): wind, outdoor", TOT.filter(r => r.t === "ov" && r.wind != null && !r.dome), r => r.wind, [["calm <10", r => r.wind < 10], ["10-14", r => r.wind >= 10 && r.wind < 15], ["15+", r => r.wind >= 15]]);
table("Totals (over): both teams' pace (last 3 avg)", TOT.filter(r => r.t === "ov" && r.paceH && r.paceA), r => (r.paceH + r.paceA) / 2, 4);
table("Totals (over): total size", TOT.filter(r => r.t === "ov"), r => r.pt, 4);
table("Totals (over): temperature, outdoor", TOT.filter(r => r.t === "ov" && r.temp != null && !r.dome), r => r.temp, [["under 32", r => r.temp < 32], ["32-49", r => r.temp >= 32 && r.temp < 50], ["50+", r => r.temp >= 50]]);

// ---------- 7. Out-of-sample test: does a score built from the traits pick winners better than the book? ----------
// Candidate traits (each as a numeric feature). Effects are learned per quintile on the TRAIN seasons, shrunk, and added to the book %.
const FEATS = {
  histVsBook: r => r.rp - r.bk,
  last3VsBook: r => r.h3 - r.bk,
  form: r => r.td ? null : (r.avg3 - r.avg) / Math.max(1, r.line) * (r.side === "under" ? -1 : 1),
  margin: r => r.td ? null : (r.avg3 - r.line) / Math.max(1, r.line) * (r.side === "under" ? -1 : 1),
  streaky: r => r.avg > 0 ? r.sdv / r.avg : null,
  snap3: r => r.sn3, snapTrend: r => r.snS != null && r.sn3 != null ? r.sn3 - r.snS : null,
  tgtTrend: r => /Rece/.test(r.mkt) && r.tgtS != null ? r.tgt3 - r.tgtS : null,
  oppF: r => r.oppF, opace: r => r.opace, pace: r => r.pace, pass: r => r.pass,
  tsp: r => r.tsp, tot: r => r.tot, wind: r => r.dome ? 0 : (r.wind || 0), inj: r => r.inj, home: r => r.home, gp: r => r.gp
};
function learn(train, feats, K = 5, SHRINK = 400) {
  const M = {};
  for (const f in feats) { const fn = feats[f]; const v = train.map(fn).filter(x => x != null && !isNaN(x)).sort((a, b) => a - b); if (v.length < 500) continue;
    const q = []; for (let i = 1; i < K; i++) q.push(v[Math.floor(v.length * i / K)]);
    const eff = []; for (let i = 0; i <= q.length; i++) { const lo = i ? q[i - 1] : -Infinity, hi = i < q.length ? q[i] : Infinity;
      const L = train.filter(r => { const y = fn(r); return y != null && !isNaN(y) && y >= lo && y < hi; }); const g = mean(L.map(r => r.res)) || 0; eff.push(g * L.length / (L.length + SHRINK)); }
    M[f] = { q, eff }; }
  return M;
}
const score = (r, M, feats, use) => { let s = r.bk; for (const f of use) { const m = M[f]; if (!m) continue; const y = feats[f](r); if (y == null || isNaN(y)) continue; let i = 0; while (i < m.q.length && y >= m.q[i]) i++; s += m.eff[i]; } return Math.min(0.98, Math.max(0.02, s)); };
// pick traits whose quintile gaps on the train set have the same sign at both ends in every train season (robust), else drop
function robust(train, feats) {
  const keep = [];
  for (const f in feats) { const fn = feats[f]; const v = train.map(fn).filter(x => x != null && !isNaN(x)).sort((a, b) => a - b); if (v.length < 2000) continue;
    const lo = v[Math.floor(v.length * 0.2)], hi = v[Math.floor(v.length * 0.8)];
    const signs = [...new Set(train.map(r => r.s))].map(s => { const T = train.filter(r => r.s === s); const a = mean(T.filter(r => { const y = fn(r); return y != null && y < lo; }).map(r => r.res)), b = mean(T.filter(r => { const y = fn(r); return y != null && y >= hi; }).map(r => r.res)); return a == null || b == null ? 0 : Math.sign(b - a); });
    const d = mean(train.filter(r => { const y = fn(r); return y != null && y >= hi; }).map(r => r.res)) - mean(train.filter(r => { const y = fn(r); return y != null && y < lo; }).map(r => r.res));
    if (signs.every(x => x === signs[0] && x !== 0) && Math.abs(d) >= 0.015) keep.push({ f, d: +(100 * d).toFixed(1) }); }
  return keep;
}
function oos(label, train, test, feats) {
  const keep = robust(train, feats), use = keep.map(x => x.f), M = learn(train, feats);
  console.log(`== Out of sample: ${label}. Traits that held up in every training season: ${keep.map(x => x.f + " (" + (x.d > 0 ? "+" : "") + x.d + ")").join(", ") || "none"}`);
  const sc = test.map(r => Object.assign({ sc: score(r, M, feats, use) }, r));
  // compare: within each book band, the top 30% by our score vs everyone else
  for (const [lo, hi] of [[0.45, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1]]) {
    const L = sc.filter(r => r.bk >= lo && r.bk < hi); if (L.length < 300) continue;
    const cut = L.map(r => r.sc - r.bk).sort((a, b) => b - a)[Math.floor(L.length * 0.3)];
    const top = L.filter(r => r.sc - r.bk >= cut), rest = L.filter(r => r.sc - r.bk < cut);
    console.log(`  book ${pct(lo)}-${pct(hi)}%: top 30% by score  n ${String(top.length).padStart(6)} hit ${pct(mean(top.map(r => r.won)))}% (book said ${pct(mean(top.map(r => r.bk)))}, we'd say ${pct(mean(top.map(r => r.sc)))})  |  rest n ${String(rest.length).padStart(6)} hit ${pct(mean(rest.map(r => r.won)))}% (book ${pct(mean(rest.map(r => r.bk)))})`);
  }
  // parlay test: each week, the 3 safest picks by book vs by score (one per player, book 60-90%), did all 3 hit?
  const weeks = [...new Set(test.map(r => r.s + "|" + r.wk))];
  let nB = 0, wB = 0, nS = 0, wS = 0, nB5 = 0, wB5 = 0, nS5 = 0, wS5 = 0;
  const pickTop = (L, key, k) => { const seen = {}, out = []; for (const r of L.sort((a, b) => b[key] - a[key])) { const id = r.mkt + "|" + r.line + "|" + r.a + "|" + r.s + r.wk; if (seen[r.player || id]) continue; seen[r.player || id] = 1; out.push(r); if (out.length === k) break; } return out; };
  for (const w of weeks) { const L = sc.filter(r => r.s + "|" + r.wk === w && r.bk >= 0.6 && r.bk < 0.9 && r.nv != null); if (L.length < 20) continue;
    const b3 = pickTop(L.slice(), "bk", 3), s3 = pickTop(L.slice(), "sc", 3), b5 = pickTop(L.slice(), "bk", 5), s5 = pickTop(L.slice(), "sc", 5);
    nB++; if (b3.every(r => r.won)) wB++; nS++; if (s3.every(r => r.won)) wS++; nB5++; if (b5.every(r => r.won)) wB5++; nS5++; if (s5.every(r => r.won)) wS5++; }
  console.log(`  Weekly 3-pick parlay of the safest main lines: by book ${wB}/${nB} won (${pct(wB / nB)}%), by our score ${wS}/${nS} won (${pct(wS / nS)}%). 5-pick: book ${pct(wB5 / nB5)}%, score ${pct(wS5 / nS5)}%`);
  console.log();
  return { M, use };
}
const TRAIN = SITE.filter(r => r.s < 2025), TEST = SITE.filter(r => r.s === 2025);
oos("learn on 2023-24, test on 2025 (props)", TRAIN, TEST, FEATS);
oos("learn on 2023+2025, test on 2024 (props)", SITE.filter(r => r.s !== 2024), SITE.filter(r => r.s === 2024), FEATS);
oos("learn on 2024-25, test on 2023 (props)", SITE.filter(r => r.s !== 2023), SITE.filter(r => r.s === 2023), FEATS);
