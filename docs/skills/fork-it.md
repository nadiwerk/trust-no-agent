# fork-it

> One branch per piece of work — that's how git works, and how work should be broken down. Spec → tracer-bullet tickets, each declaring what blocks it.

## When this is the skill you need

1. **The spec is a monolith and the agent works better in slices.** "Build notifications" is a week of context. `fork-it` forks it into vertical slices — each cutting through schema, API, UI, and tests — each demoable on its own, each sized to one fresh context window. The agent works the frontier: any ticket whose blockers are done.
2. **You want to parallelize without a coordination hell.** Tickets declare blocking edges. Whatever has no blockers can start immediately — across parallel sessions or worktrees — and the edges make the ordering explicit instead of tribal knowledge.
3. **A wide refactor that can't land green in one slice.** Renaming a column with 4,000 call sites breaks vertical slicing. `fork-it` has the exception built in: **expand–contract** — add the new form beside the old, migrate call sites in batches (each batch its own ticket, CI green batch to batch), delete the old form last.

## What it looks like

> 1. **Outbox table + relay skeleton** — blocked by: none. Delivers: events land in `outbox`, relay polls and logs them.
> 2. **Email dispatch on relay** — blocked by: 1. Delivers: signup sends a real email end to end.
> 3. **Retry + dead-letter** — blocked by: 2. Delivers: a failing send retries 3x, then lands in dead-letter with an alert.
>
> Granularity feel right? Edges correct? Anything to merge or split?

## Chaining

- Consumes the spec from **`save-as`** — and refuses to slice a spec without numbered, falsifiable acceptance criteria. Criteria invented at slicing time are implementation wishes, not requirements.
- Feeds **`make-it-so`**, which executes one ticket at a time, each in a fresh session.
- Runs inside the main loop: `classify → breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log`.

## Not for

- `fast`-class work — a two-step change doesn't need a ticket graph.
- Horizontal layer-slicing ("all the models first, then all the APIs") — that's the anti-pattern; slices are vertical on purpose.
