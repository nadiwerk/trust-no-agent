---
name: Feature proposal
about: Propose a skill, rule, or framework change — gap-driven, rent-paying
title: ''
labels: ['enhancement']
assignees: ''
---

trust-no-agent adds things only when they **fill a gap we actually hit** —
every new skill, rule, or router section must pay rent (its standing cost is
weighed before it's added, not after). Frame your proposal accordingly.

## The gap

What failure or recurring friction does this address? First-hand evidence is
strongest: an eval finding, a session where the framework silently dropped
something, a work pattern the current chain cannot express. "It would be nice"
is not a gap.

## Proposed change

The skill / rule / doc / mechanical check you propose, described at router
level: what loads it, when, and what gate it enforces. Reference the relevant
existing design (`docs/design.md`, `docs/rule-inheritance.md`, the trigger
matrix) so we can see how it fits.

## Alternatives considered

What existing skill, rule, or docs change could cover this instead? Often the
right fix is a one-line rule in `AGENTS.md`, not a new skill (skills are
standing cost on every request).

## Acceptance criteria

How would we verify this works? Proposals land with executable acceptance
criteria — a spec that cannot be tested cannot be decomposed. List the
observable, falsifiable outcomes (e.g. "eval check N fails when the rule is
removed, passes when restored").

## Scope check

- [ ] This fills a gap actually hit, not a hypothetical one
- [ ] No existing skill/rule covers it
- [ ] The change keeps the standing cost to skill descriptions (lazy by
      default — reference material goes in files, not skills)
- [ ] I've read `AGENTS.md` and `docs/design.md`
