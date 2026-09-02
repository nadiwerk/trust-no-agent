# scribe

> The breakpoint interview, plus it records while the conversation runs — every architecture decision becomes an ADR, every new domain term lands in the glossary, at the moment it's decided.

## When this is the skill you need

1. **A feature that changes the architecture.** You're adding multi-tenancy. Every round of the interview produces decisions someone will ask about in six months ("why row-level security and not schema-per-tenant?"). `scribe` writes the ADR *when the decision is made* — not retroactively from a transcript nobody can find.
2. **A domain you're still naming.** The team keeps saying "workspace" and "project" interchangeably. During the interview, new and ambiguous terms get pinned into the glossary in `CONTEXT.md` with one-two sentence definitions — so the code, tests, and future agents all use the same vocabulary.
3. **Regulated or high-churn teams.** New engineers join and ask "why is it built this way?" The ADRs written during scribe interviews are the answer — written at decision time, when the reasoning is still fresh.

## What it looks like

> **You:** okay, decision: we go with outbox pattern for events.
> **Agent:** Recording — `docs/adr/0007-transactional-outbox.md` (context, decision, consequences). Also adding "outbox" to the glossary since it's new to this codebase. Next open decision: who owns the relay process?

## Chaining

- Same gate position as `breakpoint` — pick ONE of the two entry skills. No documents wanted? `breakpoint` alone is the stateless default.
- Exits into **`save-as`**, which uses the freshly written ADRs and glossary as spec material.
- Runs inside the main loop: `classify → scribe → save-as → fork-it → make-it-so → roast-my-code → ship-log`.

## Not for

- Prototypes and throwaway spikes — the ADR scaffolding would outlive the code. Use **`breakpoint`**.
- `fast`-class tasks — no decisions, no docs, no interview.
