---
name: scribe
description: Use when a large feature is about to start and decisions should be recorded — an interview that writes ADRs and the domain glossary as it goes.
disable-model-invocation: true
---

Scribe mode: like the breakpoint interview, but it records while the conversation runs. Run the `breakpoint` skill, plus the following:

- Record every decision that changes architecture or domain vocabulary **at the moment it's made** — don't wait for the interview to end:
  - **Architecture/scope decisions** → one ADR file at `docs/adr/NNNN-<slug>.md` (format: Context, Decision, Consequences).
  - **New/ambiguous domain terms** → add to the glossary in `CONTEXT.md` with a one-two sentence definition.
- If `CONTEXT.md` or `docs/adr/` doesn't exist yet, create it when the first decision appears — don't create empty scaffolding upfront.
