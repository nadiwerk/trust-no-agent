# trust-no-agent

[![CI](https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**The agent said "done." It wasn't.**

Every developer running AI coding agents has lived this: the agent declares victory, the tests were never run, the UI was never opened, the bug "fix" fixed a symptom. You find out in production — or in front of a code review.

**trust-no-agent is the fix.** A discipline layer of 11 skills that sits on top of your existing agent and orchestrator. It does not replace your harness — it makes the output you already get **verifiable, reviewable, and honest**.

The paranoia is the feature: an agent's claim is not evidence, a subagent's "success" report is not evidence, and "should work" is a confession. **Work only counts when it exits zero.**

**Verifiable, concretely:** every "done" ships with the command, the output, and the exit code from this session. If you can't re-run it, it isn't done.

> **Workflow + skills for AI coding agents that don't trust anyone, including themselves.**

> **Philosophy in one line:** an agent that can't prove its work is a liability, no matter how fast it is. — [docs/philosophy.md](docs/philosophy.md)

## What "verifiable" means

Without it:

> **Agent:** "Done! All tests pass." ✅
> No output. No exit code. Trust it — or re-check everything yourself.

With it:

> ✅ DONE fix-login | `vitest 1/1 EXIT 0`
> **Bukti:** FAIL pre-impl (500) → PASS post-impl (401)
> **Belum:** browser check on real data

You don't read a claim. You read the run.

## What "reviewable" means

Without it:

> **Agent:** "Here's everything I did!" — a wall of diff with no boundaries. The reviewer starts from zero and guesses what matters.

With it:

> `Scope: diff 91df587..d396c26 (2 files)` — claims tied to numbered acceptance criteria, findings severity-labeled with file:line, feedback verified before it's implemented.

Reviewable isn't "go check it yourself" — work arrives ready to check: scoped, falsifiable, and labeled.

Upstream, the same discipline runs as questions. Before a single line of code:

> **Agent:** "Payment flow — which gateway? On timeout, how many retries? Card data stored or tokenized?"
> **You:** answer. The agent guesses nothing.

Decisions come to you as questions. Facts are the agent's job; decisions are yours.

## What "honest" means

Without it:

> **Agent:** "Done! Fixed." — the browser was never opened, and you find out in production.

With it — you've already seen it. The `Belum:` line in the receipt above? That's honest:

> **Belum:** browser check on real data

Nothing forced that line to exist. A gate that passed proves only what it measured — the gap is named because hiding it is how "done" lies.

Honest isn't what the agent says when it succeeds — it's the Belum line, the named gap, and a README that states its own limits. The framework applies the paranoia to itself: see [The honest limits](#the-honest-limits).

## Install

**One line — skills + router together** (run inside your project):

```bash
npx skills add nadiwerk/trust-no-agent && cp AGENTS.md WORKFLOW.md .
```

`npx skills add` installs the 11 skills into your harness's skill-discovery directory; `cp` adds the router (`AGENTS.md` + `WORKFLOW.md`) — no skill installer distributes it, and without the router the skills sit inert (self-trigger eval: fresh agents loaded the mandatory skills **0 out of 3 times**; evidence: [docs/design.md](docs/design.md)). First `npx` run executes third-party code — verify the package (`npm view skills`) against your harness's skill installer before trusting it.

Project **already has its own router**? Don't copy over it — [adopt instead](docs/installation.md#adopting-into-an-existing-project). **Harness with no skill system?** Nothing to install — the router tells the agent to open `skills/<name>/SKILL.md` from a clone, on demand. Per-harness paths, install modes, and post-install verification: [docs/installation.md](docs/installation.md).

## The three skills to know first

| Hero skill | The pitch | Use case |
|---|---|---|
| **`breakpoint`** | *Opens the work.* The agent interviews YOU before a single line of code — no acting until shared understanding is confirmed. | "Build me a payment flow" → the agent asks the 8 questions you hadn't answered, instead of guessing all 8 wrong. → [use cases](docs/skills/breakpoint.md) |
| **`make-it-so`** | *Executes the work.* Test-first at agreed seams, a bounded repair loop (max 2 rounds — no infinite "one more try"), and built-in chaining to review and logging. | Tickets are approved → code gets written red-green, every failure classified and repaired, not thrashed. → [use cases](docs/skills/make-it-so.md) |
| **`receipts`** | *Closes the work.* "Done" without fresh verification evidence = didn't happen. Typecheck, tests, lint, build — run in THIS message, output read, exit code checked. | Agent says "tests pass" → before accepting, the gate demands the actual run from this session. Receipts or it didn't happen. → [use cases](docs/skills/receipts.md) |

```
breakpoint opens → make-it-so executes → receipts closes
```

## The core loop

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Classify sits before the chain — only `loop`-class work enters it.

- **Classify** the task: `fast` (one step, verifiable at a glance) / `full` (2-4 steps) / `loop` (multi-stage). Don't run the full ceremony on a typo.
- **breakpoint** — execution pauses here: the agent interviews YOU until shared understanding. Facts are the agent's job; decisions are yours.
- **save-as** — File > Save As: synthesize the conversation into a spec. No new questions, no speculative answers.
- **fork-it** — fork the work into vertical slices with blocking edges. One branch per piece of work, just like git.
- **make-it-so** — test-first at agreed seams, verify ruthlessly, repair with receipts.
- **roast-my-code** — three-axis review (Standards + Spec + Security) run as parallel subagents.
- **ship-log** — append to a private, gitignored working ledger. A log that dies with the conversation was a decision made in secret.

Bugs take their own parallel path: `root-cause` → `expect-fail` → fix → `receipts` → `ship-log`. Both paths meet at the same gates.

**Per-skill use cases:** every skill has a page with 2-3 concrete scenarios, a sample dialog, and its chaining neighbors — [docs/skills/](docs/skills/) · [index](docs/skills/README.md)

## The four Iron Laws

```
NO ACTING until the user confirms shared understanding.        (breakpoint)
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.              (expect-fail)
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.        (receipts)
NO EXPENSIVE, IRREVERSIBLE, OR SHARED-SYSTEM ACTION WITHOUT EXPLICIT HUMAN SIGN-OFF.
```

These are not guidelines. Three of them are enforced by **mandatory skills** the router loads before the relevant work can start — the model does not get to decide whether the discipline applies. (Eval result: fresh agents loaded self-triggered skills 0 out of 3 times, even with explicit trigger words in the scenario. Self-trigger is unreliable; forcing is the design. Evidence and honest limits: [docs/design.md](docs/design.md).)

## What makes this different

Most agent frameworks optimize for *speed* — more tokens, more parallel subagents, more autonomy. This one optimizes for *trust*. The difference shows up in the moments that cost you real time:

| | Speed-first frameworks | trust-no-agent |
|---|---|---|
| Plausible-but-wrong spec | Straight to tickets, straight to code | Upstream spec gate: falsifiable acceptance criteria + adversarial self-review before `fork-it` |
| "It's done" | A claim from the agent | A receipt: verification run fresh, output read, exit zero |
| Ambiguous request | Agent guesses and builds | `breakpoint` pauses execution; the agent interviews you first |
| Bug appears | Try a fix, hope it sticks | `root-cause`: no fix before root-cause investigation; 3 failed fixes → question the architecture |
| Subagent "success" | Taken at face value | A lead, not evidence — the orchestrator verifies |
| Failing verification | Retry until it passes (or looks like it) | Bounded repair loop: classify, fix the class, cap at 2 rounds, then report honestly |
| Session ends / context compacts | Work context evaporates | `ship-log` ledger + recipes survive; next session resumes from state, not memory |
| Review feedback | "You're absolutely right!" → blind implementation | `no-thanks`: verify before implementing, push back when the feedback is wrong |

## The gaps it closes

Most frameworks leave these holes open. This one closes them:

- **A permanent private working ledger.** Conversation memory dies with compaction; the ledger doesn't. Every finished unit is logged to a gitignored `.trust/progress.txt` with its verification evidence, rulings (`Ruling: <decision> — <why> — <cost if wrong>`), and a 4-dimension self-review — so a fresh or compacted session resumes from state, not from memory.
- **Memory that compounds.** Three private tiers: chronological (the ledger), corrective (what broke and how — the lessons file `make-it-so` writes to `.trust/lessons.md`), procedural (how tasks like this were solved — `.trust/recipes.md`). Each new task starts from the last time it was solved, not from scratch.
- **Adoption that keeps the past.** A long-running project adopting the framework doesn't start from an empty ledger — an optional one-time bootstrap seeds it from git history (grouped into completed units, marked as reconstructed evidence, never backfilled with fake recipes), so early recovery doesn't depend on git archaeology.
- **Four first principles, written as rules.** Surface assumptions before building, simplicity first, surgical changes, verifiable goals. Quality behavior is a rule, not a vibe.
- **A delegation contract.** Every subagent prompt carries 3 repo rules + 6 sections. A subagent's "success" is a lead, not evidence — the orchestrator verifies. Accepted review findings become permanent router rules, so a fix that landed once guards every future session.
- **Real-data UI verification.** Unit-test fixtures lie. UI changes are checked in a browser with real data before they're called done — real data catches the bugs fixtures can't: duplicate names, empty columns, rows that render as separate entities.
- **An upstream spec gate (built into `save-as`, not a new skill).** Verification proves behavior, not intent — a wrong spec that passes its tests still ships wrong code. So `save-as` now writes numbered, falsifiable acceptance criteria (one per requirement, each with its check method) and runs an adversarial self-review — ambiguity, contradictions, hidden assumptions, untestable criteria — before publishing; `fork-it` refuses to slice a spec without them. Class `loop`: discipline scales with stakes.
- **Lazy by default.** Skill descriptions are the only always-on cost — a few short lines that say *when* to load, never *what* the workflow does. Deep reference material loads on demand. The framework's standing cost is tiny, so it doesn't tax every request forever.

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

- **You review agent-written PRs** and are tired of "looks done" work that fails on the second read → `roast-my-code` + `receipts`
- **You hand agents whole features** and get back something plausible but wrong → `breakpoint` → `save-as` → `fork-it`
- **Your agent thrashes on bugs** — five "fixes," none stick → `root-cause`
- **Your agent writes tests that always pass** → `expect-fail`
- **Long-running projects** where context compaction wipes what the agent knew → `ship-log`

Not every task needs the ceremony. The router classifies first: `fast` tasks (a typo, a one-liner) skip the chain entirely. Discipline scales with stakes — that's what keeps the framework from being abandoned after week one.

### Agent / orchestrator layers — add parallelism, worktrees, routing on top

An **agent/orchestrator** is an orchestration layer that runs *on top of* a harness and adds parallel subagents, worktree isolation, and category routing. These are accelerators, not dependencies — the core works without them:

| Orchestrator | Runs on | Install |
|---|---|---|
| **OMO (OhMyOpenAgent)** | on opencode (harness plugin) | `cp -r skills/*/* ~/.agents/skills/` |

Then apply the rules into your project — copy `AGENTS.md` + `WORKFLOW.md` as shown in [Install](#install). Full mapping in `docs/omo-integration.md`; verified compatibility matrix across other orchestrators (omp, OpenClaw, and more): [docs/compatibility.md](docs/compatibility.md).

## Contributing

Contributions are welcome — and they follow the same discipline as the framework: **work only counts when it exits zero.** Every change is verified by a mechanical gate before it is accepted. Full guide: [CONTRIBUTING.md](CONTRIBUTING.md).

```
trust-no-agent/
├── AGENTS.md            # the router — classify, chain, Iron Laws, delegation
├── WORKFLOW.md          # core rules (non-negotiable)
├── skills/              # the 11 skills, three tiers
│   ├── engineering/     #   breakpoint, scribe, save-as, fork-it, make-it-so,
│   │                    #   expect-fail, root-cause, roast-my-code
│   ├── discipline/      #   receipts, no-thanks
│   └── meta/            #   ship-log
├── docs/                # design, philosophy, installation, per-skill use cases
├── evals/               # static scenarios + live end-to-end results
├── scripts/
│   ├── validate.mjs     # structural validator (exit 0 or rejected)
│   ├── eval.mjs         # static evals, HARD checks (exit 0 or rejected)
│   ├── tickets.mjs        # ticket-graph validator: blockers resolve, numbered blockers-first, acyclic
│   ├── tickets.test.mjs   # fail-first self-test for tickets.mjs (exit 0 or rejected)
│   ├── doctor.mjs       # adopter install self-check (router, hooks, skills, ledger)
│   └── hooks/           # pre-commit + commit-msg (Conventional Commits)
└── .github/workflows/   # CI runs validate + eval + tickets self-test on every push and PR
```

**How to contribute:**

Activate the local hooks once so the same gate runs on every commit:

```bash
git config core.hooksPath scripts/hooks
```

Then follow these rules:

- **Run the gates before you push** — `node scripts/validate.mjs`, `node scripts/eval.mjs`, and `node scripts/tickets.test.mjs` must all exit 0. CI runs the same three checks on every push and PR.
- **Branch from `master`, open the PR against `master`** — one PR = one logical change, linked to an issue.
- **Conventional Commits** — `<type>(<scope>): <description>`; update `CHANGELOG.md` for user-visible changes.
- **Changing a skill?** Keep frontmatter `name` = folder, the invocation axis consistent, and descriptions trigger-shaped.
- **Changing the router or Iron Laws?** High-stakes — the MANDATORY skills and "writing tests is never `fast`" are HARD checks; weakening them fails CI.
- **Adding an eval?** Static checks go in `scripts/eval.mjs`; live scenarios in `evals/scenarios.md`; results in `evals/live-results.md`.
- **Reporting a bug?** Open an issue with the exact command, output, and expected vs. observed. Security issues go through the private path in [SECURITY.md](SECURITY.md).

## Portability

The core — the chain, the Iron Laws, the ledger, the verification gates — runs on any **harness** that reads `AGENTS.md`. No subagents, no MCP servers, no background tasks required; those are accelerators, not dependencies (see AGENTS.md §5 and §8).

Two layers, kept deliberately separate:

- **Harness** — the runtime that reads `AGENTS.md` and executes the agent (Claude Code, Codex, opencode, Cursor, Gemini CLI, Zed). The framework core needs only this.
- **Agent / orchestrator** — an optional orchestration layer on top (OMO on opencode) that adds parallel subagents, worktree isolation, and category routing. These are accelerators: they make the framework faster, never required.

Beneath the workflow sits a deliberately simple engine, expressed as rules, not code:

- **A task graph with blocking edges** — `fork-it` decomposes work into vertical slices where each ticket declares what it depends on, so independent work parallelizes without a single line of orchestration code.
- **A bounded repair loop** — `make-it-so` classifies every failing verification (capability / instruction / environment / context gap), commits to a minimal fix, and caps retries at two rounds; a loop that is allowed to retry forever is not a loop, it is a guess repeated.
- **A harness-agnostic core** — the chain, the ledger, and the gates have no dependency on any orchestrator; the model is a commodity, the stack around it is the engineering.

**Recommended setup: OMO (OhMyOpenAgent) on opencode** — the orchestrator layer on top of the opencode harness, adding parallel orchestration, category routing, and worktree isolation (details above).

## The honest limits

- **It verifies testability, not intent.** The upstream gate forces specs to be *testable*, not *true* — an intent that is wrong but cleanly testable still passes. The gate makes wrong intent cheap to catch, not impossible to have.
- **It does not make a weak model strong.** It catches silent failures and forbids dishonest claims. Output quality still comes from the model, the harness, and the direction you give it.
- **It does not enforce itself.** Skills are text; a model's promise to comply is not evidence. The parts that never depend on the model are the mechanical ones: `validate.mjs`, `eval.mjs`, CI, and the pre-commit hooks.

## License

MIT — built for our own daily work, released for everyone who runs coding agents.
