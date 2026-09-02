# save-as

> File > Save As — but the file is a spec and the source is the conversation. Pure synthesis of what was already discussed. No new questions, no speculative answers.

## When this is the skill you need

1. **The conversation converged but nothing is written down.** You and the agent just spent an hour deciding the payment flow: seams, limits, error behavior. The knowledge lives only in scrollback. `save-as` turns it into a spec — problem statement, user stories, implementation decisions, testing decisions, numbered acceptance criteria, constraints — then runs an **adversarial self-review** (ambiguity, contradictions, hidden assumptions, untestable criteria — the translation from conversation to document is where new ambiguity is born) and publishes it to the issue tracker with a `ready-for-agent` label.
2. **You're handing work to another agent (or session).** A fresh context window can't inherit your conversation. It *can* read a spec. Undecided details aren't invented — they're listed as open questions at the end, so the next session asks instead of guessing.
3. **You need the constraints locked before execution.** "Response time under 200ms at p95" agreed verbally becomes a line in the Constraints section — which becomes material for `make-it-so` and `roast-my-code` later. A floor agreed here must not be lowered during execution.

## What it looks like

> **Spec produced:**
> - Problem Statement — checkout drops users on 3DS redirect
> - 14 user stories, numbered
> - Acceptance Criteria — one falsifiable assertion per requirement, each with its check method
> - Decisions Already Made — retry at the gateway seam, not per-card
> - Testing Decisions — test at the public checkout API seam; prior art: existing `checkout.spec.ts`
> - Open Questions — *1: chargeback webhook idempotency — undiscussed, not answered here*

## Chaining

- Consumes the output of **`breakpoint`** / **`scribe`** — the confirmed understanding becomes the spec.
- Feeds **`fork-it`**, which turns the spec into tickets — and refuses to slice a spec that has no acceptance criteria. Verification proves behavior, not intent; the spec gate forces testability upstream, where intent is still cheap to fix.
- Runs inside the main loop: `classify → breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log`.

## Not for

- Anything still ambiguous — that's a **`breakpoint`** job, not a spec template with guesses in it.
- Interviewing: save-as is synthesis only. If you're being asked questions, you're not in save-as.
