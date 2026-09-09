---
name: Bug report
about: Report a broken skill, gate, router rule, or eval — with evidence, per repo discipline
title: ''
labels: ['bug']
assignees: ''
---

**Before you open this issue:** trust-no-agent's own discipline applies to its
bugs. If you observed a wrong *behavior* (an agent skipped a gate, a skill
misfired), the report is evidence-shaped: what you saw, what you expected, and
the artifacts that prove it — never "it didn't work".

## What happened

A clear, factual description of the observed behavior. If this is a silent
failure (the framework *looked* like it worked but a skill/gate never ran), say
so explicitly — that failure class is the reason this repo exists.

## What you expected

The behavior the router, skill, or gate should have produced, citing the rule
(`AGENTS.md` section, skill name, Iron Law number) it violates.

## Evidence

- Which harness and model you ran on (e.g. ZCode + GLM-5.3-Flash, Codex).
- The commands you ran and their **actual output / exit codes** (a report is a
  lead, not evidence — fresh verification output is what counts).
- The relevant files or `.trust/` ledger excerpts, if any.

## Reproduction

Steps to reproduce from a clean clone, or a minimal fixture (temp-dir style,
like the eval fixtures) that triggers it.

## Environment

- OS:
- Node version (`node --version`):
- Harness + model:

## Honest limits (optional)

Anything uncertain about your observation — a verifier that cannot determine
an outcome reports `uncertain` with a one-line reason; the same honesty applies
to bug reports.
