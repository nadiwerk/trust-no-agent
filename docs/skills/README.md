# Skill use cases

Every skill has one page: what it's for, 2-3 concrete scenarios, a sample moment, and how it chains into the rest of the workflow.

## The chain

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Classify sits before the chain (the router decision, WORKFLOW.md rule 2 — not a stage).

Bug path: `root-cause` → `expect-fail` → fix → `receipts` → `ship-log`

## Pages

### Engineering

| Skill | One-line pitch | Page |
|---|---|---|
| `breakpoint` | The agent interviews you before it's allowed to act | [breakpoint.md](breakpoint.md) |
| `scribe` | Same interview, plus ADRs and a domain glossary as you go | [scribe.md](scribe.md) |
| `save-as` | Conversation → spec, synthesis only | [save-as.md](save-as.md) |
| `fork-it` | Spec → vertical-slice tickets with blocking edges | [fork-it.md](fork-it.md) |
| `make-it-so` | Build test-first at agreed seams, bounded repair loop | [make-it-so.md](make-it-so.md) |
| `expect-fail` | No production code without a failing test first | [expect-fail.md](expect-fail.md) |
| `root-cause` | No fixes without root-cause investigation first | [root-cause.md](root-cause.md) |
| `roast-my-code` | Three-axis review: Standards, Spec, Security | [roast-my-code.md](roast-my-code.md) |

### Discipline

| Skill | One-line pitch | Page |
|---|---|---|
| `receipts` | No "done" claim without fresh verification evidence | [receipts.md](receipts.md) |
| `no-thanks` | Receive review feedback with rigor — never "thanks" | [no-thanks.md](no-thanks.md) |

### Meta

| Skill | One-line pitch | Page |
|---|---|---|
| `ship-log` | Every finished unit of work gets a ledger entry | [ship-log.md](ship-log.md) |

## Which entry point do I start at?

- **Starting a big feature** → `breakpoint` (or `scribe` when decisions should be recorded as ADRs/glossary — same gate, extra paperwork)
- **Conversation already converged, just need it written down** → `save-as`
- **Spec ready, need tickets** → `fork-it`
- **Tickets approved, time to build** → `make-it-so`
- **Something is broken** → `root-cause`
- **Agent just said "done"** → `receipts`
- **Review feedback just arrived** → `no-thanks`
- **Domain language should get recorded** (glossary + ADRs as decisions land) → `scribe`
