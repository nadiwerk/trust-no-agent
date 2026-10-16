# Spec: veto-plugin-in-onboarding — /setup-tna wires the tna-gate veto on OpenCode

Status: draft (breakpoint complete 2026-10-16, 3 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-16
Origin: Master question — "apakah tna-gate bisa dimasukkan ke /setup-tna?".
Breakpoint 2026-10-16 (3 decisions locked, see ledger). Gap measured today:
on OpenCode the veto needs a manual `cp -r .opencode/plugins/tna-gate/`
the onboarding flow never performs; on Claude Code/Codex the plugin install
already ships it.

## Problem Statement

On OpenCode, an adopter who finishes `/setup-tna` gets the floor, the
mapping, and the commit gate — but the mid-session veto (tna-gate) stays
off until they discover a separate manual copy command in the installation
docs. The most valuable mechanical layer is the one the onboarding never
wires on the harness where the framework is developed.

## Solution

The onboarding CLI's existing `hooks` component is extended: when the human
consents to hooks AND the detected harness is OpenCode, the CLI also copies
the veto plugin (`.opencode/plugins/tna-gate/`) into the project — with an
existence guard (never clobber a directory the user owns), the copy recorded
in the stamp (`did.vetoPluginCopied: true`) so `--undo` removes exactly what
onboarding created. The per-harness branches live in the SKILL body (Claude
Code/Codex: verify presence, don't duplicate wiring; other harnesses: honest
audit-only message), while the CLI owns only the OpenCode copy action.
Doctor-lite gains one check: the veto plugin is present on OpenCode trees
that consented to hooks.

## User Stories

1. As an OpenCode adopter, I want `/setup-tna` to install the veto plugin
   when I consent to hooks, so that the strongest mechanical layer works
   without me finding a manual `cp` command.
2. As an adopter, I want the veto plugin copy recorded in the stamp, so that
   `--undo` removes exactly what onboarding created — never my own files.
3. As an adopter whose project already has `.opencode/plugins/tna-gate/`, I
   want onboarding to leave it untouched, so that my customizations survive.
4. As a Claude Code / Codex adopter, I want `/setup-tna` to verify the veto
   ships with the plugin (and say so), so that onboarding doesn't duplicate
   the plugin's wiring or break it.
5. As an adopter on a harness with no hook API, I want an honest audit-only
   message, so that onboarding never pretends a veto exists.
6. As a maintainer, I want the per-harness branch logic in the skill body
   and only the copy action in the CLI, so that harness knowledge stays in
   prose and the machine stays harness-agnostic.

## Decisions Already Made

- The existing `hooks` component is extended (no new component; the stamp
  shape gains `did.vetoPluginCopied` only). Breaking stamp-shape change is
  rejected.
- Per-harness branching lives in the SKILL body; the CLI performs only the
  OpenCode copy when (hooks consented) AND (harness is OpenCode) AND (target
  does not already exist).
- `did.vetoPluginCopied: true` is written to the stamp only when the CLI
  actually copied; `--undo` removes it then (recursive, force) and reports
  it.
- Doctor-lite adds: on an OpenCode tree whose stamp records hooks-consent,
  verify `.opencode/plugins/tna-gate/index.js` exists.

## Testing Decisions

- Fail-first (repo Iron Law); the new CLI behavior is tested the same way
  the existing hooks wiring is (spawn the CLI in a temp repo fixture).
- Byte-identity: the copied plugin must be identical to the payload copy
  (pin via existing eval mirror guard — no new check needed if the copy is
  a straight copyFileSync of tracked files).

## Constraints

- The CLI never writes outside the project root's `.opencode/plugins/`
  (plus its existing `.trust/` writes).
- No clobbering: an existing `.opencode/plugins/tna-gate/` directory is left
  untouched and reported as "already present".
- Consent for the copy is the hooks component's consent — no second round.
- All new docs text in English; mirrors re-synced byte-identical in the
  same change.

## Acceptance Criteria

1. (US1) In a temp repo fixture on an OpenCode-detected run with hooks
   consented, `.opencode/plugins/tna-gate/index.js` exists after the CLI
   finishes. — automated test.
2. (US2) The stamp records `did.vetoPluginCopied: true` exactly when the
   copy happened, and `--undo` removes the copied directory and reports it.
   — automated test (RED-first).
3. (US3) When `.opencode/plugins/tna-gate/` already exists, the CLI leaves
   it untouched and the receipt says "already present"; the stamp records
   `vetoPluginCopied: false`. — automated test.
4. (US4) The SKILL body carries the Claude Code/Codex branch (verify, don't
   re-wire) — text check via eval 46 markers. — automated.
5. (US5) The SKILL body carries the honest audit-only branch for
   hook-less harnesses. — automated (same marker block).
6. (US4) Doctor-lite (skill text) gains the veto-plugin-present check for
   OpenCode trees. — automated text check.
7. All gates green fresh after the change; mirror byte-identity holds. —
   automated.

## Out of Scope

- New hook wiring for other harnesses (Codex live-check remains open).
- Changing the Claude Code/Codex plugin payload layout.
- Any change to the evidence-gate component.

## Open Questions

- None — all three breakpoint decisions are recorded above.
