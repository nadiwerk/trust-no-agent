<p align="center">
  <img src="assets/logo-readme.png" alt="trust-no-agent" width="480">
  <br>
  <a href="https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml"><img src="https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

**The agent said "done." It wasn't.**

Every developer running AI coding agents has lived this: the agent declares victory, the tests were never run, the UI was never opened, the bug "fix" fixed a symptom. You find out in production — or in front of a code review.

**trust-no-agent is the fix.** A discipline layer of 11 skills that sits on top of your existing agent and orchestrator. It does not replace your harness — it makes the output you already get **verifiable, reviewable, and honest**.

The paranoia is the feature: an agent's claim is not evidence, a subagent's "success" report is not evidence, and "should work" is a confession. **Work only counts when it exits zero.**

> **Workflow + skills for AI coding agents that don't trust anyone, including themselves.**

> **Philosophy in one line:** an agent that can't prove its work is a liability, no matter how fast it is. — [docs/philosophy.md](docs/philosophy.md)

## Install

**One line** (run inside your project):

```bash
npx skills add nadiwerk/trust-no-agent && cp AGENTS.md WORKFLOW.md .
```

That's it: **11 skills + the router**, working on any harness that reads `AGENTS.md`. The router is the secret — without it the skills sit inert (fresh agents self-triggered them **0 out of 3 times** in evals).

## The three skills to know first

| Hero skill | The pitch | Use case |
|---|---|---|
| **`breakpoint`** | *Opens the work.* The agent interviews YOU before a single line of code — no acting until shared understanding is confirmed. | "Build me a payment flow" → the agent asks the 8 questions you hadn't answered, instead of guessing all 8 wrong. → [use cases](docs/skills/breakpoint.md) |
| **`make-it-so`** | *Executes the work.* Test-first at agreed seams, a bounded repair loop (max 2 rounds — no infinite "one more try"), and built-in chaining to review and logging. | Tickets are approved → code gets written red-green, every failure classified and repaired, not thrashed. → [use cases](docs/skills/make-it-so.md) |
| **`receipts`** | *Closes the work.* "Done" without fresh verification evidence = didn't happen. Typecheck, tests, lint, build — run in THIS message, output read, exit code checked. | Agent says "tests pass" → before accepting, the gate demands the actual run from this session. Receipts or it didn't happen. → [use cases](docs/skills/receipts.md) |

## The core loop

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Classify sits before the chain — only `loop`-class work enters it: `fast` (one step, glance-verifiable) / `full` (2-4 steps) / `loop` (multi-stage). But no class skips the **registry check**: before answering any task, the agent checks the skill registry once and proposes a matching skill by name — trust-no-agent's own **or an external one** — and waits for approval. `fast` skips the chain, never the registry.

Bugs take their own parallel path: `root-cause` → `expect-fail` → fix → `receipts` → `ship-log`. Both paths meet at the same gates.

**Per-skill detail:** every skill has a page with 2-3 concrete scenarios, a sample dialog, and its chaining neighbors — [docs/skills/](docs/skills/) · [index](docs/skills/README.md)

## The four Iron Laws

```
NO ACTING until the user confirms shared understanding.        (breakpoint)
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.              (expect-fail)
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.        (receipts)
NO EXPENSIVE, IRREVERSIBLE, OR SHARED-SYSTEM ACTION WITHOUT EXPLICIT HUMAN SIGN-OFF.
```

These are not guidelines. Three are enforced by **mandatory skills** the router loads before the relevant work starts — the model does not decide whether the discipline applies. (Eval: fresh agents self-triggered the skills **0 out of 3 times**, even with explicit trigger words. Self-trigger is unreliable; forcing is the design — [docs/design.md](docs/design.md).)

## What makes this different

Most agent frameworks optimize for *speed* — more tokens, more parallel subagents, more autonomy. This one optimizes for *trust*, because the expensive failures are never about speed: they are the moment your agent said "done" and you believed it.

| | Speed-first frameworks | trust-no-agent |
|---|---|---|
| "It's done" | A claim from the agent | A receipt: verification run fresh, output read, exit zero |
| Plausible-but-wrong spec | Straight to tickets | Upstream spec gate: falsifiable acceptance criteria before `fork-it` |
| Ambiguous request | Agent guesses and builds | `breakpoint` pauses execution; the agent interviews you first |
| Bug appears | Try a fix, hope it sticks | `root-cause`: no fix before root-cause investigation; 3 failed fixes → question the architecture |
| Subagent "success" | Taken at face value | A lead, not evidence — the orchestrator verifies |
| Failing verification | Retry until it passes | Bounded repair loop: classify, fix the class, cap at 2 rounds, report honestly |
| Session ends / context compacts | Work context evaporates | `ship-log` ledger + recipes survive; next session resumes from state |
| New task | Starts from scratch | Three memory tiers — ledger, lessons, recipes — each task starts from the last time it was solved |
| Review findings | Fixed once, forgotten | Accepted findings become permanent router rules — a fix that lands once guards every future session |
| UI "works" | Fixture-based unit tests | Checked in a browser with real data — real data catches the bugs fixtures can't |
| Review feedback | "You're absolutely right!" → blind implementation | `no-thanks`: verify before implementing, push back when the feedback is wrong |
| External skills | Replaced, fenced off, or fought | A gate over them — anything fits, nothing fires uninvited; other skills make it capable, the gate keeps it honest |
| Standing cost | Every token counts, forever | Descriptions are the only always-on cost; deep material loads on demand (lazy by default) |

