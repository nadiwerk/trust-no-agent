# Spec: full enforcement — block-total, fail-closed, every harness

Status: published (approved Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: Master demand — trust-no-agent must not be ignorable text; when fully
installed, discipline holds without defiance. Breakpoint 2026-10-13 (2 rounds,
frontier empty). Builds on hardening-general 01–08 (proven live on opencode
v2.0.27) and newcomer-escalation 01–03.

## Problem Statement

As the owner of the framework, I want a fully installed trust-no-agent across
various projects to be 100% disciplined — not text instructions the model reads and
then ignores under pressure. Today its enforcement piggybacks on an API that can die,
gates punish words rather than actions, and every harness carries a different
guarantee level with nothing forcing the highest one.

## Solution

Raise every harness with an adapter to a live-proven fail-closed veto, refuse
violating merges in CI, and state honestly per harness which is veto-guaranteed vs
audit-only. Doubt = block; a claim without live proof = a proposal, not a guarantee.

## User Stories

1. As an adopter on opencode V2, I want irreversible calls blocked without
   fresh evidence on every install (not just this repo), so that the proven
   veto travels with the framework.
2. As an adopter on Claude Code, I want the PreToolUse exit-2 veto proven
   live (not assumed from docs), so that the guarantee is measured.
3. As an adopter on Codex, I want the PreToolUse forwarding proven live, so
   that the hooks file is more than a declaration.
4. As an adopter on OMO, I want a veto adapter or a written reason why
   audit-only is the ceiling, so that the gap is owned, not silent.
5. As an adopter on omp/Devin, I want adapters or dated live-proof plans, so
   that doc-first WARN has an expiry, not an eternity.
6. As a maintainer, I want CI to refuse merges that violate the boundary
   (failing gate = red build), so that main stays the proven line.
7. As a maintainer, I want fail-closed semantics pinned (doubt blocks, with
   the reason surfaced), so that no adapter quietly degrades to fail-open.
8. As a maintainer, I want the per-harness guarantee table to fail CI when a
   row claims veto without a live proof attached, so that the table cannot
   inflate itself.

## Decisions Already Made

- "100%" = block-total: veto blocks every irreversible attempt without
  evidence (breakpoint round 1).
- Scope: all harnesses — opencode, Claude, Codex, OMO, omp, Devin (round 1).
- Fail-closed on doubt, with the reason surfaced (round 1).
- Gates run both locally (hooks) and in CI (round 2).
- Blocked package: commit/push/publish/delete/destructive migration (round 2).
- Honest per harness: 100% claimed only where an adapter with live proof
  exists (round 2).

## Testing Decisions

- What counts as a good test: live denial/allow runs on the real harness
  plus fixture suites that fail when wiring is removed (mutation/strip
  dances, not presence assertions).
- Modules (seams, existing only): the per-harness hook CLIs (gate-hook,
  tna-gate plugin), eval marker checks, the CI workflow + pre-commit hooks,
  the doctor meter (veto-fire counts as the proof stream).
- Prior art: probe-4–8 live runs (deny + allow), W2 mutation probe, check
  35/36/37 strip dances, K8 call-marker pattern.

## Constraints

- Zero new runtime dependencies; Node builtins only.
- Same boundary everywhere (irreversible package); adapters differ, the line
  does not.
- No veto without a live proof attached; assumed contracts stay labeled
  assumed until a run proves them.
- Fail-closed never swallows the reason — every denial names the missing
  evidence and the way to open the gate.
- Iron Law 4: publish + landings wait for Master.

## Acceptance Criteria

1. (US1) The opencode veto installs from a standard install (not just this
   repo) — automated test (clean install + live denial fixture).
2. (US2) The Claude PreToolUse is proven to block live — human verification
   (live run) + automated test (manifest + exit-2 suite).
3. (US3) The Codex forwarding is proven live — human verification +
   automated test.
4. (US4) OMO: a veto adapter OR a written reason why audit-only is its
   ceiling — human verification (reading the decision).
5. (US5) omp/Devin: an adapter OR a dated live-proof plan — human
   verification.
6. (US6) CI goes red when the boundary is violated — automated test
   (pipeline fixture or mutation: remove the wiring → red build).
7. (US7) Doubt = block + the reason surfaced — automated test (an unknown
   shape → deny, not a silent allow).
8. (US8) The guarantee table fails CI when a row claims veto without live
   proof — automated test (eval marker: every veto row links evidence).

## Out of Scope

- Harnesses beyond the six decided ones (round 1).
- Actions outside the irreversible package (round 2).
- Changing the already-decided doctor WARN/FAIL severity.

## Open Questions

- Execution order per harness (parallel vs one at a time)?
- The live-proof deadline for omp/Devin before its row is downgraded?

## Adversarial self-review

- Ambiguity: "fully installed" → CLARIFIED: router + skills + hooks + a
  green doctor in the adopter's project (post-install verification).
- Contradiction: "all harnesses" vs "honest per harness" → NOT a
  contradiction: the scope covers all; a veto claim only where an adapter
  with proof exists.
- Hidden assumption: harnesses allow a hook/tool-gate → DECLARED: those
  that do not stay written-down audit-only (-US4/US5 are the outcome).
- Untestable: "without defiance" → TRANSLATED into falsifiable AC1–AC8;
  the model's intent is not measured, blocked/caught behavior is.
