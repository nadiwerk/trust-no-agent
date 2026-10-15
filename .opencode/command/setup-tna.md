---
description: Onboard trust-no-agent in this chat — briefing, consent, skill mapping, stamp, receipt, doctor proof
---

# /setup-tna — onboard trust-no-agent from this chat

Follow this procedure exactly. You are the CHANNEL for the human's consent —
never the decider. The onboarding CLI is the ONLY writer of `.trust/` files.

## Step 1 — Briefing

Show the human this briefing (verbatim structure, plain language):

1. Every session starts with the discipline floor: the four Iron Laws and the
   MANDATORY section, quoted from the router.
2. A commit without fresh test evidence is vetoed by the evidence gate.
3. Every work unit closes with a 4-block receipt (Verdict / Evidence / Open /
   Next).
4. Three skills load on their domain: expect-fail (before any test or
   behavior-changing code), root-cause (before any fix), receipts (before any
   done claim).

## Step 2 — ONE combined question round

Use your interactive question mechanism ONCE, covering everything below in a
single round (the human answers once):

- Consent per component (each enable/disable):
  - the session floor
  - the mechanical hooks (session injection + commit veto)
  - skill mapping (proposals below)
  - the evidence gate (a commit without fresh test evidence is vetoed)
- For each discovered skill (run `node scripts/onboarding.mjs` WITHOUT flags
  first if you need the discovery list, or scan `.claude/skills/`,
  `.agents/skills/`, project skill dirs): one confirm/skip choice with its
  suggested trigger keywords.

## Step 3 — Forward the answers to the machine

Run EXACTLY:

```
node scripts/onboarding.mjs --from-chat '<answers JSON>'
```

where the answers JSON is:

```json
{ "components": { "floor": true, "hooks": true, "overlays": true, "evidenceGate": true }, "mapSkills": ["confirmed-skill-name", "..."] }
```

- `components` carries the human's per-component choices (true/false).
- `mapSkills` carries ONLY the skill names the human confirmed.

## Step 4 — Verify with the doctor

Run `node scripts/doctor.mjs` and read the output: the onboarding warnings
must be resolved by the stamp; the receipt's Evidence block quotes the
doctor's own lines.

## Step 5 — Receipt

Close with the 4-block receipt (Verdict / Evidence / Open / Next). The
Evidence block quotes the CLI output and the doctor output verbatim.

## Guards — never cross these

- NEVER write `.trust/onboarding.json`, `.trust/skills-overlay/`, or any
  `.trust/` file directly — the CLI is the only writer.
- NEVER run `--yes` in place of the human's forwarded answers.
- NEVER skip the question round — consent without the human's answers is
  fabrication.
- NEVER name external products in your output.

## Degrade path — harness without an interactive question mechanism

If your harness has no interactive question mechanism, do NOT fake it.
Instead: show the briefing (Step 1) plus this one command block, and ask the
human to run it in their terminal:

```
node scripts/onboarding.mjs
```

Then wait for them to return with the CLI's receipt before proceeding to
Step 4. The CLI's interactive prompts handle the consent in that terminal.

## Already onboarded?

If `.trust/onboarding.json` already exists, the CLI routes to the
mapping-only behavior automatically: new skills are mapped, consent is not
re-asked. Just follow Steps 2–5 with the mapping confirmations only.
