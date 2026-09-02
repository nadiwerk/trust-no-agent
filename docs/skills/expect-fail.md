# expect-fail

> Iron Law: **NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.** Write the failing expectation, then make it a lie.

## When this is the skill you need

1. **The agent's tests always pass.** A test that passes immediately isn't a new test — the behavior already existed, or the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)` — a tautology). `expect-fail` is the reference that makes red-green produce tests worth keeping: behavior tested through public interfaces, expected values from an independent source of truth. The sneakier failure — **certifying the bug** — derives the expected value from the code's own output (`sum(1, 2)` returned `4`, so the test asserts `4`): expected values come from intent (name, spec, requirement), and an intent-vs-observation conflict is the bug, not the assertion.
2. **You're about to say "just fix the bug."** The fix needs a failing test first — the test proves the bug exists, then proves the fix. Without it you have a patch and a prayer. This is the seam where **`root-cause`** hands off: root cause understood → failing test written → fix.
3. **Test effort keeps landing on trivia.** No test is written at an unconfirmed seam. Seams are agreed up front with the user, so testing effort lands on critical paths and complex logic instead of every edge case — and tests verify behavior through public interfaces, so they survive refactors.

## What it looks like

> **Agent:** Seam agreed: the public `POST /checkout` API. Writing the failing expectation first:
> `expect(checkout(cartWithExpiredCard)).toRejectWith(CardDeclinedError)`
> → runs, fails (no such error exists yet) — now the implementation makes it a lie. One slice: one seam, one test, one minimal implementation.

## Chaining

- Loaded by **`make-it-so`** at execution time (and by delegation via `load_skills` — an unloaded skill is a dead skill).
- Pairs with **`root-cause`**: root cause is how you understand the bug enough to write the failing test.
- Its anti-refactoring rule hands off to **`roast-my-code`**: refactoring belongs to the review stage, not the fail→pass cycle.

## Not for

- Retroactive "tests as documentation" — a different goal, and it should be named honestly.
- Horizontal slicing (all tests first, then all implementation) — bulk tests verify *imagined* behavior; tracer-bullet slices respond to what the last cycle taught.
