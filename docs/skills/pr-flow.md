# pr-flow

> The pull-request lifecycle in one contract: **open**, **review**, **watch**, **merge** — each phase verified, never inferred.

## When this is the skill you need

1. **You're about to open a PR.** The contract: check for an existing PR on the head first, verify the base (a stacked PR targets its parent branch — a wrong base once made a diff carry ~20 commits of another PR whole), title says *why*, body leads with the problem + test plan, secrets scanned, draft until review-ready.
2. **You're reviewing or being reviewed.** One issue per comment anchored to file+line, severity-prefixed (`blocker:` / `nit:` / `question:`); on your own PR every comment gets a reply or a resolve-with-reason. A too-large PR goes back for re-slicing — never rubber-stamped.
3. **You're waiting on checks or about to merge.** Watching runs through the tested watcher (`scripts/pr-wait.mjs`), never an ad-hoc polling loop — an empty check rollup is not-started, never green. Merge preconditions: reviewed + green-by-terminal-state + no unresolved comments; stacks merge bottom-up; the post-merge proof is `gh pr view --json state,mergeCommit` — `gh pr merge`'s exit code is not evidence (measured false-fail: the "failed" merge had already landed).

## What it looks like

> **Before `gh pr create`:** `gh pr list --head feat/x` → clean; branch stacks on PR #64 → `--base feat/base-branch`, not master; `gh pr diff` shows only this branch's 4 files.
> **While open:** `node scripts/pr-wait.mjs 71 --until green` → `pr-wait: checks-green — 3 check(s) green`, exit 0.
> **Merge:** reviewed ✓, green ✓, comments resolved ✓ → merge, then `gh pr view 71 --json state` → `MERGED` + sha — terminal state, not the command's exit code.

## Chaining

- **Slice-level**: `fork-it` produces mergeable slices; pr-flow is how each slice lands.
- **Risk gate**: high-blast-radius diffs pass `roast-my-code` before merge.
- **Claims gate**: merge/deploy claims close per `receipts` §Delivery claims — including the post-deploy probe for UI/public routes.
- **Memory**: `ship-log` entry on merge or handoff — a PR event is a unit of work.

## Not for

- Code review of a diff itself — that's `roast-my-code`.
- Writing the code — pr-flow begins when a branch is ready to become a PR.
