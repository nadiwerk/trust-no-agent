# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.20] - 2026-09-23

### Added
- Receipt delivery contract — plain chat text, blocks separated (2026-09-23, two owner findings at the render layer in one session): (1) a receipt sent inside a fenced code block rendered in the owner's chat UI as a clipped scrollable file card ("file md tidak masalah tapi yang paling penting buat user adalah isi receipt langsung muncul di chat"); (2) four tight single-newline lines collapsed by markdown renderers into one merged paragraph ("saya tidak terbaca yangmana yang done, evidence, open, next. Pisahkan atau kasih spasi agar terbaca"). `docs/chat-receipt.md` gains two Delivery paragraphs: the receipt is plain chat text in the message body — never a fenced code block (a fence is a file, not a card) — and each block starts its own paragraph with a bold lead (verdict line bold; `Evidence:`/`Open:`/`Next:` bolded labels), because spacing is the skim test's rendering prerequisite. Archive files (ledger, `evidence.md`) supplement the in-chat receipt, never replace it. Encode twice: `scripts/eval.mjs` check 26 now guards all four receipt markers literally (skim test + delivery + separation). Teeth verified, not assumed: a neutralized marker turned eval RED (exit 1, naming the rule), a byte-identical restore turned it GREEN. Register rows, the corrective-tier lesson, and the private memory record kept aligned. Deliberate limit, stated: render quality itself is judged by the owner's eyes — no automated check claims it. Verified: full battery 12/12 EXIT 0 (validate, eval + all 10 suites) plus the pre-commit hook gates re-running at `5c7ad3f` and at the release commit.

### Fixed
- The chat-receipt Example taught a rule violation (2026-09-23, found by the consistency sweep the owner asked for with the commit): `Next: none` on T01, a chain ticket, contradicts rule 4's tightened "none" semantics (whole-thread-closed only) — the example now shows "proceed to T02". The Shape and Example also demonstrated the pre-delivery form (tight unlabeled lines), teaching every reader the exact shape the contract now forbids; both are rewritten in the canonical separated, bold-labeled form.

## [0.1.19] - 2026-09-23

