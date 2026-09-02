---
name: fork-it
description: Use when a spec is ready and work needs to be broken down — forks it into tracer-bullet tickets (vertical slices), each declaring its blocking edges.
disable-model-invocation: true
---

# Fork It

Git gives every piece of work its own branch; work breakdown deserves the same shape. Fork the plan into **tickets** — tracer-bullet vertical slices — and let every ticket name the tickets that **block** it.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL), fetch it and read its full body and comments.

### 2. Explore the codebase (if not done yet)

If you haven't explored the codebase yet, do so. Ticket titles and descriptions use the project's domain glossary vocabulary and respect ADRs in the area you're touching.

Check `.trust/recipes.md` if it exists — start from the most-similar recipe as a prior instead of from scratch. A recipe is a prior, not a straitjacket: adapt it to this spec, don't force the spec into it. A missing recipes file means no prior — work from first principles.

Look for opportunities to prefactor the code to make implementation easier: "Make the change easy, then make the easy change."

### 3. Draft the slices

**Spec gate — before slicing:** for class `loop` work, tickets must not be drafted from a spec that lacks the `## Acceptance Criteria` section. If the spec has none, stop and return it to `save-as` — do not invent criteria yourself while slicing; criteria invented at slicing time are implementation wishes, not requirements. Each ticket must trace to at least one numbered criterion in the spec (cite it), and every criterion must be claimed by at least one ticket or explicitly ruled Out of Scope. This gate is what makes the upstream discipline bind: a spec that cannot be tested cannot be decomposed, so it is fixed before decomposition, not after.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — a slice is vertical, never one layer spread horizontally
- A finished slice can be demoed or verified standing on its own
- Each slice fits inside one fresh context window
- Prefactoring happens before the slices start

</vertical-slice-rules>

Every ticket then declares its **blocking edges** — the tickets that must finish before it may begin. No blockers means the ticket is free to start now.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**: (1) *Expand* — add the new form beside the old so nothing breaks; (2) *Migrate* — move call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, CI stays green batch to batch because the old form still exists; (3) *Contract* — delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, share an integration branch: all batches block a final integrate-and-verify ticket, and green is promised only there.

### 4. Quiz the user

Lay out the proposed breakdown as a numbered list. Each entry shows:

- **Title**: a short, descriptive name
- **Blocked by**: the tickets (if any) that must land first
- **What it delivers**: the end-to-end behaviour this ticket brings to life

Then interrogate the plan with the user:

- Is the granularity right? (too coarse / too fine)
- Do the blocking edges hold — does each ticket depend only on tickets that truly gate it?
- Any ticket that wants merging or splitting?

Refine until the user signs off on the breakdown.

### 5. Publish to the issue tracker

- **Local files** → one file per ticket under `.trust/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). One ticket per file — never a single combined file.
- **A real tracker (GitHub, Linear, …)** → one issue per ticket in dependency order; use the platform's native blocking/sub-issue relationship where it has one. Apply the `ready-for-agent` label unless told otherwise.

**Project schema precedence:** if the project already tracks tickets with its own schema, template, or linter, that contract wins for FORMAT — publish tickets in the project's shape. The semantics below stay mandatory regardless: vertical slices, declared blockers, acceptance criteria, and approval before work starts.

Execution starts at the **frontier** — any ticket whose blockers have all landed. A purely linear chain just runs top to bottom.

Never close or edit a parent issue from this skill.

<local-ticket-template>

# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, told from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** numbers/titles of the gating tickets, or "None — can start immediately".

**Status:** ready-for-agent

- [ ] <criterion 1 — cited from the spec>
- [ ] <criterion 2 — cited from the spec>

</local-ticket-template>

Avoid specific file paths or code snippets — they go stale fast. Exception: a prototype snippet that encodes a decision more precisely than prose can — inline it and note where it came from.

## Orchestration note (parallel subagents)

Three or more independent tickets (no mutual blocking edges) may be executed in parallel by background subagents — whatever your harness's async delegation mechanism is. Tickets that WRITE files in parallel must each get their own git worktree, merged at the end. Read-only parallel work runs without worktrees.

Parallel tickets need a defined output shape — files touched plus the acceptance criteria that gate them. Free-text results are only readable by a human; shaped results merge deterministically. And the convergence step that gathers parallel outputs must genuinely consume every one of them — a synthesis that ignores an input is itself a fake dependency, and the work feeding it was wasted.

Before dispatching, scan for hidden shared resources — the same files, tables, or environment state touched by two tickets. Fake independence produces merge conflicts, not speed. Same-shape micro-tickets batch into one dispatch instead of paying per-ticket overhead.

When several tickets need the same codebase or external research, run one exploration pass before dispatch and save the findings as shared notes (e.g. `.trust/<slug>/research.md`, outside every worktree) — implementers receive a pointer to it instead of repeating the work. Research done once is free to every ticket; research done per-ticket is a duplicated cost with no shared memory.

### Deferred queue — blocked work is held, never cancelled

When execution pauses or blocks (a gate, a human decision, an external dependency), work that has **not yet started** is **deferred**, not discarded: record the pending tickets, their blocking edges, and the position in the chain, and hold them. On resume, execution continues from the deferred queue — the held tickets are picked up where the pause happened, not restarted from the beginning. A pause that forgets its queue is a restart in disguise; the resume point is defined by what was written down at pause time, never by memory.

### Iteration vs loop — two different frame semantics

Parallel ticket batches and repair/retry loops look similar but have different isolation rules:

- **Iteration (parallel batch)** — each item runs in its own **isolated frame**: its own copy of the shared state (worktree, outputs, ticket context). Items cannot see each other's intermediate state; results are **aggregated** into an ordered output at the end. This is the semantics of parallel worktree tickets — isolation is the point.
- **Loop (repair/retry, sequential repeat)** — each pass runs in a frame that **shares** the parent state: the loop body sees the accumulated results of earlier passes, and the loop exits on a declared **break condition** (or round cap), not on item count alone. This is the semantics of repair rounds — convergence is the point.

Choose by what the work needs: if passes must not contaminate each other, iterate (copy the state); if each pass must see the last pass's output, loop (share the state). The two are not interchangeable — picking the wrong one either leaks state between parallel items or starves the loop of its own progress.
