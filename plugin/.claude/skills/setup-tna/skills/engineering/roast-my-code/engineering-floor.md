# Engineering floor — the how-it-was-built baseline

Companion to the smell baseline in SKILL.md §3. Smells ask *does this code
smell bad*; this floor asks *was it built the right way* — the discipline
layer distilled from production incidents and the executor stacks an adopter
was carrying on top of this framework (distilled, not ported — the style
skills stay optional).

Same two binding rules as the smell baseline: **the repo wins** where a
documented standard endorses what this floor flags, and **skip anything
tooling already enforces**. Each item names the test a reviewer can apply.

## Boundaries

Validation, type narrowing, and defensive error handling live at system
boundaries — CLI args, config files, env vars, network, external APIs, DB
rows. Internal code trusts the types the boundary produced. Tests:

- Is this check defending data that already crossed a validated boundary? →
  redundant; delete it.
- Is raw external data flowing past the boundary unparsed? → add the parse
  at the edge, not scattered guards inside.
- Is a wire/transport/framework type re-exported through the public
  surface? → the boundary leaked; expose domain types only.
- Could this logic be a pure function the thin shell just calls? → extract
  it; logic in framework wiring can't be tested without the framework.

## Minimal diff / laziness

- The smallest change that solves the problem wins; fewer lines beat
  elegant boilerplate.
- One decision, one home: a choice repeated in several places belongs
  behind one source of truth, with consumers reading a simple flag.
- No speculative abstraction, indirection layer, or signal threading — the
  same class as Speculative Generality in the smell baseline, flagged at
  authoring time not just review time.
- **Subtract before you add:** dead code, redundant validators, and stub
  references come out before the new thing goes in. Design for observed
  usage, not imagined edge cases.

## Reader load

The metric is not LOC — it is **layers to trace** plus **state to hold**:
indirection between the question and the answer, and hidden or mutable
context the reader must keep in their head.

- Collapse layers that cost more than they save: one-caller wrappers,
  pass-through adapters, interfaces that hide nothing.
- Shrink mutable scope: locals over fields, fields over module state,
  module state over globals. Derive values instead of syncing them.
- Name the invariant once, at the boundary — not repeated in every
  consumer.
- The test: can a new reader answer *where does X come from* and *what can
  change X* in under 30 seconds? If not, cut layers or cut state.

## Domain modeling

Encode the real domain in structure instead of scattering it across
conditionals — a state machine over booleans that must stay in sync, a
map/registry/discriminated union over the same branch repeated across
files, a typed model over loose repeated shape assumptions. The tells:

- A feature growing an existing if/else chain by one more branch.
- A second boolean that must stay in sync with the first.
- Phase-named modules repeating the same domain rules per step (execution
  order is not ownership).

Do not force an abstraction: boring, clear, local code beats an abstraction
that adds indirection without removing branches, duplicated rules, or
invalid states.

## Type discipline (statically-typed languages)

- Make illegal states unrepresentable — define errors and special cases
  out of existence before adding handlers for them.
- Brand semantic primitives: two parameters sharing a primitive type but
  meaning different things (`UserId` vs `OrderId`) get distinct types;
  validate once at creation, trust downstream.
- Derive types from authoritative schemas (migrations, OpenAPI, protocol
  definitions) instead of hand-rolling parallel shapes that drift.
- Exhaust variants — an unhandled case should be a compile error, not a
  runtime surprise.

## Comments

- No comment restates what the code says — the comment rots, the code
  doesn't. A kept comment carries information code cannot: the *why* of a
  workaround, an external constraint, a non-obvious invariant.
- A constraint comment (`do not remove`, `do not change wording`, `talk to
  X before changing`) is an unenforced rule — the cheapest in-scope
  encoding (type, lint, runtime check, test) beats the instruction. If the
  lesson can't be encoded, make it more prominent with a failure example.
- Suppressions (`@ts-ignore`, lint disables, skip markers) are audit items,
  not decoration: each needs a named reason a reviewer can check.

## Idempotent operations

State-mutating operations converge to the same end state however many
times they run and wherever the previous run stopped — commands, lifecycle
steps, processing loops, restores. The tests:

- What happens if this runs twice?
- What happens if the previous run crashed at every possible point?
- Can the next run tell stale leftovers from live state by evidence, not
  by guessing? (temp-file-then-rename beats partial writes; content
  comparison beats creation order)

## Tests

`expect-fail` owns the fail-first contract and stub honesty; the floor's
slice is the two imagined edits:

- **Break the behavior** (wrong value, skipped effect, doubled effect) —
  if the test still passes it proves nothing: assertion looser than the
  contract, expected value computed by the code under test, assertion on
  data the test built itself.
- **Change the internals** keeping observable results identical — if the
  test now fails it is pinned to implementation and will need a rewrite on
  every refactor.

Assert the observable contract — return values, errors callers branch on,
effects outside the code — never internals, call order, or wording nobody
reads.

## AI tells in code

- Defensive checks on data that never crossed a boundary (see Boundaries).
- Grab-bag `utils` modules and symmetric boilerplate added "for symmetry".
- Comments narrating the diff (`// now validate input`) or restating the
  signature.
- Error handling that swallows — `catch` returning a default that hides a
  real failure a receipt would have to explain.
- Generality nobody asked for: options objects with one used key,
  plugin-shaped interfaces with one implementation.

## The ladder — decision order before writing code

Take the first rung that fully works (adapted from an MIT-licensed adopter
heuristic — measured in adopter routers):

1. Does it need to exist? Skip features/options/flexibility nobody asked
   for — and name what you skipped in one line.
2. Already in this codebase — a helper, component, service, pattern? Use it
   the way surrounding code does.
3. Standard library or platform feature? Use it, unless the project has its
   own.
4. An installed dependency? Use it. Never add one for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

Never cut down to size: validation at trust boundaries, error handling that
prevents data loss, security, accessibility — those are not negotiable
(rungs 2-6 never justify dropping them). A shortcut with a known limit
carries the line `shortcut: <limit>, <when to upgrade>` at the code site.

## Exceptions carry an owner and an expiry

A floor that can never bend gets routed around; a floor that bends silently
rots. Any accepted exception to these rules is written down with **owner +
expiry date** (the constraint-driven-development pattern): it is reviewed
or removed when it expires — it never becomes a permanent hole by neglect.
And the floor itself is never weakened to make a change pass; it changes
only through review of the rule, not through the diff that violates it.
