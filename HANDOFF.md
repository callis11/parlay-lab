# ParlayLabs: handoff notes for a new Claude chat

Read this first, then `README.md`. Everything lives in this repo (github.com/callis11/parlay-lab, branch `main`); the site is GitHub Pages: https://callis11.github.io/parlay-lab/ (`?nba`, `?cfb`, `?cbb` for other sports).

## Owner and how he likes to work
- Andrew (GitHub `callis11`), Detroit, America/Detroit time. Uses the site as an iPhone home-screen app; tests on his phone and sends screenshots.
- Wants plain-English explanations, honest odds, and lots of "why" behind every %. Likes iterating fast on look and feel; push small changes and tell him to tap the ↻ button.
- Favorite teams (defaults): Lions (NFL), Pistons (NBA), Michigan State (NCAAF + NCAAB). Buddy's site is ladderup.io: never copy its name, wording ("ladder", "pieces") or branding; keep LadderUp's picks private.
- Never paste API keys or tokens in chat. The Odds API key is the GitHub secret `ODDS_API_KEY`; the Cloudflare Worker uses the secret `GH_TOKEN`.

## Where things are
- `index.html`: the whole site (one file). Tabs: Parlays · Build · Players · Games · Results. Header: sport tabs; logo row with ↻ refresh, ★ My teams (per-sport favorite, saved per phone), ? tour.
- `engine.js`: shared parlay engine (browser + Node). `build-data.js`: NFL data (exports `buildData` for point-in-time builds). `fetch-odds.js`: NFL odds pull. `picks.js`: records/grades slips, report cards, calibration (includes backtest legs at half weight for NFL).
- `nba/` (fetch.js, build.js), `cfb/fetch.js` + `cfb/build.js` serve both college sports (`SPORT=cfb|cbb`, data in `cfb/` and `cbb/`).
- `backtest/`: historical NFL odds (`raw/`, gzipped), `fetch.js` (workflow `backtest.yml`), `replay.js` (run locally with `CALIB=1`), outputs `results.json`, `teams.json`, `graded-legs.json`.
- `schedule.json`: refresh times (US Eastern, minutes end in 0/5). The Cloudflare Worker `parlay-lab-timer` (code in `cloudflare/worker.js`) reads it every 5 min and dispatches workflows. GitHub crons are only a backup.
- Workflows: `refresh.yml` (NFL), `nba.yml`, `cfb.yml`, `cbb.yml`, `backtest.yml`. Dispatch with `gh api -X POST repos/callis11/parlay-lab/actions/workflows/<file>/dispatches -f ref=main` (+ `-f "inputs[auto]=true"` to respect the "already pulled recently" guard). After editing a workflow file, Andrew re-saves it on GitHub so its backup cron runs under his account (cfb.yml, cbb.yml and refresh.yml still need that).

## Odds plan and credits
- The Odds API, currently on the $59 / 100K plan (upgraded Oct 30, 2026); about 8K credits were left after the history pull. Plan: stay on $59 until the rest of the history is pulled, then tell Andrew to switch back to $30.
- Still to pull when credits reset: rest of 2023 props (215 of 272 done), 2023 alt lines, playoff games, 5 seasons of college game lines (~26K credits). Then rerun `CALIB=1 node backtest/replay.js`, commit outputs, run `node picks.js` to refresh calibration.
- Normal use ≈ 15K/month. Sunday NFL has 16 pulls timed to kickoff windows; pulls after kickoff only buy props for games not started.

## Model in one paragraph
Per leg: player's last-10 hit rate (normal fit + empirical), adjusted for opponent defense and wind, blended with the book's no-vig price (weight n/(n+15)), then calibrated by market and price bucket from graded legs (live + 154K backtest legs at half weight). Parlay % = product of legs × a slip-type correction from three seasons of replays (shrunk). Backtest takeaways: safe legs are honest (70–90% estimates hit within 1–2 pts); "value" picks lost badly (flagged Weak history and kept out of top picks); unders beat overs; multi-leg slips hit 4–8 pts below their legs.

## Testing
Serve with `python3 -m http.server 8765` in the repo, test with Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), set `localStorage age21=yes, tour1=seen` before loading. Node network needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. ESPN and Open-Meteo are blocked from the container (they work on GitHub Actions); nflverse (GitHub releases) works.

