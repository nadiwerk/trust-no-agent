# Behavioral eval — the second tier of proof

`scripts/eval.mjs` (static tier) proves the framework's rules **exist** —
markers, wiring, literal strings. It cannot prove the rules **change agent
behavior**. This harness is the second tier: scored scenario cases run
against a model with and without the framework, graded by a blind judge on a
weighted rubric.

## Files

- `cases.jsonl` — one JSON object per line: `id`, `prompt` (the scenario the
  responder sees), `dimensions` (which rubric axes the case exercises).
- `rubric.md` — dimensions, weights (sum = 1), and 1-5 definitions. Must
  always carry `error-causal-honesty`, the anti-fabrication dimension.
- `judge.md` — the judge prompt template. Must stay condition-blind.

All three are validated offline by `node scripts/behavioral-eval.mjs`
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

## Honest limits

- Small samples are noisy: single-case deltas under ~0.5 on 3 trials are not
  signal; treat the aggregate as the ground truth.
- A judge from the same model family as the responder is a known bias; a
  cross-model judge condition is the next control worth adding.
- Gains must not be bought by fabrication: that is why `error-causal-honesty`
  is mandatory in the rubric — a reporting style that becomes crisper by
  asserting causes the evidence does not support must show up as a regression
  on this axis, not a win.
