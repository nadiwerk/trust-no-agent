# Contributing to trust-no-agent

Thanks for considering a contribution. This repo is a discipline layer for AI
coding agents, so the contribution process itself follows the same discipline:
**work only counts when it exits zero.** Every change is verified by a
mechanical gate before it is accepted.

## What this project is

- A **markdown-only workflow framework** — 14 skills across three tiers
  (engineering, discipline, meta) plus a router (`AGENTS.md` + `WORKFLOW.md`).
- The identity is the **trust layer**: proven work (receipts, evidence gates,
  vetoes, the ledger). The built-in chain is one workflow option — bring-your-
  own workflows are first-class too, so contributions are equally welcome on
  both sides: **domain/engineering skills** (new capabilities mapped as
  overlays or canonical additions) and **enforcement machinery** (gates,
  evals, hooks). The chain's shape is not a contribution gate; the trust
  discipline is.
- The engine is **rules, not code**. The only executable parts are the
  structural validator (`scripts/validate.mjs`), the static evals
  (`scripts/eval.mjs`), the CI workflow, and the git hooks.
- The philosophy: an agent that can't prove its work is a liability. See
  [docs/philosophy.md](docs/philosophy.md) and [docs/design.md](docs/design.md).

## Before you start

1. **Read the router** — `AGENTS.md` and `WORKFLOW.md`. They define the
   classification (`fast`/`full`/`loop`), the chain, and the four Iron Laws.
2. **Check the design docs** — `docs/design.md` explains *why* the framework is
   shaped this way. A change that fights the design will be sent back.
3. **Open an issue first** for anything non-trivial. The maintainers use the
   issue tracker to record decisions; a PR without a linked issue for a
   behavioral change will be asked to add one.

## Development setup

No dependencies to install — the validator and evals are pure Node with zero
packages. You need Node 24+ (the CI uses Node 24).

```bash
# Run the structural validator (skill frontmatter, cross-references, ownership)
node scripts/validate.mjs

# Run the static evals (invocation-axis consistency, mandatory-skill enforcement)
node scripts/eval.mjs
```

Both must exit 0 before a change is considered done.

## Activating the local hooks

The repo ships git hooks that run the same gates on every commit. Activate them
once:

```bash
git config core.hooksPath scripts/hooks
```

This installs two hooks:

- **`pre-commit`** — runs `validate.mjs` and `eval.mjs`. A commit that breaks
  the structure or the discipline is rejected.
