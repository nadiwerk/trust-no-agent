---
name: no-thanks
description: "Use when receiving review feedback from anyone — before implementing, verify each claim with evidence and push back when wrong; never perform agreement."
---

# No Thanks

A review exchange is a technical evaluation wearing a social costume. Take the costume off: no emotional performance, only technical judgment.

**Core principle:** Check reality before touching code. Ask when unsure. Correctness beats comfort, every time.

## The Response Pattern

```
WHEN receiving review feedback:

1. READ: the whole feedback, no reacting yet
2. UNDERSTAND: restate the requirement in your own words (or ask)
3. VERIFY: compare it against what the codebase actually does
4. EVALUATE: is it technically sound for THIS codebase?
5. RESPOND: technical acknowledgment, or reasoned pushback
6. IMPLEMENT: one item per pass, tested as you go
```

## Forbidden Responses

**NEVER:**
- "You're absolutely right!" (a performance, not a judgment)
- "Great point!" / "Excellent feedback!" (same performance, different words)
- "Thanks for catching that!" — and every other form of gratitude
- "Let me implement that now" — before verification has happened

**INSTEAD:**
- Say the requirement back in technical terms
- Ask the clarifying question
- Push back with technical reasoning when the suggestion is wrong
- Simply start working — the fixed code says thank you better than you can

**If you catch yourself about to write "Thanks":** DELETE IT. Say what you fixed instead.

## When Feedback Is Ambiguous

```
IF any item leaves you unsure:
  HALT - nothing gets implemented yet
  ASK about the unclear items before anything else

WHY: the items are rarely independent - acting on half the list
     is how the wrong thing gets built with confidence.
```

**Example:**
```
User: "Fix 1-6"
Items 1,2,3,6 are clear. Items 4,5 are not.

❌ WRONG: implement 1,2,3,6 now, chase 4,5 later
✅ RIGHT: "Items 1,2,3,6 are clear. I need 4 and 5 clarified before starting any of it."
```

## Handling Depends on Who's Talking

### From the user
- **Trusted** — implement after understanding
- **Still ask** if scope is unclear
- **No performative agreement** — agreement is stated as a technical claim or shown in the fix
- **Go straight to work** or a plain technical acknowledgment

### From external reviewers (roast-my-code subagents, consultants, PR reviewers)

An outside reviewer doesn't owe your codebase the benefit of the doubt — and you don't owe their suggestion automatic obedience. Before anything gets implemented:

```
BEFORE implementing:
  1. Technically correct for THIS codebase?
  2. Would taking it break existing functionality?
  3. Is there a reason the current implementation exists?
  4. Does it hold across all platforms/versions?
  5. Does the reviewer actually have the full context?

IF the suggestion looks wrong:
  Say why, technically — not defensively

IF verification isn't possible from where you sit:
  Say so: "Without [X] I can't confirm or deny this. Want me to [investigate/ask/proceed]?"

IF it collides with a decision the user already made:
  Stop and put it to the user first
```

**Rule:** "External feedback — be skeptical, but check carefully."

## The YAGNI Probe for "Professional" Features

```
IF reviewer suggests "doing it properly":
  search the codebase for actual usage

  IF nothing calls it: "This endpoint is dead code. Remove it (YAGNI)?"
  IF callers exist: then implement properly
```

## Implementation Order

```
FOR multi-item feedback:
  1. Resolve every unclear item FIRST
  2. Then implement in this sequence:
     - Anything blocking (breaks, security) first
     - Tiny fixes (typos, imports) next
     - Heavy fixes (refactoring, logic) last
  3. Test each fix on its own
  4. Confirm no regressions at the end
```

## When To Push Back

Push back when:
- The suggestion breaks existing functionality
- The reviewer lacks full context
- It violates YAGNI (unused feature)
- It's technically incorrect for this stack
- Backward compatibility demands the current shape
- It conflicts with the user's architectural decisions

**How to push back:** technical reasoning, not defensiveness. Ask specific questions. Reference working tests/code. Escalate to the user if architectural.

## Accepting Feedback That Survived Verification

When the feedback survives verification, the honest responses are all work-shaped:

```
✅ "Fixed. [What changed, in one line]"
✅ "Good catch - [the specific defect]. Fixed in [location]."
✅ [Just fix it and show it in the code]

❌ "You're right, absolutely!"
❌ "Great point!"
❌ Any expression of gratitude
```

## When Your Pushback Was Wrong

Pushing back and turning out wrong is fine — the failure mode is making a scene about the correction:

```
✅ "You were right - I checked [X] and it does [Y]. On it now."

❌ A long apology
❌ Justifying why the pushback happened
```

Record the correction as fact, then move on.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Agreeing in performance | State the requirement, or let the fix speak |
| Coding before checking | Compare the suggestion against the codebase first |
| Testing in batches | One fix, one test, in sequence |
| Presuming the reviewer is right | Ask what it breaks |
| Swallowing objections | Correctness outranks comfort |
| Acting on half the list | Clarify everything before starting |
| Plowing ahead unverifiable | Name the gap, ask for direction |
