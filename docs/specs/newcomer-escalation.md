# Spec: newcomer escalation — first-run onboarding gate + docs hardening

Status: published (approved by Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: Master question on first-time-user "defiance"; breakpoint 2026-10-13
(2 rounds, frontier empty). Scribe attempt cancelled by Master; this spec is
the breakpoint's output. Evidence: session findings (self-trigger 0/3,
dual-router arbitration, zombie skills, stale registries, API-harness
audit-only decision A).

## Problem Statement

As a new trust-no-agent user, I follow the install but the agent still
behaves "defiantly": skills are not loaded, receipts are skipped, old
behavior persists. I cannot tell whether my install is broken or the
framework is weak — no check tells me in the first session.

## Solution

Two-layer escalation, docs first then gate: (1) harden the onboarding flow in
the docs so that every step can be verified — not merely read; (2) add a
mechanical first-run gate that checks doctor green + skills reachable AND
the Iron Laws recitable from the project's router, before discipline is
claimed to be running.

## User Stories

1. As a first-time adopter, I want install steps I can verify one by one, so
   that I know which step failed instead of guessing.
2. As a first-time adopter, I want a single mechanical verdict after install
   (not five manual checks), so that "is it working?" has one answer.
3. As a first-time adopter with an existing router, I want the adoption
   interview to prevent dual-router setups, so that the model never
   arbitrates by forgetting one router.
4. As a first-time adopter, I want stale/zombie skills purged during install,
   so that pre-adoption behavior cannot resurrect weeks later.
5. As a maintainer answering "it disobeys" reports, I want the doctor output
   as the mandatory first artifact, so that support starts from evidence.
6. As a maintainer, I want the first-run gate to check doctor AND recital
   (per breakpoint decision), so that neither wiring-only nor prose-only
   installs pass silently.
7. As a maintainer, I want every new onboarding rule pinned by an eval check,
   so that docs drift fails CI instead of rotting quietly.

## Decisions Already Made

- Target: both — docs first, gate follows (breakpoint round 1).
- Evidence: this session's findings, no new evidence gathering (breakpoint
  round 1).
- Output: spec + tickets (breakpoint round 1), not notes only.
- The gate checks doctor+skills AND reciting the Iron Laws (breakpoint
  round 2).
- Diagnosis stands: apparent defiance = unwired enforcement + stale memory,
  not disobedience (session findings; the ADR was cancelled, not published).

## Testing Decisions

- What counts as a good test: exit codes + marker presence on real files —
  a gate test that passes with the wiring removed is theater.
- Modules (seams, existing only): the doctor CLI (first-run verdict),
  eval marker checks (docs invariance), the post-install verification section
  (human half). No new modules proposed.
- Prior art: eval checks 31/36 (docs-marker guards with RED/GREEN proofs),
  doctor C-checks (mode-aware verdicts), gate-meter.test.mjs (fixture style).

## Constraints

- Zero new runtime dependencies; Node builtins only for any script touched.
- No sterner-prose-only fixes — every onboarding rule ships with its
  mechanical check (encode-twice doctrine).
- Existing install paths keep working; hardening is additive (merge, not
  copy-over), per the adoption doctrine.
- Iron Law 4: publishing the spec and landing tickets both wait for Master.

## Acceptance Criteria

1. (US1) Every new/changed install step carries its one-line verification
   method — automated test (eval marker present).
2. (US2) A single first-run verdict exists (doctor green + skills reachable +
   recite) — automated test (green suite + RED/GREEN proof when the wiring
   is removed).
3. (US3) The adoption flow rejects dual-router setups (interview + merge,
   no copy-over) — human verification (reading the flow) + automated test
   (marker).
4. (US4) The install/uninstall flow (install + de-adoption) is fully
   documented — automated test (purge marker + sweep present in the docs).
5. (US5) The support guidance "ask for doctor output first" is written down —
   human verification (reading the docs).
6. (US6) The gate checks BOTH sides (doctor and recite), not just one —
   automated test (the suite fails when one side is removed).
7. (US7) Every new onboarding rule is guarded by an eval check — automated
   test (green eval + RED proof per check).

## Out of Scope

- New harness adapters (tickets 07/08 are their own track).
- Changing the existing WARN/FAIL severities in doctor.
- Rewriting the install docs from scratch — additive hardening only.

## Open Questions

- First-run gate WARN or FAIL when unmet? (Not discussed in the breakpoint —
  do not assume; proposed default: WARN, following the doctor doctrine for
  installs.)
- Where does the gate live: part of doctor, a new script, or both?

## Adversarial self-review

- Ambiguity: "recitable" → CLARIFIED: the model quotes the 4 Iron Laws from
  the project's router (not from the framework checkout) when asked, first
  session.
- Contradiction: US2 (one verdict) vs US6 (two sides) → NOT a contradiction:
  the one verdict is COMPOSED of two sides; both must be green.
- Hidden assumption: the harness has a skill system → STATED: the
  no-skill-system fallback follows the same flow (router recital + doctor
  without C3).
- Untestable: "knowing which step failed" (US1) → KEPT via the check-method
  marker: every step names its verification command.
