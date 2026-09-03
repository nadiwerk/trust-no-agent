# Compatibility — running trust-no-agent on agent harnesses & orchestrators

The core framework is harness-agnostic (see README → Portability): it needs a harness that reads `AGENTS.md` as instructions. Skill systems are optional — without one, the router's trigger matrix tells the agent to open the SKILL.md files on demand. This page records what was verified against real repositories and docs (2026-08-31). Unknowns are marked as unknown, never guessed. For step-by-step install commands on each harness, see `docs/installation.md`.

The **Evidence** column distinguishes two proof levels: **doc** (verified against the harness's official documentation/repositories only) and **live** (the framework was actually executed on that harness — an audit run, eval battery, or daily use). Doc rows are claims about capability; live rows are receipts. A harness without a live row has not yet been executed end-to-end.

## Verified matrix

| Harness / orchestrator | AGENTS.md | Skill discovery | Invocation control | Delegation / parallelism | Evidence | Verdict |
|---|---|---|---|---|---|---|
| **OMO** (oh-my-openagent, formerly oh-my-opencode) | Native, lazy + re-injected after compaction | `~/.agents/skills/` — our documented install path | `disable-model-invocation` **not recognized** — encode via config `skills.disable` or `agent:` gating | `task(category, load_skills, run_in_background)` — same shape as our prompts; worktrees via its work-with-pr skill | **live** — daily driver for this repo's development; full eval battery (scenarios.md) executed here | Hostable — the recommended setup |
| **Hermes Agent** | Native — priority chain (`.hermes.md` → `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md`), merged git-root chain + progressive subdirectory discovery | `~/.hermes/skills/` primary + `~/.agents/skills/` via `external_dirs` config + project-local `.agents/skills/` (trust-gated) | Invocation flag not read — every skill also becomes a slash command; the split lives in trigger-matrix prose (our portable design) | Isolated parallel subagents, RPC pipelines, MCP | doc | Near drop-in |
| **oh-my-pi (omp)** / Senpi | Native, injected at session start | **Non-recursive** — needs flattened `skills/<name>/` layout | Recognized (kebab-case normalized) | Subagents + parallel; **no native worktree isolation** | **live** — installed + smoke + task fan-out + /review executed (2026-09-03 orchestrator test) | Hostable + 3 adaptations |
| **OpenClaw** | Native (workspace + project) | `.agents/skills/**/SKILL.md` | Supported | Multi-agent + managed worktrees | doc | Best fit |
| **Codex** | Native — `AGENTS.md` (+ `AGENTS.override.md`) at session start, concatenated root→cwd | Agent Skills: `.agents/skills/`, `~/.agents/skills/` | Not verified per-tool | Coding-agent orchestration | **live** — full 5-dimension audit executed on a repo copy (2026-09-03); single-agent, no parallel reviewer fan-out | Hostable — verified |
| **[Claude Code] CLI** | **No** — reads `CLAUDE.md` natively; `AGENTS.md` only via manual import/symlink in `CLAUDE.md` | Agent Skills: `~/.claude/skills/` (personal), `.claude/skills/` (project) | Not verified per-tool | Agent Skills standard | doc | Router-only via wrapper — verified caveat |
| **Cursor** | Native — project root + subdirectories (nested combine); load timing unknown | Agent Skills: `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/` + compat dirs | Not verified per-tool | — | doc | Hostable — verified; load timing unknown |
| **Gemini CLI** | Partial — native is `GEMINI.md`; `AGENTS.md` only via `context.fileName` in settings | Agent Skills: `~/.agents/skills/` / `.agents/skills/` | Not verified per-tool | — | doc | Router-only via config — verified caveat |
| **Zed** | Native — `AGENTS.md` is the primary instruction file (first-match among compat names) | Agent Skills: `~/.agents/skills/` (global), `<worktree>/.agents/skills/` (project-local, trusted worktrees) | Not verified per-tool | — | doc | Hostable — verified |
| **ZCode** | Native | Agent Skills: `~/.agents/skills/`, `.agents/skills/` (same agentskills.io standard as the others) | Not verified per-tool | Parallel read-only subagents | **live** — full 12-finding audit executed (2026-09-03), 4 parallel dimension reviewers; skills discovered from `~/.agents/skills/` | Hostable — 1 gap: a skill installed but not re-discovered mid-session (Skill not found) needs a fresh session / reload before the registry sees it |

## What the research confirmed about our design

1. **The flattened skill layout is load-bearing.** omp discovers skills non-recursively (`skills/<name>/SKILL.md`). The README install instructions already ship the flattened `skills/*/*` copy — keep it that way; never reintroduce category nesting in install guidance.
2. **`disable-model-invocation` is not universal.** omp and OpenClaw honor it; OMO parses and drops unknown frontmatter fields, so the user-invoked/model-invoked split must be re-encoded there via config (`skills.disable`) or agent gating. On every harness, the split also lives in the AGENTS.md trigger matrix prose — that part always works.
3. **The private working ledger is the most portable anti-compaction mechanism.** OMO re-injects AGENTS.md after compaction; omp does not (only its sticky `RULES.md` survives). The file-based ledger survives on every harness regardless — it is the canonical cross-session memory, by design.

## Adapting per harness (setup deltas only, core never changes)

- **OMO**: after installing skills, encode the 4 user-invoked skills (scribe, save-as, fork-it, make-it-so) in OMO config so the model does not auto-fire them; model-invoked skills (breakpoint, expect-fail, root-cause, receipts, no-thanks, roast-my-code, ship-log) stay loadable.
- **Hermes Agent**: add `~/.agents/skills` under `skills.external_dirs` in `~/.hermes/config.yaml` (or rely on project-local `.agents/skills/` after one `hermes skills trust`); every skill is additionally exposed as a slash command — the user/model-invoked split is carried by the AGENTS.md trigger matrix, not by frontmatter.
- **omp / Senpi**: skills are already flattened — additionally mirror the router's trigger matrix into a sticky top-level `RULES.md` (omp does not re-inject AGENTS.md after compaction) and enforce one-git-worktree-per-parallel-writer externally.
- **OpenClaw**: near drop-in via `.agents/skills/`; follow the harness's naming rule (skill dir name must equal frontmatter `name`).
- **[Claude Code] CLI**: no native AGENTS.md — add `@AGENTS.md` import or symlink in the project's `CLAUDE.md`; skills land in `.claude/skills/`.
- **Gemini CLI**: add `AGENTS.md` to `context.fileName` in settings, or mirror the router into the native `GEMINI.md`.
- **ZCode**: skills are read from `~/.agents/skills/` (the agentskills.io standard path) on session start; a skill copied in mid-session is not discovered until a fresh session / settings reload — install first, then start the session.

## Evidence integrity

All rows above were verified against each harness's official documentation and repositories. Two verification waves: 2026-08-31 (OMO, Hermes Agent, omp/Senpi, OpenClaw) and a follow-up wave (Codex, [Claude Code] CLI, Cursor, Gemini CLI, Zed). Items marked "unverified", "unknown", or "no evidence found" are stated as such — they were not assumed to be absent. A cross-tool note from the second wave: all Agent Skills standard tools converge on `~/.agents/skills/` + `.agents/skills/` as the shared path — that, alongside AGENTS.md, is the actual interoperability seam.

Rows marked **live** were additionally executed end-to-end on that harness: OMO (this repo's daily driver; full eval battery in `evals/scenarios.md`), omp (install + smoke + task fan-out + /review, 2026-09-03), Codex (full 5-dimension audit on a repo copy, 2026-09-03), and ZCode (full 12-finding audit with 4 parallel dimension reviewers, 2026-09-03). These are receipts, not capability claims — a harness without a live row has been verified against docs only. The `evals/scenarios.md` scenario 13 self-trigger battery is the standing per-harness receipt; ZCode's 9-run run is pending there.
