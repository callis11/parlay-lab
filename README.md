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
