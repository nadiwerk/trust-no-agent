---
name: expect-fail
description: "Test-driven development — write the failing expectation first, then make it pass. Use when the user asks to write tests, verify behavior, or prove something is correct."
---

# Expect Fail

```js
expect(feature).toFail(); // write this first. then make it a lie.
```

The loop is three moves: expect a failure, make the expectation honest, clean up. What separates TDD that produces lasting tests from TDD that produces theater is knowing what a good test is, where tests belong, which shapes rot, and which rules govern the loop — and applying all four on every cycle, not consulting them after the fact.

While exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
```

Violating the letter of this rule is violating the spirit of this rule.

### The upstream cousin (class `loop` specs)

```
NO FORK-IT WITHOUT A FAILING ACCEPTANCE TEST PER REQUIREMENT.
```

For class `loop` work, every requirement in the spec must map to an acceptance criterion (written in `save-as`, enforced at `fork-it`) that can be expressed as a test able to FAIL — before tickets are sliced. This is the same fail-first discipline moved one stage upstream: verification proves behavior, not intent, so a requirement that cannot be stated as a failing-test-to-be is a requirement the implementation will guess at. See `save-as` §Acceptance Criteria for the criteria format.

## What a good test is

A test is worth keeping when it checks behavior at the public interface — never the implementation beneath it. Then internals can be rebuilt from scratch and the tests stay green, because a good test reads like a specification: "password reset email is sent with a valid token" states a capability the software has, in words that survive any refactor that preserves the capability.

Examples live in [tests.md](tests.md); mocking guidance is in [mocking.md](mocking.md).

## Seams — where tests go

A **seam** is the public boundary where tests attach: the interface you observe behavior through, without reaching inside. Tests attach at seams, never to internals.

**Agree the seams before any test exists.** Write down which seams are under test and get the user's confirmation on that list — then hold to it; nothing gets tested at an unconfirmed seam. Total coverage is a mirage; the point of agreeing seams up front is that testing effort lands on critical paths and gnarly logic instead of spreading thin across every edge case.

The question to settle first: "What's the public interface, and which seams should we test?"

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, reaches into private methods, or checks through a side channel (querying the database instead of using the interface). The tell: a refactor that changes no behavior still breaks the test.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Certifying the bug** — testing pre-existing code against values derived from its observed behavior. The first green test against code that already exists certifies what the code DOES, not what it SHOULD do: an expected value copied from the code's output (sum(1,2) returned 4, so assert 4) is the tautological pattern in disguise, and a bug ships with a passing test as its alibi. Derive the expected value from intent instead — the name, the spec, the user's stated requirement — and if intent contradicts observed behavior, the behavior is the bug. Say so before the test runs, not after it passes.
- **Horizontal slicing** — writing all tests before writing any implementation. A pile of pre-written tests verifies behavior nobody has designed yet: they encode guesses about shape instead of what users actually see, they go numb to real changes, and they lock test structure in before a line of code has taught you anything. Build in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Fail before pass.** Write the failing expectation first, then only enough code to make it a lie. Don't anticipate future tests or add speculative features.
- **One slice per cycle.** A single seam, a single test, the minimum implementation that turns the test green — then stop.
- **Refactoring is not part of the loop.** It belongs to the review stage (the `roast-my-code` skill), not the fail → pass implementation cycle.

## Rationalization table

| Excuse | Reality |
|---|---|
| "Too simple to test" | Simple code is the cheapest to test; if it's truly trivial, the test is trivial too |
| "I'll test it after" | Tests written after the fact verify what the code does, not what it should do |
| "Tests after achieve the same goals" | They achieve a different goal: retroactive documentation, not design |
| "The test passed immediately" | Then it isn't a new test — the behavior already existed. Move it or check your assumptions |
| "The expected value came from running the code" | That certifies the bug, not the behavior — expected values come from intent (name, spec, requirement), never from observed output |
