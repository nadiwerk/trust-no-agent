# Tests worth keeping

A test justifies its existence by pinning behavior that someone — a user, a caller — depends on. Anything else, whether it restates the implementation or pokes around inside it, is pure upkeep: effort spent with no payoff when things change.

## The good shape

Exercise the public interface, assert observable outcomes, name the capability being pinned. If the implementation changes but the behavior stays, the test should keep passing.

```typescript
// Pins user-visible behavior through the public API
test("password reset email is sent with a valid token", async () => {
  const user = await seedUser({ email: "dev@example.com" });
  await requestPasswordReset(user.email);
  const message = await lastSentEmail();
  expect(message.to).toBe("dev@example.com");
  expect(message.link).toMatch(/\/reset\/[a-zA-Z0-9]+$/);
});
```

Markers of a good test:

- Asserts what the caller observes, not what the code does internally.
- Touches only public entry points — no reaching into collaborators.
- Survives a refactor that changes internals without changing behavior.
- Names the capability ("password reset email is sent"), not the mechanism.
- One logical expectation per test, so a failure names the exact contract broken.

## Shapes that rot

**Implementation-coupling.** When a test doubles as a wiring diagram — mocking internal collaborators, invoking private methods, asserting the order calls arrive in — every refactor snaps it, even one that leaves behavior untouched.

```typescript
// Coupled to internals: fails on refactor with no behavior change
test("resetEmails calls mailer.deliver", async () => {
  const mailerMock = jest.mock(mailer);
  await requestPasswordReset("dev@example.com");
  expect(mailerMock.deliver).toHaveBeenCalledTimes(1);
});
```

Red flags:

- Mocking a module you own, instead of testing through it.
- Private methods under test.
- Assertions on call counts or invocation order.
- The test fails when you refactor and nothing observable changed.
- The name describes HOW (the call sequence) instead of WHAT (the outcome).

**Verifying through a side channel.** Checking an effect by querying the database yourself rebuilds the app's own read path inside the test. Make the public interface hand you the fact instead, and assert on that.

```typescript
// Side channel: re-implements the lookup path the app already has
test("archiveUser writes archived flag to database", async () => {
  await archiveUser(user.id);
  const row = await db.query("SELECT archived FROM users WHERE id = ?", [user.id]);
  expect(row.archived).toBe(true);
});

// Through the interface: exercises the same path a caller would
test("archiveUser makes the account read as archived", async () => {
  await archiveUser(user.id);
  const account = await getAccount(user.id);
  expect(account.status).toBe("archived");
});
```

**Tautology.** An expected value computed with the same logic as the code under test is an echo, not a check: the two can never disagree, the test always passes, and it documents nothing. Ground the expectation in something the code had no hand in producing — a known-good literal, a worked example, the spec.

```typescript
// Tautological: expected is recomputed the way the code computes it
test("applyDiscount reduces by the percentage", () => {
  const price = 4000;
  const expected = price - price * (discountRate / 100);
  expect(applyDiscount(price, discountRate)).toBe(expected);
});

// Independent: a literal the code has no part in producing
test("applyDiscount reduces by the percentage", () => {
  expect(applyDiscount(4000, 25)).toBe(3000);
});
```

## The one-question filter

Before any test joins the suite, put it through one question: **could this test fail while the behavior its name promises still works?** If yes, it pins structure where it claims to pin behavior — rework it first. A test that cannot disagree with the code is not a test.