## All 11 skills

### Engineering

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `breakpoint` | model | Execution pauses — the agent interviews the user | [docs/skills/breakpoint.md](docs/skills/breakpoint.md) |
| `scribe` | user | Interview + writes glossary/ADRs as you go | [docs/skills/scribe.md](docs/skills/scribe.md) |
| `save-as` | user | Conversation → spec (PRD), synthesis only | [docs/skills/save-as.md](docs/skills/save-as.md) |
| `fork-it` | user | Plan → tracer-bullet tickets with blocking edges | [docs/skills/fork-it.md](docs/skills/fork-it.md) |
| `make-it-so` | user | Build from spec/tickets, test-first | [docs/skills/make-it-so.md](docs/skills/make-it-so.md) |
| `expect-fail` | model | Fail-first reference — good tests, seams, anti-patterns | [docs/skills/expect-fail.md](docs/skills/expect-fail.md) |
| `root-cause` | model | Root-cause-first debugging — no fixes before root-cause investigation | [docs/skills/root-cause.md](docs/skills/root-cause.md) |
| `roast-my-code` | model | Three-axis review (Standards + Spec + Security), parallel subagents, severity labels | [docs/skills/roast-my-code.md](docs/skills/roast-my-code.md) |

### Discipline

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `receipts` | model | Iron Law: no "done" claim without fresh verification evidence | [docs/skills/receipts.md](docs/skills/receipts.md) |
| `no-thanks` | model | Receive review feedback with rigor — and never say "thanks" | [docs/skills/no-thanks.md](docs/skills/no-thanks.md) |

### Meta

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `ship-log` | model | Append-only private working ledger + self-review + rulings | [docs/skills/ship-log.md](docs/skills/ship-log.md) |

## When to reach for this

- **You review agent-written PRs** and are tired of "looks done" work → `roast-my-code` + `receipts`
- **You hand agents whole features** and get back something plausible but wrong → `breakpoint` → `save-as` → `fork-it`
- **Your agent thrashes on bugs** — five "fixes," none stick → `root-cause`
- **Your agent writes tests that always pass** → `expect-fail`
- **Long-running projects** where context compaction wipes what the agent knew → `ship-log`

Discipline scales with stakes — that keeps the framework from being abandoned after week one. And the chain never dead-ends: after every stage the agent proposes the next step by name and waits.

## Portability

The core — the chain, the Iron Laws, the ledger, the verification gates — runs on any **harness** that reads `AGENTS.md`. The whole discipline ships as markdown: no subagents, no MCP servers, no background tasks, nothing to run or maintain beyond four verification commands. Portability details and the compatibility matrix: [docs/compatibility.md](docs/compatibility.md) · install paths per harness: [docs/installation.md](docs/installation.md).

- **Harness** — the runtime that reads `AGENTS.md` and executes the agent. The framework core needs only this.
- **Agent / orchestrator** (optional) — a layer on top that adds parallel subagents, worktree isolation, and category routing. Recommended: **OMO on opencode**. Verified compatibility matrix across other orchestrators: [docs/compatibility.md](docs/compatibility.md) · OMO mapping: [docs/omo-integration.md](docs/omo-integration.md).

Beneath the workflow sits a deliberately simple engine, expressed as rules, not code:

- **A task graph with blocking edges** — `fork-it` decomposes work into vertical slices where each ticket declares what it depends on, so independent work parallelizes without a single line of orchestration code.
- **A bounded repair loop** — `make-it-so` classifies every failing verification (capability / instruction / environment / context gap), commits to a minimal fix, and caps retries at two rounds; a loop that is allowed to retry forever is not a loop, it is a guess repeated.

## Contributing

Contributions follow the same discipline: **work only counts when it exits zero.** Full guide — repository layout, hook setup, branch rules: [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git config core.hooksPath scripts/hooks   # once — the same gate then runs on every commit
```

Before pushing, all four gates must exit 0 — `node scripts/validate.mjs && node scripts/eval.mjs && node scripts/tickets.test.mjs && node scripts/doctor.test.mjs` (CI runs the same four on every push and PR). Conventional Commits; `CHANGELOG.md` updated for user-visible changes; security issues via the private path in [SECURITY.md](SECURITY.md).

## The honest limits

- **It verifies testability, not intent.** The upstream gate forces specs to be *testable*, not *true*. It makes wrong intent cheap to catch, not impossible to have.
- **It does not make a weak model strong.** It catches silent failures and forbids dishonest claims. Output quality still comes from the model, the harness, and the direction you give it.
- **It does not enforce itself.** Skills are text; a model's promise to comply is not evidence. The parts that never depend on the model are the mechanical ones: the four verification gates, CI, and the pre-commit hooks.
- **It routes external skills, it does not vet them.** The registry check proposes any matching skill — external ones included — but approval without audit is trust without evidence. The vetting checklist lives in [docs/skill-vetting.md](docs/skill-vetting.md); meanwhile the verification gates keep auditing everything an external skill produces.

## License

MIT — built for our own daily work, released for everyone who runs coding agents.
