#!/usr/bin/env bash
# Commit and push the bots' data files without ever committing a broken file (Nov 16, 2026).
#   bash tools/safe-commit.sh "Commit message" file1.json 'nba/*.json' ...
# Old way: `git pull --rebase --autostash origin main || true`, then `git add` + commit. When the autostash conflicted,
# `|| true` hid it and files with <<<<<<< markers were committed; the next run read picks.json as empty and wiped the
# saved slips (NBA Nov 13, NFL Nov 15). Now: check, commit, rebase onto main, check again, push. On a conflict the run
# stops and pushes nothing (the next scheduled run redoes the work: grading is repeatable).
set -euo pipefail
msg="$1"; shift
shopt -s nullglob
files=()
for pat in "$@"; do for f in $pat; do files+=("$f"); done; done
[ ${#files[@]} -eq 0 ] && { echo "no files to commit"; exit 0; }
git config user.name "odds-bot"
git config user.email "odds-bot@users.noreply.github.com"
git fetch -q origin main
node tools/check-json.js "${files[@]}"
git add -- "${files[@]}"
if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
git commit -q -m "$msg"
git reset -q --hard HEAD   # drop changes this run didn't mean to commit, so the rebase needs no autostash
for i in 1 2 3; do
  if git pull -q --rebase origin main; then
    node tools/check-json.js "${files[@]}"
    if git push -q origin HEAD:main; then echo "pushed"; exit 0; fi
  else
    git rebase --abort 2>/dev/null || true
    echo "::error::Another run changed the same data files; stopped without pushing (no conflict markers committed)."
    exit 1
  fi
  sleep $((i * 5))
done
echo "::error::Push failed 3 times; nothing pushed."
exit 1
