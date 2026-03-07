#!/usr/bin/env bash
set -euo pipefail

# Guard for recovered branches:
# require merge-base(branch, origin/master) == origin/master
# so carry-over branches are rebuilt from origin/master + task commit only.

target_ref="${1:-HEAD}"

git fetch --quiet origin master

origin_master="$(git rev-parse origin/master)"
target_sha="$(git rev-parse "${target_ref}")"
merge_base="$(git merge-base "${target_sha}" "${origin_master}")"

echo "target=${target_ref} (${target_sha})"
echo "origin/master=${origin_master}"
echo "merge-base=${merge_base}"

if [[ "${merge_base}" != "${origin_master}" ]]; then
  cat <<'EOF'
FAIL: recovered branch is not based directly on origin/master.
Rebuild branch as:
  git switch --detach origin/master
  git switch -c <recovered-branch>
  git cherry-pick <task-commit>
  git push --force-with-lease origin HEAD:<recovered-branch>
EOF
  exit 1
fi

echo "PASS: recovered branch base is origin/master."
