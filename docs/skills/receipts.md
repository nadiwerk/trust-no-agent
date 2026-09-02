# receipts

> Iron Law: **NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.** Receipts or it didn't happen.

## When this is the skill you need

1. **The agent just said "done."** Before accepting any success claim — "done", "fixed", "shipped", "tests pass" — the gate demands the proof: identify what command proves the claim, run it *fresh in this message*, read the full output, check the exit code. A memory of a past run is not evidence; "should pass" is a confession.
2. **You're about to commit or open a PR.** The same gate, self-applied: no commit, no PR, no "it's ready" without fresh verification of typecheck, tests, lint, build. The gate is categorical, not vibes — five booleans (constraints satisfied, evidence fresh, scope held, subject verified, fail-first proven) compose into the verdict. All yes → "done with evidence". Any no → *not* done, with the disproving evidence named.
3. **A gate passed and you're tempted to over-claim.** Gate semantics keep claims honest: "tests pass" proves the tests ran green — it does not prove the task is done, the requirements are met, or the UI looks right. Each is its own gate with its own receipt. Reaching a round cap or token budget is a stop, not a success.

## What it looks like

> **Claim:** ticket 3 (dead-letter + alert) is done.
> **Receipt:** `vitest run deadletter` → 12/12 pass, exit 0 (ran this message) · `tsc --noEmit` → exit 0 · fail-first proven: the dead-letter test was observed failing before implementation · scope held: no drive-by changes in the diff.
> **Verdict:** done with evidence — for the code path. UI alert rendering is a separate gate, not yet run.

## Chaining

- The gate between **`make-it-so`** execution and **`ship-log`** / commit / PR — every completion claim in the main loop passes through it.
- The bug path ends here too: `root-cause` → `expect-fail` → fix → **`receipts`** → `ship-log`.
- Loaded by delegation via `load_skills` on any subagent that will claim done or commit.
- Failure handling (what happens *after* a failed gate) lives in `make-it-so`'s repair-receipt contract; receipts governs the claims.

## Not for

- Work still in progress — receipts governs success claims, not status updates.
- Skipping the uncomfortable run — if no command can prove the claim, the claim can't be made.
