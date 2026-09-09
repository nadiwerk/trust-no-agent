# Behavioral eval results — first recorded run

Reproduce with `node scripts/behavioral-eval/run.mjs --trials 3`; protocol and
honest-limits notes in [README.md](README.md).

| | |
|---|---|
| Date | 2026-09-10 |
| Responder / judge | GLM (`glm-5-3-flash`) via an Anthropic-compatible endpoint — same model family graded its own outputs (known bias, see README) |
| Cases | 10 (`cases.jsonl`) |
| Trials | 3 |
| Rows | 58 per condition scored; 29 of 30 (case, trial) judge groups (1 group lost to a judge-JSON parse failure after retry — the responder transcripts for it are archived) |
| Raw transcripts | gitignored `.tmp/behavioral-eval/` (58 response files + judge JSON per group) |

Baseline is the bare case prompt. Candidate is the case prompt prefixed with
the framework core (Iron Laws + MANDATORY contract via `scripts/reinject.mjs`,
the chat-receipt shape, and the anti-fabrication instruction).

## Scores

| Dimension | Weight | Baseline | Candidate | Δ |
| --- | ---: | ---: | ---: | ---: |
| correctness | 0.15 | 4.59 | 4.62 | +0.03 |
| actionability | 0.15 | 4.52 | 4.45 | −0.07 |
| state-restatement | 0.10 | 3.86 | 4.97 | +1.10 |
| error-causal-honesty | 0.15 | 3.72 | 4.86 | +1.14 |
| completion-honesty | 0.10 | 4.07 | 4.93 | +0.86 |
| artifact-target | 0.10 | 4.59 | 4.17 | −0.41 |
| tangent-suppression | 0.05 | 4.97 | 3.03 | −1.93 |
| test-first | 0.05 | 2.59 | 4.97 | +2.38 |
| estimate-concreteness | 0.05 | 3.24 | 3.28 | +0.03 |
| context-confirmation | 0.05 | 4.00 | 4.38 | +0.38 |
| spec-gate | 0.05 | 3.24 | 4.86 | +1.62 |
| **Weighted** | | **4.078** | **4.522** | **+0.445** |

Candidate wins 20 of 29 judged groups, ties 1, loses 8 (losses concentrate in
`tangential-review` and two single-trial dips in `implementation-first` /
`no-spec-gate`).

## What moved, and why it matches the framework's claims

- **test-first (+2.38)** — the largest gain: baseline responses almost never
  plan a failing test before code (7 of 14 baseline blockers on this
  dimension); the candidate plans one essentially every time. This is Iron
  Law 2 showing up in free-form replies, not in a repo test suite — the
  first direct behavioral evidence the static tier could never produce.
- **error-causal-honesty (+1.14)** — the anti-fabrication dimension moved
  *toward* the framework, the opposite of the regression the upstream
  reporting-style finding predicted: the prefix's "never assert a cause the
  evidence does not support" line plus the mandatory dimension kept the
  crisper format honest. Baseline invented definitive causes from thin
  evidence; the candidate hedged where evidence underdetermined.
- **state-restatement (+1.10), spec-gate (+1.62), completion-honesty
  (+0.86)** — receipts-shaped reporting, Law 1 (criteria before build), and
  Law 3 (done = verified) all moved strongly.

## The two regressions worth owning

1. **tangent-suppression (−1.93).** The candidate's receipts shape forces
   side findings into the reply as structured "Open items"; the baseline
   just answers the reported bug and stops. The framework's own rule
   ("suppress tangents — offer the second issue once, separately") is not in
   the injected prefix, so the shape won over the behavior. Candidate fix:
   add tangent-suppression to the prefix (one line), re-run this case.
2. **artifact-target (−0.41).** The candidate learned to hedge rendered
   claims ("I won't restate specifics I can't re-verify here") — honest, but
   the judge scored the lost concreteness, and the baseline simply verified
   the thing directly. Candidate fix: teach the prefix that the action for a
   rendered claim is *to verify the rendered artifact*, not to refuse.

## Judge failures (the harness's own honesty)

3 of 30 judge groups failed JSON parsing on the first attempt; 2 recovered on
retry, 1 was lost (`multi-step-progress` trial 2, both transcripts archived
with `(JUDGE FAILED)`). Root cause is the judge model's thinking budget
consuming the token cap — fixed mid-run by raising `max_tokens`; the lenient
parser (`parseJudgeJson`) recovered trailing-comma and prose-wrapped output.

## Reading these numbers

- **Three trials is few.** The aggregate (+0.44 on 58 scored responses) is
  on firmer ground than any single case row; per-case deltas under ~0.5 are
  not signal.
- **Same model judged its own family.** A cross-model judge condition is the
  next control worth adding (README §Honest limits).
- **The candidate prefix is a proxy for full framework adoption.** It carries
  the discipline floor (Iron Laws + MANDATORY + receipt shape), not the whole
  skill set — gains measured are the floor's gains.
