# Contributing to trust-no-agent

Thanks for considering a contribution. This repo is a discipline layer for AI
coding agents, so the contribution process itself follows the same discipline:
**work only counts when it exits zero.** Every change is verified by a
mechanical gate before it is accepted.

## What this project is

- A **markdown-only workflow framework** — 11 skills across three tiers
  (engineering, discipline, meta) plus a router (`AGENTS.md` + `WORKFLOW.md`).
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

## What the CI checks

The CI workflow (`.github/workflows/ci.yml`) runs on every push and PR to
`master`/`main`:

1. `node scripts/validate.mjs` — structural validation.
2. `node scripts/eval.mjs` — static eval consistency.

If either fails, the PR is not mergeable. Run both locally before pushing.

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
