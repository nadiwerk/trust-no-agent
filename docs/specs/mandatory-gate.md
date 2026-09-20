# Spec: mandatory-gate — mechanical pre-gate for MANDATORY skill routing

Status: draft (awaiting owner approval before tickets)
Date: 2026-09-20
Origin: internal evaluation of mechanical-enforcement patterns for MANDATORY routing (ledger decision entry, 2026-09-20). The principle (mechanical enforcement over model initiative) is the framework's own — `docs/design.md` §Self-trigger is unreliable.

## Problem Statement

The router's MANDATORY discipline skills (`expect-fail`, `root-cause`, `receipts`) depend on the executing model choosing to load them at the right moment. The framework's own evals prove that choice is unreliable (self-trigger 0/3 — `docs/design.md`). Today the gap is held shut by two mechanisms — `load_skills` on delegation and the `Loaded:` ledger line checked by `ledger-audit.mjs` (M4) — but both operate *after* the fact: they count compliance, they never flag the obligation at the moment a task enters. A task that demands `receipts` can be worked start-to-finish with no signal at entry that a gate applies.

## Solution

A zero-dependency, pattern-based classifier script that inspects a task's text and emits a typed verdict: which MANDATORY skill's domain this task touches, or none. Its verdict is consumed by two existing surfaces — `ledger-audit.mjs` (a ledger entry whose task text the gate flagged but which carries no `Loaded:` line becomes a finding) and a new doctor C-check (the gate itself must be present and passing). The classifier is bilingual (English + Indonesian) because this project's real work happens in mixed-language sessions. It emits binary verdicts, no probabilities.

## User Stories

1. As an adopter running `ledger-audit.mjs`, I want ledger entries whose work text matches a MANDATORY domain to be checked for a `Loaded:` line, so that silent discipline drops become countable findings.
2. As an adopter whose entry legitimately used an unloaded skill domain, I want the audit finding to be worded as a signal to check (not a hard fail), so that pattern noise never blocks a healthy ledger.
3. As a framework maintainer, I want the gate's keyword tables to live in the script with tests, so that adding a trigger word is a tested change, not prose drift.
4. As a maintainer porting the framework to another harness, I want the gate to be a standalone script with no dependencies, so that it runs anywhere Node runs.
5. As a doctor user, I want a doctor check verifying the gate script exists and its self-test passes, so that a broken or missing gate is reported like any other installation defect.
6. As an agent working in a mixed English/Indonesian session, I want the gate to recognize Indonesian task phrasing ("perbaiki bug", "tulis test", "commit"), so that the gate is not blind to the session's actual language.
7. As a maintainer, I want explicit negative cases ("refactor test helper", "rename variable") to be tested as no-match, so that the gate cannot silently become a false-alarm machine.
8. As a future maintainer considering a judgment-model classifier variant (B), I want the gate's interface reduced to a pure function over text, so that variant B can replace the matcher without touching consumers.

## Decisions Already Made

(All four decided by the owner in breakpoint round 1, 2026-09-20.)

- **Scope: all three MANDATORY skills in v1** — receipts (done-claim/commit), expect-fail (test-writing), root-cause (bug/failure). Not receipts-only.
- **Language: English + Indonesian keyword patterns.** Bilingual tables per skill.
- **Integration: standalone script consumed by `ledger-audit.mjs` (new finding class) + a new doctor check.** No new git hook, no prompt interception.
- **No probabilities in v1.** Binary match/no-match verdicts; probability-weighted scoring is variant B, deferred. The module interface stays a pure function over text so variant B can slot in later.
- **Attribution contract** (from ledger decision entry): original implementation — no external skill code or assets reused; origin recorded in ledger and in this spec's Origin line; the principle is the framework's own, cited to `docs/design.md`.
- **Audit severity:** a flagged-without-`Loaded:` finding is a *warning-level* signal, not a fail — the ledger-audit false-signal lesson (v0.1.15) forbids turning a keyword matcher into a hard gate on uncalibrated patterns.

## Testing Decisions

- What counts as a good test: the exported classifier function's verdicts on representative task texts — positive cases per skill per language, negative cases, and the audit-integration check (flagged entry text + missing `Loaded:` → finding). No implementation-detail tests.
- Modules tested: the new gate script (classifier + finding logic), consumed by the existing `ledger-audit.test.mjs` and `doctor.test.mjs` patterns.
- Prior art: `reinject.test.mjs` and `ledger-audit.test.mjs` — extracted pure decision logic imported by fail-first tests, CLI side effects kept out of the import path (same pattern as `corrective-tier.mjs`).

## Constraints

- Zero dependencies; Node built-ins only; must run on the version CI already runs.
- The gate never mutates anything: it reads text, returns verdicts. All enforcement stays with the existing consumers.
- No external judgment-model APIs or code in v1 — original implementation only (the binary matcher is the whole interface; variant B is out of scope).
- Finding severity from the gate is warn-level; it may never fail an audit by itself until calibrated against real ledger data.
- Every trigger keyword lands with a test (positive or negative), never prose-only.
- The `Loaded:` contract line in AGENTS.md §2 stays authoritative; the gate paragraph added there must reference the script as the mechanical boundary, per the encode-twice doctrine.

## Acceptance Criteria

1. (US 1) A ledger entry whose Summary text contains a done-claim pattern ("commit", "shipped", "selesai") and lacks a `Loaded:` line produces a warn-level finding naming `receipts` — automated test.
2. (US 1) The same entry WITH a `Loaded: receipts` line produces no such finding — automated test.
3. (US 6) Task texts in Indonesian ("perbaiki bug ini", "tulis test untuk modul X") produce the correct `root-cause` / `expect-fail` verdicts — automated test.
4. (US 7) Negative cases ("rename variable", "refactor test helper", "update README") produce no verdict for any skill — automated test.
5. (US 3) Every keyword in the gate's tables is exercised by at least one passing test case — automated test (a table-vs-tests consistency check inside the test file).
6. (US 4) The gate script imports only Node built-ins and runs clean under `node scripts/validate.mjs` / existing CI gates — automated test (CI run).
7. (US 5) Doctor reports a fail-level defect when the gate script is missing and a pass when its self-test suite passes — automated test via `doctor.test.mjs` pattern.
8. (US 8) The classifier's public interface is a single pure function (text in, verdicts out) with no I/O — automated test (import the module, assert verdicts, no fixtures/mocks needed).
9. (US 2) The audit finding message explicitly says the verdict is a keyword-pattern signal to verify, not a proven violation — human verification of the finding text in the test fixtures.
10. (Origin contract) The spec's Origin line and the ledger attribution entry exist and record the internal-evaluation origin with no-code-copied — human verification (this document + `.trust/progress.txt`).

## Out of Scope

- Variant B (model-judgment/probability classification), any network calls, API keys.
- New git hooks or ZCode hooks; prompt-time interception.
- Enforcing on live sessions (the gate reads task text passed to it; it does not watch sessions).
- Calibration of thresholds (nothing to calibrate in a binary matcher; ledger data decides if/when variant B is justified).

## Open Questions

(none — all frontier decisions settled in breakpoint round 1)
