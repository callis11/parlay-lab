// Safety check before the bots commit data files (Nov 16, 2026, after the Nov 13 and Nov 15 wipes).
//   node tools/check-json.js file1.json file2.json ...
// Fails (exit 1) when a file:
//   - has git conflict markers (<<<<<<< / >>>>>>>) or doesn't parse as JSON
//   - is a picks.json that lost a big share of its slips compared with origin/main (graded slips are never deleted,
//     so a big drop means the file was rebuilt from empty)
const fs = require("fs"), cp = require("child_process");
let bad = 0;
const fail = (f, why) => { console.log("::error file=" + f + "::" + f + ": " + why); bad++; };
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  if (/^(<<<<<<<|>>>>>>>) /m.test(t)) { fail(f, "has git conflict markers"); continue; }
  let j; try { j = JSON.parse(t); } catch (e) { fail(f, "is not valid JSON (" + e.message + ")"); continue; }
  if (/(^|\/)picks\.json$/.test(f) && j && j.slips) {
    let before = null;
    try { before = Object.keys(JSON.parse(cp.execSync("git show origin/main:" + f, { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString()).slips || {}).length; } catch (e) {}
    const now = Object.keys(j.slips).length;
    if (before !== null && before >= 40 && now < before * 0.75) fail(f, "slips dropped from " + before + " to " + now + " (looks like it was rebuilt from empty)");
  }
}
if (bad) { console.log(bad + " file(s) failed the check; nothing committed."); process.exit(1); }
console.log("JSON check ok:", process.argv.length - 2, "file(s)");