### Added
- Every close now carries a forward arrow — `Next: none` only when the whole thread is closed, enforced twice (2026-09-23, owner feedback: "sebagai user kadang tidak tau harus apa, termasuk saya. Jadi next itu sangat diperlukan" — receipts whose `Next:` was missing or read "none pending" mid-chain left the owner stranded even when the work itself was correct; ledger drift confirmed: `Next:` lines routinely ended "none pending" while work waited). The receipt contract (`docs/chat-receipt.md` rule 4) now states that "none" is a value, not an absence — it means the whole thread is closed and nothing waits anywhere — and AGENTS.md §6 gains the permanent rule via `docs/rule-inheritance.md` (register row with origin/rationale/scope/undo; scope: global). Mechanical twin: `scripts/ledger-audit.mjs` M7 `next-gap` flags any in-window entry with no `- Next:` line (presence bar, literal-line doctrine as `LOADED_LINE`), surfaced through doctor C7 like its M1–M6 siblings — `Next: none` counts as a value, only silence is the gap. Fail-first: K1/K4/K6 (flag when the line is missing; cousin phrases like `Next steps:` don't satisfy it; additive to `loaded-gap`) were RED before the check existed (3 expectations broke, exit 1) and GREEN after (62/62, exit 0); H5's fixture gained `- Next: none` because the new boundary invalidated its cleanliness assertion — the fixture was completed, the assertion not weakened. Deliberate limit, stated: a false "none" mid-thread is NOT mechanically detected (a genuinely closed-then-reopened thread would false-positive) — that half is prose-guarded. Verified: fresh in-session batch — `ledger-audit.test.mjs`, `doctor.test.mjs`, `eval.mjs`, `validate.mjs`, `reinject.test.mjs` all EXIT 0; doctor C7 live against this repo's own ledger proves the pipeline on the real artifact (8 legacy entries flagged as WARN leads, the new entry clean). Cost, stated honestly: +104/−3 LOC across 5 files, one regex test per ledger entry, no new dependencies; adopters will see `next-gap` WARN leads for legacy entries inside the 14-day window — a signal to verify, never a failure.

## [0.1.18] - 2026-09-23

### Fixed
- Ledger audit counted Self-Review checklist bullets as churn evidence (2026-09-23, found while cleaning 125 warnings on the Metrian adopter ledger — the same reader-creates-the-signal class as v0.1.15): `KNOWN_SUBSECTIONS` folds every `### Self-Review` head into the parent entry's body before M5's bullet scan, so each session's `- [x] **Maintainability**: … (revert 3001)` checklist line was read as an ordinary revert bullet. `normalizeRevertTarget` reduces any such line to the shared fixed prefix `x maintainability` (`[x]`→`x`, `**Maintainability**`→`maintainability`), so two unrelated sessions' checklists collided and the audit demanded the owner be re-consulted about churn that never happened. Fixed: M5 skips checkbox lines (`- [x]` / `- [ ]`) — a completed review checklist is a template repeat, not revert evidence; genuine `- Reverted …` bullets inside a Self-Review subsection still count. Fail-first: F5 reproduces the adopter collision (RED pre-fix with the exact `"2 reverts on x maintainability"` message, GREEN after); F6 counter-tests that real revert bullets in the folded subsection keep firing pre- and post-fix. Verified: full suite PASS via pre-commit hook; adopter ledger re-audit 125 → 122 findings with context-gap 0 and churn 0 (remaining findings are historical `loaded-gap`s inside the 14-day window, aging out).

## [0.1.17] - 2026-09-21

### Fixed
- Router re-injection could never emit the Iron Laws (2026-09-21, found by wiring the extractor into a real Claude Code `SessionStart` hook — the first caller to run it against the real two-file router): `buildReinject` demanded a heading matching `Iron Laws` followed by a backtick fence to find the laws, a shape no file in this repo has — the four laws live in `WORKFLOW.md` as a nested list under `## The four principles` (no heading of their own, no fence), and the CLI defaulted to reading `AGENTS.md`, which carries no law text at all. Every caller therefore got the MANDATORY half, silence about the other half, and no signal that half was missing. The test suite shared the same fictional assumption — its fixtures were single-file, both-sections transcripts, 8/8 green, while the real path never once produced the laws: a green suite over a fixture the repo does not contain, which is the silent-failure mode this framework exists to catch, reproduced inside the framework. Fixed: `extractLaws` gains a second form — the four law stems in order, within 12 source lines (the historical heading+fence form is still honored, so no existing caller breaks); `buildReinject` never returns a half floor silently, naming the missing half alongside the file it lives in; the CLI reads `WORKFLOW.md` and `AGENTS.md` by default and exits 1 when the block names a missing half. Fail-first: F1 (law extraction from list form) and G2 (the missing-half block names both source files) were RED before the change and GREEN after; D1 asserted the old "empty block" contract the fix deliberately contradicts and was replaced by D1/D1b/D3 — strictly more specific, checked against the only real consumer (`scripts/behavioral-eval/run.mjs`). Verified: `scripts/reinject.test.mjs` 14/14, `node scripts/reinject.mjs` exit 0 with all four laws present, all 10 repo suites PASS, `validate.mjs` and `eval.mjs` exit 0. Cost, stated honestly: no performance change (no build step; +236/−21 LOC); the injected block is ~3064 chars at every SessionStart, which is new standing context — see AGENTS.md §8.

### Added
- Installation docs: the [Claude Code] CLI section now carries the mechanical half (2026-09-21, same finding): installing the skills without the hooks leaves them inert on a harness whose session-start injection is hook-driven — the discipline floor only re-enters context if something puts it there. `docs/installation.md` §[Claude Code] CLI documents session-start floor injection via `scripts/reinject.mjs` (both router files, exit 1 on a half floor), per-prompt `mandatory-gate` classification, both placement shapes (local plugin via `.claude-plugin/plugin.json` + `hooks/hooks.json` + `enabledPlugins`, or direct `settings.json` hooks), the fail-open requirement that a discipline layer must never break session startup, and a post-install verification step. Teeth first: `eval.mjs` check 31 was written and verified RED with 4 errors before the docs changed (the section existed and mentioned neither hooks nor the scripts); exit 0 after. The check was proven non-decorative by removing the hook paragraph (2401 chars) and watching the identical 4 errors return, then restoring it. `docs/compatibility.md` porting-checklist item 9 now states the floor spans two files, the bare-CLI default, and the exit-1 contract; `AGENTS.md` §7 says the same.

## [0.1.16] - 2026-09-20

### Added
- Mandatory-gate — a mechanical pre-gate for MANDATORY skill routing (2026-09-20, full breakpoint → save-as → fork-it → make-it-so chain, owner-approved): `scripts/mandatory-gate.mjs` classifies task text (bilingual EN/ID keyword patterns, binary verdicts, zero dependencies) against the three MANDATORY domains (`expect-fail`, `root-cause`, `receipts`), closing the encode-twice gap for the trigger matrix — AGENTS.md §2 gains the paragraph (the why), the script plus its fail-first test are the check. Consumers: the ledger audit adds a `gated-loaded-gap` finding (WARN-level by contract — a keyword signal to verify, never proof; additive to M1's literal markers, bound by test K6) for a gated entry that carries no `Loaded:` line; doctor gains C8 (`gateVerdict` in `doctor-checks.mjs`), which runs the gate's self-test file as evidence — strict in repo mode, warn in adopter mode (the C2 lesson); CI runs both new self-tests. Fail-first throughout (classifier 33 checks, audit J-suite, doctor K-suite), three-axis roast findings fixed (domain-list import over duplication, boundary-matched keyword coverage, generic `expect` keyword dropped, CI wiring, warn-contract binding, C8 wiring test + audited-tree-execution documented). Spec with 10 falsifiable acceptance criteria: `docs/specs/mandatory-gate.md`. Provenance: the principle (mechanical enforcement over model initiative) is the framework's own — `docs/design.md` §Self-trigger is unreliable; original implementation, no external code reused.

## [0.1.15] - 2026-09-19

### Fixed
- Ledger audit no longer produces false signals on a real adopter ledger (2026-09-19, stress test against a 6-day / 71-commit project): running the audit against `ads-tracker/progress.txt` returned 67 findings + 127 coverage gaps on a healthy ledger — ~95% artifacts of the reader, not defects in the ledger. The reader had been built and tested against ONE writer shape; a second writer is in production, prescribed by adopter routers. Now fixed: **titled date headers** (`## 2026-09-19 — Rebrand X` — 131 of 144 headers in the real ledger carried a title the bare-only regex could not see); **flat entries** (a date header followed directly by bullets, no `###` heading — 43 such sections were invisible and their bullets leaked into the previous entry); **`Loaded:` lists** (`,` `;` `+` ` / ` all parse, so `- Loaded: expect-fail, root-cause, receipts` counts three skills instead of one — M4 was undercounting 5–8x: 126 bullets containing `receipts` counted as 16); **CRLF ledgers** (Windows adopters); and the same strict date regex in `checkStarve`, where it meant the corrective-tier grace clock never started on an adopter ledger. `docs/installation.md` gains §The ledger contract documenting both accepted shapes and both ledger locations, enforced by eval check 29.
- M3 (context-gap) fires on owner-supplied feedback instead of on the word "screenshot" (2026-09-19): the trigger was a bare `screenshot|mockup|diagram` match, and `screenshot` sat in BOTH the M2 rendered-evidence list and the M3 trigger list — so an entry that *provided* rendered evidence was accused of skipping confirmation. On the real 6-day ledger it fired 60 times with zero owner-attributed entries. Attribution is now required, by line proximity rather than mere co-presence: the rule was derived empirically (bare word: 60 flagged, all false; any owner/master title in the entry: 14 flagged, all false on inspection; attribution adjacent to the artifact on one line: 2 flagged, both genuine — and the canonical `Owner screenshot showed the collision` fixture still fires). A request FOR an artifact ("butuh screenshot … dari Master") is excluded, verified load-bearing by neutralizing it (2 → 1 context-gap).
- Doctor reads the project it is actually checking (2026-09-19, found by running it against a real adopter): it FAILED on `core.hooksPath` in a project installed exactly as the README documents, and it hardcoded `.trust/progress.txt` while the adopter convention is `progress.txt` at the root — so the audit never ran on the ledger it exists to check. Doctor now derives its mode (repo vs adopter): repo mode keeps the strict hook contract, adopter mode checks for any hook and never fails there, while a *set* `hooksPath` pointing at an empty dir is a warning rather than a false PASS. Ledger resolution reports when two ledgers exist and one shadows the other, and each audit line names the file it read. Finding output is grouped by kind with entry dates — the first live adopter run printed 18 warning lines that buried the two real signals.

### Added
- `scripts/doctor-checks.mjs` (2026-09-19): `hookVerdict` / `pickLedgerPath` / `blindSpotWarning` extracted as pure functions so doctor's decision logic is testable without its CLI side effects (the `corrective-tier.mjs` pattern). `blindSpotWarning` gives M4's `stats.mandatoryMentions` its first consumer — the anti-blind-spot stat had been computed and read by nobody since it was introduced, the exact silent-failure mode AGENTS.md §5 names; eval check 30 now fails if the call is removed. `formatFindingGroup` lives in `ledger-audit.mjs` beside the messages it formats.

## [0.1.14] - 2026-09-13

### Added
- Scheduled update-check reminder (2026-09-13, full save-as → fork-it → make-it-so chain from owner request): an opt-in OS-level weekly check that turns release detection into a working reminder on every user's machine — `node scripts/update-check-cli.mjs install` registers a Monday-09:00 task (Windows Task Scheduler toast, macOS launchd plist, Linux cron), the check compares the upstream CHANGELOG's highest version against every `.trust/tna-version` stamp under the configured projects root (default `~/projects`, overridable via `--projects-root`; upstream source overridable via `--upstream-url`), writes the report to `update-check.log`, and notifies **only when an install is stale** (all-current and fetch-failure runs log silently). Detection-only by constraint: nothing in the chain ever installs skills or stamps versions. The router's update-reporting obligation now also fires when a session starts on a Monday or when the log names stale installs: the agent opens with the version delta + CHANGELOG entries + consent question, then waits. Config is validated at the trust boundary (https-only URL, no quote/substitution/newline characters) before reaching any scheduler command. Spec with 11 falsifiable acceptance criteria: `docs/specs/scheduled-update-check.md`; fail-first tests at pure-function seams (`scripts/update-check.test.mjs`, `update-delivery.test.mjs`, `update-install.test.mjs`, doctor.test.mjs pattern); three-axis roast findings (incl. a `file://` URL that broke node under the Windows Task Scheduler and nested PowerShell quoting) fixed and verified live (`schtasks /Run` → `LastTaskResult 0`). Uninstall: `node scripts/update-check-cli.mjs uninstall`.

## [0.1.13] - 2026-09-12

### Added
- Breakpoint question-delivery contract (2026-09-12, owner standing order): every user-facing question is delivered through the harness's interactive question mechanism — structured prompt, options, one recommended default — when the harness provides one; the numbered `➡️` list is the documented fallback on harnesses without it. Content contract is identical in both channels (one frontier per round, every question carries a recommendation, user confirmation resumes execution). Enforced by eval check 28 (HARD), verified fail-first.

### Fixed
- Ledger audit blindness closed (2026-09-12): `ship-log` wrote no per-entry date header while `scripts/ledger-audit.mjs` and `scripts/corrective-tier.mjs` parsed `## YYYY-MM-DD` from inside the ledger — so every real ledger audited as vacuously clean (zero findings because zero entries parsed, indistinguishable from a genuinely clean ledger), and the audit's own test asserted the wrong premise ("matches the ship-log format the repo actually writes: a date header"). The writer now emits a `## <YYYY-MM-DD>` header per entry (invariant enforced by eval check 27, HARD); the parser is entry-based and reports undated entries as coverage gaps (`unprovable`) instead of silently dropping them — "blind" is now distinguishable from "clean"; the doctor's ledger verdict is three-valued (`clean` / `findings` / `unprovable`), still WARN, extracted as testable `ledgerVerdict`. Fail-first: the undated-entry fixture was observed failing (no `gaps` field) before the parser change and passing after.

## [0.1.12] - 2026-09-10
- Release of the behavioral-eval batch: router re-injection guard, behavioral eval tier + two recorded runs, and the chat-receipt skim test (all detailed under the dated entries below). Tag tracks master head per standing Ruling.
- Router re-injection guard (2026-09-10): `scripts/reinject.mjs` derives the router's discipline floor (Iron Laws + MANDATORY section) from the live AGENTS.md — the injected block cannot drift from the rules it re-injects — and prints it for re-injection after compaction/resume on harnesses that drop AGENTS.md (fail-open CLI; harnesses without hooks re-print it by hand). Router §7 rule + porting-checklist item 9 landed; fail-first tested by `scripts/reinject.test.mjs`, wired into pre-commit.
- Behavioral eval tier (2026-09-10): `scripts/behavioral-eval/` — the second tier of proof the static checks cannot provide (they prove rules exist; this proves rules change behavior). Weighted 11-dimension rubric with a mandatory `error-causal-honesty` anti-fabrication dimension, condition-blind judge template, 10 scenario cases, offline validator (`behavioral-eval.mjs`) fail-first tested, and an env-driven external runner (`run.mjs`, any Anthropic-compatible endpoint) with per-trial A/B label shuffling, lenient judge-JSON parsing, and transcripts archived before judging so judge failures never burn responder output.
- First behavioral eval results (2026-09-10, `RESULTS.md`): two full runs (10 cases × 2 conditions × 3 trials, GLM judge). Weighted delta **+0.445** both runs (4.078→4.522; 4.113→4.558); win rate 20/29 → 22/30 after fixes. Gains concentrated in framework-core dimensions: test-first +1.7–2.4, spec-gate +1.1–1.6, error-causal-honesty +1.0–1.1, state-restatement +1.1, completion-honesty +0.7–0.9. Run 1 regressions (tangent-suppression −1.93, artifact-target −0.41) were fixed in the candidate prefix and verified closed/improved by the run 2 re-run; the residual rubric-vs-shape tension is recorded, not re-weighted away.
- Chat receipt skim test (2026-09-10): a receipt is built to be read at a skim — a reader who reads only the first and last line must know what just happened and what happens next; "want me to X?" is a hanging offer, not a Next. Enforced mechanically by eval check #26.

### Fixed
- Update detection bootstrap gap (found by live testbed test 2026-09-09: an install without `.trust/` produced no detection — the remind happened only because the user asked): an unstamped install now reports level `unstamped` — "detection cannot tell stale from current, stamp it now" — instead of the false-positive "update available"; stamping the version is documented as part of every install path, not an update-time afterthought; and the Updating section states the honest limit that router prose does not propagate by re-install — rule updates are a user-reviewed re-merge.

### Added
- Update detection + user-approved updates (2026-09-09): doctor check C6 compares the installed version stamp (`.trust/tna-version`) against the upstream release and warns when skills are stale or unmarked; `checkStale` in `corrective-tier.mjs` (fail-first tested in `doctor.test.mjs`, 5 expectations). AGENTS.md §6 obliges the agent to report an available update to the user and ask before re-running the install — detection is mechanical, the update is the user's decision. `docs/installation.md` gains an "Updating" section (detect → model proposes → user approves → re-install + stamp).
- Approval-gate audit pass (2026-09-09): gates implied by Iron Law 4 but never stated are now explicit — de-adoption and global-dir skill edits are user decisions (installation.md); spec publish to the issue tracker waits for the user's spec approval (save-as); ticket publish to a real tracker rides the breakdown sign-off, and parallel-worktree merges route through make-it-so's dry-run gate (fork-it); receipts gains the "verification is not authorization" red flag (commit still needs human sign-off); rule-inheritance states entry is user-decided ("a rule that lands without sign-off is smuggled, not inherited"); agent-run greenfield install requires explicit approval. Found by a read-only audit subagent against the philosophy; the eval.mjs memory-modes check caught and forced alignment on the ship-log promotion wording.
- Ledger audit gates (2026-09-09, evaluation-driven, all fail-first): `scripts/ledger-audit.mjs` (+ 20-expectation test, wired into doctor C7 and the pre-commit hook) mechanically audits the private ledger — M1 flags domain-relevant entries missing the `Loaded:` audit-trail line, M2 flags site/ changes verified by string-match instead of rendered evidence, M3 flags fixes from owner visual feedback without a literal `Context confirmed:` restatement, M4 computes per-skill Loaded: counts (the 47-receipts-vs-0 blind spot made countable), M5 flags 2+ reverts on one target within 14 days as the Iron-Law-1 churn signature. Eval checks #22-25 guard the wiring plus two new router §6 rules (rendered evidence; owner feedback is a context to confirm) and the ship-log `Context confirmed:` line; 3 rule-inheritance register rows landed.
- Porting checklist in `docs/compatibility.md` (2026-09-09): 8 harness-specific failure modes hit on real harnesses (cwd drift, bg-registry loss, mid-session skill invisibility, flatten-on-install, worktree-provisional ledger, pristine fixtures, exit-0-is-not-a-receipt, environment-vs-installation degradation), each with origin — adopters on a new harness walk the list before diagnosing anything new.

## [0.1.11] - 2026-09-09
- Release of the 2026-09-09 evaluation batch: ledger audit gates (M1-M5), the two router §6 verification rules, the ship-log `Context confirmed:` line, eval checks #22-25, and the portability checklist (all detailed under [Unreleased] above). Tag tracks master head per standing Ruling.
- Skill-load audit trail (external-eval finding 2026-09-09, ads-tracker testbed): ledger entries for work in a MANDATORY skill's domain now carry a `Loaded: <skill>` line (AGENTS.md §2 + ship-log log format), turning self-trigger discipline into a countable fact — previously compliance was indistinguishable from a dead skill (0 Ruling lines, ~5 skill mentions across 79 sessions).
- De-adoption section in `docs/installation.md`: how to retire skills and old routing (remove files from every install location, clean the router, verify no references remain, log the retirement) — closing the gap where a pre-adoption skill chain survives in a global dir and resurrects weeks later.
- Precedence note (global vs project-local skills) in `docs/installation.md`: same-named skills in both locations change behavior with no repo diff; one skill, one location per project; global dir treated as shared infrastructure.

### Changed
- Adoption step 3 (name mapping) now states its premise — a mapping only lives while the name resolves; dead names are dropped, with a post-adoption sweep added as merge step 6 (every skill name the router cites must resolve in a discovered registry).
- `Ruling:` format lightened (AGENTS.md §4 + ship-log §Rulings): the two-part `Ruling: <decision> — <why>` is the default; the three-part cost-if-wrong form reserved for weighty calls. Origin: 79 sessions produced 0 Ruling lines — a ceremony nobody performs dies silently.

## [0.1.9] - 2026-09-06

### Added
- Interactive adoption interview in `docs/installation.md`: before any merge into a project that already has a router, the agent asks four questions (existing router?, what it covers — with the overlap audit performed by the agent, skill location, name mapping), presents a merge plan, and waits for explicit confirmation before writing a single line.
- Merge-safety guarantees section ("Why this cannot break your existing router"): the project's router stays the only router, overlapping rules are skipped rather than duplicated, skills land as new files in their own directory (name collisions surfaced in the interview, never silently overwritten), and the whole adoption is reversible via `git diff` / `git checkout`.
- README install section now states the adoption safety contract inline: guided interview → merge, not a copy → additive, reversible, no overwrite of the existing setup.

## [0.1.8] - 2026-09-06

### Added
- AGENTS.md §3 proposal-handoff rule (commit `863d9fb`, eval check #19): after every chain stage and every unit of work the model proposes the concrete next step — skill by name, why now — and waits for approval, so a user-invoked chain never stalls because the user didn't know the next skill.
- AGENTS.md §1 registry-check rule (commit `f7ac9bb`, eval check #20): "`fast` skips the chain, never the registry" — before answering any task, the skill registry is checked once and a matching skill (the framework's own or an external one) is proposed by name regardless of class. Origin: designed probe (2026-09-06, 4 runs) — fast-classified requests never considered the registry (2/2 recurrence); results in `evals/live-results.md`.
- README restructured for focus (~219 → ~149 lines): the per-skill chain bullets, Contributing detail, and Portability duplication moved/linked to CONTRIBUTING.md and docs/; the differentiator table gains memory-tiers, rule-inheritance, real-data-UI, and lazy-by-default rows; classification now carries the registry-check rule.
- `evals/self-trigger-battery.md` — standalone protocol for scenario 13 (`evals/scenarios.md` S13): tests whether fresh agents load MANDATORY discipline skills unprompted across harnesses (OMO, DSH, Pi, Codex, Claude Code, ZCode). Includes pre-flight checks, launch procedure (9 runs per harness), grading rubric, and anti-manufacture rules to ensure honest evaluation of self-triggering capability.
- `scripts/doctor.mjs` C5 raised from WARN to grace-then-HARD (user-approved 2026-09-06): a ledger with entries but no `.trust/lessons.md` warns during a 14-day grace period measured from the oldest dated entry (ship-log `## YYYY-MM-DD` headers), then FAILS with exit 1 — after grace, lesson capture is mandatory, not optional. Decision logic extracted to `scripts/corrective-tier.mjs` (`checkStarve`, testable without doctor's CLI side effects); a ledger with no parseable dates degrades to WARN. Test override: `TNA_DOCTOR_GRACE_DAYS`.
- `scripts/doctor.test.mjs` — fail-first self-test for the grace logic (7 expectations: warn/fail boundary, lessons-exists, no-dates, empty ledger). Wired into CI (validate + windows jobs) and pre-commit; the contributing gate list grows from three to four commands.
- AGENTS.md trigger-matrix row (commit `ebf3a3c`): an external skill proposed by the registry check opens `docs/skill-vetting.md` — audited BEFORE the user's approval — closing the gap where the checklist existed but nothing in the always-read router pointed to it.
- `docs/skill-vetting.md` — red-flag response ladder (commit `976a87a`): refuse approval first, ask the publisher (or the proposing agent) to explain, continue only on an explanation that holds; unexplained, the rejection is permanent — deleting the skill from disk stays the user's call ("a gate refuses, it does not remove"). Two red-flag categories added — data exfiltration beyond credentials, persistence and side channels — bringing the list to six.

### Changed
- `evals/self-trigger-battery.md` — S13 result framing reworded to the honest outcome (commit `976a87a`): "No harness passed S13. OMO alone ran the battery to completion - and scored TRIGGER 0/9 twice, a real failure signal, not an incomplete run"; a battery another harness could not run is never recorded as a pass.

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

- `docs/chat-receipt.md` — the 4-block chat receipt (Verdict / Evidence /
  Open / Next) closing every `full`/`loop` unit in chat, recorded in
  `docs/rule-inheritance.md` as the router's first gated rule (§6).

### Fixed

- `docs/chat-receipt.md` — the Evidence block no longer demands a visible
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
  points back at the receipt's own Open line as the proof ("nothing forced
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

[Unreleased]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.20...HEAD
[0.1.20]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.17...v0.1.18
[0.1.13]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.12...v0.1.13
[0.1.7]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nadiwerk/trust-no-agent/releases/tag/v0.1.0
