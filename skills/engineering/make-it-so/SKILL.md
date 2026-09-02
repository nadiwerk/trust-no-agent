---
name: make-it-so
description: Use when tickets are approved and it is time to build — test-first at agreed seams, layered verification, closed with roast-my-code and ship-log.
disable-model-invocation: true
---

# Make It So

Implement the work the user described in the spec or tickets.

Before implementing, check for in-flight work touching the same area — open PRs, active branches, another session's worktree. On overlap, stop and ask: two sessions editing one area is a conflict, not a coincidence.

1. Use the `expect-fail` skill at pre-agreed seams, wherever possible.
2. Run typechecking regularly, single test files regularly, and the full test suite once at the end.
3. When done, run the `roast-my-code` skill to review the work.
4. Record the work via the `ship-log` skill.

## Test-refusal gate (Iron Law 2)

The `expect-fail` Iron Law is `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST` — it is not waivable by the same request that asks for the code.

1. **User declines tests** ("no test runner", "I don't want tests", "just trust me") → STOP. Name the conflict in one line and ask once: "Tests are how the work is proven — do you want me to proceed without any verification, or pick a lighter option?" Lighter options, in order of preference: a zero-dependency assertion script run with plain `node`, a smoke command against a real surface, or explicit acceptance of the risk in one sentence.
2. **User declines every option but explicitly commands the change** → the user still owns their code: write it. What cannot be negotiated away is the *done claim*, not their authority — report the ticket as **"implemented, unverified"**, never "done", and keep that status until a real check runs. Record `decided_by: user` in the receipt so the evidence gap is attributed, not hidden.
3. **User picks any verification option** → proceed test-first at that seam; the Iron Law holds.
4. Record the outcome in the ticket's receipt: `decided_by: user`, with the option chosen — so "who waived verification" is always answerable.

## Repair receipt — the verification-failure contract

When a verification step breaks (typecheck, test, lint, build):

1. Record a receipt BEFORE editing: subject (file + symbol), evidence (verbatim error), and the single fix you chose with why.
2. Before each retry, classify the failure: missing capability, wrong instruction, environment gap, or context gap (the window lacked material the pass needed — never fetched, compacted away, or stale; repair by restoring the context, not by retrying the same window). Prefer the fix that repairs the class (a rule, a test, a config), not just this instance.
3. Prove progress before retrying: if the workspace is unchanged since the failure (same `git diff HEAD` plus untracked files), a re-run cannot pass — the failing command and the code it tests are identical. Make a real change first (fix, config, dependency), then retry. Only a change that alters the tested input/output counts.
4. Change only the diagnosed subject per round. No drive-by refactors.
5. Max two focused correction rounds for the same failure. Continue only while the objective error count reaches a new minimum. If two consecutive rounds do not improve, STOP: revert the failing chunk to last-known-good and report the diagnosis, both attempts, and remaining hypotheses to the user truthfully.
6. A non-zero exit can never be reported as done. Every completed ticket cites its verification evidence.

## Termination contract

Every loop you enter — repair rounds, verification retries, research passes — declares its exit BEFORE the first iteration:

1. **Success condition** — categorical, checkable in one step (e.g. "typecheck + the failing test pass", "all 3 acceptance criteria met"). "Looks good" is not a success condition.
2. **Hard round cap** — a number (default: 2 for the same failure). The cap is not a suggestion.
3. **Terminal action** — what you MUST emit on the final round no matter what: report the evidence + remaining gaps to the user truthfully (stop), or ask the human a specific question (escalate). There is no "one more retry" on the final round.

Declaring all three before starting is what separates a bounded loop from a stall. Reaching the cap is a STOP with a report, never a silent continue. If the loop you are in was not declared up front, declare it now — in the next message — then honor it.

## Delegation discipline (subagents)

When executing through subagents, every delegated prompt MUST include:

- **The 3-line repo rules**: (1) every file change is verified (typecheck/test/error output) before being called done; (2) no refactoring outside the requested scope; (3) no touching files outside the allowed path list.
- **The 6 sections**: TASK / EXPECTED OUTCOME / REQUIRED TOOLS / MUST DO / MUST NOT DO / CONTEXT.

A vague prompt means the subagent improvises. Subagent results are verified by the orchestrator — never trusted from the report alone.

## UI verification

Changes touching UI/data must be checked in a browser with real data (not unit-test fixtures) before being called done — real data catches bugs invisible to static checks: per-day rows appearing as separate entities, duplicate names across groups, empty columns. Light check (1-2 snapshots + 1 screenshot) for small changes; full check (explore + interact) for new features or refactors spanning 3+ files.

Commit your work to the current branch once the user signs off (Iron Law 4 — commit is never a self-serve action).

## Dry-run gate (Iron Law 4)

Before any expensive, irreversible, or shared-system action (commit, push, publish, delete, destructive migration), produce the dry-run in this order — and do NOT perform the action until the human signs off:

1. **Proposed action** — the exact command or edit, one line. Not "push changes" — `git push origin master`.
2. **Predicted effects** — 3-6 concrete effects + the estimated number of things affected (files, rows, users, systems).
3. **Irreversibility** — 1 to 5, with the rubric: read-only = 1; reversible local edit = 2; config/state change = 3; deletes or rewrites without easy undo = 4; destroys data or reaches shared systems = 5.
4. **Severity** — `low` / `medium` / `high` / `block` (what breaks if this goes wrong).

Then the gate: **irreversibility ≥ 4 OR severity `block` ⇒ MUST ask the human, regardless of your own assessment.** No self-made Ruling can override this — Iron-Law-4 actions are never a self-made decision (WORKFLOW.md rule 4). Verdict line records `decided_by: hard_cap | agent_judgment` with the human's answer, so the receipt names who decided.

## Operational claims (beyond code)

When the ticket touches migrations, data fixes, external side effects, or async jobs, its success claim is not a code claim: follow `receipts`' Operational claims class — receipt the named target's terminal state (which system, what actually changed, declared delivery semantics), not the fact that a command exited 0. Exit codes prove the command ran; only target-state proves it worked.

## Lessons (memory tier below rules)

Every failure that survives classification writes a structured lesson — the automatic tier under rule-inheritance:

```
Lesson: root_cause = <the specific broken feature, one sentence> | correction = <one imperative sentence>
```

- Write it in the same message as the repair, appended under `## Lessons` in the project's private `.trust/lessons.md` (create the file on first entry). Root cause names the *feature*, not the symptom; correction is imperative, not descriptive.
- Before starting a structurally-similar task, read `.trust/lessons.md` and recall the matching lessons as priors — a recalled lesson is a prompt, not a gate; it never blocks work.
- Lessons are NOT rules: rules are gated, scoped, reversible (rule-inheritance); a lesson becomes a rule only when the same failure recurs — that recurrence is the trigger, and the rule lands via the gate, not here.

## Rationalization table

| Excuse | Reality |
|---|---|
| "I'll refactor while I'm here" | Out of scope — log it as a review finding instead |
| "The error is flaky, rerun" | Read the error — a rerun without classification is a guess |
| "Let's rerun and see" (workspace unchanged) | A retry without a change is the same failure twice — prove progress first |
| "One more round won't hurt" | The two-round cap exists because round three rarely improves |
| "Just one more retry, I feel it" | Undeclared loop — state the success condition, the cap, and the terminal action before round one |
| "Skip this check, tests are slow" | Skipped verification is a lie with extra steps |
| "User said no tests, so I flagged it and coded anyway" | Flag-then-proceed is a negotiated Iron Law — invoke the test-refusal gate: offer a lighter option, stop if every option is declined |
