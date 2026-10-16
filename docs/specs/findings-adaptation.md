# Spec: findings adaptation — eval contract, brief execution window, autonomy decay, stale-probe, local judgment

Status: published (approved Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: external agent-discipline corpus research (6 synthesis files in
`.trust/coworker-research/`, 4 parallel digests) + breakpoint 2026-10-13
(adopted: eval-contract, J2, ladder, stale-probe, K6/K9; no-Jev-API article
not found, K6/K9 pattern approved instead).

## Problem Statement

As the owner of trust-no-agent, I want the tested lessons from the external research
corpus (344 findings, evals, memory, Jev, harness) to enter the framework — not as
quotations, but as mechanisms with teeth: an eval contract that separates tuning from
reporting, a delegation brief that carries the exact verification command, an autonomy
ladder that decays, a stale-memory probe, and cheap no-API judgment.

## Solution

Adopt the five transfers, each with its mechanical limit: the eval contract (dev/test
split, negatives, failure tags), the 9-field J2 delegation brief, the per-harness
autonomy ladder with decay, the stale-memory re-verification probe, and the K6/K9
judgment pattern (deterministic first, model-judge last, no API key).

## User Stories

1. As a maintainer tuning evals, I want dev/test fixtures physically split,
   so that reported numbers are never tuned numbers (K2).
2. As a maintainer reading a failure, I want every run tagged infra vs agent
   fault, so that harness outages never masquerade as model failures
   (K12–K14 pattern).
3. As a maintainer guarding quality, I want must-not-fire negatives at ~half
   the suite, so that a gate that cannot stay silent is caught (K3–K5).
4. As an orchestrator delegating, I want VERIFY-exact-command + TIMEBOX +
   partial-return in every brief (J2), so that delegates return checkable
   work, not narration.
5. As an adopter on any harness, I want staged autonomy (audit-only →
   veto-proven → trusted) with decay, so that old proofs never grant
   permanent trust (M1/M2, L9).
6. As a maintainer, I want stale lessons re-verified against current
   behavior (D11 as a real check), so that dead memory cannot gate live work.
7. As a maintainer needing cheap judgment, I want deterministic/code-first
   verdicts with a model judge only as last resort and no API key (K6/K9),
   so that bounded decisions stay fast and free.
8. As a maintainer, I want pass@k + reliability reporting on repeated runs,
   so that capability and flakiness are never conflated (K12–K14).

## Decisions Already Made

- Adopted (breakpoint round 1): eval-contract, J2 brief, autonomy ladder,
  stale-memory probe — plus the K6/K9 local-judgment pattern (round 2).
- Not adopted: Jev model-slot usage, auto-downgrade paths, uncalibrated
  scores, Likert verdicts, agent self-grading, second graph system.
- Evidence base: `.trust/coworker-research/*.md` (jev harness loop graph
  memory evals); the alleged no-API Jev article was not found — proceeded
  on K6/K9 instead, honestly recorded.
- Shape: five vertical slices, one per transfer; shared research already
  done (this spec's Origin), not repeated per ticket.

## Testing Decisions

- What counts as a good test: exit codes + marker presence + strip/mutation
  dances on real files — presence assertions alone are theater (repo
  doctrine, proven across tickets 01–08).
- Modules (seams, existing only): eval marker checks, doctor verdicts, the
  delegation prompt shape, lessons tier, verdict composition fns. New seams
  only where no existing seam reaches (stale-probe runner, ladder state).
- Prior art: checks 35–38 + pins, K8 call-marker, W-suffix wiring suites,
  G-suffix strip loops, live CLI derivations.

## Constraints

- Zero new runtime dependencies; Node builtins only.
- No model-judgment API keys anywhere in the framework (K6/K9 decision).
- No second graph/memory/eval system beside the existing ledger, ticket
  DAG, and eval tiers — extend, never duplicate.
- Every transfer ships its RED proof (strip/mutation/live) in-session.
- Iron Law 4: publish + landings wait for Master.

## Acceptance Criteria

1. (US1) Dev/test fixtures physically separated + the check rejects tuning
   in the reported numbers — automated test (marker + layout).
2. (US2) Every eval run tagged infra vs agent fault — automated test
   (verdict shape + counter in both directions).
3. (US3) Negatives suite at ~half + a gate that cannot stay silent is
   caught — automated test (ratio + a red must-not-fire case).
4. (US4) The delegation brief carries VERIFY-exact-cmd + TIMEBOX + partial
   — automated test (template marker + one filled example).
5. (US5) The per-harness autonomy ladder + decay applies — automated test
   (a stale status drops a rung, it does not hold).
6. (US6) The stale-memory probe runs + a dead lesson cannot gate —
   automated test (stale lesson vs current behavior).
7. (US7) Bounded judgment without an API key + model-judge last —
   automated test (zero-dep + deterministic-first ordering).
8. (US8) pass@k + reliability + flakiness reporting — automated test
   (report shape + deterministic repeated runs).

## Out of Scope

- Jev API / model-slot judgment / model calibration (explicitly rejected).
- Semantic retrieval over the ledger (deferred until real scale).
- New harness adapters (tracks 07/08).
- Changing the already-decided WARN/FAIL severity.

## Open Questions

- The "half" negatives threshold: exactly 50% or a range?
- The ladder decay limit (how many days without evidence)?
- The stale-memory probe verdict format: a new finding or reuse
  lesson-gap?

## Adversarial self-review

- Ambiguity: "physically separated" → CLARIFIED: separate dev/ vs test/
  directories, not a flag.
- Contradiction: US7 (no API) vs judge-last → NOT a contradiction:
  judge-last = the same session's model, not an external API; even without
  it, deterministic must be enough to gate.
- Hidden assumption: the harness supports cheap repeated runs → DECLARED
  in Constraints? Not yet — MOVE to Open Questions if implementation needs
  it. (Recorded here so it is not lost.)
- Untestable: "defense in depth" → Avoided; every AC above is
  fail-complete (marker missing / ratio drops / stale status holds).
