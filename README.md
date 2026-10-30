# Parlay Lab setup (about 10 minutes)
1. Create a free GitHub account and a new PUBLIC repo (example: parlay-lab).
2. Upload everything in this folder to it, keeping the .github/workflows folder.
3. Repo > Settings > Secrets and variables > Actions > New secret.
   Name: ODDS_API_KEY   Value: your NEW key from the-odds-api.com
4. Repo > Actions > "Refresh odds" > Run workflow. This creates odds.json.
5. Repo > Settings > Pages > Deploy from branch: main, folder: / (root).
6. Your site goes live at https://YOURNAME.github.io/parlay-lab/
The workflow refreshes odds 3 times a day. Edit the cron line in refresh.yml to change that.

## What each file does
- fetch-odds.js pulls game lines and player props from The Odds API (uses your ODDS_API_KEY secret).
- build-data.js adds free nflverse game history and player stats, plus Open-Meteo weather, and writes data.json.
- index.html is the site. It reads odds.json and data.json.
- engine.js builds the games, props and auto parlays. The site and the grader both use it.
- picks.js saves each auto parlay at FanDuel's price when its first game kicks off and grades it afterward ($10 per slip) into picks.json.
- gameday.js skips the paid odds pull on days without an NFL game.
- history.json remembers each game's opening line so the site can show line movement.

## Refresh schedule (Eastern time)
- Game days: 10 AM, 2 PM, 6 PM, plus 7 PM before night games.
- Sundays: hourly 9 AM-1 PM, then 3 PM and 6 PM.
- Tuesdays 9:30 AM for early-week lines.
- Each refresh costs about 155 Odds API credits (roughly 11,000-12,000 a month). If credits drop below about 550, props stop updating so game lines keep going.

## NBA page (./?nba)
- nba/fetch.js pulls NBA lines and props for games in the next 30 hours (about 60 credits on a typical night; days without games are free).
- nba/build.js gets box scores and injury reports from ESPN's public feed, caches them in nba/logs.json, and writes nba/data.json.
- picks.js with SPORT=nba records and grades NBA slips into nba/picks.json.
- Runs twice a day (10:30 AM and 4:30 PM ET) from .github/workflows/nba.yml.

## Report cards and learning
- picks.js also builds a report card for every game (ladder legs, straight over/under picks, anytime TDs) until kickoff, then grades it (cards.json).
- Every other rated prop and game line is graded too (gradebook.json -> graded-legs.json). calibration.json learns from all of them.

## Timer (Cloudflare Worker)
- GitHub's own schedule is unreliable, so cloudflare/worker.js runs every 5 minutes on Cloudflare and starts the GitHub refreshes at the times in schedule.json (US Eastern, handles daylight saving).
- Change times by editing schedule.json; the Worker reads it each time.
- GitHub's schedule stays on as a backup. Automatic runs skip if odds were pulled in the last 45 minutes, so the two never double-spend credits.
