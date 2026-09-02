# root-cause

> Iron Law: **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.** A bug is not understood until its root cause is.

## When this is the skill you need

1. **The bug came back.** The previous fix patched the symptom and left the real defect to resurface. `root-cause` is the four-phase discipline — investigate the root cause, check for the pattern (where else does this class of bug live?), form hypotheses, *then* implement — so the second fix is the last one.
2. **Time pressure is making guessing tempting.** Production is down, someone says "just add a try/catch." That's exactly when the discipline matters: rushing guarantees rework, and systematic is faster than thrashing. Read the full stack trace, reproduce the failure, prove the hypothesis — under pressure *especially*.
3. **Three fixes have failed.** The stop-and-question guard: after three failed fix attempts, the problem may not be a bug but an architecture that makes the bug inevitable. Stop editing; question the design. Continuing to guess is how agents burn hours "fixing" the same thing five ways.

## What it looks like

> **Agent:** Phase 1 — investigating before proposing anything.
> Error: `ECONNRESET` on ~2% of webhook deliveries, only after 30s.
> Finding: the provider times out at 30s but our handler holds the DB transaction while calling their API — slow calls exceed the pool wait and the connection resets.
> Root cause: network call inside a transaction. Fix: move the call outside the transaction + a failing test reproducing the 30s case first (`expect-fail`).

## Chaining

- Entry point of the bug path — parallel to the feature chain, meeting it at the gates: `root-cause` → **`expect-fail`** → fix → **`receipts`** → **`ship-log`**.
- Its phase-1 output is what makes an `expect-fail` test possible: you can't write the failing expectation for a bug you don't understand.
- Loaded by delegation via `load_skills` whenever a subagent will diagnose or fix anything.

## Not for

- Feature work — that's the `breakpoint` → `save-as` → `fork-it` → `make-it-so` chain.
- Known-good changes where no unexpected behavior exists — expect-fail alone covers the TDD loop.
