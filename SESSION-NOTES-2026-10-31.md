# ParlayLabs: session notes, Oct 31, 2026

Give this file to a new chat along with HANDOFF.md in github.com/callis11/parlay-lab (start with the START HERE section there).

## What ParlayLabs is for
- For people who **don't follow sports closely** but still want to make good parlay decisions and build their own. It replaces "knowing the games" with **data, history and plain-English reasons**.
- Also for people who **do** follow sports: the best results possible, deep stats, and room to go big on small-stake long shots (like a friend who loves 15-leg parlays).
- Open, honest, understandable. More stats and more "here's why" is better. Andrew will spend money on data to get there.
- LadderUp (a buddy's site) is for people who already know the games. Never copy its name, wording or branding.

## Top rule (every sport)
A parlay for a later game must **never include an earlier game that has started and might lose** (example: Ohio State down 30 in the 4th should never be in the 10 PM parlay).
- **Now:** started games are always left out of every parlay, generator, Build and Players list. The page refreshes itself at each kickoff.
- **After live odds are built:** a started game can stay only if it's still very likely to win. Use the **lowest** chance from ESPN's live win %, Kalshi's live market %, and the live odds, and it must clear the same bar as any leg in that style (Safe 60%+, Balanced 45%+, Long shot 25%+). A team losing big never qualifies.

## Built tonight (all live on the site)
1. **Generator auto-switch:** if the chosen style can't build a parlay, it switches style (Safe → Balanced → Long shot) or uses fewer legs, and the card shows a yellow ↪ note saying what changed and why. All 3 generators, all sports.
2. **Bet screenshots (Results → My bets):** pick or paste a screenshot of a FanDuel "My Bets" page or a DraftKings receipt. The site reads the app, odds, wager, payout, legs, bet ID (no duplicates) and placed time on the phone, for free. You check it, then save. Legs only match games at the right date and kickoff time, so there are no cross-sport mix-ups.
3. **Receipt in the slip:** "I placed this bet" has 📋 Paste receipt / 📷 Pick receipt to fill in the app, odds and wager. The slip's own legs are kept.
4. **Bets grade themselves:** after games end, the site saves final scores and player stats (`finals.json`), and My bets marks each leg ✓/✗ and the bet Won/Lost automatically. Mark won/lost buttons still work.
5. **No started games in parlays** (see Top rule).
6. **Slip:** ✕ Close slip button. Clear slip and removing the last leg close it. The bar says "tap to close" when the open slip is empty.
7. **Big parlays:** generators go up to **15 legs** (2 3 4 5 + "6+" picker). Chances under 1% show as "1 in N" (never 0%), and big payouts get commas. Example (NFL Sunday, 15 legs): Safe +1290 / 5%, Balanced +3648 / 2%, Long shot +408,708 / 1 in 3,400.

## Decisions
- **College football player props:** wait until Odds API credits reset, then build them (Michigan State + ranked games, about 1K credits for the rest of the season).
- **Share links (FanDuel "addToBetslip?shareCode=")** can't be read from outside FanDuel's app. Use screenshots instead.
- **Credits:** Andrew would rather spend credits to get the best, most up-to-date options, and also wants free sources used wherever they help.

## Next steps, in order
1. **History pull** when credits reset (Nov 1). A reminder was set for 9 AM in the earlier Oct 30–31 chat; if it doesn't fire, ask the new chat to "run the history pull".
2. **Live odds for in-progress games:**
   - Free first: **ESPN** (live score, clock, win %), **Kalshi** public market data (live win %, spreads, totals; no key), and a test of the **SharpAPI free tier** (vendor says 12 req/min, 2 sportsbooks, live odds) for live FanDuel/DraftKings prices.
   - Odds API live pulls every 5 min as backup: 3 credits per sport per pull, all games in one call. About 1,100 a week / 4,700 a month in football season (plan is 100K, normal use about 15K).
   - Show 🔴 LIVE · score · quarter · win % on live legs and Games cards.
3. **Beginner review + other-AI cross-check** (new chat): a fresh reviewer that hasn't seen the site uses it as a beginner on a phone-size screen; check that everything matches across all 4 sports and tabs; test that no parlay ever includes a started game; fold in the other AI's suggestions; fix things one at a time.
4. **Double-up planner + My usual bet:**
   - **My usual bet:** each person picks their usual stake ($1 to $100 or custom). All "wins $X" amounts use it. Results keeps grading the site's picks at $10.
   - **Double-up planner:** budget + number of bets (e.g. $100 in 10 bets) → 10 separate ~+100 parlays on different games, with honest odds for the whole plan. With ten $10 bets at 47% each: 31% chance to come out ahead, 24% break even, 23% lose most; the average is about $94 back either way. Spreading out makes results steadier; it doesn't raise the average. One $100 bet is 47% double / 53% lose it all.
5. **Ideas:** a Long shot / Lottery mode with the best long-shot value per $1; "missed by 1 leg" stats on Results for big parlays.

## Already scheduled
- Monday 7:35 AM ET email: weekend review. Tuesday 1:13 PM ET email: weekly report.
- Phone reminders: Jan 4 college basketball props · Feb 16 drop to $30 · Feb 22 March Madness mode · Mar 10 baseball decision · Jun 22 summer plan · Aug 25 back to $59.

## Links
- Site: https://callis11.github.io/parlay-lab/ (add `?nba`, `?cfb`, `?cbb` for the other sports)
- Repo: https://github.com/callis11/parlay-lab (HANDOFF.md has the technical details)

## Question set for other AIs (Andrew is sending this out)
"Please review my sports betting parlay website as if you were a complete beginner who doesn't understand parlays, odds, or spreads: https://callis11.github.io/parlay-lab/ (also ?nba, ?cfb, ?cbb). It's used mainly as an iPhone home-screen app. Tell me: 1) what confused you in the first 2 minutes, and which words or numbers you didn't understand; 2) whether it's clear what to tap first and how to go from picking a parlay to placing it; 3) what a beginner needs explained, and where; 4) whether the odds and percentages feel honest and easy to trust; 5) your top 10 changes ranked by impact for beginners, with a reason for each. Be blunt and specific. Don't suggest copying other betting sites."

## Message to start the new chat
"Let's keep working on ParlayLabs. Read HANDOFF.md in my repo callis11/parlay-lab, start with the START HERE section, and read SESSION-NOTES-2026-10-31.md. Here's what the other AI said about my site: [paste it here]"
