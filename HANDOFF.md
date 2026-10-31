# ParlayLabs: handoff notes for a new Claude chat

**Starting a new chat?** Paste: *"Let's keep working on my ParlayLabs site. Read HANDOFF.md in my GitHub repo callis11/parlay-lab first."* Claude should then attach the repo, read this file and ask what's next. Keep each chat to one feature or one evening; start a fresh chat after that.

Read this first, then `README.md`. Everything lives in this repo (github.com/callis11/parlay-lab, branch `main`); the site is GitHub Pages: https://callis11.github.io/parlay-lab/ (`?nba`, `?cfb`, `?cbb` for other sports).

## Owner and how he likes to work
- Andrew (GitHub `callis11`), Detroit, America/Detroit time. Uses the site as an iPhone home-screen app; tests on his phone and sends screenshots.
- Wants plain-English explanations, honest odds, and lots of "why" behind every %. Likes iterating fast on look and feel; push small changes and tell him to tap the ↻ button.
- Favorite teams (defaults): Lions (NFL), Pistons (NBA), Michigan State (NCAAF + NCAAB). Buddy's site is ladderup.io: never copy its name, wording ("ladder", "pieces") or branding; keep LadderUp's picks private.
- Never paste API keys or tokens in chat. The Odds API key is the GitHub secret `ODDS_API_KEY`; the Cloudflare Worker uses the secret `GH_TOKEN`.

## Growth plan
Roadmap (college build-out, European soccer, budget by month, session sizing): https://claude.ai/artifact/R373PchkDZnEbX4weBQV4a — one feature per session, timed to the sports calendar; $59 late Aug to the Super Bowl, $30 otherwise.

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
Serve with `python3 -m http.server 8765` in the repo, test with Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), set `localStorage age21=yes, tour1=seen, setup1=done` before loading. Node network needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. ESPN and Open-Meteo are blocked from the container (they work on GitHub Actions); nflverse (GitHub releases) works.

