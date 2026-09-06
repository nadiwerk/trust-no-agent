# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- AGENTS.md §3 proposal-handoff rule (commit `863d9fb`, eval check #19): after every chain stage and every unit of work the model proposes the concrete next step — skill by name, why now — and waits for approval, so a user-invoked chain never stalls because the user didn't know the next skill.
- AGENTS.md §1 registry-check rule (commit `f7ac9bb`, eval check #20): "`fast` skips the chain, never the registry" — before answering any task, the skill registry is checked once and a matching skill (the framework's own or an external one) is proposed by name regardless of class. Origin: designed probe (2026-09-06, 4 runs) — fast-classified requests never considered the registry (2/2 recurrence); results in `evals/live-results.md`.
- README restructured for focus (~219 → ~149 lines): the per-skill chain bullets, Contributing detail, and Portability duplication moved/linked to CONTRIBUTING.md and docs/; the differentiator table gains memory-tiers, rule-inheritance, real-data-UI, and lazy-by-default rows; classification now carries the registry-check rule.
- `evals/self-trigger-battery.md` — standalone protocol for scenario 13 (`evals/scenarios.md` S13): tests whether fresh agents load MANDATORY discipline skills unprompted across harnesses (OMO, DSH, Pi, Codex, Claude Code, ZCode). Includes pre-flight checks, launch procedure (9 runs per harness), grading rubric, and anti-manufacture rules to ensure honest evaluation of self-triggering capability.
- `scripts/doctor.mjs` C5 raised from WARN to grace-then-HARD (user-approved 2026-09-06): a ledger with entries but no `.trust/lessons.md` warns during a 14-day grace period measured from the oldest dated entry (ship-log `## YYYY-MM-DD` headers), then FAILS with exit 1 — after grace, lesson capture is mandatory, not optional. Decision logic extracted to `scripts/corrective-tier.mjs` (`checkStarve`, testable without doctor's CLI side effects); a ledger with no parseable dates degrades to WARN. Test override: `TNA_DOCTOR_GRACE_DAYS`.
- `scripts/doctor.test.mjs` — fail-first self-test for the grace logic (7 expectations: warn/fail boundary, lessons-exists, no-dates, empty ledger). Wired into CI (validate + windows jobs) and pre-commit; the contributing gate list grows from three to four commands.

## [0.1.7] - 2026-09-06

### Added
- `scripts/corrective-tier.mjs` — corrective tier starvation check for doctor.mjs C5
- `scripts/doctor.test.mjs` — fail-first test for doctor C5
- `evals/self-trigger-battery.md` — standalone protocol for scenario 13 self-trigger battery

### Changed
- `scripts/doctor.mjs` — C5 now enforces corrective tier with a 14-day grace period before failing; uses checkStarve from corrective-tier.mjs; added TNA_DOCTOR_GRACE_DAYS test override
- `evals/scenarios.md` — updated S13 description to clarify battery completion steps and added note about updating three places when a battery completes

### Removed
- README — the "What 'verifiable' means", "What 'reviewable' means", and
  "What 'honest' means" sections from 0.1.6 are reverted after user review.
  The trio keeps its one-line mention in the intro; the depth stays in
  [docs/philosophy.md](docs/philosophy.md) and The honest limits section.

## [0.1.6] - 2026-09-05

### Added

- `docs/chat-receipt.md` — the 4-block chat receipt (Verdict / Bukti / Belum /
  Next) closing every `full`/`loop` unit in chat, recorded in
  `docs/rule-inheritance.md` as the router's first gated rule (§6).

### Fixed

- `docs/chat-receipt.md` — the Bukti block no longer demands a visible
  fail-first cycle for non-behavioral units (docs, config, typo): provide
  existence/exit-code evidence instead; inventing a FAIL to fill the template
  is forbidden.
- `AGENTS.md` §6 — receipt duty scoped to `full`/`loop` units; `fast` units
  skip the ceremony (classification precedes the chain), matching the
  "don't run the full ceremony on a typo" principle.
- `evals/live-results.md` — binding grading note added: the ZCode round's A3
  PASS covers behavior only; narration that invents user sanction is a defect
  to flag, never a grading precedent.

### Changed

- README — "verifiable" is now shown, not just named: a one-line concrete
  definition ("every 'done' ships with the command, the output, and the exit
  code from this session — if you can't re-run it, it isn't done") plus a
  side-by-side claim-vs-evidence section ("What 'verifiable' means") placed
  right after the philosophy one-liner.
- README — "reviewable" gets the same treatment: a "What 'reviewable' means"
  section with a without/with contrast (wall-of-diff vs scoped, AC-bound,
  severity-labeled review) and a sample interview dialog showing decisions
  arriving to the user as questions.
- README — "honest" completes the trio: a "What 'honest' means" section that
  points back at the receipt's own Belum line as the proof ("nothing forced
  that line to exist"), a gate-semantics line, and the self-applied twist —
  the framework states its own limits (The honest limits).

## [0.1.5] - 2026-09-04

### Added

- `scripts/doctor.mjs` — installation self-check for adopters: verifies router
  files present, `core.hooksPath` active with both hooks (and identical to the
  tracked copies when run from a clone), all 11 skills reachable from a harness
  discovery path (repo, project-local, or `~/.agents/skills`), and `.trust/`
  gitignored once the ledger exists. Exit 0 = healthy, exit 1 = gaps named with
  their fix. Pointed to from `docs/installation.md` §Post-install verification.
- CI: a `hooks` job exercises pre-commit + commit-msg on a scratch repo
  (valid commit passes, non-conventional message is rejected) and a `windows`
  job runs both gates on Windows — hooks can no longer rot silently, and the
  Windows dev surface is covered.
- `evals/scenarios.md` scenario 13 — rerunnable self-trigger battery for the
  MANDATORY skills: 3 tasks × 3 runs per harness, nothing pinned, graded on
  whether the skill is actually *loaded* (not on correct behavior from general
  judgment). Includes a self-trigger evidence log with the original 0/3 claim
  rows and a pending row for ZCode as the third harness.
- `docs/compatibility.md`: ZCode row (live audit 2026-09-03, 4 parallel
  dimension reviewers) + Evidence column distinguishing doc-verified from
  live-executed rows + ZCode adapting note (skills discovered at session start;
  mid-session installs need a reload).
- `scripts/tickets.mjs` + `scripts/tickets.test.mjs` — mechanical ticket-graph
  validator for `fork-it` local tickets (`.trust/<slug>/issues/`): blockers
  resolve, numbering stays blockers-first, graph is acyclic (Kahn). Wired into
  CI (validate + windows jobs), pre-commit, and the `fork-it` publish gate.
- `scripts/eval.mjs` checks 13/14/15 (HARD) — canonical large-feature chain
  identical across WORKFLOW.md, AGENTS.md, docs/skills/README.md, root README;
  trigger-matrix large-feature row bound to the chain; `fork-it` publish gate
  marker present. Closes all 3 Required findings of the 2026-09-03 omx audit.

### Fixed

- `scripts/validate.mjs` check 7 — the mirrored `docs/skills/` pages are now
  walked for stale backtick skill references; the pre-existing `walkFiles`
  helper finally has a call site (it was dead code). Skill-shaped tokens only,
  so code identifiers (`relay.ts`, `ECONNRESET`) are not false positives.
- `scripts/eval.mjs` check 6c (HARD) — each MANDATORY skill must carry its own
  Iron Law sentence inside its own SKILL.md body, not just be named in the
  router trigger matrix. Proven non-tautological: stripping an Iron Law fails
  eval with exit 1.
- Trimmed skill descriptions (`no-thanks`, `expect-fail`, `save-as`) —
  editorial content and redundant trigger lists removed; trigger-pure per §8
  (context is a budget), YAML quoting preserved.

## [0.1.4] - 2026-09-03

### Fixed

- `.omx/` (orchestrator runtime dir) is now gitignored and excluded from the
  validator's file walk, so runtime junk cannot leak into commits or confuse
  the backtick-reference scan.
- `CHANGELOG.md` is no longer gitignored — the contributing contract requires
  updating it, which was impossible while it was ignored.
- `make-it-so` repair loop: the cap is now unambiguously a hard two-round
  stop (previously the "continue while improving" clause contradicted the cap
  and the mirror doc).
- `roast-my-code`: added a serial fallback for harnesses whose delegation
  tool cannot spawn three parallel subagents — the same axis briefs run
  sequentially in fresh contexts, preserving the context-isolation goal.
- `docs/installation.md` skill-folder count corrected to 11 (was "12"), and
  `docs/compatibility.md` OMO setup now includes `root-cause` in the
  model-invoked list (it was the one skill missing from both lists).

### Notes

- This release applies the first batch of findings from a full read-only audit
  of the repo (skills / workflow-router / harness / graph-loop dimensions).
  Remaining audit findings (enforcement depth, docs cleanup, description
  trims) land in subsequent patch releases.

## [0.1.3] - 2026-09-02

### Added

- Dedicated contributing guide (CONTRIBUTING.md), linked from the README, with
  the repo tree and hook activation instructions.

### Changed

- README: core-loop section reformatted as bullets; contributing bullets
  tightened (hook command inlined, then restored as a code block).

## [0.1.2] - 2026-09-02

### Added

- Live eval results for the tier A-D scenario suite (10/10 pass) recorded in
  `evals/live-results.md`.

## [0.1.1] - 2026-09-02

### Fixed

- Pre-commit and commit-msg hooks are committed executable (100755).

### Changed

- CI actions (checkout, setup-node) pinned to full SHAs.
- README notes the npx supply-chain verification step before install.
- commit-msg hook documented as a quality gate, not a security boundary.

## [0.1.0] - 2026-09-02

### Added

- Initial public framework: AGENTS.md router, WORKFLOW.md core rules, 11
  skills across discipline/engineering/meta tiers, validator + eval scripts,
  git hooks, CI, and full docs (design, philosophy, installation,
  compatibility, rule-inheritance, per-skill pages).

[Unreleased]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nadiwerk/trust-no-agent/releases/tag/v0.1.0
