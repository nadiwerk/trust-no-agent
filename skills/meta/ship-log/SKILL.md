---
name: ship-log
description: Append a log entry of completed work to the private project ledger (typically .trust/progress.txt, gitignored). Use after finishing any file change, refactor, task, or bug fix, before moving to the next item.
---

# Ship Log

Every completed unit of work gets a ledger entry — before starting the next one. A log that dies with the conversation was a decision made in secret: conversation memory does not survive compaction, but the ledger does.

## What it does

- Append a log of completed work to the project ledger at the private, gitignored path (default `.trust/progress.txt`).

## When to use it

- After finishing a file change, refactor, task, or bug fix
- After every code change — no exceptions
- Never for work that is still pending approval or waiting on user decisions

## How it works

1. Resolve the ledger path: `<project>/.trust/progress.txt` by default (create the `.trust/` dir and file on first use). Read it to see existing logs.
2. Append a new entry at the bottom of the file.
3. Never overwrite or delete old logs — this is the project's work history.
4. Confirm the ledger path is gitignored before relying on it as private.
5. Append the entry's one-line summary to the recovery index at `.trust/index.md` (see Recovery index).

## Log Format

```markdown
### Session Summary - <short title>
- <Modified/Created/Fixed> '<path/file>' - <short description of the change>
- Verification: <evidence, e.g. tsc EXIT 0; vitest 42/42 pass>
- Next: <the single open action, or "none">
- Recipe: task_type = <type of task, e.g. "add-validation"> | steps = <2-8 generalizable steps, no task-specific entities>
- Tags: <2-5 short tags, comma-separated, e.g. "evals, harness, fail-first">

### Self-Review (4 Dimensions)
- [x] **Readability**: descriptive names, comments explain "why" not "what", no unexplained magic numbers
- [x] **Maintainability**: clear boundaries, no hardcoded values that belong in config, module structure contained
- [x] **Performance**: no N+1 in loops, no heavy synchronous work in render path
- [x] **Security**: no secrets in source, user input validated, no sensitive data in logs
```

Mark `[x]` when checked, or `[ ]` + a one-line reason when skipped. Never skip silently. The four checkboxes compose into the verdict: the entry is **loggable only when every dimension is answered** — all `[x]`, or a `[ ]` that carries its one-line reason. A self-review with any unanswered dimension is a claim, not a record.

## Recipes (workflow memory)

The `Recipe:` line mines the completed chain into a reusable prior: `task_type` (a category like "add-validation" — no project entities) + 2-8 generalizable steps that would apply to the same task type in any project (no task-specific names). Append each recipe to the project's private `.trust/recipes.md` (create on first entry, one `## <task_type>` section per recipe). Recipes accumulate the process data the ledger can't: the ledger is chronological, recipes are retrievable by task type. The lookup is grep on the task type — the markdown-native recall (AGENTS.md §8 lookup ladder).

The entry carries the smallest set of information required to continue correctly — the next session inherits the state of the work, not a retelling of the conversation.

## Rulings

Any architecture/scope decision the agent made on its own (not a user order) is recorded at the time it's made, inside the entry:

```
Ruling: <decision> — <why> — <cost if wrong>
```

When a ruling must outlive one developer (a team repo, a shared decision), it is **promoted explicitly** to a tracked artifact — an ADR, a glossary term, a tracker ticket — per the memory-modes doctrine in `docs/design.md`. Never publish the private ledger itself.

## Recovery index

Recovery after compaction or a fresh session must not require reading every full entry. The ledger keeps a companion index at `.trust/index.md` (gitignored like the ledger, created on first entry):

- **One line per entry**: `- <YYYY-MM-DD> <open|closed> - <short title>` — the same title as the ledger entry's `### Session Summary` heading, dated, with its status (an entry whose `Next:` is not "none" is open).
- **Index-first recovery**: on resume, read the index first to see what was done and what is still open, then read only the specific ledger entries that matter. The index answers "where are we?"; the ledger answers "how exactly?".
- **Rotation trims it in lockstep**: when ledger entries rotate to the archive, their index lines rotate with them (the archive keeps full text; the index keeps only live entries).

The index is redundant by design — it can be rebuilt from the ledger at any time — but redundancy is what makes recovery cheap: a one-line scan instead of a full-ledger read. `scripts/eval.mjs` mechanically guards this contract's markers.

## Rotation (keeping recovery cheap)

The recovery rule ("re-read the ledger") reads the whole live ledger — so the live ledger must stay small enough that the read is cheap. Append-only means **never delete history**, not keep it all in one hot file:

- When the live ledger passes ~100 KB or holds entries older than ~30 days, rotate: append the older **completed** entries — anything with an open `Next:` stays live — to `.trust/archive/YYYY-MM.txt`, and replace them in the live file with a one-line pointer: `### Archive - <month>: N entries, see .trust/archive/2026-08.txt`.
- The pointer section keeps one line per rotated entry (title + Verification + commit ref, oldest first); full text lives in the archive.
- Archives are append-only too and are read **only on demand** ("when did we fix X?") — routine recovery reads the live file only.
- Log the rotation itself as an entry (`Recipe: task_type = ledger-rotation`) so the act is part of the history it reshaped.

## Reflection at rotation

Rotation is the one moment the whole ledger gets read — so it is where reflection belongs. While moving entries to the archive, scan the older entries for **recurring patterns**: the same lesson hit twice, the same kind of verification skipped, the same tool failing the same way. yith-archive calls this a reflection pass (`mem::patterns`); here it is a bounded scan, not a pipeline:

- For each recurring pattern found (2+ independent entries, not the same bug retold), prepare a **candidate rule line**: what recurred, the evidence (entry dates + tags), and the proposed 1-3 line rule for the router.
- Candidates go **to the user** — recurring findings are rule-inheritance candidates (`docs/rule-inheritance.md`), and rule entry is gated and user-decided. The agent never auto-lands a router rule from its own reflection.
- Record the pass itself in the rotation entry (`Tags: rotation, reflection`), listing candidates surfaced and the user's decision on each. A pass that finds nothing says so — silence is not a scan.

## Canonical ledger & worktree handoff

Gitignored files are per-worktree: a ledger written inside a git worktree dies with `git worktree remove` (proven empirically — a fresh worktree contains no `.trust/` at all). Since `fork-it` gives every parallel writer its own worktree, a worktree-local ledger is **provisional**, never "the project ledger":

- The **canonical ledger** is the coordinating checkout's `.trust/progress.txt` — the same directory as its lessons and recipes companions. Serial work is unchanged — there, the project path IS canonical.
- Before a worktree's ticket closes, append a bounded **handoff** to the canonical ledger: ticket ID + branch/commit, files changed, verification receipts (commands + exit results), rulings, self-review verdict, and the open `Next:` line. Handoff first, then worktree removal — that order is the contract.
- Canonical path unreachable ⇒ the ticket is **not closed**: keep the provisional ledger alive and report the blocked handoff. A memory that dies with its worktree is the decision made in secret this skill exists to prevent.
- Shared research notes (`fork-it`) follow the same rule: write to the canonical `.trust/`, outside every worktree, so all writers read one copy.

Provisional logs remain useful mid-ticket (crash recovery inside the worktree); they are simply not durable. Durable = canonical. `scripts/eval.mjs` mechanically guards this contract's markers.

## Why append-only

The ledger is the anti-compaction mechanism: after a long session is compacted or a fresh session starts, reading the ledger restores the full picture. Deleting old entries destroys the only memory that survives. Keeping it under a gitignored path (`.trust/`) means the work history stays private even as the repository is shared. Rotation serves the same invariant — it moves entries between files, it never drops one.
