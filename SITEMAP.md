# ParlayLabs site map (for AIs and new chats)

What every screen, button, word and number on ParlayLabs is, so an AI can review or work on the site without tapping through it. Written Nov 1, 2026 from a phone-size (390×844) walk-through of all four sports. For code details, see HANDOFF.md.

**Site:** https://callis11.github.io/parlay-lab/ (NFL). Other sports: add `?nba`, `?cfb` (college football), `?cbb` (men's college basketball).
**Used as:** an iPhone home-screen app. One page (`index.html`). Nothing is bet or paid on the site.
**Owner can send screenshots:** if something here doesn't match the phone, ask Andrew for a screenshot instead of guessing.

## Reading the page as text (important for AIs)
Pages read as text glue small pieces together, which can make numbers look wrong. On the phone they are separate badges:
- `Spread DET -3 0.5 → MIN opened DET -3.5` = spread is Lions −3, a badge says the line moved 0.5 toward the Vikings, and it opened at −3.5. It is **not** −30.5.
- `52%to hit · adj. from 57%` = big "52%" then small "to hit".
- `All games15`, `Sun 1 PM8` = a chip and its game count (15, 8).
- Leg circles show icons (TD, S for spread, ML, O/U), which read as stray letters like "TD TD S S".
- Some content only loads after a tap (cards open with "Tap to open", stories open with ⓘ), so a text scan misses it.

## Words and numbers used on the site
| On screen | Means |
|---|---|
| **ML** (moneyline) | Pick who wins the game, by any score. Kept as "ML" on purpose (Andrew's call); explained in the tour and card guide. |
| **Spread** (−3.5 / +3.5) | Favorite must win by more than the number; underdog can lose by less and still win the bet. |
| **Over / Under (O/U)** | Total points scored by both teams vs the number. |
| **−138** | Favorite price: risk more than you win ($10 wins $7.25). |
| **+110** | Underdog price: win more than you risk ($10 wins $11). |
| **Pick** | One bet inside a parlay. Betting apps call it a **leg**; the site says "pick" on screen (saved data still says "leg"). |
| **Parlay / slip** | 2+ picks in one bet. Every pick must win. |
| **% to hit** | ParlayLabs' own estimate that every pick wins (not the sportsbook's). Under 1% shows as "1 in N". |
| **adj. from 57%** | Picks multiplied together gave 57%; corrected using how that kind of parlay really hit in past seasons. |
| **The app's price says about X%** (slip) | 1 ÷ payout: the sportsbook's own chance, with its cut built in. |
| **$10 wins $X** | Profit on a $10 bet at that price. All site results use $10 bets. |
| **Prop / player prop** | A bet on one player's stats (e.g. "Rome Odunze 10+ receiving yds"). NFL and NBA only. |
| **Alt line** | A different number than the main line for the same stat (e.g. 50+ yards instead of 64.5). |
| **ATS** | Against the spread: how often a team covered. "4–2 ATS · overs 1–5" = covered 4 of 6, games went over 1 of 6. |
| **1H** | First half (college basketball only). |
| **Closing line** | The last price before kickoff. "Beating the closing line" = the price moved toward our pick after we posted it. |
| **Books expected** | How many picks the sportsbooks' own prices said should hit. |

### Tags and colors
- **ALL GREEN** every pick 70%+. **SPREAD OUT** 3+ picks, all from different games. **⚑ RED FLAG** something to check (pick under 45%, injury report or missed last game, two picks on one player, line moved 1.5+ against, game started). **ⓘ Heads up** (grey box inside the card, no tag): a pick we rate 80%+ that the player rarely cleared in past seasons, or a poor record vs this opponent.
- **PROVEN** (NFL) this parlay type made money over 40+ replayed slips (2023–25). **WEAK HISTORY** lost 20%+; kept out of the top 3.
- **Safest · Best value · Big payout** = the top 3 cards per slate.
- Pick circles: green 70%+, yellow 50–69%, red under 50%.
- Parlay % (cards, generator, Build, slip): green 45%+, yellow 20–44%, red under 20%, with words underneath ("about a coin flip", "hits about 1 time in 5").
- Under each game card's spread: "DET must win by 4+ · MIN can lose by 3 or less (or win)". Every pick story starts with a one-line "Why 77%: …" summary.
- Theme: football = mowed-field green, basketball = hardwood brown.

