---
name: breakpoint
description: Stop execution like a debugger breakpoint — relentlessly interview the user about a plan, decision, or idea until shared understanding is reached, before any code runs. Use when the user wants to stress-test their thinking, before starting any large feature, or when the user says "interview me", "stress-test this plan", or asks to be grilled.
---

# Breakpoint

Before code runs, execution pauses here. A disciplined interview to reach **shared understanding** before a single line of code is written — like a debugger breakpoint, nothing past this line executes until the state is inspected and approved. The agent is not trusted to guess what the user means — and the user is never asked for facts the agent can look up.

## Process

1. **Build the decision tree.** Every decision branches into dependent decisions. Map it first — don't ask randomly.
2. **Ask per frontier.** The *frontier* = every decision whose prerequisites are settled. Ask the entire frontier in one round, numbered, each with **your recommended answer** (mark it with `➡️`). Separate rounds with `---`.
3. **One round = one frontier batch.** Wait for answers before the next round. Unstructured question dumps are bewildering.
4. **Done when the frontier is empty** — inspection complete, execution may resume.

## Division of labor

- **Facts are the agent's job.** If a fact can be found by exploring the environment (filesystem, tools, codebase), look it up — don't ask the user.
- **Decisions are the user's job.** Put each decision to the user and wait. Never decide on their behalf.

## Serialize at pause — state survives the stop

A breakpoint stops execution; what makes the stop *resumable* is the state written down **before** the pause. Before stopping to wait for the user (or any gate), record the full resume point:

- **Position** — where in the chain/work the execution halted (which step, which frontier questions are open).
- **State** — what exists so far: artifacts, decisions made, tickets/blockers settled, evidence gathered.
- **Deferred work** — what has not started but is queued behind this pause (see fork-it's deferred-queue rule).
- **Next action** — the single smallest step that resumes correctly.

Write this to the ledger (or the shared state file) at pause time — never reconstruct it at resume time from memory. A pause that serializes its state is a checkpoint; a pause that doesn't is a conversation break. Resume reads what was written, not what is remembered.

## Question delivery — interactive by default

Every user-facing question is delivered through the harness's **interactive question mechanism** — one structured prompt per frontier round, each question carrying concrete options with one recommended default the user can accept or override. This is the repo's default, not a stylistic choice: a question the user must hunt for inside a prose wall gets answered later, partially, or not at all — the same silent-failure class as any rule left to runtime initiative.

**Harness-agnostic fallback:** if the harness has no interactive question mechanism, deliver the frontier as a numbered list with a recommended answer per item (the `➡️` convention above). The *content* contract (one frontier per round, every question carries a recommendation, the user's confirmation resumes execution) is identical in both channels; only the delivery mechanism follows the harness. Portability precedence: `docs/compatibility.md`.

## Iron Law

```
DO NOT ACT until the user confirms shared understanding.
```

The user's confirmation of shared understanding is the only command that resumes execution past this breakpoint.

### What does NOT count as confirmation

| Response | Why it isn't a yes |
|---|---|
| "Whatever you think" / "Up to you" | Delegates the decision back — put it to the user explicitly |
| "Looks good" without specifics | Approves nothing in particular — name what was approved |
| Silence, or moving to another topic | Not an answer — re-ask the open frontier |
| Answering one question of a batch | The rest of the frontier is still open |

## Rationalization table

| Excuse | Reality |
|---|---|
| "It's a simple question, just answer it" | Even simple questions need context; a 2-minute pause is cheaper than building the wrong thing |
| "The user obviously wants X, I'll just build it" | A wrong guess = a whole feature built in the wrong direction |
| "I'll ask questions as I go" | Decisions asked mid-implementation = rework |
| "The spec already covers everything" | Specs cover decisions someone already thought about; unhandled frontier decisions are written nowhere |

## Red flags — STOP

- Asking about something you could look up in the codebase yourself
- Making a user decision without asking
- Moving to implementation without explicit confirmation
- Question rounds without numbers or recommended answers
