// Parlay Lab engine: builds games, props and auto parlays from odds.json + data.json.
// Shared by the website (index.html) and the grader (picks.js) so both build the same slips.
(function (root) {
  function dec(a) { return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
  function amFromDec(d) { var a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); return a; }
  function nick(n) { return n.split(" ").pop(); }
  var BOOKS = ["fanduel", "draftkings", "betmgm", "betrivers"];
  var BOOK_NAMES = { fanduel: "FanDuel", draftkings: "DraftKings", betmgm: "BetMGM", betrivers: "BetRivers" };
  function unit(label, n) {
    return { "Passing yards": "passing yds", "Rushing yards": "rushing yds", "Receiving yards": "receiving yds", "Receptions": n === 1 ? "reception" : "receptions", "Passing TDs": n === 1 ? "passing TD" : "passing TDs", "Rush + rec yards": "rush + rec yds",
      "Points": n === 1 ? "point" : "points", "Rebounds": n === 1 ? "rebound" : "rebounds", "Assists": n === 1 ? "assist" : "assists", "Threes": n === 1 ? "three" : "threes", "Pts + reb + ast": "pts + reb + ast" }[label] || label.toLowerCase();
  }
  // ---------- send picks to a sportsbook's bet slip ----------
  // Each leg carries links from The Odds API ({book: url}). FanDuel and DraftKings links can be combined
  // into one parlay link; BetMGM and BetRivers get one link per leg.
  function fixUrl(u) { return u.replace(/\{state\}/g, "mi").replace("{pickType}", "single").replace("{wagerAmount}", ""); }
  function betslipLink(legs, book) {
    var urls = legs.map(function (l) { return l.links && l.links[book]; }).filter(Boolean);
    if (!urls.length) return null;
    if (urls.length === 1) return { url: fixUrl(urls[0]), n: 1, combined: true };
    if (book === "fanduel") {
      var ps = urls.map(function (u) { var q = u.split("?")[1] || "", m = /marketId=([^&]+)/.exec(q), s = /selectionId=([^&]+)/.exec(q); return m && s ? { m: m[1], s: s[1] } : null; }).filter(Boolean);
      return { url: urls[0].split("?")[0] + "?" + ps.map(function (x, i) { return "marketId[" + i + "]=" + x.m + "&selectionId[" + i + "]=" + x.s; }).join("&"), n: ps.length, combined: true };
    }
    if (book === "draftkings") {
      var ids = urls.map(function (u) { var m = /outcomes=([^&]+)/.exec(u); return m && m[1]; }).filter(Boolean);
      return { url: "https://sportsbook.draftkings.com/?outcomes=" + ids.join("+"), n: ids.length, combined: true };
    }
    return { url: null, n: urls.length, combined: false };
  }
  function legLink(leg, book) { var u = leg.links && leg.links[book]; return u ? fixUrl(u) : null; }
  // ---------- learning from results ----------
  // Every graded leg falls into a category (market + price range). picks.js compares how often each category
  // actually hit with what we estimated and saves a correction factor in calibration.json.
  function bucket(a) { return a <= -250 ? "big fav" : a <= -120 ? "fav" : a < 120 ? "even" : "dog"; }
  function category(leg) {
    var t2 = leg.kind === "g" ? leg.t.replace(/^1/, "") : "", h1 = leg.kind === "g" && leg.t.charAt(0) === "1" ? "1H " : "";
    var mk = leg.kind === "g" ? h1 + (t2.slice(0, 2) === "ml" ? "Moneyline" : t2.slice(0, 2) === "sp" ? "Spread" : "Total") : leg.label + (leg.side === "under" ? " under" : "");
    return mk + "|" + bucket(leg.a);
  }
  function calibrate(p, cat, calib) {
    var c = calib && calib.byCat && calib.byCat[cat];
    if (!c || !c.factor || p === undefined || p === null) return p;
    return Math.min(0.97, Math.max(0.02, p * c.factor));
  }
  // Our estimated chance a whole slip hits, treating legs as independent
  function chance(legs) { var p = 1; for (var i = 0; i < legs.length; i++) { if (legs[i].p === undefined || legs[i].p === null) return null; p *= legs[i].p; } return p; }
  // Slate label in US Eastern time, e.g. "Thursday night", "Sunday", "Monday night"
  // NFL slate label in US Eastern time: "Thu Night", "Sun 9:30 AM", "Sun 1 PM", "Sun 4 PM", "Sun Night", "Mon Night",
  // plus holidays ("Thanksgiving 12:30 PM", "Black Friday", "Christmas 1 PM") and Saturdays
  function slateName(iso) {
    var d = new Date(iso), o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
    var h = +o.hour % 24, m = +o.month, day = +o.day, w = o.weekday;
    var t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(":00", "");
    var special = m === 11 && w === "Thu" && day >= 22 && day <= 28 ? "Thanksgiving" : m === 11 && w === "Fri" && day >= 23 && day <= 29 ? "Black Friday" : m === 12 && day === 25 ? "Christmas" : null;
    if (special) return special + (h >= 19 ? " Night" : " " + t);
    if (w === "Sun") return h < 12 ? "Sun " + t : h < 15 ? "Sun 1 PM" : h < 19 ? "Sun 4 PM" : "Sun Night";
    return w + (h >= 17 ? " Night" : " " + t);
  }

  // Date label in US Eastern time, e.g. "Thu, Oct 29" (used for daily sports like the NBA)
  function dateName(iso) { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }); }
  // Per-sport settings: how far ahead to show games, how to group them, and whether to show a "Best of the week" row
  // featured: the hometown team that gets its own section on the Parlays page
  var OPTS = { nfl: { featured: "DET", featuredName: "Lions" }, nba: { windowH: 30, slate: "date", noWeek: true, featured: "DET", featuredName: "Pistons" },
    cfb: { windowH: 192, slate: "cfb", full: true, featured: "MSU", featuredName: "Michigan State" },
    cbb: { windowH: 72, slate: "date", noWeek: true, full: true, featured: "MSU", featuredName: "Michigan State" } };

  // College slates in US Eastern time: "Sat Noon", "Sat 3:30", "Sat Night", "Fri Night", "Tue Night", plus holidays
  function cfbSlate(iso) {
    var d = new Date(iso), o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
      .formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
    var h = +o.hour % 24, w = o.weekday, m = +o.month, day = +o.day;
    if (m === 11 && w === "Fri" && day >= 23 && day <= 29) w = "Black Friday";
    else if (m === 11 && w === "Thu" && day >= 22 && day <= 28) w = "Thanksgiving";
    if (w === "Sat") return h < 15 ? "Sat Noon" : h < 19 ? "Sat 3:30" : "Sat Night";
    return w + (h >= 17 ? " Night" : " Day");
  }
  function make(odds, data, book, now, opts) {
    opts = opts || {};
    var G = [], P = [];
    // Team display name: college uses the school (and AP rank) from ESPN; pro leagues use the nickname
    function tname(full) { return (data && data.names && data.names[full]) || (opts.full ? full : nick(full)); }
    var wk = now + (opts.windowH || 168) * 36e5;
    // ---------- games ----------
    ((odds && odds.lines) || []).filter(function (e) { var t = new Date(e.commence_time); return e.bookmakers && e.bookmakers.length && t < wk && t > now - 4 * 36e5; })
      .sort(function (a, b) { return new Date(a.commence_time) - new Date(b.commence_time); }).forEach(function (e) {
        var bk = e.bookmakers.filter(function (b) { return b.key === book; })[0], alt = !bk;
        if (!bk) bk = e.bookmakers.filter(function (b) { return b.key === "fanduel"; })[0] || e.bookmakers[0];
        function mk(k) { return (bk.markets || []).filter(function (m) { return m.key === k; })[0]; }
        function oc(m, n) { return m && m.outcomes.filter(function (o) { return o.name === n; })[0]; }
        var h = mk("h2h"), s = mk("spreads"), t = mk("totals"); if (!h || !s || !t) return;
        var A = tname(e.away_team), H = tname(e.home_team), as = oc(s, e.away_team), hs = oc(s, e.home_team), ov = oc(t, "Over"), un = oc(t, "Under");
        if (!as || !hs || !ov || !un || !oc(h, e.away_team) || !oc(h, e.home_team)) return;
        // Fair chance from this book's two-way prices (vig removed)
        function nv(x, y) { var px = 1 / dec(x), py = 1 / dec(y); return px / (px + py); }
        // Best price for the same side at the same number across the four books
        function best(mkey, name, pt, mine) {
          var b = { a: mine, book: bk.title };
          e.bookmakers.forEach(function (o) {
            if (BOOKS.indexOf(o.key) < 0) return;
            var m = (o.markets || []).filter(function (x) { return x.key === mkey; })[0]; if (!m) return;
            var oc2 = m.outcomes.filter(function (x) { return x.name === name && (pt === undefined || x.point === pt); })[0];
            if (oc2 && dec(oc2.price) > dec(b.a)) b = { a: oc2.price, book: o.title };
          });
          return b;
        }
        var mlA = oc(h, e.away_team).price, mlH = oc(h, e.home_team).price;
        var raw = { "sp-a": nv(as.price, hs.price), "sp-h": nv(hs.price, as.price), "ml-a": nv(mlA, mlH), "ml-h": nv(mlH, mlA), "ov": nv(ov.price, un.price), "un": nv(un.price, ov.price) };
        function cg(pp, t, a) { return calibrate(pp, category({ kind: "g", t: t, a: a }), opts.calib); }
        // Each book's add-to-bet-slip link for each side
        function fl(mkey, name) {
          var out = {};
          e.bookmakers.forEach(function (b2) { var m = (b2.markets || []).filter(function (x) { return x.key === mkey; })[0], o = m && m.outcomes.filter(function (x) { return x.name === name; })[0]; if (o && o.link) out[b2.key] = o.link; });
          return out;
        }
        // First-half lines (college basketball): spreads_h1 / totals_h1, pulled for a handful of games a day
        var h1s = mk("spreads_h1"), h1t = mk("totals_h1"), H1 = null;
        if (h1s && h1t) { var a1 = oc(h1s, e.away_team), b1 = oc(h1s, e.home_team), o1 = oc(h1t, "Over"), u1 = oc(h1t, "Under");
          if (a1 && b1 && o1 && u1) H1 = { "1sp-a": [a1, b1, "spreads_h1", e.away_team, A + " 1H " + (a1.point > 0 ? "+" : "") + a1.point], "1sp-h": [b1, a1, "spreads_h1", e.home_team, H + " 1H " + (b1.point > 0 ? "+" : "") + b1.point],
            "1ov": [o1, u1, "totals_h1", "Over", A + "/" + H + " 1H over " + o1.point], "1un": [u1, o1, "totals_h1", "Under", A + "/" + H + " 1H under " + u1.point] }; }
        var lk = { "sp-a": fl("spreads", e.away_team), "sp-h": fl("spreads", e.home_team), "ml-a": fl("h2h", e.away_team), "ml-h": fl("h2h", e.home_team), "ov": fl("totals", "Over"), "un": fl("totals", "Under") };
        G.push({ id: e.id, t: e.commence_time, away: A, home: H, alt: alt ? bk.title : null, total: ov.point, p0: raw, links: lk,
          p: { "sp-a": cg(nv(as.price, hs.price), "sp-a", as.price), "sp-h": cg(nv(hs.price, as.price), "sp-h", hs.price), "ml-a": cg(nv(mlA, mlH), "ml-a", mlA), "ml-h": cg(nv(mlH, mlA), "ml-h", mlH), "ov": cg(nv(ov.price, un.price), "ov", ov.price), "un": cg(nv(un.price, ov.price), "un", un.price) },
          best: { "sp-a": best("spreads", e.away_team, as.point, as.price), "sp-h": best("spreads", e.home_team, hs.point, hs.price),
            "ml-a": best("h2h", e.away_team, undefined, mlA), "ml-h": best("h2h", e.home_team, undefined, mlH),
            "ov": best("totals", "Over", ov.point, ov.price), "un": best("totals", "Under", un.point, un.price) },
          legs: {
          "sp-a": { n: A + " " + (as.point > 0 ? "+" : "") + as.point, a: as.price, pt: as.point },
          "sp-h": { n: H + " " + (hs.point > 0 ? "+" : "") + hs.point, a: hs.price, pt: hs.point },
          "ml-a": { n: A + " ML", a: oc(h, e.away_team).price },
          "ml-h": { n: H + " ML", a: oc(h, e.home_team).price },
          "ov": { n: A + "/" + H + " over " + ov.point, a: ov.price, pt: ov.point },
          "un": { n: A + "/" + H + " under " + un.point, a: un.price, pt: un.point } } });
        if (H1) { var gg = G[G.length - 1]; gg.h1 = true;
          for (var t1 in H1) { var X = H1[t1], q = nv(X[0].price, X[1].price);
            gg.legs[t1] = { n: X[4], a: X[0].price, pt: X[0].point }; gg.p0[t1] = q; gg.p[t1] = cg(q, t1, X[0].price);
            gg.best[t1] = best(X[2], X[3], X[0].point, X[0].price); gg.links[t1] = fl(X[2], X[3]); } }
      });
    function gkey(g, t) { var h = t.charAt(0) === "1" ? "1" : "", u = t.replace(/^1/, ""); return "G|" + g.id + "|" + h + (u.slice(0, 2) === "sp" ? "sp" : u.slice(0, 2) === "ml" ? "ml" : "tot"); }
    function gameLeg(g, t) { var L = g.legs[t]; return { k: gkey(g, t), kind: "g", t: t, n: L.n, a: L.a, pt: L.pt, ev: g.id, time: g.t, p: g.p[t], p0: g.p0[t], best: g.best[t], links: g.links[t] }; }

    // ---------- props ----------
    var live = {}; G.forEach(function (g) { live[g.id] = g; });
    ((data && data.props) || []).forEach(function (p) {
      var g = live[p.event]; if (!g) return;
      var rungs = p.ladder.filter(function (r) { return r.prices[book] !== undefined; }).map(function (r) {
        // Blend the player's history with the book's own price (less history = lean more on the book)
        var a = r.prices[book], pa, ev = null, fair = null;
        var p0;
        if (r.p !== undefined) { var imp = 1 / dec(a) / 1.045, w = r.n / (r.n + 15); pa = w * r.p + (1 - w) * imp; p0 = pa;
          pa = calibrate(pa, category({ kind: "p", label: p.label, a: a }), opts.calib); ev = pa * dec(a) - 1; fair = pa >= 0.5 ? Math.round(-100 * pa / (1 - pa)) : Math.round(100 * (1 - pa) / pa); }
        var b = { a: a, book: BOOK_NAMES[book] || book };
        BOOKS.forEach(function (k) { var x = r.prices[k]; if (x !== undefined && dec(x) > dec(b.a)) b = { a: x, book: BOOK_NAMES[k] }; });
        return { line: r.line, a: a, p: pa, p0: p0, hits: r.hits, n: r.n, since: r.since, fair: fair, ev: ev, best: b, links: r.links || (r.fd ? { fanduel: r.fd } : null), under: r.under ? r.under[book] : undefined };
      });
      if (!rungs.length) return;
      // Healthy = no injury designation and played in his team's last game. Only healthy players go in auto parlays.
      var healthy = !p.injury && !p.missedLast;
      P.push({ id: p.event + "|" + p.player + "|" + p.label, ev: p.event, g: g, player: p.player, team: p.team, opp: p.opp, oppF: p.oppF, windF: p.windF, injury: p.injury, missedLast: p.missedLast, healthy: healthy,
        label: p.label, td: p.td, avg: p.avg, recent: p.recent, rungs: rungs,
        best: Math.max.apply(null, rungs.map(function (r) { return r.ev === null || r.n < 6 || r.a > 400 ? -9 : r.ev; })),
        top: Math.max.apply(null, rungs.map(function (r) { return r.p || 0; })) });
    });
    function rungName(p, r) { return p.player + (p.td ? " anytime TD" : " " + (r.line + 0.5) + "+ " + unit(p.label, r.line + 0.5)); }
    function propLeg(p, r) { return { k: "P|" + p.id, kind: "p", since: r.since, line: r.line, n: rungName(p, r), a: r.a, ev: p.ev, time: p.g.t, player: p.player, team: p.team, label: p.label, td: p.td, p: r.p, p0: r.p0, best: r.best, links: r.links }; }

    // ---------- presets ----------
    function favSide(g) { return g.legs["ml-h"].a <= g.legs["ml-a"].a ? "h" : "a"; }
    function gamePresets() {
      // Skip moneylines so lopsided they barely pay (common in college)
      var fav = G.map(function (g) { var s = favSide(g); return { g: g, s: s, ml: g.legs["ml-" + s].a }; }).filter(function (f) { return f.ml >= -1000; }).sort(function (a, b) { return a.ml - b.ml; });
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
      var c = []; P.forEach(function (p) { if (p.healthy) p.rungs.forEach(function (r) { if (r.p !== undefined) c.push({ p: p, r: r }); }); });
      function pickN(arr, n) {
        var used = {}, games = {}, out = [];
        arr.forEach(function (x) { if (out.length < n && !used[x.p.player] && !games[x.p.ev]) { used[x.p.player] = 1; games[x.p.ev] = 1; out.push(propLeg(x.p, x.r)); } });
        arr.forEach(function (x) { if (out.length < n && !used[x.p.player]) { used[x.p.player] = 1; out.push(propLeg(x.p, x.r)); } });
        return out;
      }
      var out = []; function add(n, d, l, need) { if (l.length >= need) out.push({ n: n, d: d, l: l }); }
      add("High-Floor 3", "Highest hit % at a fair price", pickN(c.filter(function (x) { return x.r.a <= -120 && x.r.a >= -350 && !x.p.td; }).sort(function (a, b) { return b.r.p - a.r.p; }), 3), 3);
      add("Best Value 3", "Our estimate beats the price most", pickN(c.filter(function (x) { return x.r.p >= 0.5 && x.r.n >= 6 && x.r.a <= 150; }).sort(function (a, b) { return b.r.ev - a.r.ev; }), 3), 3);
      add("TD Trio", "Likeliest anytime TD scorers", pickN(c.filter(function (x) { return x.p.td && x.r.n >= 6; }).sort(function (a, b) { return b.r.p - a.r.p; }), 3), 3);
      add("Yardage 4-Leg", "Solid hit rates, plus-ish prices", pickN(c.filter(function (x) { return !x.p.td && x.r.p >= 0.5 && x.r.n >= 6 && x.r.a >= -200 && x.r.a <= 130; }).sort(function (a, b) { return b.r.ev - a.r.ev; }), 4), 4);
      return out;
    }

    // ---------- mixed slips (game lines + props) ----------
    // Each candidate: {leg, who (one leg per player / per game market), ev, ...}
    function poolFor(ids, team) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      var props = []; P.forEach(function (p) {
        if (!set[p.ev] || (team && p.team !== team) || !p.healthy) return;
        p.rungs.forEach(function (r) { if (r.p !== undefined && r.n >= 6) props.push({ leg: propLeg(p, r), who: p.player, ev: p.ev, p: r.p, a: r.a, e: r.ev, td: p.td }); });
      });
      var gs = G.filter(function (g) { return set[g.id]; });
      function gl(g, t) { return { leg: gameLeg(g, t), who: "G|" + g.id + "|" + (t === "ov" || t === "un" ? "tot" : "side"), ev: g.id, a: g.legs[t].a, p: g.p[t] }; }
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
    function teamSlips(abbr, gid) {
      // gid picks one of the team's games (college teams can have two in the window); default is the next one
      var mine = G.filter(function (x) { var m = data && data.games[x.id]; return m && (m.home === abbr || m.away === abbr); });
      var g = (gid && mine.filter(function (x) { return x.id === gid; })[0]) || mine[0];
      var myIds = {}; mine.forEach(function (x) { myIds[x.id] = 1; });
      if (!g) return { g: null, l: [] };
      var Q = poolFor([g.id], abbr), out = [], nm = g[data.games[g.id].home === abbr ? "home" : "away"];
      function add(s) { if (s) out.push(s); }
      var safeTD = Q.tds.filter(function (x) { return x.a <= -110; });
      if (safeTD.length) add(mkSlip(nm + " Safe", "Win or cover, a likely TD and two high-floor props", [[[Q.side(g, abbr)], 1], [safeTD, 1], [Q.floors, 2]], false));
      else add(mkSlip(nm + " Safe", "Win or cover plus three high-floor " + nm + " props", [[[Q.side(g, abbr)], 1], [Q.floors, 3]], false));
      add(mkSlip(nm + " Shootout", "Game over plus three " + nm + " stat overs", [[Q.over, 1], [Q.mid, 3]], false));
      add(mkSlip(nm + " Long Shot", "Cover plus three plus-money " + nm + " props", [[[Q.teamSP(g, abbr)], 1], [Q.plus, 3]], false));
      // No player props (college): pair the team with the best game lines from other games
      if (!out.length) {
        var A = poolFor(G.map(function (x) { return x.id; }));
        var others = function (arr) { return arr.filter(function (x) { return !myIds[x.ev] && x.a >= -600; }); };
        add(mkSlip(nm + " + Favorites", nm + " plus the two safest favorites on the board", [[[Q.side(g, abbr)], 1], [others(A.favML), 2]], true));
        add(mkSlip(nm + " Cover + Total", nm + " to cover and the game total, same game", [[[Q.teamSP(g, abbr)], 1], [Q.over, 1]], false));
        add(mkSlip(nm + " Long Shot", nm + " to cover plus three other favorites to cover", [[[Q.teamSP(g, abbr)], 1], [others(A.favSP), 3]], true));
      }
      return { g: g, l: out };
    }
    function slates() {
      var groups = [], idx = {};
      G.forEach(function (g) {
        var k = opts.slate === "date" ? dateName(g.t) : opts.slate === "cfb" ? cfbSlate(g.t) : slateName(g.t);
        // College: games more than 7 days out get their date in the name so they don't merge with this week's slot
        if (opts.slate === "cfb" && +new Date(g.t) - now > 7 * 864e5) k += " " + new Date(g.t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
        if (!(k in idx)) { idx[k] = groups.length; groups.push({ k: k, g: [] }); } groups[idx[k]].g.push(g); });
      // soonest first, so anything a week or more away ends up at the end
      groups.forEach(function (x) { x.g.sort(function (a, b) { return new Date(a.t) - new Date(b.t); }); });
      groups.sort(function (a, b) { return new Date(a.g[0].t) - new Date(b.g[0].t); });
      return groups;
    }
    // ---------- most likely to hit ----------
    // Every healthy rated prop rung and every game side, with our win chance. One leg per game.
    function likelyPool() {
      var c = [];
      P.forEach(function (p) { if (!p.healthy) return; p.rungs.forEach(function (r) { if (r.p !== undefined && r.n >= 6 && r.a >= -400 && r.a <= 200) c.push({ leg: propLeg(p, r), who: p.player, ev: p.ev, p: r.p, a: r.a }); }); });
      G.forEach(function (g) { ["ml-a", "ml-h", "sp-a", "sp-h", "ov", "un"].forEach(function (t) { var a = g.legs[t].a; if (a >= -400 && a <= 200) c.push({ leg: gameLeg(g, t), who: "G|" + g.id, ev: g.id, p: g.p[t], a: a }); }); });
      return c;
    }
    // Search small combinations for the slip with the highest chance that still pays at least `target` (decimal odds).
    function bestCombo(c, target, maxK, sameGame) {
      // Candidates: the 25 likeliest legs plus the 25 that add the most payout per unit of risk
      var eff = function (x) { return -Math.log(x.p) / Math.log(dec(x.a)); };
      var byP = c.slice().sort(function (x, y) { return y.p - x.p; }).slice(0, 25);
      var byE = c.filter(function (x) { return dec(x.a) > 1.3; }).sort(function (x, y) { return eff(x) - eff(y); }).slice(0, 25);
      var pool = [], seenL = {}; byP.concat(byE).forEach(function (x) { var k = x.leg.k + "|" + x.leg.t + "|" + x.leg.line; if (!seenL[k]) { seenL[k] = 1; pool.push(x); } });
      pool.sort(function (x, y) { return y.p - x.p; });
      var best = null, bestP = 0;
      function ok(sel) { var who = {}, evs = {}; for (var i = 0; i < sel.length; i++) { if (who[sel[i].who] || (!sameGame && evs[sel[i].ev])) return false; who[sel[i].who] = 1; evs[sel[i].ev] = 1; } return true; }
      function rec(start, sel, p, d) {
        if (sel.length >= 2 && d >= target) { if (p > bestP && ok(sel)) { bestP = p; best = sel.slice(); } return; }
        if (sel.length === maxK || p <= bestP) return;
        for (var i = start; i < pool.length; i++) { sel.push(pool[i]); rec(i + 1, sel, p * pool[i].p, d * dec(pool[i].a)); sel.pop(); }
      }
      rec(0, [], 1, 1);
      return best ? best.map(function (x) { return x.leg; }) : null;
    }
    function topN(c, n, sameGame) {
      var sorted = c.filter(function (x) { return x.a >= -300; }).sort(function (x, y) { return y.p - x.p; });
      var who = {}, evs = {}, legs = [];
      for (var i = 0; i < sorted.length && legs.length < n; i++) { var x = sorted[i]; if (who[x.who] || (!sameGame && evs[x.ev])) continue; who[x.who] = 1; evs[x.ev] = 1; legs.push(x.leg); }
      return legs.length === n ? legs : null;
    }
    function likelySlips(ids) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      var c = likelyPool().filter(function (x) { return set[x.ev]; }), out = [], sg = ids.length === 1;
      var seen = {};
      function add(n, d, l) { if (!l) return; var k = l.map(function (x) { return x.k + x.line; }).sort().join(); if (seen[k]) return; seen[k] = 1; out.push({ n: n, d: d, l: l }); }
      add("Best 2-Leg", "The two legs we rate most likely to hit", topN(c, 2, sg));
      add("Best 3-Leg", "The three legs we rate most likely to hit", topN(c, 3, sg));
      add("Best Shot at +100", "Highest chance to double your money", bestCombo(c, 2, 4, sg));
      add("Best Shot at +300", "Highest chance to pay 3 to 1 or better", bestCombo(c, 4, 4, sg));
      if (!sg) add("Best Shot at +600", "Highest chance to pay 6 to 1 or better", bestCombo(c, 7, 5, sg));
      return out;
    }

    // Every auto-built slip on the Parlays page, grouped
    function allParlays() {
      var out = [{ group: "Most likely to hit", slips: likelySlips(G.map(function (g) { return g.id; })) }];
      if (!opts.noWeek) out.push({ group: "Best of the week", slips: slateSlips(G.map(function (g) { return g.id; })) });
      slates().forEach(function (s) { var ids = s.g.map(function (g) { return g.id; }); out.push({ group: s.k, slips: likelySlips(ids).concat(slateSlips(ids)) }); });
      if (opts.featured) { var ft = teamSlips(opts.featured); if (ft.g && ft.l.length) out.push({ group: opts.featuredName + " parlays", slips: ft.l }); }
      out.push({ group: "Player props only", slips: playerPresets() });
      out.push({ group: "Game lines only", slips: gamePresets() });
      return out;
    }
    return { G: G, P: P, gkey: gkey, gameLeg: gameLeg, propLeg: propLeg, rungName: rungName, gamePresets: gamePresets, playerPresets: playerPresets,
      slateSlips: slateSlips, teamSlips: teamSlips, slates: slates, allParlays: allParlays, likelySlips: likelySlips };
  }

  // ---------- same-game correlation ----------
  // Legs from the same game don't hit independently (a QB's yards and his receiver's yards rise together).
  // backtest/replay.js measures, for each kind of pair, how strongly their results moved together over past seasons
  // (a correlation from -1 to 1) and saves it in backtest/corr.json. Here we turn that into a corrected chance.
  function propGroup(label, td) { if (td) return "td"; return { "Passing yards": "pass", "Passing TDs": "pass", "Rushing yards": "rush", "Receiving yards": "rec", "Receptions": "rec", "Rush + rec yards": "rec" }[label] || String(label || "").toLowerCase(); }
  // What a leg is, for pairing: role, team, and whether it's a side or a total. meta = {away, home} abbreviations of its game.
  function legInfo(l, meta) {
    meta = meta || {};
    if (l.kind === "g") { var t = l.t.replace(/^1/, ""), side = t.slice(0, 2) === "ml" || t.slice(0, 2) === "sp";
      return { ev: l.ev, p: l.p, g: true, h1: l.t.charAt(0) === "1", side: side, team: side ? (/-a$/.test(t) ? meta.away : meta.home) : null,
        role: side ? "side-" + ((t.slice(0, 2) === "ml" ? l.a < 0 : l.pt < 0) ? "fav" : "dog") : (t === "ov" ? "tot-o" : "tot-u") }; }
    return { ev: l.ev, p: l.p, g: false, team: l.team || null, player: l.player, role: propGroup(l.label, l.td) + (l.side === "under" ? "-u" : "-o") };
  }
  function pairKey(A, B) {
    if (A.ev !== B.ev) return null;
    if (A.g && B.g) { if (A.h1 !== B.h1 || A.side === B.side) return null; var s = A.side ? A : B, o = A.side ? B : A; return s.role + "+" + o.role; }
    if (A.g || B.g) { var gl = A.g ? A : B, pr = A.g ? B : A; if (gl.side) return "side+" + pr.role + "|" + (gl.team && gl.team === pr.team ? "for" : "vs"); return gl.role + "+" + pr.role; }
    if (A.player && A.player === B.player) return null;
    var r = [A.role, B.role].sort(); return r[0] + "+" + r[1] + "|" + (A.team && A.team === B.team ? "same" : "opp");
  }
  // Chance both hit, from each one's chance and the pair's correlation, kept inside what's possible
  function joint(pa, pb, rho) { var j = pa * pb + rho * Math.sqrt(pa * (1 - pa) * pb * (1 - pb)); return Math.max(Math.max(0, pa + pb - 1) + 1e-4, Math.min(Math.min(pa, pb), j)); }
  // Correlation for a pair, shrunk toward zero when we have few past examples
  function pairRho(key, corr) { var c = key && corr && corr.pairs && corr.pairs[key]; if (!c || c.n < 100) return 0; return c.rho * c.n / (c.n + 400); }
  // Multiplier on the independent chance for a set of legs; also returns the pairs that moved it
  function corrAdj(legs, metaOf, corr) {
    var f = 1, out = [], I = legs.map(function (l) { return legInfo(l, metaOf ? metaOf(l.ev) : null); });
    for (var i = 0; i < I.length; i++) for (var j = i + 1; j < I.length; j++) {
      var a = I[i], b = I[j]; if (a.ev !== b.ev || a.p == null || b.p == null) continue;
      var k = pairKey(a, b), rho = pairRho(k, corr); if (!rho) continue;
      var m = joint(a.p, b.p, rho) / (a.p * b.p); f *= m; out.push({ i: i, j: j, key: k, rho: rho, m: m });
    }
    var mn = 1; I.forEach(function (x) { if (x.p != null && x.p < mn) mn = x.p; });
    var base = chance(legs); if (base) f = Math.min(f, mn / base); // never more likely than the weakest leg alone
    return { f: f, pairs: out };
  }

  var Engine = { make: make, legInfo: legInfo, pairKey: pairKey, corrAdj: corrAdj, joint: joint, pairRho: pairRho, propGroup: propGroup, betslipLink: betslipLink, legLink: legLink, category: category, bucket: bucket, dec: dec, amFromDec: amFromDec, slateName: slateName, dateName: dateName, chance: chance, unit: unit, BOOK_NAMES: BOOK_NAMES, OPTS: OPTS };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.Engine = Engine;
})(this);
