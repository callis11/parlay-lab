# Parlay Lab setup (about 10 minutes)
1. Create a free GitHub account and a new PUBLIC repo (example: parlay-lab).
2. Upload everything in this folder to it, keeping the .github/workflows folder.
3. Repo > Settings > Secrets and variables > Actions > New secret.
   Name: ODDS_API_KEY   Value: your NEW key from the-odds-api.com
4. Repo > Actions > "Refresh odds" > Run workflow. This creates odds.json.
5. Repo > Settings > Pages > Deploy from branch: main, folder: / (root).
6. Your site goes live at https://YOURNAME.github.io/parlay-lab/
The workflow refreshes odds 3 times a day. Edit the cron line in refresh.yml to change that.
