# Compatibility — running trust-no-agent on agent harnesses & orchestrators

The core framework is harness-agnostic (see README → Portability): it needs a harness that reads `AGENTS.md` as instructions. Skill systems are optional — without one, the router's trigger matrix tells the agent to open the SKILL.md files on demand. This page records what was verified against real repositories and docs (2026-08-31). Unknowns are marked as unknown, never guessed. For step-by-step install commands on each harness, see `docs/installation.md`.

## Verified matrix

| Harness / orchestrator | AGENTS.md | Skill discovery | Invocation control | Delegation / parallelism | Verdict |
|---|---|---|---|---|---|
| **OMO** (oh-my-openagent, formerly oh-my-opencode) | Native, lazy + re-injected after compaction | `~/.agents/skills/` — our documented install path | `disable-model-invocation` **not recognized** — encode via config `skills.disable` or `agent:` gating | `task(category, load_skills, run_in_background)` — same shape as our prompts; worktrees via its work-with-pr skill | Hostable — the recommended setup |
| **Hermes Agent** | Native — priority chain (`.hermes.md` → `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md`), merged git-root chain + progressive subdirectory discovery | `~/.hermes/skills/` primary + `~/.agents/skills/` via `external_dirs` config + project-local `.agents/skills/` (trust-gated) | Invocation flag not read — every skill also becomes a slash command; the split lives in trigger-matrix prose (our portable design) | Isolated parallel subagents, RPC pipelines, MCP | Near drop-in |
| **oh-my-pi (omp)** / Senpi | Native, injected at session start | **Non-recursive** — needs flattened `skills/<name>/` layout | Recognized (kebab-case normalized) | Subagents + parallel; **no native worktree isolation** | Hostable + 3 adaptations |
| **OpenClaw** | Native (workspace + project) | `.agents/skills/**/SKILL.md` | Supported | Multi-agent + managed worktrees | Best fit |
| **Codex** | Native — `AGENTS.md` (+ `AGENTS.override.md`) at session start, concatenated root→cwd | Agent Skills: `.agents/skills/`, `~/.agents/skills/` | Not verified per-tool | Coding-agent orchestration | Hostable — verified |
| **[Claude Code] CLI** | **No** — reads `CLAUDE.md` natively; `AGENTS.md` only via manual import/symlink in `CLAUDE.md` | Agent Skills: `~/.claude/skills/` (personal), `.claude/skills/` (project) | Not verified per-tool | Agent Skills standard | Router-only via wrapper — verified caveat |
| **Cursor** | Native — project root + subdirectories (nested combine); load timing unknown | Agent Skills: `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/` + compat dirs | Not verified per-tool | — | Hostable — verified; load timing unknown |
| **Gemini CLI** | Partial — native is `GEMINI.md`; `AGENTS.md` only via `context.fileName` in settings | Agent Skills: `~/.agents/skills/` / `.agents/skills/` | Not verified per-tool | — | Router-only via config — verified caveat |
| **Zed** | Native — `AGENTS.md` is the primary instruction file (first-match among compat names) | Agent Skills: `~/.agents/skills/` (global), `<worktree>/.agents/skills/` (project-local, trusted worktrees) | Not verified per-tool | — | Hostable — verified |

## What the research confirmed about our design

1. **The flattened skill layout is load-bearing.** omp discovers skills non-recursively (`skills/<name>/SKILL.md`). The README install instructions already ship the flattened `skills/*/*` copy — keep it that way; never reintroduce category nesting in install guidance.
2. **`disable-model-invocation` is not universal.** omp and OpenClaw honor it; OMO parses and drops unknown frontmatter fields, so the user-invoked/model-invoked split must be re-encoded there via config (`skills.disable`) or agent gating. On every harness, the split also lives in the AGENTS.md trigger matrix prose — that part always works.
3. **The private working ledger is the most portable anti-compaction mechanism.** OMO re-injects AGENTS.md after compaction; omp does not (only its sticky `RULES.md` survives). The file-based ledger survives on every harness regardless — it is the canonical cross-session memory, by design.

## Adapting per harness (setup deltas only, core never changes)

- **OMO**: after installing skills, encode the 4 user-invoked skills (scribe, save-as, fork-it, make-it-so) in OMO config so the model does not auto-fire them; model-invoked skills (breakpoint, expect-fail, receipts, no-thanks, roast-my-code, ship-log) stay loadable.
- **Hermes Agent**: add `~/.agents/skills` under `skills.external_dirs` in `~/.hermes/config.yaml` (or rely on project-local `.agents/skills/` after one `hermes skills trust`); every skill is additionally exposed as a slash command — the user/model-invoked split is carried by the AGENTS.md trigger matrix, not by frontmatter.
- **omp / Senpi**: skills are already flattened — additionally mirror the router's trigger matrix into a sticky top-level `RULES.md` (omp does not re-inject AGENTS.md after compaction) and enforce one-git-worktree-per-parallel-writer externally.
- **OpenClaw**: near drop-in via `.agents/skills/`; follow the harness's naming rule (skill dir name must equal frontmatter `name`).
- **[Claude Code] CLI**: no native AGENTS.md — add `@AGENTS.md` import or symlink in the project's `CLAUDE.md`; skills land in `.claude/skills/`.
- **Gemini CLI**: add `AGENTS.md` to `context.fileName` in settings, or mirror the router into the native `GEMINI.md`.

## Evidence integrity

All rows above were verified against each harness's official documentation and repositories. Two verification waves: 2026-08-31 (OMO, Hermes Agent, omp/Senpi, OpenClaw) and a follow-up wave (Codex, [Claude Code] CLI, Cursor, Gemini CLI, Zed). Items marked "unverified", "unknown", or "no evidence found" are stated as such — they were not assumed to be absent. A cross-tool note from the second wave: all Agent Skills standard tools converge on `~/.agents/skills/` + `.agents/skills/` as the shared path — that, alongside AGENTS.md, is the actual interoperability seam.
