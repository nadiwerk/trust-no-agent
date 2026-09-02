# Running trust-no-agent on OMO (OhMyOpenAgent) + MCP

The core framework is harness-agnostic (see README → Portability). This doc is the OMO mapping — the recommended optimal setup, not a dependency:

## OMO orchestration

### 1. The router is AGENTS.md — keep it single

OpenCode auto-loads `AGENTS.md` every session and re-loads it after `/compact` — this is the bootstrap reinjection mechanism (router rules reload after context compaction, keeping skill triggering alive in long sessions). **Do not stack a second router on top** (e.g. installing a second framework's meta-router); one router as primary, borrow individual mechanics à la carte. Two active routers = non-deterministic skill selection.

### 2. Skills reach subagents only via `load_skills`

When delegating with `task(category=..., load_skills=["expect-fail", "receipts"], ...)`. Without this, subagents never see the skill — the orchestrator's discipline must be injected into the prompt instead (see AGENTS.md §5).

### 3. Category routing

| Work | Category / agent |
|---|---|
| UI, styling, layout, design | `visual-engineering` (never `quick` for visual work) |
| Hard logic, architecture | `ultrabrain` |
| Autonomous research + build | `deep` — one goal, one deliverable per call |
| Trivial single-file change | `quick` |
| Architecture/debugging consultation | `oracle` (read-only; collect results before implementing) |
| Codebase pattern discovery | `explore` (background, parallel — then don't re-search yourself) |
| External docs/OSS research | `librarian` |

### 4. Parallel execution

- 3+ independent tickets (`fork-it` output with no mutual blocking edges) → parallel `task(run_in_background=true)`.
- Parallel **writers** → one git worktree per agent (OMO `session.create` with `worktree`), merge at the end.
- Parallel **readers** → no worktrees; don't tax every run.
- **Loop until dry**: iterative research stops after 2 consecutive rounds with no new findings; dedupe against *everything seen* (the private ledger), not just accepted findings.

## MCP servers

| MCP | Used for | Skills that need it |
|---|---|---|
| **codegraph** | `codegraph_explore` before any edit — symbol source + blast radius in one call, ~10x cheaper than grep/read loops | all engineering skills |
| **exa web search** | external research against primary sources | `breakpoint` fact-finding, API research during `save-as` |
| **Playwright / browser panel** | UI verification with real data (never unit-test fixtures) | `make-it-so` UI gate, `receipts` UI row |

## Session hygiene

- Max ~3 hours or ~150 messages per session; symptoms of a full context: tool timeouts, `retry: "<none>"`.
- Fix: `/new` or `/compact` — then re-read the private working ledger (the `ship-log` ledger exists precisely for this).
- Blocked-on-user items stay OUT of the todo list (prose note instead), so continuation hooks never fire on work that's intentionally waiting for a human.

## Writing rules on this harness (learned the hard way)

The harness parses assistant output as BOTH prose and a stream of slash commands. A line that begins with `/` in a position the parser treats as command-start can be swallowed as a slash command — the rest of the message never reaches the user, and the harness may route it to a nonexistent tool. Observed with inline paths written as `/`-prefixed tokens in table rows.

Rules:
1. Never start a line with a `/`-leading token (paths like `/foo/bar`, or a bare `/` cell) unless it is an intentional slash command.
2. When a path must appear mid-line, keep it inside code fences or backticks and surrounded by text — a line consisting of only a path-like token is the danger shape.
3. If a response was swallowed, the recovery is to re-send the message with the path rewritten (e.g. `foo/bar` without the leading slash, or wrapped so no line begins with it).
4. When the text itself documents a path, prefer writing it without a leading slash (`skills/<name>/SKILL.md`) or inside a fenced block.
