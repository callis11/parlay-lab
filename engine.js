// Parlay Lab engine: builds games, props and auto parlays from odds.json + data.json.
// Shared by the website (index.html) and the grader (picks.js) so both build the same slips.
(function (root) {
  function dec(a) { return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
  function amFromDec(d) { var a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); return a; }
  function nick(n) { return n.split(" ").pop(); }
  // Slate label in US Eastern time, e.g. "Thursday night", "Sunday", "Monday night"
  function slateName(iso) {
    var d = new Date(iso);
    var w = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
    var h = +d.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }) % 24;
    return w === "Sunday" ? "Sunday" : (w + (h >= 17 ? " night" : ""));
  }

  function make(odds, data, book, now) {
    var G = [], P = [];
    var wk = now + 7 * 864e5;
    // ---------- games ----------
    ((odds && odds.lines) || []).filter(function (e) { var t = new Date(e.commence_time); return e.bookmakers && e.bookmakers.length && t < wk && t > now - 4 * 36e5; })
      .sort(function (a, b) { return new Date(a.commence_time) - new Date(b.commence_time); }).forEach(function (e) {
        var bk = e.bookmakers.filter(function (b) { return b.key === book; })[0], alt = !bk;
        if (!bk) bk = e.bookmakers.filter(function (b) { return b.key === "fanduel"; })[0] || e.bookmakers[0];
        function mk(k) { return (bk.markets || []).filter(function (m) { return m.key === k; })[0]; }
        function oc(m, n) { return m && m.outcomes.filter(function (o) { return o.name === n; })[0]; }
        var h = mk("h2h"), s = mk("spreads"), t = mk("totals"); if (!h || !s || !t) return;
        var A = nick(e.away_team), H = nick(e.home_team), as = oc(s, e.away_team), hs = oc(s, e.home_team), ov = oc(t, "Over"), un = oc(t, "Under");
        if (!as || !hs || !ov || !un || !oc(h, e.away_team) || !oc(h, e.home_team)) return;
        G.push({ id: e.id, t: e.commence_time, away: A, home: H, alt: alt ? bk.title : null, total: ov.point, legs: {
          "sp-a": { n: A + " " + (as.point > 0 ? "+" : "") + as.point, a: as.price, pt: as.point },
          "sp-h": { n: H + " " + (hs.point > 0 ? "+" : "") + hs.point, a: hs.price, pt: hs.point },
          "ml-a": { n: A + " ML", a: oc(h, e.away_team).price },
          "ml-h": { n: H + " ML", a: oc(h, e.home_team).price },
          "ov": { n: A + "/" + H + " over " + ov.point, a: ov.price, pt: ov.point },
          "un": { n: A + "/" + H + " under " + un.point, a: un.price, pt: un.point } } });
      });
    function gkey(g, t) { return "G|" + g.id + "|" + (t.slice(0, 2) === "sp" ? "sp" : t.slice(0, 2) === "ml" ? "ml" : "tot"); }
    function gameLeg(g, t) { var L = g.legs[t]; return { k: gkey(g, t), kind: "g", t: t, n: L.n, a: L.a, pt: L.pt, ev: g.id, time: g.t }; }

    // ---------- props ----------
    var live = {}; G.forEach(function (g) { live[g.id] = g; });
    ((data && data.props) || []).forEach(function (p) {
      var g = live[p.event]; if (!g) return;
      var rungs = p.ladder.filter(function (r) { return r.prices[book] !== undefined; }).map(function (r) {
        // Blend the player's history with the book's own price (less history = lean more on the book)
        var a = r.prices[book], pa, ev = null, fair = null;
        if (r.p !== undefined) { var imp = 1 / dec(a) / 1.045, w = r.n / (r.n + 10); pa = w * r.p + (1 - w) * imp; ev = pa * dec(a) - 1; fair = pa >= 0.5 ? Math.round(-100 * pa / (1 - pa)) : Math.round(100 * (1 - pa) / pa); }
        return { line: r.line, a: a, p: pa, hits: r.hits, n: r.n, fair: fair, ev: ev };
      });
      if (!rungs.length) return;
      P.push({ id: p.event + "|" + p.player + "|" + p.label, ev: p.event, g: g, player: p.player, team: p.team, label: p.label, td: p.td, avg: p.avg, recent: p.recent, rungs: rungs,
        best: Math.max.apply(null, rungs.map(function (r) { return r.ev === null || r.n < 8 || r.a > 400 ? -9 : r.ev; })),
        top: Math.max.apply(null, rungs.map(function (r) { return r.p || 0; })) });
    });
    function rungName(p, r) { return p.player + (p.td ? " anytime TD" : " " + (r.line + 0.5) + "+ " + p.label.toLowerCase().replace(" yards", " yds")); }
    function propLeg(p, r) { return { k: "P|" + p.id, kind: "p", line: r.line, n: rungName(p, r), a: r.a, ev: p.ev, time: p.g.t, player: p.player, label: p.label, td: p.td }; }

    // ---------- presets ----------
    function favSide(g) { return g.legs["ml-h"].a <= g.legs["ml-a"].a ? "h" : "a"; }
    function gamePresets() {
      var fav = G.map(function (g) { var s = favSide(g); return { g: g, s: s, ml: g.legs["ml-" + s].a }; }).sort(function (a, b) { return a.ml - b.ml; });
      var low = G.slice().sort(function (a, b) { return a.total - b.total; }), out = [];
      function add(n, d, l, need) { if (l.length >= need) out.push({ n: n, d: d, l: l }); }
      add("The Safe 3", "Three biggest moneyline favorites", fav.slice(0, 3).map(function (f) { return gameLeg(f.g, "ml-" + f.s); }), 3);
      add("Favorites Trio", "Next tier of moneyline favorites", fav.slice(3, 6).map(function (f) { return gameLeg(f.g, "ml-" + f.s); }), 3);
      add("Spread Trio", "Favorites laying points", fav.slice(6, 9).map(function (f) { return gameLeg(f.g, "sp-" + f.s); }), 3);
      add("Unders Special", "Three lowest game totals", low.slice(0, 3).map(function (g) { return gameLeg(g, "un"); }), 3);
      add("Longshot 4-Leg", "Closer lines, bigger payout", fav.slice(9, 13).map(function (f) { return gameLeg(f.g, "ml-" + f.s); }), 4);
      return out;
    }
    function playerPresets() {
      var c = []; P.forEach(function (p) { p.rungs.forEach(function (r) { if (r.p !== undefined) c.push({ p: p, r: r }); }); });
      function pickN(arr, n) {
        var used = {}, games = {}, out = [];
        arr.forEach(function (x) { if (out.length < n && !used[x.p.player] && !games[x.p.ev]) { used[x.p.player] = 1; games[x.p.ev] = 1; out.push(propLeg(x.p, x.r)); } });
        arr.forEach(function (x) { if (out.length < n && !used[x.p.player]) { used[x.p.player] = 1; out.push(propLeg(x.p, x.r)); } });
        return out;
      }
      var out = []; function add(n, d, l, need) { if (l.length >= need) out.push({ n: n, d: d, l: l }); }
      add("High-Floor 3", "Highest hit % at a fair price", pickN(c.filter(function (x) { return x.r.a <= -120 && x.r.a >= -350 && !x.p.td; }).sort(function (a, b) { return b.r.p - a.r.p; }), 3), 3);
      add("Best Value 3", "Our estimate beats the price most", pickN(c.filter(function (x) { return x.r.p >= 0.5 && x.r.n >= 8 && x.r.a <= 150; }).sort(function (a, b) { return b.r.ev - a.r.ev; }), 3), 3);
      add("TD Trio", "Likeliest anytime TD scorers", pickN(c.filter(function (x) { return x.p.td && x.r.n >= 8; }).sort(function (a, b) { return b.r.p - a.r.p; }), 3), 3);
      add("Yardage 4-Leg", "Solid hit rates, plus-ish prices", pickN(c.filter(function (x) { return !x.p.td && x.r.p >= 0.5 && x.r.n >= 8 && x.r.a >= -200 && x.r.a <= 130; }).sort(function (a, b) { return b.r.ev - a.r.ev; }), 4), 4);
      return out;
    }

    // ---------- mixed slips (game lines + props) ----------
    // Each candidate: {leg, who (one leg per player / per game market), ev, ...}
    function poolFor(ids, team) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      var props = []; P.forEach(function (p) {
        if (!set[p.ev] || (team && p.team !== team)) return;
        p.rungs.forEach(function (r) { if (r.p !== undefined && r.n >= 8) props.push({ leg: propLeg(p, r), who: p.player, ev: p.ev, p: r.p, a: r.a, e: r.ev, td: p.td }); });
      });
      var gs = G.filter(function (g) { return set[g.id]; });
      function gl(g, t) { return { leg: gameLeg(g, t), who: "G|" + g.id + "|" + (t === "ov" || t === "un" ? "tot" : "side"), ev: g.id, a: g.legs[t].a }; }
      var by = function (f) { return function (a, b) { return f(b) - f(a); }; };
      function sideOf(g, abbr) { var m = data && data.games[g.id]; return m && m.home === abbr ? "h" : "a"; }
      return {
        floors: props.filter(function (x) { return !x.td && x.a <= -120 && x.a >= -350; }).sort(by(function (x) { return x.p; })),
        value: props.filter(function (x) { return x.p >= 0.45 && x.a <= 150; }).sort(by(function (x) { return x.e; })),
        plus: props.filter(function (x) { return x.p >= 0.4 && x.a >= 100 && x.a <= 180; }).sort(by(function (x) { return x.e; })),
        tds: props.filter(function (x) { return x.td; }).sort(by(function (x) { return x.p; })),
        mid: props.filter(function (x) { return !x.td && x.p >= 0.55 && x.p <= 0.8 && x.a >= -250; }).sort(by(function (x) { return x.e; })),
        favML: gs.map(function (g) { return gl(g, "ml-" + favSide(g)); }).sort(function (a, b) { return a.a - b.a; }),
        favSP: gs.map(function (g) { return gl(g, "sp-" + favSide(g)); }).sort(function (a, b) { return a.leg.a - b.leg.a; }),
        over: gs.map(function (g) { return gl(g, "ov"); }),
        side: function (g, abbr) { var s = sideOf(g, abbr); return gl(g, (favSide(g) === s ? "ml-" : "sp-") + s); },
        teamSP: function (g, abbr) { return gl(g, "sp-" + sideOf(g, abbr)); }
      };
    }
    // parts: [[candidates, count], ...]. oneGame: no two legs from the same game
    function mkSlip(n, d, parts, oneGame) {
      var who = {}, evs = {}, legs = [];
      for (var i = 0; i < parts.length; i++) {
        var c = parts[i][0], need = parts[i][1], got = 0;
        for (var j = 0; j < c.length && got < need; j++) { var x = c[j]; if (who[x.who] || (oneGame && evs[x.ev])) continue; who[x.who] = 1; evs[x.ev] = 1; legs.push(x.leg); got++; }
        if (got < need) return null;
      }
      return { n: n, d: d, l: legs };
    }
    function slateSlips(ids) {
      var Q = poolFor(ids), out = [];
      function add(s) { if (s) out.push(s); }
      if (ids.length >= 4) {
        add(mkSlip("Safe 4", "Biggest favorite plus three high-floor props", [[Q.favML, 1], [Q.floors, 3]], true));
        add(mkSlip("Favorites + Floors 5", "Three favorites, two high-floor props", [[Q.favML, 3], [Q.floors, 2]], true));
        add(mkSlip("Value 3", "Props where our estimate beats the price most", [[Q.value, 3]], true));
        add(mkSlip("TDs + Spreads", "Two likely TD scorers, two favorites to cover", [[Q.tds, 2], [Q.favSP, 2]], true));
        add(mkSlip("Longshot 5", "Plus-money props and favorites to cover", [[Q.plus, 3], [Q.favSP, 2]], true));
      } else {
        add(mkSlip("Favorite Control", "Favorite wins, plus a TD and a high-floor prop", [[Q.favML, 1], [Q.tds, 1], [Q.floors, 1]], false));
        add(mkSlip("High Floor", "Three props with the best hit rates", [[Q.floors, 3]], false));
        add(mkSlip("Value", "Best-value props in this game", [[Q.value, 3]], false));
        add(mkSlip("Shootout", "Over plus three yardage overs", [[Q.over, 1], [Q.mid, 3]], false));
      }
      return out;
    }
    function teamSlips(abbr) {
      var g = G.filter(function (x) { var m = data && data.games[x.id]; return m && (m.home === abbr || m.away === abbr); })[0];
      if (!g) return { g: null, l: [] };
      var Q = poolFor([g.id], abbr), out = [], nm = g[data.games[g.id].home === abbr ? "home" : "away"];
      function add(s) { if (s) out.push(s); }
      add(mkSlip(nm + " Safe", "Win or cover, a likely TD and two high-floor props", [[[Q.side(g, abbr)], 1], [Q.tds, 1], [Q.floors, 2]], false));
      add(mkSlip(nm + " Shootout", "Game over plus three " + nm + " yardage overs", [[Q.over, 1], [Q.mid, 3]], false));
      add(mkSlip(nm + " Long Shot", "Cover plus three plus-money " + nm + " props", [[[Q.teamSP(g, abbr)], 1], [Q.plus, 3]], false));
      return { g: g, l: out };
    }
    function slates() {
      var groups = [], idx = {};
      G.forEach(function (g) { var k = slateName(g.t); if (!(k in idx)) { idx[k] = groups.length; groups.push({ k: k, g: [] }); } groups[idx[k]].g.push(g); });
      return groups;
    }
    // Every auto-built slip on the Parlays page, grouped
    function allParlays() {
      var out = [{ group: "Best of the week", slips: slateSlips(G.map(function (g) { return g.id; })) }];
      slates().forEach(function (s) { out.push({ group: s.k, slips: slateSlips(s.g.map(function (g) { return g.id; })) }); });
      out.push({ group: "Player props only", slips: playerPresets() });
      out.push({ group: "Game lines only", slips: gamePresets() });
      return out;
    }
    return { G: G, P: P, gkey: gkey, gameLeg: gameLeg, propLeg: propLeg, rungName: rungName, gamePresets: gamePresets, playerPresets: playerPresets,
      slateSlips: slateSlips, teamSlips: teamSlips, slates: slates, allParlays: allParlays };
  }

  var Engine = { make: make, dec: dec, amFromDec: amFromDec, slateName: slateName };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.Engine = Engine;
})(this);
