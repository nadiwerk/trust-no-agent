# make-it-so

> Tickets approved. Time to build — test-first at agreed seams, layered verification, a bounded repair loop, closed with `roast-my-code` and `ship-log`.

## When this is the skill you need

1. **The tickets exist and the agent is about to freelance.** `make-it-so` is the execution harness: `expect-fail` at the seams agreed in the spec, typecheck regularly, full suite once at the end, browser check with real data for UI work. No code without a failing test; no "done" without evidence.
2. **Verification keeps failing and the agent keeps "trying again."** The repair-receipt contract ends the thrash: record the receipt *before* editing, classify the failure (capability / instruction / environment / context gap), make a real change before retrying, change only the diagnosed subject, **max two rounds** — then stop and report truthfully. A loop that retries forever is a guess repeated.
3. **The next action is expensive or irreversible.** Commit, push, publish, migrate. The dry-run gate forces the exact command, predicted effects, an irreversibility score (1-5), and severity — and anything scoring ≥4 or severity `block` requires *your* sign-off. Iron-Law-4 actions are never self-serve.
4. **You'd rather skip the tests.** "No test runner", "just trust me" — the agent doesn't comply silently. It names the conflict once and offers lighter verification options (a plain `node` assertion script, a smoke command against the real surface); if every option is declined, it writes the code — you own the call — but reports the ticket as **"implemented, unverified"**, never "done", with `decided_by: user` in the receipt.

## What it looks like

> **Repair round 1 — receipt first.**
> Subject: `PaymentService.charge` — TypeError: cannot read `currency` of undefined
> Evidence: `vitest run payments` → 2 failed (verbatim output captured)
> Fix chosen: validate the charge request at the API boundary, not inside the service — repairs the class, not the instance.
> Round cap: 2. If round 2 doesn't reach a new minimum error count, I stop and report.

## Chaining

- Consumes tickets from **`fork-it`**.
- Loads **`expect-fail`** while coding; runs **`roast-my-code`** when done; closes with **`ship-log`**. The strongest chaining hub in the framework.
- Runs inside the main loop: `breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log` (canonical chain, WORKFLOW.md rule 2).

## Not for

- `fast`-class tasks — a one-line fix doesn't need the repair contract.
- Tickets that don't exist — if the plan is still prose, go through **`save-as`** → **`fork-it`** first.
