# no-thanks

> Receive review feedback with rigor: verify before implementing, ask before assuming, push back when the feedback is wrong. Named after its most-enforced rule — **never say "thanks"**.

## When this is the skill you need

1. **Review feedback just arrived and the agent is about to agree with all of it.** "You're absolutely right!" is the tell of performative agreement — followed by blind implementation of a suggestion that doesn't fit this codebase. `no-thanks` runs the response pattern: read fully, restate the requirement, **verify against codebase reality**, evaluate, respond with technical acknowledgment or reasoned pushback, implement one item at a time.
2. **Findings from `roast-my-code` (or any reviewer) need triage.** Reviewers are sometimes wrong — a "duplication" flag on code the repo's standards deliberately separate, a security finding already mitigated at a different layer. The receiver-side skill evaluates each finding on merit instead of implementing the whole batch to look agreeable.
3. **The feedback is partially unclear.** Partial understanding = wrong implementation, and items may be related. If any item is unclear, the skill stops the whole batch and asks — no implementing the clear half and hoping.

## What it looks like

> **Reviewer:** "Extract a shared retry helper — you have the same loop in two files."
> **Agent:** Verified before agreeing: the two loops differ in backoff strategy and error classification — the shape looks duplicated, the behavior isn't. Pushing back on this one; implementing the authz finding (confirmed real, missing check at the boundary).

## Chaining

- The consumer side of **`roast-my-code`** — that skill governs the reviewer side, this governs the receiver side.
- Findings that are verified real get implemented under the standard gates (**`expect-fail`**, **`receipts`**).
- Accepted findings that keep recurring become permanent router rules via rule-inheritance — the fix lands as a rule every future session inherits, not as a memory.

## Not for

- Emitting review feedback — that's `roast-my-code`.
- New work requests — that's the planning chain's entry gate, not a review-receiver.
