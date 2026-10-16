# Spec: hardening-general — mechanical enforcement beyond prose

Status: published (approved by Master 2026-10-12) — awaiting fork-it
Date: 2026-10-12
Origin: Master's complaint (the model bypassing gates/iron wall/receipt, faking compliance) + 3 structural cracks in the screenshot (enforcement riding on a dead API, word-gate, no meter) + the fail-closed pattern of the Omo worker. Breakpoint: 6 decisions, 2026-10-12.

## Problem Statement

As Master, I am frustrated that the model can ignore gates, the iron wall, and receipts — discipline and receipts do not run according to the trust-no-agent philosophy (don't trust anyone, even themselves), and the model can fake agreement (write Loaded:, verdict yes) yet still violate. TNA today is strong as an audit checklist, weak as a guarantor: enforcement rides on a dead API, the gate punishes words instead of actions, and nothing measures the gate itself.

## Solution

Change the enforcement layer from advisory text to mechanical at the action boundary, via per-harness adapters, with observable evidence and an effectiveness meter. The core stays harness-agnostic; only the veto/audit adapter is per-harness. Words ("done") are only a signal; what gets blocked/audited is action without evidence (commit/push without a fresh test, Loaded:/receipt claims without evidence).

## User Stories

1. As an adopter on opencode V2, I want irreversible tool calls (git commit/push, publish, delete, destructive migration) blocked without sign-off + fresh evidence, so unverified work cannot reach shared systems.
2. As an adopter on Claude Code, I want the same guarantee via the Claude hook surface, so the promise holds outside opencode.
3. As an adopter on Codex, I want the same via codex.hooks.json, so the promise holds there too.
4. As an adopter on OMO, I want the delegation contract to use load_skills where it exists and the inline+veto fallback elsewhere, so enforcement never depends on one dead API.
5. As an adopter on omp/Devin (doc-first), I want the adapter documented with WARN degrade until live proof exists, so I know what I am getting.
6. As a maintainer, I want Loaded: + receipt verdicts cross-checked against observable evidence (tool log / test output / diff ref), so fake compliance becomes a countable finding.
7. As a maintainer, I want the word-gate augmented by an action-gate (tool name + args) and an evidence-gate, so saying "done" is never punished but acting without evidence is.
8. As a maintainer, I want a gate-effectiveness meter (per-harness TRIGGER S13 scores, veto-fire log, fake-detect count) surfaced in doctor, so "strong" is measured, not asserted.
9. As a maintainer, I want eval check 6b revised from the literal load_skills string to the adapter contract, so CI enforces the new boundary instead of the dead API.
10. As an adopter, I want per-harness install docs stating veto vs audit-only per action, so the guarantee is legible before I rely on it.

## Decisions Already Made

- Scope: all live harnesses (OMO, Claude Code, Codex, opencode V2) + omp + Devin doc-first WARN (breakpoint R1+R2, 2026-10-12).
- Fail-closed boundary: irreversible actions only; ordinary write/edit stays fail-open.
- Anti-fake-compliance: Loaded: + the 5-boolean verdict requires observable evidence; a claim without evidence = finding.
- Meter: doctor WARN only when the meter is off; never CI FAIL (Master's decision).
- Eval 6b: revised to the adapter contract (not the literal load_skills).
- Omp/Devin: doc-first, WARN degrade until live proof exists.

## Testing Decisions

- What counts as a good test: verdicts on observable inputs (tool-call fixtures, ledger-entry texts, hook manifests, router prose markers) — never narration, never implementation details.
- Modules (seams, minimal, the highest that exist):
  - Seam A (new): action-gate pure fn over tool calls (tool, args, state) — zero deps.
  - Seam B (existing): auditLedger() + a new fake-compliance finding — extend, not a new module.
  - Seam C (existing): doctor checks (gateVerdict/hookVerdict + a new verdict meter) — extend.
  - Seam D (new): opencode plugin tool.execute.before/after + state file — fixture-driven.
- Prior art: mandatory-gate.test.mjs, ledger-audit.test.mjs, doctor.test.mjs, gate-hook.test.mjs (pure-fn pattern + RED/GREEN + boundary-matched consistency).

## Constraints

- Core is harness-agnostic; only the adapter is per-harness. No discipline logic inside the adapter beyond veto/audit wiring.
- Fail-closed only for irreversible actions (commit, push, publish, delete, destructive migration). Ordinary write/edit is fail-open.
- Every new finding (including fake-compliance) is warn-level; meter off = WARN, not FAIL.
- Scripts: zero runtime deps, Node builtins only. Plugin: JS only, no new deps.
- No hard requirement on the literal load_skills string anywhere except as one available adapter.
- Omp/Devin: doc-first, WARN degrade; no hostable/live claim before live proof.
- Security: local state file only (.trust/, gitignored), no secrets, no exfil; the veto throws a reasoned Error, never blocks silently.
- Prose + check (encode-twice): every new contract above is guarded by one HARD eval check.

## Acceptance Criteria

1. (US1) A tool-call fixture `bash git commit` without a fresh test-pass in the state file is REJECTED by the opencode plugin (throw) — automated test.
2. (US2) The Claude hooks manifest carries a PreToolUse-equivalent guard for the same actions — automated test (parse manifest + guard present) + human live verification.
3. (US3) codex.hooks.json carries the same guard — automated test + human live verification.
4. (US4) AGENTS.md §5 names the adapter matrix and no longer requires the literal load_skills as the only path — automated test (revised eval check).
5. (US5) compatibility.md + installation.md mark omp/Devin doc-first WARN with the degrade note — automated test (marker check).
6. (US6) A ledger entry containing `Loaded: receipts` + an all-yes verdict WITHOUT a reference to test output/diff produces a fake-compliance finding — automated test (RED before, GREEN after).
7. (US7) A prompt containing the word "done" with no tool action produces NO finding; a commit tool call without evidence produces a finding — automated test.
8. (US8) Doctor prints the meter (TRIGGER score, veto-fire count, fake-detect count) as WARN and exits 0 when the meter is absent — automated test.
9. (US9) Revised eval check 6b FAILs when the adapter contract is removed and PASSes when restored (RED/GREEN proof) — automated test.
10. (US10) The per-harness install table states veto vs audit-only per action — human verification (reading the docs table).

## Out of Scope

- Variant B (model-judgment/probability classifier), network calls, API keys.
- Blocking all write/edit; fail-closed beyond irreversible actions.
- CI FAIL for a meter being off (decided: WARN only).
- Live proof for omp/Devin (doc-first first).
- New git hooks beyond the existing ones.

## Open Questions

- The exact name of Devin's hook surface (research the docs, agent facts — not guesses).
- Final state-file schema (field names, veto-fire log rotation).
- Bulk vs flat threshold for fake-compliance findings in doctor (follow the BULK_THRESHOLD pattern or flat).

## Adversarial self-review

- Ambiguity: "fresh evidence" → CLARIFIED in Constraints + AC1/AC6 (test-pass in the same session/state, not an old run).
- Contradiction: "all harnesses" vs "omp/Devin doc-first" → CLARIFIED (all = scope, doc-first = guarantee level; the install table distinguishes veto vs audit-only).
- Hidden assumption: the state file exists before the first veto → STATED (the plugin creates the state when absent; the veto reads absence as "no evidence" = reject for irreversible).
- Untestable: AC2/AC3 "human live verification" → KEPT as a second check alongside the automated manifest test (not the only check).
