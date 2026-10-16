# setup-tna — use cases

The onboarding front door. One skill that turns "I installed some files" into
"the framework is wired, proven, and consented".

## Scenario 1 — fresh install, one line

You ran the one-liner in a new project. The skills are discovered, but the
router is not in the root yet — the framework is aboard but silent.

Type `/setup-tna`. The skill asks one consent question about copying the
router (`AGENTS.md` + `WORKFLOW.md`) from its own payload into your project
root, byte-identical. You say yes. Then one combined round covers the
components (floor, hooks, mapping, evidence gate) and which of your own
skills to map into the workflow. The CLI writes the stamp; the doctor-lite
checks prove the wiring; you get a receipt.

> **Human:** /setup-tna
> **Agent:** The framework's skills are installed but the router isn't in
> your project root. Install it from the skill payload (byte-identical copy)?
> **Human:** yes — and hooks on, map my review skill.
> **Agent:** [runs the onboarding CLI with the forwarded answers, then the
> doctor-lite checks] Verdict: DONE — stamp written, router identical to
> payload, 12 skills detected.

## Scenario 2 — already onboarded, new skill arrives

`.trust/onboarding.json` exists. A new skill landed in your skills directory.

`/setup-tna` skips consent re-asking and goes straight to mapping-only: one
confirm/skip choice for the new skill, the CLI updates the overlay, the
receipt closes.

## Scenario 3 — project with its own router

Your project already carries an `AGENTS.md`. The skill refuses to copy over
it — instead it points you at the adopt-merge path in
[docs/installation.md](../../docs/installation.md): a guided interview, your
router stays the only router, `git diff` shows every added line.

## How it chains

Runs once per project at adoption, and again (mapping-only) whenever new
skills appear. Everything after onboarding is the chain's territory —
[breakpoint](breakpoint.md) opens real work, [receipts](receipts.md) closes it.
