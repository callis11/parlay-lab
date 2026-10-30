// Parlay Lab timer (Cloudflare Worker)
// Every 5 minutes it reads schedule.json from the GitHub repo and, when a scheduled time (US Eastern) matches,
// tells GitHub to start that refresh. Times live in schedule.json, so they can change without touching this code.
//
// Setup in Cloudflare:
//   1. Paste this file as the Worker's code and deploy.
//   2. Settings > Variables and Secrets: add a Secret named GH_TOKEN (a GitHub fine-grained token for
//      callis11/parlay-lab with "Actions: Read and write").
//   3. Settings > Trigger Events: add a Cron Trigger "*/5 * * * *".
// Check it: open the Worker's URL + /check in a browser.

const REPO = "callis11/parlay-lab";
const SCHEDULE_URL = `https://raw.githubusercontent.com/${REPO}/main/schedule.json`;

function easternNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const min = Math.floor(+parts.minute / 5) * 5; // round down to this 5-minute slot
  return { day: parts.weekday, time: `${parts.hour}:${String(min).padStart(2, "0")}` };
}

async function loadSchedule() {
  const r = await fetch(SCHEDULE_URL + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error("schedule.json " + r.status);
  return r.json();
}

async function dispatch(env, workflow, inputs) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "parlay-lab-timer"
    },
    body: JSON.stringify({ ref: "main", inputs: inputs || {} })
  });
  return r.status === 204 ? "started" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
}

async function tick(env) {
  const s = await loadSchedule();
  const now = easternNow(s.timezone || "America/New_York");
  const due = (s.jobs || []).filter(j => j.days.includes(now.day) && j.times.includes(now.time));
  const results = [];
  for (const j of due) results.push(`${j.workflow}: ${await dispatch(env, j.workflow, j.inputs)}`);
  return { now, results };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).then(r => console.log(JSON.stringify(r))).catch(e => console.log("timer error: " + e.message)));
  },
  // Visit the Worker's URL to see status; /check also tests the GitHub token without starting anything.
  async fetch(request, env) {
    const url = new URL(request.url);
    const out = {};
    try {
      const s = await loadSchedule();
      out.easternNow = easternNow(s.timezone || "America/New_York");
      out.jobsToday = s.jobs.filter(j => j.days.includes(out.easternNow.day)).map(j => `${j.workflow} at ${j.times.join(", ")}`);
    } catch (e) { out.scheduleError = e.message; }
    if (url.pathname === "/check") {
      if (!env.GH_TOKEN) out.token = "missing: add the GH_TOKEN secret";
      else {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, {
          headers: { "Authorization": `Bearer ${env.GH_TOKEN}`, "Accept": "application/vnd.github+json", "User-Agent": "parlay-lab-timer" }
        });
        out.token = r.ok ? "works" : `GitHub said ${r.status}. Check the token's repo access and Actions permission.`;
      }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json" } });
  }
};
