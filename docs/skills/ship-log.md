# ship-log

> Every completed unit of work gets a ledger entry — before starting the next one. The ledger is private, gitignored, and survives what conversation memory doesn't.

## When this is the skill you need

1. **A unit of work just finished.** File change, refactor, bug fix, ticket — logged to `.trust/progress.txt` with what changed, the verification evidence (`tsc EXIT 0; vitest 42/42 pass`), and the single next open action. Never for work still pending approval — a log entry is a record, not a claim.
2. **A new session (or a compacted one) is resuming.** After a long pause, the rule is: re-read the todos, `progress.txt`, and the router — state the next step, never resume from partial memory. The log that dies with the conversation was a decision made in secret; the ledger is what makes work *survive* the conversation.
3. **You're about to repeat a solved task.** Every entry mines a **Recipe** — `task_type` + 2-8 generalizable steps, appended to `.trust/recipes.md`. Next time a similar task starts, `fork-it` greps the recipe and starts from a prior instead of from scratch. The ledger is chronological; recipes are retrievable by task type.

## What it looks like

```markdown
### Session Summary - add dead-letter queue to email relay
- Modified 'src/relay/email.ts' - dead-letter on 3rd retry failure + alert hook
- Verification: tsc EXIT 0; vitest 12/12 pass (deadletter suite, fresh run)
- Next: alert rendering in UI — separate ticket, not started
- Recipe: task_type = add-retry-with-dead-letter | steps = agree seam, failing test,
  minimal relay branch, dead-letter store, alert hook, full suite, roast, log
```

Plus the 4-dimension self-review — readability, maintainability, performance, security — each `[x]` or `[ ]` with a one-line reason. Never skipped silently: an unanswered dimension makes the entry a claim, not a record.

## Chaining

- Closes the main loop: `classify → breakpoint → save-as → fork-it → make-it-so → roast-my-code → **ship-log**`.
- Closes the bug path too: `root-cause` → `expect-fail` → fix → `receipts` → **`ship-log`**.
- Its recipes feed **`fork-it`** (reads `.trust/recipes.md` as priors) — the loop compounds.
- Runs after **`receipts`**: the ledger entry cites the receipt's evidence.

## Not for

- Work pending user approval — log after completion, not in place of a decision.
- Public changelogs — the ledger is deliberately private and gitignored; public history is git's job.
