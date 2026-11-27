# slice-it

> Classify says *what kind* of work this is; slice-it says *how it lands*. Before any `full` or `loop` task touches a file, the whole lifecycle arrives as one table — ticket, branch, worktree, PR, cleanup, verify — and waits for your answer.

## When this is the skill you need

1. **The task is bigger than a glance, and you want to approve its shape before it exists.** A `full` or `loop` classification triggers the proposal automatically (model-invoked): every ticket gets a branch, every parallel writer a worktree, every PR a place in the merge order, every merged unit a teardown. You answer approve, override, or skip — a skip is recorded, not argued with.
2. **You want small, reviewable PRs instead of one merged blob.** Blocked tickets stack on their blocker's branch so each PR's diff carries only its own work; independent tickets can run in parallel `git worktree`s on any harness.
3. **You keep finding zombie branches and stale worktrees.** The Cleanup column is declared at plan time, and the teardown contract runs through `pr-flow` post-merge — every removal re-verifies MERGED state at execution time, so plan-time approval is never a blank cheque for deletions.

## What it looks like

> **Proposal emitted, work not yet started:**
>
> | # | Ticket | Branch | Worktree | PR | Cleanup | Verify |
> |---|--------|--------|----------|----|---------|--------|
> | 1 | stack-select rule | `slice/x-01` | — (serial) | PR-1 → master | after PR-1 merges | `node scripts/x.test.mjs` |
> | 2 | skill file + mirrors | `slice/x-02` | `.trust/wt/x-02` | PR-2 → `slice/x-01` | after PR-2 merges | `node scripts/y.test.mjs` |
>
> *"Ticket 2 runs in parallel in its own worktree; both PRs land parent-first. Approve, override, or skip?"*

The table is serialized to `.trust/<slug>/plan.md` — a resume reads the file, never memory.

## Chaining

- Sits **before the chain** — after classify, before `breakpoint` on `loop`, before execution on `full`. Like classify, it is a routing decision, not a build stage.
- On `loop`, its slice list is **provisional**: `fork-it` produces the authoritative decomposition after the spec gate, and overrides the table wherever they disagree.
- On `full`, there is no fork-it stage — the table *is* the plan.
- Teardown executes inside **`pr-flow`** post-merge (`git worktree remove`, branch delete, ticket marked landed); `receipts` and `ship-log` close each ticket.

## Not for

- `fast` work — one glance-verifiable step needs no ceremony, and suggesting one is the noise this rule exists to prevent.
- Re-defining slice rules — vertical-slice discipline lives in `fork-it` and is cited, not duplicated.
