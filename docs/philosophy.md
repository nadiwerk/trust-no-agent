# The Philosophy: Trust Over Speed

## The moment that gave this framework its name

An AI coding agent works for an hour. It writes the feature, runs into two errors, "fixes" them, and ends its turn with the sentence every developer has learned to dread:

> "Done! All tests pass. Let me know if you'd like any changes."

You check. There are no tests. The type error it "fixed" was suppressed, not fixed. The feature works in the happy path only. Nothing it claimed was a lie, exactly — it was a *guess dressed as a report*. And the entire cost of verifying it just transferred to you.

Most frameworks responded to this by making agents faster: more tokens, more parallel subagents, more autonomy, longer context. trust-no-agent starts from the opposite bet: **the bottleneck was never speed. It was trust.** An agent that can't prove its work is a liability, no matter how fast it is.

## The four Iron Laws

Everything in this framework is an application of four laws. Each one exists because a specific, expensive failure keeps happening without it:

```
NO ACTING until the user confirms shared understanding.        (breakpoint)
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.              (expect-fail)
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.        (receipts)
NO EXPENSIVE, IRREVERSIBLE, OR SHARED-SYSTEM ACTION WITHOUT EXPLICIT HUMAN SIGN-OFF.
```

**Law 1 exists because agents guess.** A wrong guess at the start of a feature means an entire feature built in the wrong direction — the most expensive class of bug there is, and it costs nothing to prevent. Interview before building. The agent looks up facts itself; it asks you only what genuinely needs deciding.

**Law 2 exists because tests written after code verify what the code does, not what it should.** A test that passes immediately is not a test — it's a tautology. Failing first is what makes the green at the end mean anything. The same logic now runs upstream: a spec written without falsifiable acceptance criteria verifies what the author imagined, not what was required — so `save-as` writes numbered criteria and `fork-it` refuses to slice a spec without them. Wrong intent is the most expensive bug there is, and tests can't catch it; the gate makes it cheap to catch before the first ticket exists.

**Law 3 exists because a claim is not evidence.** "Should work" is a confession. Verification run fresh, in this session, with output actually read and an exit code checked — that is evidence. Everything else is a vibe.

**Law 4 exists because some actions can't be un-done — and some that can be never should be taken alone.** An agent that can push, publish, or delete without a human in the loop is one hallucination away from a bad afternoon. Reversibility alone is not the line; cost and blast radius gate it — a push to a shared remote is trivially undone, yet still gated. Sign-off is how it's enforced.

## Three design commitments

### 1. Discipline scales with stakes

A typo doesn't need an interview, tickets, and a three-axis review. The router classifies every task first — `fast` / `full` / `loop` — and the ceremony scales to match. Frameworks that apply heavyweight process to every task get abandoned in week two. This one is built to survive week two.

### 2. Reports are leads; verification is the job

When work is delegated to subagents, their "success" reports are treated as leads — never as evidence. The orchestrator verifies. This is the same paranoia applied recursively: an agent's claim about *its own* work and a subagent's claim about *delegated* work fail in exactly the same way.

### 3. Memory that outlives the conversation

Context compaction wipes what the agent knew. A private, append-only ledger (`.trust/progress.txt`) does not. Completed work is logged with its verification evidence *before* the next unit starts; recurring patterns are mined into recipes; decisions the agent had to make on its own are recorded as rulings — decision, why, and cost if wrong. A fresh session resumes from state, not from memory. Lessons that recur are promoted into permanent router rules, so a failure that was fixed once stays fixed for every future session.

## Why "trust no one" — including yourself

The agent is the natural suspect, but the discipline applies to the whole loop: the subagent's report, the reviewer's finding (verify before implementing — even feedback gets no blind agreement), the passing test (was it observed failing first?), and the framework's own completion claims. *Everyone's* claims are checked against fresh, inspectable evidence.

The result is not slower development. It is development whose only cost is paid once — at the gate — instead of twice: once when the agent said "done," and again when production proved otherwise.
