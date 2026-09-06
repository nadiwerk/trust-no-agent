# Rule inheritance — governance

AGENTS.md §5 says accepted review findings become 1-3 permanent router lines before the work is logged. This file is the governance for that act. Load it only when a rule is about to land in the router; a rule entering the router pays rent forever, so entry is gated, scoped, and reversible.

## The gate — four required fields

A finding may become a router rule only when all four are recorded (in the ledger entry, here, or both):

| Field | Meaning | Example |
|---|---|---|
| **Origin** | The finding / ledger entry that produced it | "roast-my-code #12: off-by-one labeled FYI" |
| **Rationale** | Why the rule must guard every session from tomorrow | "severity labels drifted toward FYI on real bugs" |
| **Scope** | `repo` (target project only) vs `global` (this router) | global |
| **Undo** | How to remove it and what removal costs | "delete the trigger line; ledger keeps the record" |

No origin, no rule. A rule without an origin is a preference wearing a rule's uniform.

## The noise filter

Reject before gating — a lesson that fails this filter never reaches the gate:

- **One-off noise** — a single incident with no recurrence pattern.
- **Unsupported hypotheses** — an explanation with no evidence attached.
- **Transient tool outputs** — an error that resolved on retry after a real fix.
- **Session-specific lessons** — true only for this project/task; they belong in the target project's own AGENTS.md (repo scope), not the global router.
- **Duplicates of a mechanical check** — if a script/lint/hook already enforces the boundary, prose is redundant: encode once, reference the check.

Recurring failures inherit the same way: the fix lands as a rule, not as a story in the transcript.

## Local vs global

- **repo scope** — the rule lands in the target project's AGENTS.md / WORKFLOW.md, not here. Lower bar; a session lesson can live here if the project accepts it.
- **global scope** — the rule lands in this router (AGENTS.md). Higher bar: it must have survived at least one recurrence, or one review acceptance with evidence attached.

## Undo

Removal is a normal edit, never a secret: delete the rule's line(s) from the router and leave the ledger entry intact. The ledger is the audit trail; the router is the current state. Cost of a wrong removal: the rule stops guarding future sessions — but the ledger still shows why it existed, so the removal is reviewable, not lost.

## Register

Append a row when a rule lands. Pre-doc rules (present before this file existed) predate this gate — their origins live in the private ledger, not this register. Backfilling rows is optional cleanup, not required for future entries.

| Rule (router section) | Origin | Scope | Undo | Added |
|---|---|---|---|---|
| §6 chat receipt (4-block: Verdict/Bukti/Belum/Next) | Session 2026-09-04: user concern chat verifiable drifts without a fixed card shape | global | Delete the 2 router lines + `docs/chat-receipt.md`; ledger keeps the record | 2026-09-04 |
| §6 narration claims graded as claims (each claim needs its own artifact) | A3 narration defect, recurring across DSH/Codex/ZCode-1 live rounds (promotion claimed, no ADR written; user sanction invented) — absent in Pi/[CC]/ZCode-2 after the check was applied | global | Delete the router line + this register row; ledger keeps the record | 2026-09-06 |
| §6 ad-hoc verification never earns SHIPPED (at most IMPLEMENTED-UNVERIFIED) | D2 strict-reading precedent: strict in DSH/Pi/[CC] vs loose in ZCode-1 — 3/4 majority across harnesses | global | Delete the router line + this register row; ledger keeps the record | 2026-09-06 |
| §3 proposal handoff (model proposes next step by name; user-invoked chain never dead-ends) | Session 2026-09-06 user decision: user-invoked skills stay gated by approval, but a chain that stalls because the user doesn't know the next skill is the user-trigger trap again, now at chain level — dependence on the user remembering the map | global | Delete the §3 bullet + eval check #19 + this register row; ledger keeps the record | 2026-09-06 |
| §1 fast skips the chain, never the registry (matching skill proposed by name, any class) | Designed probe 2026-09-06, 2 runs: fresh agents given teaching requests classified `fast` and never considered the skill registry — correct-looking output from general judgment, external matching skill (teach) never proposed; 2/2 recurrence with the same mechanism while full-class tasks (archify, prototype) proposed 2/2. Same invisible-failure pattern as self-trigger (check #6), one layer earlier: the classification step itself hides the gap | global | Delete the §1 bullet + eval check #20 + this register row; ledger keeps the record | 2026-09-06 |
