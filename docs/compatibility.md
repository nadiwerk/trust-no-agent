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

## Porting checklist — harness-specific failure modes we already hit

Every item below was a real failure on a real harness (origin noted), not a hypothesis. When porting the framework to a harness not in the matrix above, or when an adopter reports "it works on the dev's machine but not mine", walk this list before diagnosing anything new:

1. **Absolute paths in every delegation prompt.** Subagent sessions drift to a stale cwd and review the wrong repo (origin: 2026-08-30/31 review lane). State the target path explicitly or verify the workspace first.
2. **Background-task registries may not survive harness restarts — subagent sessions do.** Recover completed research from the session store (`session.list` + `session.messages`), never re-run it (origin: 2026-08-31 3-repo comparison).
3. **Skills installed mid-session are invisible until re-discovery.** Registries load at session start; use file-injection (read the SKILL.md path directly) in the current session and re-trigger discovery in a fresh one (origin: 2026-08-31 eval harness, reproduced on ZCode 2026-09-03).
4. **Flatten on install, hash-verify after copy.** `cp -r skills/*` nests category dirs; non-recursive discoverers see nothing. Always `cp -r skills/*/*` and verify each SKILL.md (origin: 2026-08-31 eval finding, re-confirmed 2026-09-03 omp).
5. **The private ledger is worktree-provisional.** Gitignored files do not exist in fresh worktrees; hand off ledger entries to the canonical checkout before `worktree remove` (origin: 2026-09-01, proven empirically).
6. **Fixtures for regression batteries must be built pristine.** Copying fixtures from a directory that already applied its fix makes the regression cells difficulty-incomparable (origin: 2026-09-04 ZCode battery).
7. **Exit 0 is not an operational receipt.** A script that matched 0 rows "succeeded". Prove state-changing claims from the target's terminal state — counts, migration tables, live output (origin: 2026-09-01 R0 dogfood; now the receipts Operational-claims class).
8. **Degrade environment failures to WARN/SKIP.** A check that assumes git produces false "installation unhealthy" verdicts where git is unavailable; the environment's gap is not the installation's (origin: 2026-09-04 DSH round).
9. **AGENTS.md re-injection after compaction/resume is not guaranteed.** A harness that drops it leaves the Iron Laws and the MANDATORY skill contract out of context, and the ledger compensation relies on the agent's initiative to re-read — initiative fails silently (evals, docs/design.md). Wire the mechanical re-injection block (`node scripts/reinject.mjs`, derived from the live router so it cannot drift) into any session-start/resume/compact hook the harness offers; without hooks, re-print the block by hand as the first act after compaction, before resuming work (origin: 2026-09-10 harness-dependency finding; closure tested by `scripts/reinject.test.mjs`).

## Evidence integrity

All rows above were verified against each harness's official documentation and repositories. Two verification waves: 2026-08-31 (OMO, Hermes Agent, omp/Senpi, OpenClaw) and a follow-up wave (Codex, [Claude Code] CLI, Cursor, Gemini CLI, Zed). Items marked "unverified", "unknown", or "no evidence found" are stated as such — they were not assumed to be absent. A cross-tool note from the second wave: all Agent Skills standard tools converge on `~/.agents/skills/` + `.agents/skills/` as the shared path — that, alongside AGENTS.md, is the actual interoperability seam.

Rows marked **live** were additionally executed end-to-end on that harness: OMO (this repo's daily driver; full eval battery in `evals/scenarios.md`), omp (install + smoke + task fan-out + /review, 2026-09-03), Codex (full 5-dimension audit on a repo copy, 2026-09-03), and ZCode (full 12-finding audit with 4 parallel dimension reviewers, 2026-09-03). These are receipts, not capability claims — a harness without a live row has been verified against docs only. The `evals/scenarios.md` scenario 13 self-trigger battery is the standing per-harness receipt; ZCode's 9-run run is pending there.
