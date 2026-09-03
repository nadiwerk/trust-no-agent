# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nadiwerk/trust-no-agent/releases/tag/v0.1.0
