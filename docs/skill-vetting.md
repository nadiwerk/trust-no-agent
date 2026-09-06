# Skill vetting - auditing external skills before the gate approves them

The registry check (AGENTS.md §1) proposes any matching skill - trust-no-agent's own or an external one - and waits for approval. The check routes skills; it does not audit them. An external skill is a claim, and a claim is not evidence: its instructions will be followed by an agent running with your permissions. Approval without audit is trust without evidence. This page is the audit.

Vetting audits the **input** side - what ships with the skill. The verification gates audit the **output** side - work done under an external skill still exits zero through `receipts` or it didn't happen. Two layers; nothing is trusted blindly on either.

## Two risk classes

A skill is instructions; a script is an executable. The framework's own 11 skills ship markdown only (24 files under `skills/`, zero executables - verified 2026-09-06), so their entire surface is prose, auditable by reading. A skill that ships scripts is a different class: its scripts run **outside the repo's gates** - pre-commit hooks and CI see repo changes, not what a script does to the machine. Classify the skill first; the checklist weighs accordingly.

## Safety checks - once, before first approval

1. **Read everything shipped.** `SKILL.md` first, then every file it references. The instructions are the payload. Red flags - any one rejects the skill until explained:
   - Router weakening: "skip verification", "commit directly when done", "don't tell the user" - anything that overrides an Iron Law or a MANDATORY skill.
   - Credential access: `.env`, tokens, SSH keys, browser profiles - anything that reads secrets or moves them out (curl, webhooks, uploads).
   - Irreversible / shared-system actions: force-push, publish, deploy, deletes outside the workspace - Iron Law 4 territory, always explicit sign-off.
   - Injection patterns: hidden or encoded instruction blobs, "ignore previous instructions" variants, anything that tries to outlive its own invocation.
2. **Read the executables like code.** Every script the skill references gets the strongest read in this checklist, because a shipped script bypasses every gate in this framework.
3. **Provenance and pinning.** Who publishes it, what license, is the source repo active, does the install path match the standard discovery dirs (see `docs/compatibility.md`). Pin the audited version: a silently-changing upstream revokes the approval the audit earned - the same supply-chain logic as the `npx skills add` warning in README §Install.

## Quality checks - what separates good from merely existing

1. **Trigger-pure description.** The description is the standing cost (AGENTS.md §8), paid on every request forever; the body must match what it promises. A description that claims every task taxes the host project.
2. **Mechanism over prose.** Model compliance is fragile (self-trigger eval: 0/3 - `docs/design.md`). Prefer skills that carry their own mechanical checks; a skill whose guarantees are prose is a guideline wearing a skill's name.
3. **Router conflict check.** A skill that normalizes "commit when done" collides with `receipts`; one that jumps straight to code collides with the chain. AGENTS.md is the arbiter: external skills add capability, never weaken gates.
4. **Live trial in a scratch worktree.** Run it once against a throwaway repo and compare what it does with what it claims. This is the same `doc -> live` promotion `docs/compatibility.md` uses - no new taxonomy.

## Verdicts

- **`vetted-live`** - full checklist plus live trial, passed.
- **`vetted-doc`** - checklist passed, not yet executed.
- **`unaudited`** - the registry may still propose it; approval is per-use and knowing.

Record the verdict in the ledger (ship-log) with the date and the pinned version; re-vet when upstream changes. Verdicts degrade like every other reference (AGENTS.md §8): an unresolved one falls back to `unaudited` and work continues.

## What this page deliberately is not

- **Not an eval check.** This checklist is judgment work; the mechanical boundary already lives on the output side (the gates). If field use shows unvetted skills causing real damage, the next lever is a mechanical provenance check - deferred until proven needed (AGENTS.md §8: everything added pays rent).
- **Not a block.** The registry still proposes external skills freely; vetting informs the user's approval and never replaces it.
