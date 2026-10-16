---
name: setup-tna
description: Use when the user types /setup-tna, asks to onboard or install trust-no-agent in this project, or when a fresh-install signature is detected (the framework's skills are present but the router is not) — guides the whole onboarding in chat briefing, consent, router copy, skill mapping, and a doctor-lite proof
disable-model-invocation: true
---

# setup-tna — onboard trust-no-agent from this chat

Follow this procedure exactly. You are the CHANNEL for the human's consent —
never the decider. The onboarding CLI is the ONLY writer of `.trust/` files.

## Step 0 — Router install (fresh installs only)

If the project root does NOT already contain the router file and the
core-rules file:

- This skill ships byte-identical copies of both in its payload: the
  `references/` directory next to this SKILL.md holds a copy of the router
  and a copy of the core rules.
- Ask the human for explicit consent FIRST (Iron Law 4: writing into their
  project is an action on shared state). Name exactly what will appear in
  their project root.
- If the project already has its own router file, STOP — do not copy over
  it. Direct the human to the adopt-merge path in the installation docs
  instead; their router stays the only router.
- On consent, copy the two payload files byte-identical into the project
  root — never retype, never summarize, never edit. After copying, verify
  each file matches its payload copy byte-for-byte before moving on.

If the router is already present, skip this step.

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
  - the mechanical hooks (session injection + commit veto before they run)
  - skill mapping (proposals below)
  - the evidence gate (a commit without fresh test evidence is vetoed)
- For each discovered skill (run the onboarding CLI WITHOUT flags first if
  you need the discovery list, or scan the harness skill directories such as
  .claude/skills or .agents/skills): one confirm/skip choice with its
  suggested trigger keywords.

## Step 3 — Forward the answers to the onboarding CLI

The CLI lives in this skill's payload at scripts/onboarding.mjs (inside this
skill folder). From a repo checkout the same CLI is at scripts/onboarding.mjs
in the repo root.

Run it EXACTLY once, with the --from-chat flag and the human's answers as a
single-quoted JSON string:

```
onboarding.mjs --from-chat '<answers JSON>'
```

The answers JSON carries exactly these fields (do not rename them):

```json
{ "components": { "floor": true, "hooks": true, "overlays": true, "evidenceGate": true }, "mapSkills": ["confirmed-skill-name"] }
```

- The components object carries the human's per-component choices
  (true/false) from Step 2.
- The mapSkills array carries ONLY the skill names the human confirmed.

Read the CLI's output and relay what it did — including the veto-plugin
handling described in Step 4.

## Step 4 — Verify (doctor-lite)

Run these checks and read each result before claiming anything:

1. Stamp: the onboarding stamp file exists under .trust/ in the project root
   (written by the CLI, never by you).
2. Router identity: the project-root router file is byte-identical to the
   router copy in this skill's references/ payload (and the same for the
   core-rules file).
3. Skills detected: the harness's skill discovery lists the framework's
   skills.
4. Veto plugin: on a tree whose harness is OpenCode and whose consent
   included hooks, the veto plugin is present at
   .opencode/plugins/tna-gate/index.js (the CLI copies it; its receipt line
   names the copy or "already present").

## Step 5 — The veto plugin, per harness (say it exactly)

- **OpenCode**: when hooks are consented, the CLI copies the veto plugin
  into .opencode/plugins/tna-gate/ — the mid-session veto is ON. Relay the
  CLI's line (copied / already present / refused).
- **Claude Code and Codex**: the plugin install already ships the veto hooks
  — verify the presence of the hooks file in the plugin payload instead of
  re-wiring anything, and say so.
- **Harness without a hook API**: say honestly that the mid-session veto is
  audit-only there — the machine ships but nothing calls it mid-session; the
  commit gate via git hooks still applies when the hooks component was
  consented and scripts/hooks exists.

## Step 6 — Receipt

Close with the 4-block receipt (Verdict / Evidence / Open / Next). The
Evidence block quotes the CLI output and the verification results verbatim.

## Guards — never cross these

- NEVER write the onboarding stamp, the overlay directory, or any file under
  .trust/ yourself — the CLI is the only writer.
- NEVER run `--yes` in place of the human's forwarded answers. Forwarded
  answers are the human's, verbatim: the agent never edits, fills, or
  confirms them.
- NEVER skip the question round — consent without the human's answers is
  fabrication.
- NEVER copy the router without the human's explicit consent, and never copy
  it over an existing project router (merge path instead).
- NEVER re-wire a veto the plugin install already wired (Claude Code/Codex) —
  verify, don't duplicate.
- NEVER name external products in your output.

## Degrade path — harness without an interactive question mechanism

If your harness has no interactive question mechanism, do NOT fake it.
Instead: show the briefing (Step 1), then give the human the terminal
command for the onboarding CLI — the payload copy at
scripts/onboarding.mjs inside this skill folder (from a repo checkout:
scripts/onboarding.mjs at the repo root) — and wait for them to return with
the CLI's receipt. The CLI's interactive prompts handle the consent in that
terminal.

## Already onboarded?

If the onboarding stamp already exists, the CLI routes to the mapping-only
behavior automatically: new skills are mapped, consent is not re-asked. Just
follow Steps 2–5 with the mapping confirmations only.
