---
description: Onboard trust-no-agent in this chat - delegates to the setup-tna skill (single procedure source)
---

# /setup-tna - onboard trust-no-agent from this chat

This command is a thin wrapper: the procedure lives in the **setup-tna
skill** (`skills/meta/setup-tna/SKILL.md`) — read and follow it exactly. The
skill is the single procedure source; this file only routes to it so the
`/setup-tna` slash door keeps working on harnesses with project-local
commands.

Summary of what the skill will do (the skill body is authoritative):

1. Brief you on what changes in your sessions.
2. Ask ONE combined consent round (components + skill mapping) — if the
   router is not installed yet, the FIRST consent item is copying
   `AGENTS.md` + `WORKFLOW.md` into the project root from the skill's
   payload (byte-identical copies, your explicit yes required).
3. Forward your answers to the onboarding CLI — the ONLY writer of `.trust/`
   files. NEVER write `.trust/` files directly, and NEVER run `--yes` in
   place of the human's answers.
4. Verify with the doctor-lite checks (and the full doctor when run from a
   checkout), then close with a 4-block receipt.

If your harness has no interactive question mechanism, the skill's degrade
path applies: show the briefing plus the terminal command, and wait.
