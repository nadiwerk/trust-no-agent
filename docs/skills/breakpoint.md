# breakpoint

> Iron Law: **NO ACTING until the user confirms shared understanding.**

The agent stops like a debugger breakpoint. Nothing past that line executes until you approve the shared understanding it built.

## When this is the skill you need

1. **You handed an agent a one-line request for a big feature.** "Add rate limiting to the API." Ten minutes later the agent has built a Redis-backed limiter with a config DSL when you wanted a simple in-memory counter — because it never asked. `breakpoint` flips this: the agent maps every undecided decision into a decision tree and asks you the whole frontier, round by round, each with its recommended answer — delivered through the harness's interactive question mechanism (structured prompt, options, recommended default) when one exists, or the numbered `➡️` list as the documented fallback on harnesses without one.
2. **You want to stress-test your own plan.** You say "interview me" or "stress-test this plan" before committing to a design. The interview surfaces the assumptions you skipped — cheap to fix in conversation, expensive to fix in production.
3. **A previous session built the wrong thing.** The handoff prompt sounded complete, but three implicit decisions were never written anywhere. `breakpoint`'s serialize-at-pause rule means those decisions get recorded at pause time, so the next session resumes from state, not from a memory of what "seemed agreed."

## What it looks like

On a harness with an interactive question mechanism, each question arrives as a structured prompt — options to pick from, the recommended one marked, the user's answer captured in place. The example below is the fallback rendering (same content, no interactive channel):

> **Agent:** Round 1 — the open frontier:
> 1. Token bucket or sliding window? ➡️ *token bucket — cheaper, and you already have a clock dependency*
> 2. Per-user or per-endpoint limits? ➡️ *per-user — your pricing page already promises it*
> 3. What happens at the limit: 429 + Retry-After, or silent queue? ➡️ *429 — queuing hides capacity problems*
>
> Answer all three before round 2.

## Chaining

- Exits into **`save-as`** — the confirmed understanding becomes the spec.
- Variant for the same gate: **`scribe`** (ADRs + glossary wanted — scribe mode records decisions while the interview runs).
- Runs inside the main loop: `breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log` (canonical chain, WORKFLOW.md rule 2).

## Not for

- One-line fixes and `fast`-class tasks — the ceremony would outlive the change.
- Questions the agent can answer itself by reading the repo — facts are the agent's job; only decisions come to you.
