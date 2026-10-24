# roast-my-code

> Three-axis review of the diff since a fixed point — Standards, Spec, Security — run as parallel subagents, every finding severity-labeled.

## When this is the skill you need

1. **Before you believe "done."** The agent finished the tickets. `roast-my-code` reviews the actual diff: does the code follow the repo's documented standards (plus a fixed Fowler smell baseline)? Does it faithfully implement the originating spec/ticket? Does it introduce a vulnerability — injection, auth bypass, data exposure, secrets? A completion claim that passes the gate is only trustworthy if the gate checks what matters.
2. **Reviewing a PR or branch.** "Review since `main`" — the skill pins the fixed point, confirms the diff is non-empty *before* spawning subagents, and runs all three axes in parallel so they don't pollute each other's context (on harnesses without parallel delegation it falls back to running the same three reviews sequentially, one fresh context per axis). Findings come back with a closed severity set (`Critical` → `Required` → `Nit` → `Optional` → `FYI`) — the closed set makes tallies deterministic.
3. **The spec existed and you want to know if it survived.** The Spec axis finds the originating issue or spec file and checks the code against *what was asked*, not against vibes. Silent scope creep and missing acceptance criteria get named. The Spec axis also carries the **test-strategy check**: tautological assertions (`assert.ok(true)`, expectations recomputed from the code's own output) and test/impl contract mismatches (test reads path A, implementation writes path B) are at minimum `Required` — a green suite either way is a certificate with no exam.

## What it looks like

> **Standards** — `Required`: duplicated retry logic in `relay.ts` and `email.ts` → extract the shared shape.
> **Spec** — `Critical`: ticket 3 required dead-letter + alert; dead-letter exists, alert was never built.
> **Security** — `Required`: webhook payload passed to the templating engine unvalidated → validate at the trust boundary first.

## Chaining

- Called by **`make-it-so`** at the end of every execution, or directly on any branch/PR.
- Findings go to the receiver side: **`no-thanks`** — verify before implementing, push back when a finding is wrong.
- Accepted findings that recur become permanent router rules — the fix lands as a rule, not as a story in a transcript.
- Runs inside the main loop: `breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log` (canonical chain, WORKFLOW.md rule 2).

## The review loop is bounded

A review that finds something opens a loop — fix, re-review, new findings, fix again — and an agent author plus an agent reviewer can keep each other busy indefinitely, each round surfacing one more thing. So the skill declares its exit before round 1: a categorical **success condition** (every `Critical`/`Required` fixed or dismissed with a reason, no new `Critical`), a **hard round cap** of 3 (raising it is a human `Ruling:`, never a self-extension), and a **terminal action** (report the still-open findings and hand the decision to the human — there is no "one more round"). Three rules keep it converging: round 2+ re-reviews only the new diff since the last-reviewed SHA, a finding is never posted twice (it is marked *unresolved* instead), and a finding that recurs is fixed as a class at the source rather than one line at a time.

## Not for

- Uncommitted vibes — the fixed point must resolve and the diff must be non-empty; the skill asks rather than guessing.
- Replacing CI — linting and typechecking stay in the pipeline; roast reviews what tools can't.
