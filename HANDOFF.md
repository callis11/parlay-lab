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

## Open ideas Andrew liked but hasn't asked for yet
Closing line value tracking, a weekly Monday report card, same-game correlation learning, first-half lines for college basketball, extra tags (All Green, Spread Out, Red Flag).
