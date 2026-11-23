---
name: pr-flow
description: "Use when creating, reviewing, commenting on, or merging a pull request — the PR lifecycle contract: right base, problem-first body, review discipline, ordered verified merges."
---

# PR Flow

The pull-request lifecycle in one contract: **open**, **review**, **watch**, **merge**. Watching has a tested tool — `scripts/pr-wait.mjs`; delivery claims close per `receipts` §Delivery claims; risky diffs go through `roast-my-code` before merge, not after.

## Open — filing a PR

1. **Check for an existing PR first** — `gh pr list --head <branch>` before `gh pr create`. A second PR for the same head splits review history in two.
2. **Base correctness.** Default base is the repo's default branch; a PR stacked on another open PR targets that PR's branch. Measured incident: the default base on a stacked PR made the diff carry ~20 commits of another PR whole — review impossible, the PR stranded. After create, verify `gh pr diff <n> --name-only` lists only this branch's files.
3. **Title says why, body says problem-first.** The title names the reason the change exists (not "update files"); the body leads with the problem + evidence, links the ticket, lists the test plan as a checklist — never a raw commit dump.
4. **Secrets scan before push** — diff the changeset for keys, tokens, `.env` content. A secret pushed is a secret to rotate.
5. **Draft vs ready.** Open as draft while checks are pending or the body isn't review-ready; mark ready only when a reviewer could act on it today.
6. **Attribution** — note the harness/agent in the body where the project convention asks (multi-harness repos audit quality per harness; an unattributed PR is an unmeasurable one).

## Review — leaving comments

- **One issue per comment**, anchored to file + line. A comment that can't point at a line is a discussion, not a review.
- **Severity prefix on every comment** — `blocker:` / `nit:` / `question:` — so the author triages without re-reading. Aligns with `roast-my-code`'s closed severity set.
- **On your own PR**: every review comment gets a reply or a resolve-with-reason. Silence on a comment is an open question, not agreement.
- **Review against the project's standards; where none are documented, the default floor is `roast-my-code/engineering-floor.md`** — boundaries, minimal diff, reader load, domain modeling, comments that earn their place.
- **Big-diff duty**: a PR too large to review is sent back for re-slicing, never rubber-stamped — `fork-it`'s mergeable-slice rule means reviewers may reject on size alone.

## Watch — while the PR is open

Never write an ad-hoc polling loop. `node scripts/pr-wait.mjs <pr> [--repo o/n] [--until green|any-change]` waits and exits on a declared terminal event — green, failed, conflict, closed, merged, or timeout. An empty check rollup is *not-started*, never green; a watcher that cannot observe failure is a dead gate (`receipts` §Delivery claims — measured: a monitor died silently 30 minutes on a missing parser binary; another read 0 checks as "done").

## Merge — single or batch

Preconditions, all of them, per PR:

- **Reviewed** — a human verdict or a `roast-my-code` verdict on record. Risky/high-blast-radius changes get the three-axis review before merge, not after.
- **Checks green by terminal state** — `gh pr checks` shows ≥1 check and none pending. Never inferred from "CI ran".
- **No unresolved review comments.**

Then:

- **Stack order**: merge bottom-up — a stacked PR merges only after its base PR lands; rebase the next PR in the stack before merging it so each diff stays reviewable.
- **Verify the terminal state after** — `gh pr view <n> --json state,mergeCommit` shows MERGED + the merge SHA. `gh pr merge`'s own exit code is not proof: its local fast-forward step errors AFTER the remote merge already succeeded (measured false-fail — the "failed" merge had landed).
- **Merge authority**: where project convention reserves the merge for the owner, pr-flow prepares — green, reviewed, ordered — and hands the merge call back. Never merges itself (Iron Law: the model proposes, the user approves).

## Ledger & receipt

A PR event is a unit of work — `ship-log` entry on merge or on handoff. Delivery claims (merged, deployed) follow `receipts` §Delivery claims: terminal-state proof for the merge, and a post-deploy probe for UI/public-route changes — deploy success ≠ feature works.
