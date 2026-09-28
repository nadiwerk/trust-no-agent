---
name: root-cause
description: "Debugging — find the root cause before proposing any fix. Use when the user reports a bug, error, failure, or unexpected behavior — trigger words: \"broken\", \"500\", \"error\", \"sometimes fails\", \"just add a try/catch\", \"fix it\", \"why is this happening\", \"it doesn't work\". Especially under time pressure, after a previous fix failed, or when the issue isn't fully understood."
---

# Root Cause

A bug is not understood until its root cause is. Symptom fixes are failure: they
patch the visible break and leave the real defect to resurface. This skill is
the discipline that gets to the cause before any fix is written.

## Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```

If you haven't completed Phase 1, you cannot propose fixes. Violating the
letter of this rule is violating the spirit of this rule.

## When to use

Use for ANY technical issue: test failures, production bugs, unexpected
behavior, performance problems, build failures, integration issues.

Use this ESPECIALLY when:

- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- A previous fix didn't work
- You don't fully understand the issue

Don't skip when:

- The issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Someone wants it fixed NOW (systematic is faster than thrashing)

## The four phases

Complete each phase before proceeding to the next.

### Phase 1 — Root cause investigation

BEFORE attempting any fix:

1. **Read error messages carefully.** Don't skip past errors or warnings; they
   often contain the exact solution. Read stack traces completely; note line
   numbers, file paths, error codes.
2. **Reproduce consistently.** Can you trigger it reliably? What are the exact
   steps? If not reproducible, gather more data — don't guess.
3. **Check recent changes.** What changed that could cause this? Git diff,
   recent commits, new dependencies, config changes, environmental differences.
4. **Gather evidence in multi-component systems.** When the system has multiple
   components (CI → build → signing, API → service → database), add diagnostic
   instrumentation BEFORE proposing fixes: for each component boundary, log what
   enters and exits, verify environment/config propagation, check state at each
   layer. Run once to see WHERE it breaks, then investigate that component.
5. **Trace data flow.** When the error is deep in a call stack, trace backward:
   where does the bad value originate? What called this with the bad value?
   Keep tracing up until you find the source. Fix at the source, not the symptom.

### Phase 2 — Pattern analysis

Find the pattern before fixing:

1. **Find working examples.** Locate similar working code in the same codebase.
2. **Compare against references.** If implementing a pattern, read the reference
   implementation COMPLETELY — don't skim, read every line.
3. **Identify differences.** What's different between working and broken? List
   every difference, however small. Don't assume "that can't matter".
4. **Understand dependencies.** What other components does this need? What
   settings, config, environment? What assumptions does it make?

### Phase 3 — Hypothesis and testing

Scientific method:

1. **Form a single hypothesis.** State it clearly: "I think X is the root cause
   because Y." Write it down. Be specific, not vague.
2. **Test minimally.** Make the SMALLEST possible change to test the hypothesis.
   One variable at a time. Don't fix multiple things at once.
3. **Verify before continuing.** Did it work? Yes → Phase 4. Didn't work? Form a
   NEW hypothesis. DON'T add more fixes on top.
4. **When you don't know, say so.** "I don't understand X." Don't pretend to
   know. Ask for help. Research more.

### Phase 4 — Implementation

Fix the root cause, not the symptom:

1. **Create a failing test case.** Simplest possible reproduction; automated
   test if possible, one-off script if no framework. MUST exist before fixing.
   Use the `expect-fail` skill for writing the failing test.
2. **Implement a single fix.** Address the root cause identified. ONE change at
   a time. No "while I'm here" improvements, no bundled refactoring.
3. **Verify the fix.** Does the test pass now? Are no other tests broken? Is the
   issue actually resolved? Use the `receipts` skill before claiming success.
4. **If the fix doesn't work:** STOP. Count how many fixes you've tried. If
   fewer than 3, return to Phase 1 and re-analyze with new information. If 3 or
   more, STOP and question the architecture (below). Don't attempt fix #4
   without an architectural discussion.

### If 3+ fixes failed — question the architecture

A pattern indicating an architectural problem:

- Each fix reveals new shared state/coupling/problem in a different place
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

STOP and question fundamentals: is this pattern fundamentally sound? Are we
"sticking with it through sheer inertia"? Should we refactor the architecture
instead of continuing to fix symptoms? Discuss with the user before attempting
more fixes. This is NOT a failed hypothesis — this is a wrong architecture.

## Red flags — STOP and follow the process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- "One more fix attempt" (when already tried 2+)
- Each fix reveals a new problem in a different place

ALL of these mean: STOP. Return to Phase 1.

## Rationalization table

| Excuse | Reality |
|---|---|
| "Issue is simple, don't need process" | Simple issues have root causes too; the process is fast for simple bugs |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing |
| "Just try this first, then investigate" | The first fix sets the pattern; do it right from the start |
| "I'll write the test after confirming the fix works" | Untested fixes don't stick; the test first proves it |
| "Multiple fixes at once saves time" | Can't isolate what worked; causes new bugs |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem; question the pattern, don't fix again |
