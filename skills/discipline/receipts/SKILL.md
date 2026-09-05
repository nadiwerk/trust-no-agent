---
name: receipts
description: "Use when the user claims work is done, fixed, passing, shipped, or asks to log/commit/PR it — before accepting any success claim. Trigger words: \"done\", \"shipped\", \"it works\", \"log it\", \"commit\", \"PR\", \"finished\", \"it's ready\". Requires running verification commands (typecheck, tests, lint, build) and confirming output before making any success claim. Receipts or it didn't happen. Failure handling lives in the make-it-so repair-receipt contract; this skill governs success claims only."
---

# Receipts

An unverified "done" is a rumor. This skill turns rumors into records.

**Breaking this rule in letter is breaking it in spirit.**

## The Iron Law

```
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE
```

The verification command must run in THIS message. A run from an earlier message proves nothing about the current state.

## The Gate Function

```
BEFORE stating any result or feeling satisfied:

1. IDENTIFY: which command would prove this claim?
2. RUN: the full command, fresh and complete
3. READ: every line of output, the exit code, the failure count
4. VERIFY: does the output actually support the claim?
   - If NO: report the real status, evidence attached
   - If YES: make the claim, evidence attached
5. ONLY THEN: the claim exists

A skipped step is not a shortcut — it is a lie told in installments
```

## Gate semantics
Every receipt proves exactly what its gate measured — nothing more. "Tests pass" attests that tests ran green; it is silent about requirements, about done-ness, about whether the UI looks right. Those each need a gate of their own, and a gate of their own receipt. And hitting a limit — round cap, token budget, clock — is a stop, not a success: report it as a stop. Every receipt should be readable as two lists: what this evidence proves, and what it leaves unproven.

## Categorical gate (deterministic picker)

A verdict written as a sentence lets the model freelance. A verdict composed from categorical features cannot. Commit to the booleans, then let the verdict assemble itself:

