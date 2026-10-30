// Prints play=true if there's an NFL game today (Eastern time), using the free nflverse schedule.
// The refresh workflow skips the paid odds pull on days without games.
const fs = require("fs");
(async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD
  let play = true; // if the schedule can't be read, refresh anyway
  try {
    const res = await fetch("https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv");
    if (!res.ok) throw new Error(res.status);
    const lines = (await res.text()).split("\n");
    const col = lines[0].split(",").indexOf("gameday");
    play = lines.some(l => l.split(",")[col] === today);
  } catch (e) { console.warn("Schedule check failed, refreshing anyway:", e.message); }
  if (process.env.FORCE === "true") play = true;
  // Automatic runs skip if odds were pulled recently, so the two timers never pay for the same refresh twice.
  // Cloudflare timer: 12 minutes (Sunday runs can be 15-20 minutes apart). GitHub backup cron: 60 minutes (it often fires late).
  if (play && process.env.AUTO_GUARD === "true") {
    try { const last = JSON.parse(fs.readFileSync("odds.json", "utf8")).fetchedAt; if (Date.now() - new Date(last) < (+process.env.GUARD_MIN || 45) * 60e3) { play = false; console.log("Odds already pulled at", last, "- skipping"); } } catch (e) {}
  }
  console.log(today, play ? "game day: refreshing" : "no games today: skipping");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `play=${play}\n`);
})();
