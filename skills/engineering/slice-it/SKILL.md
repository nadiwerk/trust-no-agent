---
name: slice-it
description: Use when work classified `full` or `loop` is about to start — propose the split as a ticket/branch/worktree/PR/cleanup table and wait for approval before the first file changes.
---

# Slice It

Classify says *what kind* of work this is; slice-it says *how it lands*. Before any `full` or `loop` task touches a file, propose the whole lifecycle — every ticket gets a branch, every parallel writer a worktree, every PR a place in the merge order, and every merged unit a teardown — in one table, then wait for the user's answer. `fast` work is untouched: one glance-verifiable step needs no ceremony, and suggesting one is the noise this rule exists to prevent.

## Process

### 0. Preflight

Before the first slice is drafted, confirm the ground it stands on: `git status` clean (a dirty checkout makes every later diff untrustworthy — report the dirt, never build on it), the current branch at or behind the latest base (`git fetch` + compare, so slices are not planned against a stale merge target), and the tools the tickets will name actually present (`gh`, `node`, whatever the Verify column will call). Three checks, seconds each — a failed preflight is reported to the user, not worked around.

### 1. Draft the slices

Cut the work into **vertical slices** — the rules live in `fork-it` §vertical-slice-rules and are cited, not redefined: complete path through every layer, mergeable on its own, refactors never share a slice with behavior changes. A `full` task usually yields one slice; it splits when the engagement criteria say so (more than one file, a function boundary other code calls, a design choice). A `loop` task yields a **provisional** slice list — a hypothesis refined later, never the authoritative decomposition: that belongs to `fork-it` after the spec gate, and fork-it's output overrides this table wherever they disagree.

### 2. Emit the proposal table

Always the full-stack shape, even when it holds one row:

| # | Ticket | Branch | Worktree | PR | Cleanup | Undo | Verify |
|---|--------|--------|----------|----|---------|------|--------|
| 1 | <slice name> | `slice/<slug>-01` | — (serial) | PR-1 → `master` | after PR-1 merges | `git revert <sha>` | <exact command> |
| 2 | <slice name> | `slice/<slug>-02` | `.trust/wt/<slug>-02` | PR-2 → `slice/<slug>-01` | after PR-2 merges | `git worktree remove` + `git branch -D` | <exact command> |

Fill the columns by these rules:

- **Ticket** — the slice's one-line deliverable, phrased as behavior a reviewer can check.
- **Branch** — one branch per ticket, `slice/<slug>-NN`. `<slug>` is agent-generated and matches `[a-z0-9-]+` — it enters paths and branch names unquoted, so validate it before the first use. A ticket with a blocking edge branches from its **blocker's branch**, not the default branch; independent tickets all branch from the default branch. A PR built on another open PR targets that PR's branch, never the default branch — or its diff carries the other PR whole and review stops being possible.
- **Worktree** — only when two or more independent tickets execute in parallel by subagents: plain `git worktree add .trust/wt/<slug>-NN -b slice/<slug>-NN`, one worktree per parallel writer, on any harness. Serial work runs in the coordinating checkout — a worktree per serial ticket is overhead with no isolation to show for it.
- **PR** — the merge sequence: which PR lands first, which targets a stacked parent. Independent PRs merge in any order; stacked PRs land parent-first.
- **Cleanup** — the teardown trigger per ticket (see below).
- **Undo** — the retreat command per ticket: `git revert <sha>` for a landed commit, `git worktree remove` + `git branch -D` for unmerged resources, "close the PR" for an unmerged review. Cleanup is the scheduled end; Undo is the emergency exit — naming it at plan time forces the retreat to be thought through before the advance.
- **Verify** — the exact command whose output settles the ticket, never "run the tests".

State each ticket's **execution mode in plain language** under the table ("tickets 2 and 3 run in parallel in separate worktrees; ticket 4 starts after PR-1 merges") — approving the plan must require no knowledge of worktree mechanics.

### 3. Serialize, then wait

Write the table to `.trust/<slug>/plan.md` — the proposal is a pause-state artifact: a resume reads the file, never memory. Then ask the user: **approve, override, or skip**. A skip or an override is recorded in the receipt, not argued with — this skill proposes; it never gates. Execution past this point without an answer is the Iron-Law-1 violation this skill exists to prevent.

### 4. Run the tickets

Each ticket executes with the discipline of its class: failing test first where a seam exists (`expect-fail`), verification before any done claim (`receipts`), per-ticket review via `roast-my-code`, ledger entry via `ship-log`. The frontier is any ticket whose blockers have landed.

### 5. Teardown — the lifecycle's other half

Every row's Cleanup column names when its resources die: **after the PR merges**. The mechanics run through `pr-flow` post-merge — this skill owns the mapping, so it owns the unmapping; `pr-flow` owns knowing the merge happened:

Plan-time approval names the rows; it is not a blank cheque for deletions — every removal re-verifies at execution time:

1. Verify the merge actually happened — `gh pr view <n> --json state,mergeCommit` shows MERGED (the `pr-flow` terminal-state check, not the merge command's exit code). A plan row naming a retargeted or closed-unmerged PR produces no teardown.
2. `git worktree remove .trust/wt/<slug>-NN` — only for tickets that had one, and only when the worktree is clean; `git worktree list` confirms none remain.
3. `git branch -d slice/<slug>-NN` — merged branch deleted locally; `-d` refuses an unmerged branch, which is the check doing its job. Squash-merged branches carry no merge ancestry, so `-d` refuses them too — after step 1 verified MERGED, `git branch -D` is the sanctioned variant; never `-D` without that verification.
4. The remote branch dies with the merge (squash-merge deletes it, or the PR's delete-branch action).
5. The ticket is marked landed in `.trust/<slug>/issues/` (or the tracker) and the ledger gets its entry — per ticket, not per feature.

A `git worktree list` showing a stale `.trust/wt/` entry, or `git branch` showing a merged `slice/` branch, is a teardown debt — report it, don't silently inherit it.

## Rationalization table

| Excuse | Reality |
|---|---|
| "Small task, skip the table" | `full` is already the middle class — the table can hold one row; the skipped proposal is the merged blob the user asked to never see again |
| "I'll mention the split after I've started" | A proposal made mid-work reviews a sunk cost, not a plan |
| "Worktrees for everything, safer" | Isolation without parallelism is overhead; serial work stays in the coordinating checkout |
| "Stacked PRs are complicated — one big PR" | One big PR is the unreviewable diff this skill exists to prevent; stacking is one extra flag on the base |
| "Cleanup can wait until someone notices" | Zombie worktrees and merged branches are invisible debt; the Cleanup column makes them visible at plan time |
