# Behavioral eval — the second tier of proof

`scripts/eval.mjs` (static tier) proves the framework's rules **exist** —
markers, wiring, literal strings. It cannot prove the rules **change agent
behavior**. This harness is the second tier: scored scenario cases run
against a model with and without the framework, graded by a blind judge on a
weighted rubric.

## Files

- `dev/cases.jsonl` — tuning probes. Never reported as eval numbers; the
  dev side must itself carry ≥40% must-not-fire negatives (floor per side).
- `test/cases.jsonl` — the reporting set. Its numbers are the eval's numbers.
- One JSON object per line: `id`, `prompt` (the scenario the responder sees),
  `dimensions` (which rubric axes the case exercises), optional
  `negative: true` (a prompt where restraint is the correct behavior).
- The dev/test split is the **directory, not a field**: a case carrying a
  `"split"` key is rejected by the validator, and an `id` appearing in both
  directories is rejected too — a case tuned on dev and then reported on test
  would silently turn tuning into the report.
- `rubric.md` — dimensions, weights (sum = 1), and 1-5 definitions. Must
  always carry `error-causal-honesty`, the anti-fabrication dimension.
- `judge.md` — the judge prompt template. Must stay condition-blind.

All are validated offline by `node scripts/behavioral-eval.mjs`
(exit 0 = consistent) and fail-first tested by `scripts/behavioral-eval.test.mjs`.

## Run protocol (external runner)

This repo owns the contract, not the runner — any CLI that can prompt a model
works:

1. For each case, run the responder model twice: baseline (bare prompt) and
   candidate (prompt prefixed with the framework's core instructions — the
   Iron Laws, the MANDATORY skill contract, the chat-receipt shape).
2. Run at least 3 trials per condition per case; report per-case and weighted
   aggregate means.
3. Grade every response with the `judge.md` template, one judge call per
   (case, trial) group, with the A/B labels shuffled per trial.
4. Report deltas per dimension and **per-case blocking findings**, and report
   the numbers even when they fail the framework's expectations — a harness
   that only ever confirms the framework is theater.
5. Select the side explicitly: `--split test` (default, the reporting set) or
   `--split dev` (tuning probes — never reported as eval numbers). The flag
   selects a **directory** (`test/` vs `dev/`); a missing side fails loudly.
   Historical `RESULTS.md` runs predate the split and ran one flat file.
6. Tag every row: graded rows are `agent` fault; judge-failed or API-aborted
   trials are `infra` fault — kept as skipped rows and counted apart, never
   entering pass rates. The run prints per-case pass rate, pass@3 (capability
   estimator), rel^3 (pass^3 reliability), mean delta, flakiness (delta
   variance), and fault counts.

## Bounded judgment: deterministic-first, judge-last (K6/K9)

Any decision over a **closed answer set** ("list every acceptable answer
before the call") goes through `scripts/local-judge.mjs`, in this order:

1. **Deterministic graders first** — free code answers form
   (`requiredSection`, `forbiddenPattern`, `outputLength`): the first grader
   that decides wins and the model judge is never called.
2. **Model judge as last resort** — only when every grader abstains: one
   question, the quoted evidence, the closed set, exactly one call (K7).
3. **No API key, no network** — the seam reads no env and imports only
   `node:` builtins; a bounded decision stays fast and free.
4. **Fail closed to `inconclusive`** — no judge configured, a throwing
   judge, or an answer outside the set yields `inconclusive`, never a pass
   and never a fail: a check that cannot run says so (J4).

Meaning (groundedness, honesty, "is this claim supported?") is the only job
left for the judge — form was already settled for free. The verdict never
acts itself: who obeys a verdict stays the caller's gated, scoped decision.

## Honest limits

- Small samples are noisy: single-case deltas under ~0.5 on 3 trials are not
  signal; treat the aggregate as the ground truth.
- A judge from the same model family as the responder is a known bias; a
  cross-model judge condition is the next control worth adding.
- Gains must not be bought by fabrication: that is why `error-causal-honesty`
  is mandatory in the rubric — a reporting style that becomes crisper by
  asserting causes the evidence does not support must show up as a regression
  on this axis, not a win.