## Built Oct 30, 2026 (late): no open ideas left from the old list
- **ParlayLabs Generator**: the name on all three generators (Parlays, Players, Games tabs); subtitles say what each one uses.
- **Closing line value**: picks.js stores `a1`/`pt1` (first posted price) and `close`/`clv` per leg, followed until that leg's own game starts. Report-card legs keep `a1`. Results tab "Beating the closing line" section; ▲/▼ markers on graded legs. Old slips from before this have no `a1`, so numbers start with Week 9 games.
- **Weekly report card** (Results tab, ‹ › to page weeks): record, profit, legs hit, what we said vs reality, best hit, toughest miss, closing line. Finishes filling in once Monday night's box scores post.
- **Same-game correlation**: `backtest/replay.js` writes `backtest/corr.json` (pair types such as QB pass + same-team rec, side+prop for/vs, shrunk with n/(n+400), ignored under 100 pairs). `Engine.corrAdj` and the site's `slipChance()` use it for every % (named slips, generators, Build). The replay's slip-type factor is measured after correlation (`expRaw` keeps the old number).
- **College basketball first half**: `cfb/fetch.js` (SPORT=cbb) buys `spreads_h1,totals_h1` per event (2 credits each), at most 10 games (`H1_MAX`) every 8 hours (Michigan State first, then ranked, then closest spreads), only if over 3,000 credits are left. Force with env `H1=true`. Leg types `1sp-a/1sp-h/1ov/1un`, graded from ESPN first-half scores (`h1` in cbb/logs.json). Cost about 1.5–2K credits a month during the season.
- **More NFL market types** (fetch-odds.js `DEEP_MARKETS`, 15 markets: pass attempts, completions, INTs thrown, rush attempts, rush/rec/rush+rec TDs, pass+rush+rec yds, sacks, solo tackles, tackles+assists, tackle assists, def INTs, field goals, kicking points). Own call per game at most every `DEEP_HOURS` (6) and only above `DEEP_MIN` (4,000) credits; saved in odds.json `deep` and merged until kickoff. Stats for every market live in `Engine.NFL_STAT` (used by build-data, picks.js and replay.js). Low-count stats use a Poisson fit (`COUNT` in build-data.js). Not pulled: longest-play markets and first/last TD (no weekly stat to rate them). Force with env `DEEP=true`, turn off with `DEEP=false`.
- **Players generator**: "All markets" dropdown-style checklist of every market by name (order from `Engine.MARKET_GROUPS`; none picked = all; saved as labels in GENS.ply.mk), Side: Both / Overs / Unders (`ENG.underLeg`, main lines only), game tiles. Under legs use key `P|id|u`; `sideRec()` flips records for unders.
- **Tags**: All green (every leg 70%+), Spread out (3+ legs, all different games), ⚑ Red flag (leg under 45%, injury or missed last game, rarely clears the line since 2023, poor history vs this opponent, two legs on one player, line moved 1.5+ points against, game started). Red-flag slips never get the Safest pick.

## Remaining history pull (do this when The Odds API credits reset)
Check credits first: run the backtest workflow in test mode (`-f "inputs[test]=true"`); its log (`backtest/raw/last-run.log`, committed by the workflow) shows "Credits left". Need about 26K free plus ~15K for the live site.
1. **Rest of 2023 props (57 games, ~4K credits):** just rerun the workflow with `inputs[test]=false` and `inputs[reserve]=15000`. `backtest/fetch.js` skips anything already saved, so it only fetches the missing 2023 games (and re-checks lines, which are already complete).
2. **2023 alt lines (~10K):** 2023 was pulled with main markets only (`MAIN` in fetch.js). Needs a small code change: an env like `ALT_ONLY=2023` that requests only the four `*_alternate` markets for games already in `props-2023` and merges their bookmaker markets into the saved events.
3. **Playoffs (~4K):** fetch.js and replay.js only use `game_type === "REG"`. Add WC/DIV/CON/SB games (separate files or a flag), and in replay.js take player history across the season boundary.
4. **College game lines, 5 seasons (~12K):** add sport `americanfootball_ncaaf` to fetch.js (lines only, keyed by kickoff time like NFL), plus a college replay that grades with ESPN scores (fetch scores on GitHub Actions; ESPN is blocked from the Claude container). Lower priority: Andrew mainly cares about NFL.
5. After pulling: `CALIB=1 node backtest/replay.js` locally (NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt), then `node picks.js` to refresh calibration, commit `backtest/*.json` + `calibration.json`, push, and send Andrew the new report card. Then tell him he can switch back to the $30 plan (set it to change at the next billing date).

## What changed most recently (Oct 30, 2026 evening)
- Tabs are now Parlays · Build · Players · Games · Results (Games = the old Teams tab: swipeable flip cards per game, division/conference filters, Away | Home | Both team toggle, game generator under the card with "+ Add other games").
- **Build tab:** compact ranked board of every leg (rank · player · team tag · line · % · +); tap a row for its "why", + adds to the live parlay summary at the top (honest %, payout, warnings, How we got this %). Pick several games, filter by type, sort.
- **Generators** on Parlays, Players and Games tabs share one code path (GENS/genBox/genUI/genPool/genRank, contexts `par`, `ply`, `tm`): best-chance search within each style's payout range, pick one game (then Away/Home/Both) or several games, last 3 kept per generator, legs show team on its own line and stats two per line.
- Every parlay card flips to "How we got this %". Parlays tab has no game spotlight anymore (it lives on Games).
- Header: sport tabs on top; logo row has round gold ↻ (refresh), ★ (My teams page: favorite per sport, saved per phone), ? (6-slide tour, auto-shown once).
- Leg circle colors = chance to hit (green 70%+, yellow 50–69%, red <50%); game-line icons are letters (ML, S, O, U), TD props show TD.
- Mowed-field green theme for football, hardwood court for basketball; end-zone header on football.
