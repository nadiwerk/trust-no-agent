<!-- Linked issue: behavioral changes need a linked issue first (CONTRIBUTING.md → "Open an issue first") -->

## Summary

What this PR changes and why, in a few sentences. Reference the linked issue
(`Fixes #N` / `Closes #N`) if one exists.

## Classification & chain

trust-no-agent contributions follow the repo's own discipline. Which chain did
this work run through?

- [ ] `fast` — one step, verifiable at a glance
- [ ] `full` — short todos + verification
- [ ] `loop` — breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log

> Note: test-writing is **never** `fast`. If this PR adds or changes tests, it
> went through `expect-fail` (fail-first, non-tautological).

## Verification (work only counts when it exits zero)

Paste the **fresh** output of the gates you ran in this session — not
paraphrased, not from memory:

```text
node scripts/validate.mjs   → <paste output + exit code>
node scripts/eval.mjs       → <paste output + exit code>
node scripts/tickets.test.mjs → <paste output + exit code>   (if tickets touched)
node scripts/doctor.test.mjs  → <paste output + exit code>   (if doctor touched)
```

A PR whose verification block says "should pass" without fresh output will be
sent back — that is Iron Law, not gatekeeping theater.

## Checklist

- [ ] Gates above ran fresh, all exit 0
- [ ] Conventional Commits format (`commit-msg` hook enforces it)
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] No files touched outside the declared scope
- [ ] Skill frontmatter updated consistently (if a skill changed — `validate.mjs` checks this)
- [ ] Behavioral changes link an issue where the decision was recorded
