// College football: pulls game lines (spread, moneyline, total) for every FBS game from The Odds API.
// Run from the repo root: ODDS_API_KEY=your_key node cfb/fetch.js
// Cost per run: about 3 credits no matter how many games (one request, three markets).

const fs = require("fs");
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("Set ODDS_API_KEY first."); process.exit(1); }
// SPORT=cbb pulls men's college basketball into cbb/ the same way
const SP = process.env.SPORT === "cbb" ? "cbb" : "cfb";
const BASE = "https://api.the-odds-api.com/v4/sports/" + (SP === "cbb" ? "basketball_ncaab" : "americanfootball_ncaaf");
const BOOKS = "fanduel,draftkings,betmgm,betrivers";

function readOld() { try { return JSON.parse(fs.readFileSync(SP + "/odds.json", "utf8")); } catch (e) { return null; } }

(async () => {
  // Automatic runs skip if odds were pulled in the last 45 minutes (two timers, one refresh)
  const old0 = readOld();
  if (process.env.AUTO_GUARD === "true") { const o = old0; if (o && Date.now() - new Date(o.fetchedAt) < 45 * 60e3) { console.log("College odds already pulled at", o.fetchedAt, "- skipping"); process.exit(0); } }
  const res = await fetch(`${BASE}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true&includeSids=true`);
  const remaining = res.headers.get("x-requests-remaining");
  if (!res.ok) { console.error("Odds API error", res.status, (await res.text()).slice(0, 200)); process.exit(1); }
  const lines = await res.json();
  let left = remaining === null ? null : +remaining;
  // College basketball first-half lines (spreads_h1, totals_h1). The Odds API only sells these game by game (2 credits a game),
  // so we take a short list once every ~8 hours: Michigan State first, then ranked teams, then the closest spreads, tipping in the next 18 hours.
  let h1 = (old0 && old0.h1) || { pulledAt: null, games: {} };
  if (SP === "cbb") {
    const now = Date.now(), H1_MAX = +(process.env.H1_MAX || 10);
    for (const id in h1.games) if (+new Date(h1.games[id].t) < now - 6 * 36e5) delete h1.games[id];
    const due = !h1.pulledAt || now - new Date(h1.pulledAt) > 8 * 36e5 || process.env.H1 === "true";
    if (due && (left === null || left > 3000)) {
      const data = (() => { try { return JSON.parse(fs.readFileSync("cbb/data.json", "utf8")); } catch (e) { return {}; } })();
      const nm = t => (data.names && data.names[t]) || t, rank = t => { const m = /^#(\d+)/.exec(nm(t)); return m ? +m[1] : 99; };
      const msu = t => /^Michigan St/.test(t);
      const spread = e => { const b = (e.bookmakers || [])[0], m = b && b.markets.find(x => x.key === "spreads"); return m ? Math.abs(m.outcomes[0].point) : 30; };
      const soon = lines.filter(e => { const t = +new Date(e.commence_time); return t > now + 20 * 6e4 && t < now + 18 * 36e5; })
        .map(e => ({ e, sc: (msu(e.home_team) || msu(e.away_team) ? -1000 : 0) + Math.min(rank(e.home_team), rank(e.away_team)) * 3 + spread(e) }))
        .sort((a, b) => a.sc - b.sc).slice(0, H1_MAX);
      let got = 0;
      for (const { e } of soon) {
        try {
          const r = await fetch(`${BASE}/events/${e.id}/odds?apiKey=${KEY}&bookmakers=${BOOKS}&markets=spreads_h1,totals_h1&oddsFormat=american&includeLinks=true&includeSids=true`);
          const rr = r.headers.get("x-requests-remaining"); if (rr !== null) left = +rr;
          if (!r.ok) { console.warn("1H", e.id, r.status); continue; }
          const j = await r.json(); h1.games[e.id] = { t: e.commence_time, at: new Date().toISOString(), bookmakers: j.bookmakers || [] }; got++;
        } catch (err) { console.warn("1H", e.id, err.message); }
      }
      h1.pulledAt = new Date().toISOString();
      console.log("First-half lines pulled for", got, "games");
    }
    // Merge saved first-half markets into each game's books
    for (const e of lines) { const x = h1.games[e.id]; if (!x) continue;
      for (const hb of x.bookmakers) { const b = e.bookmakers.find(y => y.key === hb.key); if (b) b.markets = b.markets.concat(hb.markets.filter(m => /_h1$/.test(m.key))); } }
  }
  fs.writeFileSync(SP + "/odds.json", JSON.stringify({ fetchedAt: new Date().toISOString(), creditsRemaining: left, lines, props: [], h1: SP === "cbb" ? h1 : undefined }));
  console.log("Saved", SP + "/odds.json:", lines.length, "games. Credits remaining:", left);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "fetched=true\n");
})();
