# Spec: setup-as-skill — the one-liner installs everything, /setup-tna wires it

Status: draft (breakpoint complete 2026-10-16, 6 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-16
Origin: Master question — "can the one-liner be `npx skills add
nadiwerk/trust-no-agent` alone, with skills + router + workflow installed, and
`/setup-tna` doing the wiring?" Breakpoint 2026-10-16 (6 decisions locked, see
ledger). Companion to setup-command (v0.1.30-era): the same onboarding machine,
a new distribution body.

## Problem Statement

The universal one-liner currently reads `npx skills add nadiwerk/trust-no-agent
&& cp AGENTS.md WORKFLOW.md .`. The `cp` half exists only because the skills
CLI distributes SKILL.md folders and nothing else — so the router (the part
that makes the skills load at all) ships outside the only channel the one-liner
uses. An adopter on a non-plugin harness gets a two-part command where the
second part is easy to skip, and a skipped `cp` leaves the framework inert
(self-trigger measured at 0/3 without the router).

## Solution

Promote `/setup-tna` from "a command file some harnesses never receive" to a
real skill — the framework's 12th — carrying its own payload: a copy of the
router (`AGENTS.md`), the core rules (`WORKFLOW.md`), and the onboarding CLI.
The skills CLI distributes every SKILL.md folder it finds recursively
(measured: "Found 11 skills" against this repo), so the new skill rides the
existing one-liner with no CLI change. The one-liner becomes `npx skills add
nadiwerk/trust-no-agent` — one line, everything aboard — and typing
`/setup-tna` runs the onboarder, which copies the router into the project
root (with explicit consent, Iron Law 4), runs the consent + mapping flow,
and closes with a doctor-lite verification.

## User Stories

1. As an adopter on any harness with a skill system, I want a one-line install
   (`npx skills add nadiwerk/trust-no-agent`) that also delivers the router,
   the core rules, and the onboarder as an installable skill, so that nothing
   discipline-critical depends on a second command I might skip.
2. As an adopter, I want to type `/setup-tna` (or ask my agent to follow the
   setup-tna skill) and have it copy `AGENTS.md` + `WORKFLOW.md` into my
   project root after my explicit consent, so that the router install is
   consent-gated, not silently performed.
3. As an adopter, I want the onboarder to run the same briefing, single
   combined consent round, and skill mapping as today's `/setup-tna`, so that
   the chat front door behaves identically regardless of which body (command
   file or skill) delivered it.
4. As an adopter, I want a doctor-lite check at the end of onboarding (stamp
   exists, router in root byte-identical to the payload, skills detected), so
   that "onboarded" means proven wired, not claimed.
5. As an adopter on Claude Code or Codex, I want the plugin path unchanged
   (marketplace add + install), so that the recommended path keeps wiring
   hooks automatically.
6. As an agent working in a project where the skills are installed but the
   router is not, I want a mandatory-recommendation rule — propose
   `/setup-tna` before doing anything else — so that a half-installed
   framework gets finished instead of silently underperforming.
7. As a maintainer, I want the root repo to remain the single source of truth
   (router, workflow, onboarding CLI), with the skill payload guarded by a
   byte-identity pin, so that the payload cannot drift from the source.
8. As a maintainer, I want the existing `.opencode/command/setup-tna.md` to
   become a thin wrapper pointing at the skill body, so that there is one
   procedure text, not two drifting copies.
9. As a reader of the public docs, I want every current-state count to say 12
   skills, so that the docs describe the framework as shipped.
10. As an adopter whose harness has no skill system, I want the manual
    `cp`-style fallback to remain documented, so that the framework stays
    installable everywhere.

## Decisions Already Made

- Location: `skills/meta/setup-tna/` (alongside `ship-log`).
- Axis: user-invoked (`disable-model-invocation: true`, `agents/openai.yaml`
  with `allow_implicit_invocation: false`), matching scribe/save-as/fork-it/
  make-it-so.
- Mandatory recommendation: the router gains a rule — when the framework's
  skills are present but the router/stamp is not (fresh-install signature),
  the agent must propose running setup-tna before other work. Prose in
  AGENTS.md + eval marker (encode-twice); NOT a MANDATORY-skill class rule.
- Payload: the skill folder carries `references/AGENTS.md`,
  `references/WORKFLOW.md`, and `scripts/onboarding.mjs` — byte-identical
  copies of the root files, pinned by a new eval check (mirror pattern already
  proven by the plugin mirrors).
- Doctor-lite: a verification procedure inside the skill (stamp exists;
  root router identical to payload copy; skills discovered) — the full doctor
  remains a checkout-only tool and the spec does not weaken it.
- One-liner: README and docs/installation.md universal core become
  `npx skills add nadiwerk/trust-no-agent` alone; the `&& cp` form moves to
  the no-skill-system fallback section only.
- Command body: `.opencode/command/setup-tna.md` becomes a thin wrapper
  ("follow the setup-tna skill procedure") — the skill body is the single
  procedure source; the command's plugin mirrors update in sync (existing
  byte-identity guard pattern).
- Count updates: current-state docs and guards (README, CONTRIBUTING,
  docs/installation.md, docs/skill-vetting.md, marketplace.json description,
  site/index.html, plugin.test D1, gate-hook header comment) move 11 → 12.
  Dated records (CHANGELOG entries, evals/* run records, dated specs) keep
  their historical counts — history is not rewritten.
- Canonical chain docs stay untouched: setup-tna is onboarding, not a chain
  stage; the fenced chain line remains the same six stages everywhere.

## Testing Decisions

- Fail-first per ticket (repo Iron Law): every new check lands RED before the
  change that turns it green.
- Byte-identity pin: new eval check asserts
  `skills/meta/setup-tna/references/AGENTS.md == AGENTS.md`,
  `references/WORKFLOW.md == WORKFLOW.md`,
  `scripts/onboarding.mjs == scripts/onboarding.mjs` (pattern: existing
  mirror checks in plugin.test).
- Count guards: plugin.test D1 becomes "exactly the 12 skills, flat";
  validate.mjs continues to require frontmatter/name (no count change there);
  eval check 1 covers the new skill's axis flags automatically via
  USER_INVOKED.
- Command wrapper: eval check 46 updated to pin the wrapper shape (points at
  the skill) instead of the full-procedure markers; plugin mirror test keeps
  the command mirrors byte-identical.
- Live install proof: `npx skills add nadiwerk/trust-no-agent --list` shows 12
  skills (human verification, recorded in the ticket).

## Constraints

- Zero dependencies, Node-only (onboarding.mjs already is).
- The skill NEVER writes `.trust/` itself — the onboarding CLI remains the
  sole writer (fail-closed writer contract from onboarding v0.1.29).
- Router copy into the project root happens only after the user's explicit
  consent inside the onboarding flow (Iron Law 4).
- The payload copies must never be edited — root is the source; drift fails
  CI.
- No external product names anywhere in the new files (spec-scrub discipline).
- All new docs text in English (full-English repo rule).

## Acceptance Criteria

1. (US1) `npx skills add nadiwerk/trust-no-agent --list` reports 12 skills
   including `setup-tna`. — human verification, recorded in ticket.
2. (US2) The skill procedure copies `AGENTS.md` + `WORKFLOW.md` into the
   project root only after an explicit consent step, and the copy is
   byte-identical to the payload. — automated test on the procedure text
   (consent step present) + human walkthrough.
3. (US3) The skill body contains the briefing, the ONE combined consent
   round, and the skill-mapping flow — the same steps the current command
   file carries. — human review vs current command file.
4. (US4) Doctor-lite is present in the skill: stamp existence, root-router
   byte-identity vs payload, skills-detected check. — automated text check +
   human walkthrough.
5. (US6) The router carries the mandatory-recommendation rule (fresh-install
   signature → propose setup-tna), pinned by an eval marker. — automated
   (eval).
6. (US7) Byte-identity pin exists and fails when a payload copy diverges
   (strip-dance proven). — automated (new eval check, RED-first).
7. (US7) plugin.test D1 asserts exactly 12 skills flat. — automated.
8. (US8) The command file is a thin wrapper naming the skill; its plugin
   mirrors are byte-identical; eval check 46 pins the wrapper shape. —
   automated.
9. (US9) Current-state docs/guards say 12 (README, CONTRIBUTING,
   installation.md, skill-vetting, marketplace.json description,
   site/index.html); dated records unchanged. — automated grep set.
10. (US5, US10) Plugin path docs unchanged; no-skill-system fallback keeps a
    manual copy path. — human review.
11. All gates green after the change (38 existing + any new suites registered
    in ci-guard M7 + CONTRIBUTING count). — automated.

## Out of Scope

- Making the onboarding CLI write anything new beyond today's behavior.
- A Codex- or Claude-specific variant of the skill (the payload is
  harness-agnostic).
- Changing the plugin payload layout or the hooks.
- Translating or rewriting dated records.

## Open Questions

- None — all six breakpoint decisions are recorded above.
