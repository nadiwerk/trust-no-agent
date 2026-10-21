# tickets-fixture

A minimal, valid ticket graph, committed so CI has something real to validate.

`node scripts/tickets.mjs` gates on **tickets validated**, not on directories
found: a run that validates zero tickets exits 1 with an actionable message
rather than reporting OK over nothing. That is the right contract for an
adopter's project, but it makes a bare `node scripts/tickets.mjs` step
impossible in this repo's own CI — a fresh checkout has no `.trust/`, and
`.trust/` is gitignored, so no graph can live there.

This directory is the fixture that closes that gap. It lives outside `.trust/`
precisely because it must be committed.

Two consumers:

- `.github/workflows/ci.yml` — the "Ticket-graph validator smoke" step runs
  `node scripts/tickets.mjs scripts/tickets-fixture/issues`, proving the CLI
  validates a real graph end-to-end and exits 0.
- The negative contracts (no `.trust/` at all, an empty `issues/` dir, an
  explicit dir that does not exist) are covered by `scripts/tickets.test.mjs`,
  which spawns the same CLI.

Keep the fixture minimal and conformant with the fork-it ticket template. If a
required field is added to the template, add it here too — this graph breaking
is the signal that the template moved.
