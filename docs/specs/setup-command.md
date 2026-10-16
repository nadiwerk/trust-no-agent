# Spec: /setup-tna — the chat front door for onboarding

Status: draft (breakpoint complete 2026-10-15, 9 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-15
Origin: breakpoint session 2026-10-15 (3 frontier rounds, 9 decisions locked).
Companion to onboarding (v0.1.29): the same machine, a new door — Master asked for
a command that maps the user's skills into the workflow, asks consent for the
router "comprehensively", and is smooth on first install. One decision is
consciously reversed from v0.1.29: consent may now flow through the agent's
question mechanism, because an explicit command the human types and answers is
still human consent — the agent is the channel, never the decider.

## Problem Statement

As a new adopter, the existing onboarding forces me out of the chat into a
terminal to run `node scripts/onboarding.mjs` — the briefing, consent,
and skill mapping all happen in a separate CLI, while I am actually working
with an agent in chat. What I want: one slash command (`/setup-tna`) that I
run from my session — the agent presents the briefing and the consent
questions comprehensively (workflow + router + skill mapping), my answers
are forwarded to the same onboarding machine, and I receive a receipt plus
a green doctor proof without ever opening a terminal. What I need without
compromise: the stamp/overlay writer stays one machine (the tested CLI),
consent still comes from the human (the agent is only the channel for
questions), and on harnesses without a question mechanism the command
degrades honestly to terminal instructions — it never pretends to be
interactive.

## Solution

From the adopter's point of view: type `/setup-tna` in the session. The agent follows
the guided procedure in the command file: (1) presents the "what changes"
briefing; (2) presents ONE combined question mechanism — the four consent
components (floor / hooks / overlays / evidence gate) plus the per-proposal
skill-mapping confirmation — and collects Master's answers; (3) the agent runs
`node scripts/onboarding.mjs --from-chat '<answers JSON>'` — the same CLI
that is already tested, the sole writer of stamps and overlays (the
validator, fail-closed, CLI receipt rules still apply); (4) the agent runs
the doctor and closes with a 4-block receipt — a green doctor is the final
proof. Two honest paths: harnesses with a question mechanism get the full
interactive flow; harnesses without it get a summary + instructions to run
the CLI in a terminal (degrade, the per-harness briefing pattern). The
command file lives in the repo (`.opencode/command/
setup-tna.md`) and is mirrored byte-identical into the per-harness plugin
payload (the 11-skill pattern), guarded by a byte-identity guard — every
adopter gets the same door.

## User Stories

1. As an adopter, I want to type `/setup-tna` in my session and be guided
   through the entire onboarding without opening a terminal, so that the
   framework's front door is where I already am.
2. As an adopter, I want the agent to present the what-changes briefing and
   the consent questions through its own question mechanism, so that the
   interaction feels native to my harness.
3. As an adopter, I want my answers to be forwarded to the SAME onboarding
   machine (the CLI), so that the consent stamp and overlays are written by
   the tested, fail-closed writer — never by the agent freelancing.
4. As an adopter, I want the skill-mapping proposals confirmed in the same
   single question round (no back-and-forth), so that setup takes one
   exchange, not seven.
5. As an adopter on a harness without an interactive question mechanism, I
   want an honest degradation (a summary + the terminal command to run), so
   that the command never pretends to be interactive.
6. As an adopter, I want the final receipt to include a doctor verification,
   so that "onboarded" means proven wired, not claimed.
7. As the maintainer, I want the command file tracked in the repo and mirrored
   byte-identical into the plugin payload per harness, so that every adopter
   gets the same door (the 11-skill mirror pattern).
8. As the maintainer, I want the mirrors guarded by byte-identity checks, so
   that the command cannot drift between harnesses.
9. As the maintainer, I want NO new write path to `.trust/` — the CLI remains
   the sole writer (a new flag, not a new author), so that the fail-closed
   culture holds.
10. As an adopter, I want the command file to carry guards for the agent
    (never write `.trust/` directly; never run `--yes` without my answers;
    degrade honestly without a question mechanism), so that a freelancing
    agent cannot bypass consent.
11. As an adopter, I want the command to work on an already-onboarded tree
    (mapping-only re-run), so that `/setup-tna` never re-asks a consent that
    exists.
12. As the maintainer, I want the command's presence pinned by the mirror
    guards (presence + byte-identity), so that it cannot silently regress
    from any harness.
13. As the maintainer, I want the user-facing command text to name no external
    products, so that the framework keeps its own vocabulary.
14. As an adopter, I want the briefing inside the chat flow to carry the same
    content as the CLI briefing (floor, veto, receipt shape, MANDATORY
    skills), so that the consent I give is informed regardless of the door.

## Decisions Already Made

- **Consent channel**: agent-driven — the command runs in chat; the agent
  presents the consent questions through its interactive question mechanism and
  writes the stamp FROM the human's answers. Consciously reverses the v0.1.29
  "human-CLI-only" decision (that decision predates the existence of an
  explicit command; the human still types the command and answers every
  question — the agent is the channel, never the decider). (Round 1 Q1)
- **Form**: a slash-command markdown file — repo `.opencode/command/
  setup-tna.md` + per-harness plugin mirrors (`.claude/commands/`,
  `.cursor/commands/`, `.agents/commands/`), tracked, guarded byte-identity —
  the 11-skill mirror pattern. Verified: none of these paths are gitignored,
  and no command directory exists anywhere yet (this is the first command).
- **Scope**: the full onboarding flow + the bonus steps — briefing, per-
  component consent, skill-mapping proposals confirmed, overlay writing,
  hooksPath connection, stamp, receipt, and a doctor run as the final proof.
  One door from zero to doctor-green. (Round 1 Q3)
- **Execution**: the CLI with a NEW non-interactive flag `--from-chat
  '<answers JSON>'` — the onboarding machine remains the SOLE writer of the
  stamp and overlays; the agent only forwards the human's answers. No new
  write path to `.trust/`. (Round 2 Q4)
- **Interaction shape**: ONE combined question round (the four consent
  components + the skill-mapping confirmations in a single question-mechanism
  call) — the breakpoint-interview pattern proven comfortable for stacked
  decisions. (Round 2 Q5)
- **Honest degradation**: two paths in the command file — a harness WITH a
  question mechanism gets the full interactive flow; one WITHOUT it gets a
  summary + the terminal command to run (the per-harness briefing degrade
  pattern). (Round 2 Q6)
- **Command file content**: a guided procedure + guards (never write `.trust/`
  directly; never run `--yes` without the human's answers; the degrade
  condition) — the command is a procedure the agent follows; the machine is
  the existing CLI. No helper script. (Round 2 Q7)
- **Mirror guard**: presence + byte-identity in plugin.test (the G1/G2 skill
  pattern) + codex-plugin.test consistency. (Round 3 Q9)
- **Mapping-only on an onboarded tree**: `/setup-tna` on a stamped tree routes
  to `--map-only` behavior (never re-asks consent). (Derived from the
  onboarding spec's --map-only decision; confirmed in round 1 Q3 "full +
  bonus".)

## Testing Decisions

- **Command file**: presence + byte-identity tests in plugin.test (B1/G1/G2
  pattern) and codex-plugin.test — the file is data, not logic.
- **The new flag**: CLI smoke tests with piped answers JSON — the stamp
  written matches the forwarded answers, the overlays parse clean, an
  aborted/empty answers JSON writes nothing (fail-closed), `--from-chat` on a
  stamped tree behaves as `--map-only`. The gate-hook.test F-section / doctor
  P-section spawn pattern.
- **The doctor final proof**: covered by the existing doctor wiring — no new
  doctor code.
- **eval**: one new check (46) pinning the command's contract (the file exists
  in the payload + byte-identical mirrors; the `--from-chat` flag named in the
  command file; the no-direct-.trust-write guard named), pinned in
  eval-adapter.test.mjs.
- **What counts as a good test here**: external behavior only — stamp shape,
  overlay tree, CLI output, mirror hashes. Never implementation details.

## Constraints

1. Zero new runtime dependencies; keyless; no network.
2. The onboarding CLI remains the SOLE writer of the stamp and overlays — the
   command adds a flag, never a second author.
3. Consent answers come from the human via the question mechanism; the agent
   never defaults to `--yes` without forwarded answers.
4. The command file is tracked in the repo and mirrored byte-identical into
   the plugin payload per harness, guarded by the mirror tests.
5. Honest degradation: no fake interactivity on harnesses without a question
   mechanism.
6. The user-facing command text names no external products.
7. `/setup-tna` on an already-onboarded tree never re-asks consent (routes to
   the mapping-only path).
8. The command file carries the agent guards explicitly (no direct `.trust/`
   writes; no `--yes` without forwarded answers; the degrade condition).

## Acceptance Criteria

1. (US1) `--from-chat '<answers JSON>'` writes a stamp whose components match
   the forwarded answers and consentedAt is set — identical to the shape the
   interactive CLI writes. — automated test (CLI smoke).
2. (US3) With `--from-chat` + overlay consent + fixture skills in the
   discovery roots, the confirmed overlays are written and parse clean through
   the registry seam. — automated test.
3. (US3) An empty or malformed answers JSON with `--from-chat` writes nothing
   (fail-closed) and exits non-zero. — automated test.
4. (US4) The command file instructs ONE combined question round covering the
   four consent components and the mapping confirmations. — automated marker
   check + human review.
5. (US5) The command file carries the degrade path verbatim (summary +
   terminal command) for harnesses without a question mechanism. — automated
   marker check.
6. (US7) `--from-chat` on a stamped tree routes to the mapping-only behavior:
   new skills land, consent is not re-asked (no prompt). — automated test.
7. (US7) `--from-chat` with overlays declined in the answers writes no
   overlays and says so — even if the mapping answers still contain skill
   names (a declined component ignores its section's answers). — automated
   test.
8. (US7/US10) The command file carries the agent guards verbatim (no direct
   `.trust/` writes; no `--yes` without forwarded answers). — automated marker
   check.
9. (US7) The command file names the doctor run as the final step. — automated
   marker check.
10. (US7) The command file carries the two paths (interactive + degrade)
    explicitly. — automated marker check.
11. (US7) The command's user-facing text names no external product. —
    automated grep.
12. (US8) plugin.test asserts the command file exists in the payload and is
    byte-identical to the repo source; codex-plugin.test consistent. —
    automated mirror guards.
13. (US11) Flag consistency: `--from-chat` with all-consent answers produces a
    stamp whose components equal the ones `--yes` produces (the consented
    component booleans match; metadata like consentedAt naturally differs).
    — automated test.
14. (US9) No new write path: the only writer of `.trust/onboarding.json` and
    the overlay tree remains the onboarding CLI (review + the absence of any
    new module). — human verification.
15. (US14) The command file's briefing section names the floor, the commit
    veto, the receipt shape, and the MANDATORY skills. — automated marker
    check.

## Out of Scope

- A helper script wrapping the flow (the command is a procedure; the machine
  is the existing CLI).
- Consent defaults that skip the human (no `--yes` without forwarded
  answers).
- Interactive question flow inside the CLI itself (the CLI stays
  non-interactive + flags; the chat channel handles interactivity).
- Supporting every harness's command format on day one (the four known
  payload harnesses first; the porting checklist grows with evidence).
- Any network, API, or key surface.

## Open Questions

- The exact answers-JSON schema (flat components + confirmed skill names vs
  nested) — assumed flat, matches the stamp; to be finalized at fork-it.
- Whether the degrade path should also offer `--yes` as a fallback (assumed
  no — degrade means the terminal CLI, not a consent shortcut).
- Harness command-directory conventions for future harnesses (Codex reads
  commands differently?) — grows with evidence, per the porting checklist.