- **`commit-msg`** — enforces [Conventional Commits](https://www.conventionalcommits.org/).
  Allowed types: `feat|fix|docs|chore|refactor|test|ci|style|perf|build|revert`.
  Format: `<type>(<optional scope>)<!>: <description>`.

> Note: the `commit-msg` hook is a **quality gate**, not a security boundary.
> It checks message format only; it does not and cannot prevent a malicious
> commit. Treat it as a formatting guard, not a trust mechanism.

## Commit conventions

- **Conventional Commits** — see the `commit-msg` hook above.
- **One logical change per commit.** A docs change and a skill change belong in
  separate commits.
- **Surgical diffs.** Only the lines that solve the problem. No drive-by
  refactors, no restyling (see WORKFLOW.md rule 3).
- **No secrets.** The framework never stores credentials; keep them out of
  tracked files.
- **Update the CHANGELOG** (`CHANGELOG.md`, Keep a Changelog + SemVer) when a
  change is user-visible: a new skill, a renamed/removed skill, a changed
  behavior, or a breaking change. Add the entry under the current `[Unreleased]`
  section (or open one if it is missing) in the matching `Added`/`Changed`/
  `Fixed`/`Removed` group. Docs-only edits that do not change behavior do not
  need a CHANGELOG entry.

## Pull requests

- **Branch from `master`** — create a feature branch, do not commit directly to
  `master`. Name it after the work, e.g. `feat/skill-name` or `fix/validator`.
- **Open the PR against `master`.** One PR = one logical change range; keep it
  focused and reviewable.
- **Run the gates before pushing** — the self-tests CI runs must all exit 0 (full list under “What the CI checks” below).
  CI runs the same set on every push and PR; a red CI blocks merge. The
  pre-commit hook runs a superset (it adds `reinject.test.mjs`,
  `behavioral-eval.test.mjs`, and `behavioral-eval.mjs`), so a local commit can
  be red where CI is green — that is the hook being stricter, not a mismatch.
- **Link the issue** — reference the issue the PR addresses (e.g. `Closes #12`)
  so the decision record stays connected to the change.
- **Describe what and why** — a short PR body stating the change, the evidence
  it was verified, and any trade-offs. "Should work" is not a description.

## What the CI checks

The CI workflow (`.github/workflows/ci.yml`) runs on every push and PR to
`master`/`main`. Three jobs:

**`validate`** — the gates (91 `run:` steps; the workflow file is the source
of truth — `grep -n 'run:' .github/workflows/ci.yml` lists them live):

1. `node scripts/validate.mjs` — structural validation.
2. `node scripts/eval.mjs` — static eval consistency.
3. `node scripts/trigger-eval.mjs` — trigger-eval check.
4. `node scripts/tickets.test.mjs` — ticket-graph validator self-test.
5. `node scripts/doctor.test.mjs` — doctor decision-logic self-test.
6. `node scripts/mandatory-gate.test.mjs` — MANDATORY-classifier self-test.
7. `node scripts/action-gate.test.mjs` — action-gate (words never gate) self-test.
8. `node scripts/tna-gate.test.mjs` — veto core + state self-test.
9. `node scripts/tna-gate-v2.test.mjs` — opencode V2 adapter self-test.
10. `node scripts/tna-done-gate-v2.test.mjs` — done-gate V2 self-test.
11. `node scripts/tna-done-enforce-v2.test.mjs` — done-gate enforcement self-test.
12. `node scripts/tna-reinject-v2.test.mjs` — reinject V2 self-test.
13. `node scripts/tna-delegate-v2.test.mjs` — delegate-guard self-test.
14. `node scripts/tna-parity-v2.test.mjs` — adapter parity self-test.
15. `node scripts/agents-size.test.mjs` — router size budget self-test.
16. `node scripts/tna-better-v2.test.mjs` — tna-better adapter self-test.
17. `node scripts/agents-global-budget.test.mjs` — global router budget self-test.
18. `node scripts/tna-store.test.mjs` — evidence store self-test.
19. `node scripts/tna-portable.test.mjs` — veto portability self-test.
20. `node scripts/gate-meter.test.mjs` — gate-effectiveness meter self-test.
21. `node scripts/first-run.test.mjs` — first-run gate self-test.
22. `node scripts/eval-adapter.test.mjs` — eval adapter-pins regression test.
23. `node scripts/autonomy-ladder.test.mjs` — autonomy-ladder decay self-test.
24. `node scripts/stale-probe.test.mjs` — stale-memory probe self-test (dead lessons cannot gate).
25. `node scripts/local-judge.test.mjs` — bounded-judgment self-test (deterministic-first, judge-last, no API key).
26. `node scripts/overlay-registry.test.mjs` — overlay registry parser self-test (add-only roles, injection-hardened frontmatter, derived anchors).
27. `node scripts/spec-scrub.test.mjs` — spec-scrub check (the decision-composition spec names no external products).
28. `node scripts/floor-composer.test.mjs` — floor composer self-test (canonical-first, `user:` marking, bounded budget, determinism).
29. `node scripts/onboarding.test.mjs` — onboarding seam self-test (discovery, proposals, stamp fail-closed).
30. `node scripts/receipt-enforcement.test.mjs` — receipt-enforcement self-test (per-boolean shape, staleness, veto, hardened re-run).
31. `node scripts/receipt.test.mjs` — receipt writer self-test.
32. `node scripts/ledger-audit.test.mjs` — ledger-audit reader self-test.
33. `node scripts/ledger-lint.test.mjs` — ledger lint self-test.
34. `node scripts/pr-wait.test.mjs` — PR-wait self-test.
35. `node scripts/roast-first.test.mjs` — roast-first ordering self-test.
36. `node scripts/output-trim.test.mjs` — output-trim self-test.
37. `node scripts/goals.test.mjs` — standing-goals contract self-test.
38. `node scripts/automation-lint.test.mjs` — automation-scope lint self-test.
39. `node scripts/orchestrator-brief.test.mjs` — orchestrator-brief contract self-test.
40. `node scripts/stack-select.test.mjs` — stack-select self-test.
41. `node scripts/slice-it.test.mjs` — slice-it skill self-test.
42. `node scripts/coverage.mjs` — absence-coverage check (registries + mirror roots).
43. `node scripts/coverage.test.mjs` — coverage checker self-test.
44. `node scripts/plan-check.mjs` — plan-vs-actual drift check (no .trust on CI → exits 0).
45. `node scripts/plan-check.test.mjs` — plan drift checker self-test.
46. `node scripts/secrets-scan.mjs --tree` — secrets scan over the tracked tree.
47. `node scripts/secrets-scan.test.mjs` — secrets scanner self-test.
48. `node scripts/dep-lint.mjs --gate --base HEAD~1` — dependency-touch lint (dep-ok trailer required).
49. `node scripts/dep-lint.test.mjs` — dep lint self-test.
50. `node scripts/would-deny.test.mjs` — would-deny self-test.
51. `node scripts/tna-ci.test.mjs` — tna-ci parser self-test (tna-ci itself never runs inside CI).
52. `node scripts/receipt-draft.test.mjs` — receipt-draft self-test.
53. `node scripts/tickets.mjs scripts/tickets-fixture/issues` — ticket-graph smoke run against the committed fixture.
54. `node scripts/site.test.mjs` — site acceptance contract.
55. `node scripts/gate-hook.test.mjs` — hook entry-point contract (fail-open + PreToolUse veto).
56. `node scripts/ledger-hook-routing.test.mjs` — ledger hook-routing self-test.
57. `node scripts/gate-hook-fastpath.test.mjs` — gate fast-path classifier self-test.
58. `node scripts/antigravity-hook.test.mjs` — antigravity hook adapter self-test.
59. `node scripts/gemini-hook.test.mjs` — gemini hook adapter self-test.
60. `node scripts/plugin.test.mjs` — plugin mirror drift guard.
61. `node scripts/codex-plugin.test.mjs` — Codex plugin payload guard.
62. `node scripts/marketplace-copilot.test.mjs` — marketplace copilot guard.
63. `node scripts/file-budget.test.mjs` — file-budget self-test.
64. `node scripts/payload-sync.test.mjs` — payload mirror synchronization guard.
65. `node scripts/first-install-gate.test.mjs` — integrated first-install trust-layer gate.
66. `node scripts/changelog-guard.test.mjs` — changelog structure guard.
67. `node scripts/ci-guard.mjs` — workflow file guard.
68. `node scripts/ci-guard.test.mjs` — workflow file guard self-test.
69. `node scripts/file-budget.mjs --all` — file-budget baseline re-check over all entries.
70. `node scripts/file-budget.test.mjs` — file-budget self-test (re-run after the baseline check).
71. `node scripts/codex-reprobe.test.mjs` — codex reprobe self-test.
72. `node scripts/veto-adapter.test.mjs` — veto adapter self-test.
73. `node scripts/veto-tool-coverage.test.mjs` — veto tool-coverage self-test.
74. `node scripts/dsh-veto.test.mjs` — dsh veto self-test.
75. `node scripts/devin-hook.test.mjs` — devin hook adapter self-test.
76. `node scripts/dsh-discipline.test.mjs` — dsh discipline self-test.
77. `node scripts/dsh-fixlist.test.mjs` — dsh fix-list self-test.
78. `node scripts/omp-fixlist.test.mjs` — omp fix-list self-test.
79. `node scripts/pi-discipline.test.mjs` — pi discipline self-test.
80. `node scripts/pi-recorder.test.mjs` — pi recorder self-test.
81. `node scripts/harness-general.test.mjs` — cross-harness general self-test.
82. `node scripts/reinject.test.mjs` — router re-injection self-test.
83. `node scripts/doctor-adapter.test.mjs` — doctor adapter self-test.
84. `node scripts/behavioral-eval.test.mjs` — behavioral eval self-test.
85. `node scripts/onboarding-layers.test.mjs` — install-layer self-test.
86. `node scripts/onboarding-refresh.test.mjs` — onboarding refresh/preservation self-test.
87. `node scripts/record-evidence.test.mjs` — evidence recorder self-test.
88. `node scripts/recorder-runners.test.mjs` — recorder runner-matrix self-test.
89. `node scripts/update-check.test.mjs` — update-check self-test.
90. `node scripts/update-delivery.test.mjs` — update-delivery self-test.
91. `node scripts/update-install.test.mjs` — update-install self-test.

**`hooks`** — activates `core.hooksPath=scripts/hooks` on a scratch clone and
proves a conventional commit passes both hooks while a non-conventional message
is rejected by `commit-msg`. This exists because the hooks rot silently when
nothing exercises them.

**`windows`** — re-runs the structural and self-test gates on `windows-latest`,
so a Windows-only path or line-ending break is caught before merge.

If any fails, the PR is not mergeable. Run them locally before pushing.

## Repository layout

```
trust-no-agent/
├── AGENTS.md            # the router — classify, chain, Iron Laws, delegation
├── WORKFLOW.md          # core rules (non-negotiable)
├── skills/              # the 14 skills, three tiers
│   ├── engineering/     #   breakpoint, scribe, save-as, fork-it, make-it-so,
│   │                    #   expect-fail, root-cause, roast-my-code, pr-flow,
│   │                    #   slice-it
│   ├── discipline/      #   receipts, no-thanks
│   └── meta/            #   ship-log
├── docs/                # design, philosophy, installation, per-skill use cases
├── evals/               # static scenarios + live end-to-end results
├── scripts/
│   ├── validate.mjs     # structural validator (exit 0 or rejected)
│   ├── eval.mjs         # static evals, HARD checks (exit 0 or rejected)
│   ├── tickets.mjs      # ticket-graph validator: blockers resolve, numbered blockers-first, acyclic
│   ├── tickets.test.mjs # fail-first self-test for tickets.mjs (exit 0 or rejected)
│   ├── tickets-fixture/ # committed valid ticket graph the CI smoke step validates
│   ├── corrective-tier.mjs # doctor decision logic: C5 lesson grace + C6 version-stamp staleness
│   ├── doctor-checks.mjs # doctor decision logic: C2 hook verdicts, C4 ledger path, C7b M4 blind spots
│   ├── doctor.test.mjs  # fail-first self-test for the C2/C4/C5/C6/C7b logic (exit 0 or rejected)
│   ├── doctor.mjs       # adopter install self-check (router, hooks, skills, ledger, version stamp/update detection)
│   ├── action-gate.mjs  # words-never-gate action classifier (+ .test.mjs)
│   ├── tna-gate.mjs     # veto core: decide/observe/state/log (+ .test.mjs)
│   ├── tna-store.mjs    # storage-backed evidence store (+ .test.mjs)
│   ├── gate-meter.mjs   # gate-effectiveness meter (+ .test.mjs)
│   ├── first-run.mjs    # newcomer first-run gate: doctor + floor (+ .test.mjs)
│   ├── eval-adapter.test.mjs # regression pins for eval checks 35-43
│   ├── overlay-registry.mjs # overlay skill registry: frontmatter parse, derived anchors, add-only roles (+ .test.mjs)
│   ├── floor-composer.mjs  # bounded floor composition: canonical-first, user:-marked entries (+ .test.mjs)
│   ├── spec-scrub.test.mjs # the decision-composition spec names no external products
│   └── hooks/           # pre-commit + commit-msg (Conventional Commits)
└── .github/workflows/   # CI runs all four gates on every push and PR
```

## Changing a skill

Skills live in `skills/<category>/<name>/SKILL.md` with an
`agents/openai.yaml` metadata file. When you change a skill:

- Keep the frontmatter `name` equal to the folder name.
- Keep the invocation axis consistent: user-invoked skills carry
  `disable-model-invocation: true` in frontmatter and
  `allow_implicit_invocation: false` in `openai.yaml`; model-invoked skills
  carry neither. `eval.mjs` enforces this.
- Keep descriptions **trigger-shaped** — they say *when* to load, never *what*
  the workflow does (the "lazy by default" rule).
- If you change a skill's behavior, update its use-case page in
  `docs/skills/` and the README table if the description or axis changed.
- If you add or remove a skill, update `scripts/eval.mjs`'s canonical
  user-invoked set and the eval scenarios in `evals/scenarios.md`.

## Changing the router or the Iron Laws

The router (`AGENTS.md`) and the core rules (`WORKFLOW.md`) are the framework's
contract. Changes here are high-stakes:

- **The three MANDATORY discipline skills** (`expect-fail`, `root-cause`,
  `receipts`) are enforced by `eval.mjs` HARD checks. Dropping a mandate
  silently re-opens the gap the evals exposed — it will fail CI.
- **"Writing tests is never `fast`"** is a HARD check. Do not weaken it.
- **"The model proposes, the user approves"** (§3 proposal handoff) and
  **"`fast` skips the chain, never the registry"** (§1 registry check) are
  HARD checks (eval #19 and #20). Weakening either re-opens the
  classification/chain gaps the probes exposed.
- **Accepted review findings become permanent router rules** — gated, scoped,
  and reversible (see [docs/rule-inheritance.md](docs/rule-inheritance.md)).
  A one-off session lesson does not become a rule.

## Adding or updating evals

- **Static evals** (`scripts/eval.mjs`) — mechanical consistency checks. Add a
  HARD check only when a discipline must not silently regress; encode it twice
  (prose in the router + the mechanical check).
- **Scenario evals** (`evals/scenarios.md`) — live-harness scenarios, one per
  skill, graded PASS/FAIL. Add a row when a skill gains a behavior worth
  measuring.
- **Live results** (`evals/live-results.md`) — records of end-to-end eval runs.
  When you run a live eval, append the results here in the same table format.

## Reporting a bug

Open an issue with:

- The exact command that failed and its output.
- The expected behavior vs. the observed behavior.
- Whether the failure is in a skill, the router, or a script.

For security issues, use the private reporting path in
[SECURITY.md](SECURITY.md) — do not open a public issue.

## Code of conduct

Be direct and honest. This project's whole thesis is that "should work" is a
confession — apply the same standard to your own contributions and to reviews.
No flattery, no "looks good to me" without actually checking. A review that
cannot determine an outcome reports `uncertain` with a reason, rather than
guessing.

## License

By contributing to this project you agree that your contributions are licensed
under the [MIT License](LICENSE) that governs the repository. Code you
contribute — including documentation and skill text — becomes part of the
MIT-licensed project. If you are contributing on behalf of an employer or as
part of a job, make sure you are authorized to release the contribution under
these terms.
