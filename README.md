<p align="center">
  <img src="assets/logo-readme.png" alt="trust-no-agent" width="480">
  <br>
  <a href="https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml"><img src="https://github.com/nadiwerk/trust-no-agent/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

trust-no-agent is a discipline layer for AI coding agents. It does not make the
model smarter — it makes its output **verifiable**: every claim carries fresh
evidence, every stage of work has a named skill, and the rules are enforced
mechanically where the model would otherwise decide for itself.

**Philosophy:** an agent's claim is not evidence, a subagent's report is not
evidence, and "should work" is a confession. Work only counts when it exits
zero. — [docs/philosophy.md](docs/philosophy.md)

## Install

**Claude Code — plugin (recommended).** Hooks wire themselves; nothing is
copied into your project:

```bash
claude plugin marketplace add nadiwerk/trust-no-agent
claude plugin install trust-no-agent@trust-no-agent
```

**Codex — plugin.** Same payload, same one-line result:

```bash
codex plugin marketplace add nadiwerk/trust-no-agent
codex plugin add trust-no-agent@trust-no-agent
```

**Any other harness** — one line inside your project:

```bash
npx skills add nadiwerk/trust-no-agent
```

That single line delivers all 12 skills **including the onboarder itself** —
the setup-tna skill carries byte-identical copies of the router and the core
rules in its payload. Project already has its own router, or your harness has
no skill system? The merge path, the manual copy fallback, and per-harness
overrides: [docs/installation.md](docs/installation.md) — and what each
harness guarantees (veto vs audit-only):
[docs/compatibility.md](docs/compatibility.md).

Then type **`/setup-tna`** in your chat session — the agent asks for your
consent, copies the router into the project root, runs the consent + skill
mapping flow, and closes with a doctor-lite proof.

The skills alone are inert — fresh agents self-triggered them **0 out of 3
times** in evals. The router forces the discipline to load; the plugin wires
the enforcement. ([docs/design.md](docs/design.md))

## The four Iron Laws

```
NO ACTING until the user confirms shared understanding.        (breakpoint)
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.              (expect-fail)
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.        (receipts)
NO EXPENSIVE, IRREVERSIBLE, OR SHARED-SYSTEM ACTION WITHOUT EXPLICIT HUMAN SIGN-OFF.
```

Three of the four are enforced by **mandatory skills** the router loads before
the relevant work starts — self-trigger was measured unreliable, so forcing is
the design.

## The chain

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Bugs take their own path — `root-cause` → `expect-fail` → fix → `receipts` —
and both paths meet at the same gates. Small work skips the chain but never
the registry check. After every stage the agent proposes the next step by name
and waits.

## The 12 skills

### Engineering

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `breakpoint` | model | Execution pauses — the agent interviews the user | [docs/skills/breakpoint.md](docs/skills/breakpoint.md) |
| `scribe` | user | Interview + writes glossary/ADRs as you go | [docs/skills/scribe.md](docs/skills/scribe.md) |
| `save-as` | user | Conversation → spec (PRD), synthesis only | [docs/skills/save-as.md](docs/skills/save-as.md) |
| `fork-it` | user | Plan → tracer-bullet tickets with blocking edges | [docs/skills/fork-it.md](docs/skills/fork-it.md) |
| `make-it-so` | user | Build from spec/tickets, test-first | [docs/skills/make-it-so.md](docs/skills/make-it-so.md) |
| `expect-fail` | model | Fail-first reference — good tests, seams, anti-patterns | [docs/skills/expect-fail.md](docs/skills/expect-fail.md) |
| `root-cause` | model | Root-cause-first debugging — no fixes before investigation | [docs/skills/root-cause.md](docs/skills/root-cause.md) |
| `roast-my-code` | model | Three-axis review, parallel subagents, severity labels | [docs/skills/roast-my-code.md](docs/skills/roast-my-code.md) |

### Discipline

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `receipts` | model | No "done" claim without fresh verification evidence | [docs/skills/receipts.md](docs/skills/receipts.md) |
| `no-thanks` | model | Receive review feedback with rigor — verify before implementing | [docs/skills/no-thanks.md](docs/skills/no-thanks.md) |

### Meta

| Skill | Invoked by | What it does | Use cases |
|---|---|---|---|
| `ship-log` | model | Append-only private ledger + self-review + rulings | [docs/skills/ship-log.md](docs/skills/ship-log.md) |
| `setup-tna` | user | Chat-guided onboarding — router copy, consent, skill mapping, doctor-lite proof | [docs/skills/setup-tna.md](docs/skills/setup-tna.md) |

## The enforcement layer

The parts that never depend on the model choosing to comply:

- **Receipt enforcement** — a "done" claim without a valid receipt is rejected
  at commit time; the receipt shape is validated (each verification claim
  carries its own evidence), cited commands must be repo gates, and claims
  older than 14 days are stale by computation and re-verified before they gate.
- **Hooks** — the discipline floor re-injects after compaction; a prompt
  classifier routes test/bug/done work to its mandatory skill; destructive
  actions wait for sign-off.
- **Engagement criteria** — the chain engages by counting (more than one file,
  a design choice, an unknown-cause bug), never by mood.
- **Review integrity** — review subagents never see the orchestrator's verdict;
  delegated reports without the verified SHA and method are dropped.
- **Labeled claims** — every prose claim is measured, inferred, or a guess, in
  the same sentence.
- **Doctor** — one command verifies the install is actually wired, not just
  recited.
- **CI** — thirty gates run on every push; every rule in the router is pinned
  by a check that was proven able to fail (encode-twice).

## Portability

The core ships as markdown: no MCP servers, no background tasks, nothing to
run beyond the verification commands. It works on any harness that reads
`AGENTS.md`; verified matrix across ten harnesses with evidence levels:
[docs/compatibility.md](docs/compatibility.md).

## The honest limits

- **It verifies testability, not intent.** The upstream gate forces specs to be
  *testable*, not *true* — wrong intent stays possible, only cheap to catch.
- **It does not make a weak model strong.** It catches silent failures and
  forbids dishonest claims; output quality still comes from the model.
- **It does not enforce itself.** Skills are text; what never depends on the
  model is the mechanical layer above — hooks, CI, and the doctor.

## Contributing

Work only counts when it exits zero — contributions included. Full guide:
[CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git config core.hooksPath scripts/hooks   # once — the same gate then runs on every commit
```

Before pushing, the core four gates must exit 0 — `node scripts/validate.mjs
&& node scripts/eval.mjs && node scripts/tickets.test.mjs &&
node scripts/doctor.test.mjs`; CI runs the full thirty. Conventional Commits;
`CHANGELOG.md` updated for user-visible changes; security issues via the
private path in [SECURITY.md](SECURITY.md).

## License

MIT — built for our own daily work, released for everyone who runs coding
agents.