1. **Every constraint satisfied** — `yes` / `no` (name the constraints: requirements checklist, acceptance criteria)
2. **Evidence fresh** — `yes` / `no` (the verifying command ran in THIS message, not a previous one)
3. **Scope held** — `yes` / `no` (no drive-by changes outside the request)
4. **Subject verified** — `yes` / `no` (the claim's object was checked: tests cover the changed code, the UI shows real data)
5. **Fail-first proven** — `yes` / `no` (for any claim about *new production behavior*: the failing test was observed BEFORE the implementation existed — the fail-first cycle was actually run, not assumed)

Compose: **all five `yes` → "done with evidence". Any `no` → NOT done — report the failing feature(s) with the exact evidence that disproves each.** A verdict without the five booleans is an opinion, not a receipt.

### Fail-first proven — the mechanical gate

The fifth boolean exists because "dont trust anyone even themselves" means a condition that can be checked mechanically is checked mechanically, not left to the model's self-assessment. A claim that new production behavior works is only trustworthy if the fail-first cycle was actually run:

- **`yes`** requires the fail-first cycle was observed: the test FAILED against the pre-implementation code, then PASSED against the implementation. The failing run is the evidence — a test that passes immediately against user-supplied code is verification of a claim, not of a spec.
- **`no`** when the fail-first cycle was not run or not observed. This is a hard `no` for any new-behavior claim — it cannot be waived by confidence, by "the test is simple", or by a passing run alone.
- **`n/a`** when the claim is not about new production behavior (a refactor with no behavior change, a docs edit, a config change). `n/a` is a deliberate answer, never a silent skip — state why the claim is not new-behavior.

The `fail-first proven` boolean is the mechanical seam: it is what a pre-commit hook or CI gate can check for (see `scripts/eval.mjs`), so the discipline survives even when the model would rather skip it.

## Common Failures

| Claim | What counts as proof | What never counts |
|--------|----------------------|---------------------|
| Tests pass | Fresh test output: 0 failures | Earlier run, "should pass" |
| Linter clean | Linter output: 0 errors | Spot check, extrapolation |
| Build succeeds | Build command: exit 0 | Lint green, logs look fine |
| Bug fixed | Original symptom re-tested: gone | Code changed, assumed fixed |
| Regression test works | Fail-first cycle verified | Test passes once |
| New production behavior works | Fail-first cycle observed (test failed pre-impl, passed post-impl) | Test passes immediately, "it's simple", confidence |
| Agent completed | VCS diff shows the changes | Agent reports "success" |
| Requirements met | Checklist walked line by line | Tests passing |
| UI renders correctly | Browser check with real data | Unit-test fixtures green |

## Operational claims

Claims about **systems**, not code — where "the command ran" is not "the state changed". Each needs its own receipt shape (live exhibit: a data-fix script whose filter matched 0 rows was reported as "migration applied"):

| Claim | Proof required | Not sufficient |
|-------|----------------|----------------|
| Migration applied | Query the target DB's own migration table: this tag/hash present, in monotonic order | SQL file exists, journal updated, migrate exited 0 |
| Data operation done | Before/after counts on the target system per affected table/row-set | Script exit 0 — a run that matched 0 rows is a no-op, and "fixed: 0" is a finding, not a pass |
| External side effect delivered | Operation identity (idempotency key / event ID) + the provider or target's terminal state + the declared delivery semantics | One successful invocation |
| Async job processed | The job's terminal state in the queue/worker store: completed / retried / dead-lettered | Submission acknowledgement |
| Environment state live | Connectivity/version probe against the exact target named in the claim | Config file present, code compiles |

Class rules:

- **Name the target identity** — which DB, branch, tenant, environment, commit. A fresh green receipt for the wrong target is a false receipt.
- **Never claim "exactly once"** because one send succeeded. Either name the idempotency invariant, or state at-least-once with the duplicate-safety explicitly declared. Delivery guarantees are declared, never inferred from a happy run.
- **Receipt each part of a multi-part operation** — a fix spanning several tables/regions/channels is only "done" when every part shows its own state; a silently half-applied operation becomes the next incident's root cause.
- **Partial success gets a recovery decision on record** — complete the remainder, roll back, or accept-and-log; the choice is stated with evidence, not defaulted to silence.

## Lesson capture

A repair that leaves no lesson behind will be repeated. The corrective tier (`.trust/lessons.md`) must be fed on every repair — regardless of which skill drove the fix:

- **Before accepting a fixed/done/repair claim**, check the lesson exists: the root cause and its imperative correction are in `.trust/lessons.md` (feature-named root cause, imperative correction — the make-it-so repair format). A missing lesson is a hole in the receipt: either the driving skill writes it (make-it-so repair loop does), or write the one-line lesson yourself in the same message — root-cause has already produced the material.
- The check is a read, not a ceremony: one appended line, not a new process. What is forbidden is silence — a "fixed" receipt whose incident left no trace in the corrective tier.

This rule lives in receipts, not only in make-it-so, because receipts is MANDATORY — forced into every delegation and loaded before any done claim — so the corrective tier cannot depend on the user remembering to invoke a user-invoked skill.

## Proof Command Template

Each repo declares its own proof commands in its own AGENTS.md. The table shape:

| Claim | The command whose output settles it |
|--------|------------------------------|
| Types clean | (e.g. `npx tsc --noEmit`) → exit 0 |
| Unit tests pass | (e.g. `npm test`) → all pass |
| Lint clean | (e.g. `npm run lint`) → 0 errors |
| Build succeeds | (e.g. `npm run build`) → exit 0 |
| UI/data renders | browser check with real data, not fixtures |

If the repo declares none, derive the commands from `package.json` scripts and say so.

## Red Flags — STOP

- Any sentence containing "should", "probably", or "seems to"
- Satisfaction expressed before verification ran ("Great!", "Perfect!", "Done!")
- A commit/push/PR about to happen on unverified work
- An agent's success report taken at face value
- Verification that covered only part of the claim
- The thought "just this once"
- Visual or subjective quality asserted from an automated receipt — a deterministic receipt proves the check ran; visual sign-off is a separate gate
- **ANY wording implying success before verification has run**

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Should work now" | Then RUN it and watch it work |
| "I'm confident" | Confidence is a feeling; evidence is an output |
| "Just this once" | The exception is where the discipline dies |
| "Linter passed" | A linter never compiled anything |
| "Agent said success" | Read the diff yourself |
| "Partial check is enough" | A partial receipt proves a partial claim — i.e. nothing |
| "Different words so rule doesn't apply" | The rule binds the act, not the phrasing |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 42/42 pass] "All tests pass"
❌ "That should be green now" / "Looks right to me"
```

**Regression tests (fail-first):**
```
✅ Write → Run (pass) → Undo the fix → Run (MUST FAIL) → Re-apply → Run (pass)
❌ "I've written a regression test" (without fail-first verification)
```

**Requirements:**
```
✅ Re-read spec → Create checklist → Verify each → Report gaps or completion
❌ "Tests green, so this phase is wrapped"
```

**Agent delegation:**
```
✅ Subagent says success → Read the VCS diff → Verify the changes → Report the true state
❌ Trust agent report
```

**Behavioral / UI evidence (per-assertion record):**
```
✅ test_start → assertion: passed / failed / untested (with reason — never silently skipped)
   → state the exact commit + branch tested
❌ "Tested it, works" — no per-assertion record, no commit named
```