## Built Oct 30, 2026 (late): no open ideas left from the old list
- **ParlayLabs Generator**: the name on all three generators (Parlays, Players, Games tabs); subtitles say what each one uses.
- **Closing line value**: picks.js stores `a1`/`pt1` (first posted price) and `close`/`clv` per leg, followed until that leg's own game starts. Report-card legs keep `a1`. Results tab "Beating the closing line" section; ▲/▼ markers on graded legs. Old slips from before this have no `a1`, so numbers start with Week 9 games.
- **Weekly report card** (Results tab, ‹ › to page weeks): record, profit, legs hit, what we said vs reality, best hit, toughest miss, closing line. Finishes filling in once Monday night's box scores post.
- **Same-game correlation**: `backtest/replay.js` writes `backtest/corr.json` (pair types such as QB pass + same-team rec, side+prop for/vs, shrunk with n/(n+400), ignored under 100 pairs). `Engine.corrAdj` and the site's `slipChance()` use it for every % (named slips, generators, Build). The replay's slip-type factor is measured after correlation (`expRaw` keeps the old number).
- **College basketball first half**: `cfb/fetch.js` (SPORT=cbb) buys `spreads_h1,totals_h1` per event (2 credits each), at most 10 games (`H1_MAX`) every 8 hours (Michigan State first, then ranked, then closest spreads), only if over 3,000 credits are left. Force with env `H1=true`. Leg types `1sp-a/1sp-h/1ov/1un`, graded from ESPN first-half scores (`h1` in cbb/logs.json). Cost about 1.5–2K credits a month during the season.
- **More NFL market types** (fetch-odds.js `DEEP_MARKETS`, 15 markets: pass attempts, completions, INTs thrown, rush attempts, rush/rec/rush+rec TDs, pass+rush+rec yds, sacks, solo tackles, tackles+assists, tackle assists, def INTs, field goals, kicking points). Own call per game at most every `DEEP_HOURS` (6) and only above `DEEP_MIN` (4,000) credits; saved in odds.json `deep` and merged until kickoff. Stats for every market live in `Engine.NFL_STAT` (used by build-data, picks.js and replay.js). Low-count stats use a Poisson fit (`COUNT` in build-data.js). Not pulled: longest-play markets and first/last TD (no weekly stat to rate them). Force with env `DEEP=true`, turn off with `DEEP=false`.
- **Players generator**: "All markets" dropdown-style checklist of every market by name (order from `Engine.MARKET_GROUPS`; none picked = all; saved as labels in GENS.ply.mk), Side: Both / Overs / Unders (`ENG.underLeg`, main lines only), Game dropdown (All games, Pick several games… with tiles, or one game + team), same as the Parlays generator. Under legs use key `P|id|u`; `sideRec()` flips records for unders.
- **Team history, every sport** (`teamhist.js` → `th` in each data.json: this season / last season straight-up, ATS and O/U, home/away, last 5, meetings with lines). NFL from nflverse games.csv; NBA and college from ESPN game summaries' pick center (closing DraftKings line). ESPN only keeps lines from about mid-Nov 2025 on, so last season is partial (the site says "lines for X of Y games"). NBA lines live in nba/logs.json `lines`; college in cfb/lines.json and cbb/lines.json (season scoreboards scanned once, summaries capped per run: `SCAN_MAX`, `LINES_MAX`). NBA leaves out preseason (`st` season type).
- **NBA player history**: logs cover all of 2025–26; each line has `since` (this season + last) and `vs` (this opponent). NFL lines also have `vs` now.
- **One story per leg** (`legStory()` / `storyHTML()` in index.html): The price · Recent form · Past seasons · Matchup · How we got the %, used by Build ⓘ, generator legs (`storyLine`), How we got this % and the one-line history on cards. Missing data says so. Games cards use `th` for this season's ATS/overs and last-5 on every sport. "How to read these cards" is per sport (`legendHTML()`) with a "Where the % comes from" line.
- **Header ⓘ** (was ?) opens the 8-slide tour (updated for everything above). **First open**: 21+ → "Set up ParlayLabs" (teams + betting apps, `setup1`) → tour. **My betting apps** (★ page, `localStorage.apps`, default all four): the slip shows an "Open in …" button per app, and "Show odds from" on the ★ page picks which app's prices the site uses (no picker in the header).
- **College = game lines only for now** (Andrew's call, Oct 31): moneylines, spreads, totals (+ 1H for NCAAB). Planned later: college player props (same markets as NFL / NBA) shown only where legal, using a phone-location check. Ready so far: `states.json` (simplified US state borders for an offline point-in-polygon check, built by tools/mkstates.js) and FanDuel's college rules: no college props in AZ CO LA MA MD MS NY OH PA TN VA VT WY; no props on in-state players in CT DC IA IL MO NJ WA; IN pre-game only; MI unrestricted. College basketball props: Andrew has a phone reminder for Jan 4, 2027. College football props: pick up next season or when asked.
- **Tags**: All green (every leg 70%+), Spread out (3+ legs, all different games), ⚑ Red flag (leg under 45%, injury or missed last game, rarely clears the line since 2023, poor history vs this opponent, two legs on one player, line moved 1.5+ points against, game started). Red-flag slips never get the Safest pick.

## Remaining history pull (do this when The Odds API credits reset)
Check credits first: run the backtest workflow in test mode (`-f "inputs[test]=true"`); its log (`backtest/raw/last-run.log`, committed by the workflow) shows "Credits left". Need about 26K free plus ~15K for the live site.
1. **Rest of 2023 props (57 games, ~4K credits):** just rerun the workflow with `inputs[test]=false` and `inputs[reserve]=15000`. `backtest/fetch.js` skips anything already saved, so it only fetches the missing 2023 games (and re-checks lines, which are already complete).
2. **2023 alt lines (~10K):** 2023 was pulled with main markets only (`MAIN` in fetch.js). Needs a small code change: an env like `ALT_ONLY=2023` that requests only the four `*_alternate` markets for games already in `props-2023` and merges their bookmaker markets into the saved events.
3. **Playoffs (~4K):** fetch.js and replay.js only use `game_type === "REG"`. Add WC/DIV/CON/SB games (separate files or a flag), and in replay.js take player history across the season boundary.
4. **College game lines, 5 seasons (~12K):** add sport `americanfootball_ncaaf` to fetch.js (lines only, keyed by kickoff time like NFL), plus a college replay that grades with ESPN scores (fetch scores on GitHub Actions; ESPN is blocked from the Claude container). Lower priority: Andrew mainly cares about NFL.
5. After pulling: `CALIB=1 node backtest/replay.js` locally (NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt), then `node picks.js` to refresh calibration, commit `backtest/*.json` + `calibration.json`, push, and send Andrew the new report card. Then tell him he can switch back to the $30 plan (set it to change at the next billing date).

## Site layout today (Oct 31, 2026)
- **Header:** sport tabs (each tap loads the newest version), logo row with ↻ (refreshes all four sports), ★ (teams per sport + My betting apps + Show odds from), ⓘ (8-slide tour). No odds picker in the header.
- **Tabs:** Parlays · Build · Players · Games · Results (college has no Players tab: game lines only).
- **Kickoff-time chips** on Parlays, Games, Build and Players: NFL Sun 1 PM / 4 PM / night…, college Sat Noon / 3:30 / Night, basketball each tip-off half hour; dates added past 5 days (`kickWin()`, `winChips()`).
- **Games tab order:** your ★ team if it plays within 5 days, else the game of the week (`topGame`); then kickoff windows in time order, inside each window college by highest AP ranking, NFL/NBA by best matchup (`gameScore`); started games next; games 5+ days out last (your team first). Cards open on the first card unless a team is picked (`TPICKED`).
- **Generators** (Parlays, Players, Games tabs; `GENS/genBox/genUI/genPool`): Legs, Style, (Bets: not in college), Game dropdown (All games / Pick several games… tiles / one game + team). Players generator adds All markets checklist and Overs / Unders / Both. Every game picker lists games in kickoff order (`byTimeRank`).
- **Build tab:** ranked board of every leg; tap a row to add or remove, ⓘ opens its story; live parlay summary at the top. College has no type filter; NBA has no TDs filter.
- **Slip:** one "Open in …" button per app in My betting apps; prices come from "Show odds from".
- Leg circle colors = chance to hit (green 70%+, yellow 50–69%, red <50%). Football = mowed-field theme, basketball = hardwood.

## Automations already running (don't duplicate)
- **Monday 7:35 AM ET email:** "ParlayLabs Monday review" scheduled task. Grades the weekend locally (no push, no credits), breaks results down by market, % bucket, price, situation, tags and closing line, and suggests model and site changes with "change now / watch / leave". Andrew brings the ones he wants to a chat.
- **Tuesday 1:13 PM ET email:** "ParlayLabs weekly report" scheduled task. Last week, season to date, this week's top parlays.
- **Nov 1, 2026, 9 AM ET:** reminder back into the Oct 30-31 chat to run the remaining history pull (steps in "Remaining history pull" above).
- **Phone reminders (Andrew's Reminders app):** Jan 4 college basketball props · Feb 16 drop to $30 (yearly) · Feb 22 March Madness mode · Mar 10 baseball decision · Jun 22 summer plan check (yearly) · Aug 25 back to $59 (yearly).
