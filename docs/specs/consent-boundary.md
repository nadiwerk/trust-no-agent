# Spec: consent-boundary — the onboarding never defaults to yes

Status: draft (breakpoint complete 2026-10-16, 3 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-16
Origin: roast security review (2026-10-16, finding #3 Required-hardening):
the interactive prompt defaults to consent on empty Enter, and --from-chat
answers are agent-asserted. Breakpoint 2026-10-16 (3 decisions locked, see
ledger). Companion to onboarding + receipt-enforcement.

## Problem Statement

The onboarding CLI asks "Enable …? [Y/n]" and treats an empty Enter as YES.
A distracted human, a script piping empty lines, or a misbehaving agent
therefore consents by doing nothing — the exact opposite of the framework's
premise (consent is real or it is not consent). Separately, `--from-chat`
answers arrive agent-asserted and the receipt does not name their channel,
so a chat reader cannot tell consented-by-human from claimed-by-agent.

## Solution

Fail-closed consent at both boundaries: the interactive prompt re-asks on an
empty/unrecognized answer (explicit Y or N required, capped rounds then
abort); `mapSkills` is type-validated (non-strings skipped with a named
message); and the CLI receipt gains a "Consent source" line that says
whether the answers came from the interactive prompts or were forwarded via
--from-chat (the agent-as-channel case the SKILL body already governs).

## User Stories

1. As a human being onboarded, I want an empty Enter to re-ask the question
   instead of consenting, so that consent only ever happens because I said
   yes.
2. As a human, I want the prompt to abort after a bounded number of
   invalid answers, so that a broken pipe cannot consent for me.
3. As an adopter, I want a malformed `mapSkills` value skipped with a named
   message instead of crashing mid-run after partial writes.
4. As a reader of the onboarding receipt, I want it to state the consent
   source (interactive / forwarded-via-agent), so that the trust boundary is
   visible in every receipt.
5. As the SKILL body's reader, I want the agent-as-channel guard to name
   this boundary explicitly, so that no agent presents forwarded answers as
   its own consent.

## Decisions Already Made

- Interactive prompts: empty or unrecognized answer → re-ask the same
  question (max 3 attempts, then abort with a named message; fail-closed).
- `mapSkills`: must be an array; non-string entries skipped with a named
  message; a non-array value aborts before any write.
- Receipt: adds a `Consent source: interactive | forwarded via --from-chat
  (agent channel)` line; the stamp records the same field.
- SKILL body: the channel guard gains one sentence — forwarded answers are
  the human's, verbatim; the agent never edits, fills, or confirms them.
- All existing tests that relied on empty-Enter-means-yes are updated to
  pass explicit answers (the contract change is intended and pinned).

## Testing Decisions

- Fail-first: new fixtures (empty answers → re-ask then abort; malformed
  mapSkills → skip message, other overlays still land; receipt carries the
  source line) written RED before the change.
- Existing fixtures updated to explicit y/n strings where they relied on
  the default.

## Constraints

- The re-ask cap is 3 attempts per question, then the CLI aborts with
  nothing written.
- The stamp schema gains `consentSource` only — no other shape change.
- Zero dependencies; mirrors re-synced byte-identical; all new docs text in
  English.

## Acceptance Criteria

1. (US1) Empty Enter at a component prompt re-asks (the question appears
   twice) and only an explicit y/n registers. — automated fixture (RED-first).
2. (US2) Three invalid answers abort the run with a named message and
   nothing written. — automated fixture (RED-first).
3. (US3) `mapSkills: "not-an-array"` aborts before any write;
   `mapSkills: [42, "good"]` skips 42 with a named message and still writes
   "good". — automated fixture (RED-first).
4. (US4) The receipt and stamp record the consent source line. — automated
   fixture.
5. (US5) The SKILL body names the boundary (forwarded answers are the
   human's, verbatim). — eval 46 marker (RED-first).
6. All gates green fresh; mirrors byte-identical. — automated.

## Out of Scope

- Cryptographic verification of answer origin (a local CLI cannot honestly
  provide it).
- Changing the components list or the stamp shape beyond `consentSource`.

## Open Questions

- None — all three breakpoint decisions are recorded above.