## Header (every sport)
- **Sport tabs:** NFL · NBA · NCAAF · NCAAB.
- **↻** reloads the newest version and odds (tell Andrew to tap it after a change).
- **★ My teams:** favorite team per sport (defaults Lions, Pistons, Michigan State), **My betting apps** (FanDuel, DraftKings, BetMGM, BetRivers) and **Show odds from** (which app's prices the site uses). Saved on the phone only.
- **ⓘ** opens the 9-slide tour: Welcome · Reading the odds · Parlays tab · Why trust the %? · Players tab · Games tab · Build tab · Your slip and Results · Your teams and apps.
- First open: 21+ check → "Set up ParlayLabs" (teams + apps) → tour.

## Tabs
College (NCAAF, NCAAB) has no **Players** tab: game lines only (ML, spread, total; NCAAB also first half). NFL and NBA have all five tabs.

### Parlays
- **⚡ ParlayLabs Generator** (tap "Open"): Picks 2 3 4 5 or **6+** (up to 15) · Style **Safe / Balanced / Long shot** · Bets **Both / Players / Game lines** (not in college) · Game (All games, Pick several games…, or one game). **Generate a parlay** builds one and explains every pick; **Generate another** gives the next best. Each pick has **⇄ Change** (same as on the slip); the card then says you changed it and shows your version's % and payout. If the style can't build, a yellow ↪ note says what it switched to and why.
- **Slate chips:** Best of Week, each kickoff window (e.g. Sun 1 PM, Sun 4 PM, Sun Night, Mon Night; college Sat Noon / 3:30 / Night; basketball each tip-off half hour), and your ★ team's game. Started games are never in any parlay.
- **Top 3 / Show all · Expand all · Any picks / 2–3 / 4+ · All types / Player props / Game lines / Mixed.**
- **Card:** tags (own line), style · N picks · props/lines, big %, "hits about 1 time in N" + break-even, name (e.g. Best 2-Pick, Best Shot at +300, TDs + Spreads), pick circles, price, "$10 wins $X", this season / past seasons record for this type, **ⓘ How we got this %** (flips to the step-by-step math), **⇄ Change** on each pick inside an opened card (kept on the phone; "Undo changes" goes back to ours), **Load slip**.
- **How to read these cards:** Reading the numbers, % to hit, where the % comes from, tags, same-game adjustment, circle colors.

### Build
**Top list** (default): one scrolling screen, one line per pick (name, team, line, price, %), by kickoff window: Most likely player picks (top 30), Best single bets (top 10), Anytime TD (top 10), Teams to win (ML) (top 10); college without props shows Teams to win + Spreads. **Full board**: the old ranked list with filters.
Every available pick ranked (Most likely first / Biggest payout first), filters by kickoff window and game, type **All / Players / TDs / Game lines** (NBA no TDs; college no type filter). Tap a row to add or remove; **ⓘ** opens the pick's story: The price · Recent form · Past seasons · Matchup · How we got the %. A live parlay summary sits at the top.

### Players (NFL, NBA)
Players-only generator (adds an **All markets** checklist and **Both / Overs / Unders**), then a list of player props by game and market, sorted by Most likely to hit / Best price vs our estimate / Player name. Shows hit rates like "Hit 8 of last 10".

### Games
Filters: kickoff window chips, division/conference, team (★ team's game first). Each game card: kickoff countdown, teams, **chance to win** bar (from the moneyline), spread (with line-move badge and opening line), O/U, this season and since-2021 ATS / overs, which app's line, **Game stats ⟳**, tappable lines (ML, spread, total) that add to the slip, and a game generator (pick a team or Both, **+ Add other games**).

### Results
- **Weekly report card** (‹ › pages weeks): record, profit at $10 each, picks hit, what we said vs reality, toughest miss ("one pick away"), best type, report cards, **Share image**.
- **My bets** (this phone only): **🔄 Check scores** pulls live and final scores (and player stats for props) from ESPN on the phone; live picks show "🔴 3rd 8:12 · MIN 10 – DET 17" and prop progress; rechecks every 2 min while a game is live and Results is open. **📷 Add bets from a screenshot** of FanDuel My Bets or a DraftKings receipt (read on the phone), **📋 Paste screenshot**, paste text, or **Add bets from a code**. Picks grade themselves from final scores and box scores.
- **How our picks did:** every auto-built slip, locked at FanDuel's price at first kickoff, graded later; individual pick hit rates.
- **FanDuel vs DraftKings:** the same picks at both apps: who paid more, $10 on each pick and each parlay at each app's price, by bet type.
- **Beating the closing line**, **Game report cards** (Safe picks / Straights / Anytime TD vs books expected), **By section**, **What's working** (each bet type: hit %, what we said, how we adjust).
- **Estimate vs reality:** graded picks by % bucket.

## Slip (bar at the bottom, every tab)
- Closed: "Your slip is empty · tap to see how it works", or "2 picks · $10 wins $14.66 · tap to view" with the parlay price (e.g. +147).
- Empty and open: "New to parlays?" explainer.
- With picks: each pick with price and "$10 wins $X alone", **⇄ Change** (swap to another line for the same player: easier/harder number, the under, another stat; or another bet on the same game: ML, spread, over/under; shows your pick plus the 5 closest options, "Show all N options" for the rest, each with its own % and the parlay's new % and price), Remove, per-app link; **How to place it** (the site never takes bets or money); **Open in FanDuel / DraftKings…** (opens the app with the same picks); our % vs the app's %; payout on your stake; warnings (every pick must win; same-game picks priced differently by the app); Stake, **Clear slip**, **I placed this bet** (📋 Paste receipt / 📷 Pick receipt), **Save to My bets** (clears the slip after), **✕ Close slip**. After **Open in …**, coming back asks "Did you place this bet?" (save it / clear slip / keep), and adding a pick to a slip already sent to an app asks "Start a new slip?"; the bar shows "Sent to FanDuel · N picks".

## Differences between sports (intended)
- College: no Players tab, no Bets (Both/Players/Game lines) control, no TDs filter; AP ranks shown (#10 Alabama); conference filter instead of division.
- NCAAB: first-half lines (1H).
- NBA: no TDs filter.
- NCAAB Results has no Share image button (noticed Nov 1; check whether intended).
- Some college basketball games show odd early-morning times (e.g. "Mon 2:00 AM", neutral site). Check before calling it a bug.

## Where the numbers come from (one paragraph)
Prices: The Odds API (FanDuel by default). Player history: nflverse (NFL), ESPN (NBA, college). Per pick: recent hit rate blended with the book's no-vig price, adjusted for opponent and weather, calibrated from graded picks (live + about 154,000 replayed 2023–25 NFL picks). Parlay % = picks multiplied, corrected for same-game pairs and for how parlays of that size really hit. Full detail in HANDOFF.md ("Model in one paragraph").

## Asking another AI to review
Give it this file plus the site link, ask it to use the site on a phone-size screen, and tell it the page's text glues badges together (see the top section). Andrew can attach screenshots of any screen.
