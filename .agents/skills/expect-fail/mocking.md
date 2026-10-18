# When to mock

Doubles are for the world outside your control. Everything you own — classes, modules, internal collaborators — gets exercised for real; substituting a double for your own code hides exactly the interactions the test exists to pin.

Mock at system boundaries:

- External services (payment, email, third-party APIs).
- Databases — where a test database is impractical; prefer the real one when it is cheap.
- Time and randomness.
- The file system, where a real fixture is awkward.

Never mock:

- Your own code.
- Internal collaborators.
- Anything whose behavior you can change directly.

## Seams that are cheap to replace

A seam between your code and the world should be cheap to replace in a test. Two habits do most of the work.

**1. Inject the dependency.**

Hand the external client in instead of building it inside. A function that constructs its own Stripe client drags real credentials into every test; one that takes a client accepts any double you offer.

```typescript
// Easy to double: the payment client is a parameter
function chargeOrder(order, paymentGateway) {
  return paymentGateway.charge(order.total);
}

// Hard to double: constructing the real gateway forces real side effects
function chargeOrder(order) {
  const gateway = new PaymentGateway(process.env.PAYMENT_KEY);
  return gateway.charge(order.total);
}
```

**2. Prefer one function per operation over a generic fetcher.**

Give every endpoint its own function and each test doubles exactly one operation with one predictable response shape. Collapse them into a single generic fetcher and every mock must branch on endpoint and payload — routing logic smuggled into test setup.

```typescript
// GOOD: each operation is independently mockable, one shape per function
const client = {
  fetchProfile: (id) => http.get(`/profiles/${id}`),
  listInvoices: (accountId) => http.get(`/accounts/${accountId}/invoices`),
  createInvoice: (draft) => http.post('/invoices', { body: draft }),
};

// BAD: one generic function, and every mock must re-implement its routing
const client = {
  request: (path, init) => http.request(path, init),
};
```

Per-operation surfaces also read better at the call site: the test names the endpoint being exercised, the mock needs no conditional logic, and the interface stays type-safe per operation.

## The mockability rent test

Before designing for mockability, apply the same test the rest of this framework uses: **are you actually going to double this boundary?** If the external call happens once, is trivial to test against a real fixture, or never needs a fake — do not add an injection point for it. Seams earn their place the same way everything else in this repo does: by paying for themselves in tests that would otherwise be impossible.
