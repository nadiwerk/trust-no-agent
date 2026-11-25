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
| **Codex** | Native — `AGENTS.md` (+ `AGENTS.override.md`) at session start, concatenated root→cwd | Agent Skills: `.agents/skills/`, `~/.agents/skills/`; **plugin/marketplace discovery also present** — `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` observed in a real Codex-targeted bundle on this machine (2026-09-27) | Not verified per-tool | Coding-agent orchestration | **live** — full 5-dimension audit executed on a repo copy (2026-09-03); single-agent, no parallel reviewer fan-out; plugin-layout observation (2026-09-27) | Hostable — verified |
| **[Claude Code] CLI** | **No** — reads `CLAUDE.md` natively; `AGENTS.md` only via manual import/symlink in `CLAUDE.md`, **or as a plugin** (`plugin/` ships a copy the `SessionStart` hook injects, so the router reaches the session without any `CLAUDE.md` edit) | Agent Skills: `~/.claude/skills/` (personal), `.claude/skills/` (project); plugin marketplace: `claude plugin marketplace add nadiwerk/trust-no-agent` | **Flag parsed, not enforced as visibility** — all four `disable-model-invocation: true` skills (scribe, save-as, fork-it, make-it-so) appear in the live registry alongside the model-invoked ones, so the split is carried by the trigger-matrix prose, not by the flag | Agent Skills standard; the `Agent` tool exposes no `load_skills` parameter — the §5 inline fallback is the only delegation layer here | **live** — install + hook wiring (2026-09-21); invocation-control registry check + delegation-tool inspection (2026-09-27); plugin/marketplace payload built + drift-guarded (2026-09-28) | Hostable as a plugin — the flat `plugin/` payload and `${CLAUDE_PLUGIN_ROOT}` hooks make it portable; see notes 4 and 5 |
| **Gemini CLI** | Partial — native is `GEMINI.md`; `AGENTS.md` only via `context.fileName` in settings | Agent Skills: `~/.agents/skills/` / `.agents/skills/` | Not verified per-tool | — | doc | Router-only via config — verified caveat |
| **Zed** | Native — `AGENTS.md` is the primary instruction file (first-match among compat names) | Agent Skills: `~/.agents/skills/` (global), `<worktree>/.agents/skills/` (project-local, trusted worktrees) | Not verified per-tool | — | doc | Hostable — verified |
| **ZCode** | Native | Agent Skills: `~/.agents/skills/`, `.agents/skills/` (same agentskills.io standard as the others) | Not verified per-tool | Parallel read-only subagents | **live** — full 12-finding audit executed (2026-09-03), 4 parallel dimension reviewers; skills discovered from `~/.agents/skills/` | Hostable — 1 gap: a skill installed but not re-discovered mid-session (Skill not found) needs a fresh session / reload before the registry sees it |

## What the research confirmed about our design

1. **The flattened skill layout is load-bearing.** omp discovers skills non-recursively (`skills/<name>/SKILL.md`). The README install instructions already ship the flattened `skills/*/*` copy — keep it that way; never reintroduce category nesting in install guidance.
2. **`disable-model-invocation` is not universal.** omp and OpenClaw honor it; OMO parses and drops unknown frontmatter fields, so the user-invoked/model-invoked split must be re-encoded there via config (`skills.disable`) or agent gating. On every harness, the split also lives in the AGENTS.md trigger matrix prose — that part always works.
3. **The private working ledger is the most portable anti-compaction mechanism.** OMO re-injects AGENTS.md after compaction; omp does not (only its sticky `RULES.md` survives). The file-based ledger survives on every harness regardless — it is the canonical cross-session memory, by design.
4. **`disable-model-invocation` is parsed but does not hide on Claude Code.** The live registry on this machine lists all four user-invoked skills (`scribe`, `save-as`, `fork-it`, `make-it-so`) next to every model-invoked one, so the flag does not remove them from model reach there. That makes Claude Code a third harness — after OMO and Hermes — where the user/model-invoked split rests entirely on the AGENTS.md trigger matrix. Practical consequence: on Claude Code, treat the split as *prose-enforced only*, and do not rely on the flag to stop the model auto-firing a chain stage. (Measured 2026-09-27 by inspecting `~/.claude/skills/` against each skill's frontmatter.)
5. **The `load_skills` delegation layer does not exist on Claude Code.** The `Agent` tool takes no such parameter, so §5's primary mechanism cannot fire and its documented inline fallback is the only layer. Since the fallback has no mechanical check, AGENTS.md §5 now requires the inline procedure to carry a countable `Loaded: <skill>` line — see note 6 on this page's porting checklist.
6. **A repo carrying `plugin/.claude/skills/` surfaces those skills in its own session registry, scoped.** Observed 2026-09-28 after building the plugin payload: the seven model-invoked skills appeared as `plugin:breakpoint` … `plugin:ship-log`, scoped to `plugin/`, while the four `disable-model-invocation: true` skills (scribe, save-as, fork-it, make-it-so) did **not** surface. Two consequences for the framework's own repo and for anyone vendoring it: (a) the invoked-scope split DOES hide skills at project level here, which is the behaviour `docs/installation.md` leaves as "not verified per-tool" — this is the first direct observation of it, and it is the opposite of the user-level result in note 4; (b) duplicate skill names now exist in the registry (unscoped `receipts` from `~/.claude/skills/` and `plugin:receipts` from the payload), so a dispatch must name which copy it means. The repo's own tests read the canonical `skills/` path, never the registry, so grading is unaffected — but a bare skill name is now ambiguous inside this repo.

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
9. **AGENTS.md re-injection after compaction/resume is not guaranteed.** A harness that drops it leaves the Iron Laws and the MANDATORY skill contract out of context, and the ledger compensation relies on the agent's initiative to re-read — initiative fails silently (evals, docs/design.md). Wire the mechanical re-injection block (`node scripts/reinject.mjs`, derived from the live router so it cannot drift) into any session-start/resume/compact hook the harness offers; without hooks, re-print the block by hand as the first act after compaction, before resuming work (origin: 2026-09-10 harness-dependency finding; closure tested by `scripts/reinject.test.mjs`). **The floor spans two files:** the four Iron Laws live in `WORKFLOW.md`, the MANDATORY section in `AGENTS.md`. Run the CLI bare (`node scripts/reinject.mjs`) so it reads both; a harness that can only hand it one file's text must pass the other's alongside it, and a block that still names a missing half exits 1 — a half floor must never pass as a complete one (origin: 2026-09-21 finding — the CLI defaulted to `AGENTS.md` alone, so the laws were never in the injected block and nothing said so).
10. **OS notification backends degrade, never block, the scheduled check.** The opt-in weekly update check (`scripts/update-check-cli.mjs`) picks its notification per platform (Windows PowerShell toast, macOS osascript, Linux notify-send); where none works it degrades to log-only, and all-current/failure runs stay silent by design. Porting to a new platform means adding a `pickBackend` case — not weakening the log-always invariant (origin: 2026-09-13 scheduled-check feature; decisions pinned by `scripts/update-delivery.test.mjs`).

### Known limits, measured (2026-11-03 audit)

Three limits are real, were measured, and are stated here so an adopter can plan
around them instead of discovering them mid-session:

1. **Claude's `PreToolUse` matcher is `Bash|PowerShell`, on purpose.** Write,
   Edit, MultiEdit, NotebookEdit, `apply_patch` and MCP tools never reach the
   hook on Claude, so the ledger-write half of the guard cannot fire there.
   Consequence: on Claude the append-only rule for `.trust/progress.txt` is
   enforced through the SHELL path (redirect, `Set-Content`, `Out-File`, `tee`)
   and through nothing else — a `Write` tool call aimed at the ledger is not
   seen. Codex's manifest has no matcher, so its hook sees everything; the
   asymmetry is deliberate (widening the Claude matcher was considered and
   declined, since the hook's classifier is a shell-command classifier). The
   adapters that DO see write tools — pi, omp, dsh — guard `write`, `edit`,
   `multiedit`, `notebookedit`, `str_replace_editor`, and `apply_patch` by its
   target paths.
2. **`PostCompact` is not a delivery path for the floor.** Claude Code gives
   PostCompact no decision control, discards its `systemMessage` and `continue`,
   and documents `hookSpecificOutput.additionalContext` for SessionStart,
   SubagentStart and PostModelSwitch only; Codex's PostCompact accepts the common
   output fields only. Both harnesses re-fire `SessionStart` with
   `source:"compact"` after a compaction, so the floor comes back through that
   event — which is why neither manifest wires PostCompact any more
   (`scripts/harness-general.test.mjs` #7a-#7f pins the absence AND drives the
   live injection).
3. **Codex requires re-trust after every hook change.** Codex records a
   `trusted_hash` per hook file and demands a fresh review when the bundled
   script changes, so shipping an edited `gate-hook.mjs` means the operator must
   re-approve it in `/hooks` before the hook runs again. Every release that
   touches a hook script must say so (see docs/codex-testing-flow notes), or a
   user silently runs an untrusted, inactive gate.
4. **The repo carries files over its own per-file token budget — now PINNED,
   not open.** `node scripts/file-budget.mjs --report` measures **80 files**
   above the 5,000-token limit. The audit made a subset worse, and one crossed
   the line during the audit itself:

   - `scripts/action-gate.mjs` — ~4,744 (under budget) → ~6,621
   - `veto-hooks/dsh/tna-veto.mjs` — ~7,046 → ~8,962
   - `veto-hooks/omp/tna-veto.ts` — ~5,928 → ~7,841
   - `veto-hooks/pi/tna-veto.ts` — ~5,784 → ~7,743
   - `plugin/scripts/gate-hook.mjs` — ~5,513 → ~6,772
   - `docs/compatibility.md` — ~9,570 → ~11,157

   **The closure is a ratchet, because both earlier options were wrong.**
   Splitting all 80 at once is a rewrite, and an `.filebudgetignore` line hides
   them; the actual defect was that the guard was opt-in and wired nowhere, so
   nothing ever told this repo. `.filebudget-baseline.json` now pins every
   existing offender at its **measured** size as a ceiling:

   - an offender may **shrink** freely; growing past its ceiling blocks, and the
     message names both numbers (`GREW to ~X, past its pinned ceiling of ~Y`)
   - a file **absent** from the baseline gets no mercy — a new offender blocks
     outright, so the set can only ever shrink
   - re-pinning is the deliberate command `--update-baseline`, reviewed like any
     other decision; `--report` prints the measured set so a pin can never be
     written from a number no other code path reproduces
   - the honesty checks (H2-H4) make a stale, missing, or below-measured pin a
     test failure, so the baseline cannot quietly become a rubber stamp

   It is wired into **both** doors now: `scripts/hooks/pre-commit` runs it on the
   staged delta, and CI runs `--all`, which is the run that actually sees the 80.
   Proven able to fail before being trusted: appending 900 bytes to this very
   file produced `GREW to ~11,383 past its pinned ceiling of ~11,157` and exit 1,
   and restoring the file returned exit 0.

   The remaining engineering work is separate and stays open: the four classifier
   copies duplicate the grammar by design (a payload must install where
   `scripts/` does not exist) and their adapter APIs differ, so the real fix is a
   generated byte-identical include per adapter. That touches every adapter and
   belongs in its own change — the ratchet is what makes leaving it possible.

## Veto guarantee per harness (veto vs audit-only)

**The enforcement adapter matrix — no single harness API carries it.** One adapter per harness, same boundary: irreversible actions need sign-off plus fresh evidence, and words alone never gate. The wiring per harness: opencode's `tool.execute.before` deny-by-throw veto plus its `execute.after` recorder; the Claude/Codex `PreToolUse` hook (same shared state file); omp's and pi's `tool_call` block hook plus `tool_result` recorder; dsh's cordis plugin on the `tools/pre-execute` waterfall plus `tools/result`. On harnesses whose `PostToolUse` never fires (Codex 0.163.0, a platform limit), the gate opens only through `scripts/record-test-evidence.mjs --run/--from-log` — a deny there is a wall with a named door, so teach the door. Where no adapter can run, the router's inline `Loaded:` fallback is the only layer and its gap stays countable, never silent.

Skill routing and AGENTS.md work on every harness above; the *veto* — refusing an irreversible tool call before it runs — does not. Read this table before relying on it:

| Harness | Irreversible-action guarantee | Level |
|---|---|---|
| opencode V2 | `tool.execute.before` deny-by-throw + `execute.after` evidence recorder over `ctx.storage` | veto (proven live 2026-10-13 on v2.0.27: 4 denials + 1 post-evidence allow) |
|  Claude Code  |  `PreToolUse` exit-0 stdout-JSON `hookSpecificOutput.permissionDecision:"deny"` over the shared project state + `PostToolUse` evidence recorder (both wired by `plugin/hooks/hooks.json`; the manifest's `matcher` is `Bash` or `PowerShell` — see known limit 1)  | veto (**proven live** 2026-10-22/23 on the plugin payload; deny shape moved to hookSpecificOutput.permissionDecision and re-proven live 2026-11-03 on Claude 2.1.316 — receipts: docs/evidence/claude-veto.md) |
| Codex | `PreToolUse` via the Codex-native manifest `plugin/.codex-plugin/plugin.json` (`"hooks": [ … ]`), shared project state | veto (**re-proven live** 2026-10-24 on codex 0.163.0 — PreToolUse denies, but PostToolUse never spawns on that build, so the gate opens through the explicit record-test-evidence door; re-probe on a credentialed machine is one command: scripts/codex-reprobe.mjs — receipts: docs/evidence/codex-veto.md) |
| OMO | `load_skills` delegation load + ledger audit | audit-only (no tool veto known) |
| omp | `tool_call` block hook at `~/.omp/agent/hooks/pre/tna-veto.ts` + `tool_result` evidence recorder (self-contained adapter, `veto-hooks/omp/`) | veto (**proven live** 2026-10-25 on omp 18.10.4, two-sided: -C laundered commit denied, green run -> allowed, landed f7fb0e6; twelve-fix round same day — receipts: docs/evidence/omp-veto.md) |
| pi | `tool_call` block hook at `.pi/extensions/tna-veto.ts` + `tool_result` evidence recorder (self-contained adapter, `veto-hooks/pi/`) | veto (**proven live** 2026-10-25 on pi 1.4.0, two-sided: denied then allowed, landed e36d01c; recorder repaired same round — receipts: docs/evidence/pi-veto.md) |
| DeepSeek Harness (dsh) | cordis plugin on the `tools/pre-execute` waterfall returning `{ kind: 'deny', reason }` + `tools/result` evidence recorder (`veto-hooks/dsh/tna-veto.mjs`, loaded by path from the profile's `cordis.patch.yml`) | veto (**proven live** 2026-10-25 on dsh headless, ACP profiles, and the composed web surface — deny then allow; ten-fix round same day — receipts: docs/evidence/dsh-veto.md) |
| Devin | user-level `PreToolUse`/`PostToolUse` hook layer → `veto-hooks/devin/hook.mjs` adapter → `plugin/scripts/gate-hook.mjs` (the adapter maps Devin tool names, translates `{success, output, error}` responses, and rewrites the deny JSON into Devin's `{"decision":"block"}` contract) | veto (**proven live** 2026-11-24, two-sided: denied without fresh test evidence, allowed after record-test-evidence, landed 6cbd4b5; the run found+closed a payload-cwd fail-open hole — receipts: docs/evidence/devin-veto.md) |
| Antigravity CLI (`agy`) | `.agents/hooks.json` (project) or `~/.gemini/config/hooks.json` (global) `PreToolUse`/`PostToolUse` command hooks → `veto-hooks/antigravity/hook.mjs` adapter → `plugin/scripts/gate-hook.mjs` (camelCase payload: `toolCall.{name,args}`, shell under `args.CommandLine`; deny is `{"decision":"deny","reason"}` — and a missing/garbled/crashed hook output is read as a DENY, so the adapter prints an explicit allow on the pass path) | veto (**proven live** 2026-11-24 on agy 1.5.14, two-sided: `git commit` denied without evidence with the real gate reason surfacing, `node probe.test.mjs` through `run_command` recorded `testPassFresh` via the PostToolUse recorder, the same commit then passed the gate and failed only on git's own unstaged-changes error; the run also found+closed the `run_command`-not-in-`SHELL_TOOLS` recorder hole via the adapter's TOOL_MAP — real payloads in `.scratch/agy-dump.jsonl`) |
| Gemini CLI | `.gemini/settings.json` `hooks.BeforeTool`/`AfterTool` → `veto-hooks/gemini/hook.mjs` adapter → `plugin/scripts/gate-hook.mjs` (snake_case payload already gate-shaped; the adapter renames `BeforeTool`→`PreToolUse`, `AfterTool`→`PostToolUse`; deny is `{"decision":"deny","reason"}` or exit 2, empty+exit 0 = allow) | veto (doc-first + adapter self-tested against the real gate; **live check open** — free-tier auth closed 2026-06-18, `IneligibleTierError: migrate to the Antigravity suite` measured 2026-11-24 on gemini 0.66.0; live proof owed on an API-key/licensed install) |
| Current API harness (this session: tool-calling API, subagent without skill-loading, no prompt/tool-hook surface observed) | no veto wired — enforcement falls back to prose + ledger audit | audit-only (live 2026-10-12: veto log empty, meter "no data yet", self-trigger gap applies) |

A veto without a live proof is a proposal, not a guarantee: a row stays doc-first and degrades to WARN (never hostable-by-assertion) until a run on that harness shows the denial firing **and** the gate opening again after fresh evidence. Every other harness's install section in docs/installation.md states which of the two levels it wires.

**A gate that cannot open is a wall, not a gate.** The 2026-10-25 round found that both the pi and omp adapters shipped a denial path with no recorder: the harness never wrote `.trust/tna-gate-state.json`, so `testPassFresh` could only ever read false and every irreversible action was refused forever. Measured live: a green `node x.test.mjs` was ignored and the following commit was still vetoed with `Project state: (missing)`. The proof bar for a veto row is therefore two-sided — **deny without evidence, then allow with it** — because a one-sided probe cannot tell a working gate from a permanent block. The same round found a classifier hole that affected *every* harness at once: `git -C . commit`, `git -c k=v commit`, `git --git-dir=.git commit` and `git --no-pager push` all ran while the gate reported open, because the pattern was matched against the first words of the segment and git's global options sit between `git` and the subcommand. Fixed in `scripts/action-gate.mjs` (global options stripped before matching) and pinned by the J series in `scripts/action-gate.test.mjs`.

### Full-function matrix — all four mechanical layers, per harness

A veto alone is not "TNA working". The framework carries **four** mechanical
layers, and a harness that has one of them enforces roughly a quarter of the
discipline while looking installed. Audited 2026-10-25; Devin/agy/Gemini
columns added 2026-11-24 when their adapters gained a mechanical install path:
| Layer | What it does | opencode | Claude Code | Codex | omp | pi | dsh | Devin | agy | Gemini |
|---|---|---|---|---|---|---|---|---|---|---|
| **floor** — router's Iron Laws + MANDATORY section injected each session/compaction | rules survive a harness that drops AGENTS.md | `ctx` injection | `SessionStart` (fires again with `source:"compact"`) | `SessionStart` (fires again with `source:"compact"`) | `tna-discipline.ts` (`session_start`, `before_agent_start`) | `tna-discipline.ts` (`before_agent_start`, `session_compact`) | dsh reads `AGENTS.md` natively; `tna-discipline.mjs` adds the rest | `SessionStart` → adapter `reinject` (emits `additionalContext`; reads the project's own router files) | — (no proven floor surface) | — (no proven floor surface) |
| **mandatory-gate** — each prompt classified against expect-fail / root-cause / receipts | the trigger matrix fires mechanically, not by model initiative | hook | `UserPromptSubmit` | `UserPromptSubmit` | `tna-discipline.ts` | `tna-discipline.ts` | `tna-discipline.mjs` (`agent/pre-step`) | `UserPromptSubmit` → adapter `gate-hook` | — (no prompt-submit event wired) | — (no prompt-submit event wired) |
| **veto** — irreversible action without fresh evidence refused | Iron Law 4 is enforced, not suggested | plugin throw | `PreToolUse` | `PreToolUse` | `tna-veto.ts` | `tna-veto.ts` | `tna-veto.mjs` (`tools/pre-execute`) | `PreToolUse` → adapter `gate-hook` (`exec`→`bash`) | `PreToolUse` → adapter (`run_command`→`bash`) | `BeforeTool` → adapter (`run_shell_command`→`bash`) |
| **done-gate** — completion claim with no verifying tool call flagged | Iron Law 3 is enforced, not suggested | — | — | — | `tna-receipts-gate.ts` (`session_stop`) | `tna-discipline.ts` (`agent_before_settle`) | `tna-discipline.mjs` (`agent/pre-step`) | — (no stop/settle event on this harness) | — | — |
| **ledger append-only** — `write`/`edit` to `.trust/progress.txt` refused | the private history cannot be clobbered | `action-gate` | `action-gate` | `action-gate` | `tna-veto.ts` | `tna-veto.ts` | `tna-veto.mjs` | `action-gate` (`write` passthrough) | `action-gate` (`write_to_file`→`write`) | `action-gate` (`write_file`→`write`, `replace`→`edit`) |

Live evidence for the layers added on 2026-10-25:

- **pi** — `before_agent_start` proven by asking the live session whether its
  system prompt contains the floor (`YES`), then whether a failing-test prompt
  carries the directive (`YES`). `~/.pi/agent/extensions/` holds both adapters.
- **omp** — floor already proven live by the adapter's own trace
  (`~/.omp/agent/hooks/tna-trace.log`: `before_agent_start {floor:true,flagged:false}`).
- **dsh** — `MANDATORY-SEEN`: a live `--profile headless` turn asked to report
  whether `MANDATORY DOMAIN DETECTED` was in its context answered affirmatively
  for a failing-test prompt, with the turn ending `reason: completed`.

**Two dsh contracts learned the hard way** (both cost a live crash before they
were understood, and both are pinned in `scripts/dsh-discipline.test.mjs`):

1. **`next()` is called exactly once.** A second call from a `catch` block
   resolves `undefined` (the waterfall index already advanced) and the loop dies
   with `Cannot read properties of undefined (reading 'kind')`.
2. **An injected message needs `id` and `source`, not just `role` + `content`.**
   dsh builds messages through `createUserMessage` (which sets both); a plain
   object crashes the same way. The adapter constructs the same shape locally
   because a path-loaded profile plugin cannot resolve `@deepseek-ai/dsh-llm`.

**A discipline plugin that can crash the session is worse than none.** Both
contracts above were found by running the plugin against the real harness, not
by reading the type file — which is why the live probe is part of the proof and
the fixture test is not enough on its own.

### Install parity — a layer that exists but is never installed is not a layer

The matrix above describes what the ADAPTERS can do. Whether a fresh install
actually delivers them is a separate claim, and on 2026-10-25 it was false:

- **`detectHarness()` had no `dsh` branch.** A DeepSeek Harness user got no
  hooks, no profile patch and no receipt line — dsh support was manual.
- **The hooks component copied only `tna-veto`.** The discipline adapter
  (floor + mandatory-gate + done-gate) had no copy path, so a fresh omp/pi
  install shipped one of four layers while the receipt said "hooks: consented".
- **`--undo` reversed only what it knew about**, so any newly copied adapter
  would have become residue.
- **The floor's fallback list pointed at the maintainer's own checkout**
  (`~/projects/trust-no-agent`) — a path no adopter has — so outside an adopted
  project the floor silently found nothing and fail-open meant "no floor".

Fixed in `scripts/onboarding.mjs` and pinned by
`scripts/onboarding-layers.test.mjs` (AC1–AC5: every adapter per harness,
dsh detection, profile wiring, undo residue, and never clobbering an owner's
edited copy). The install is now a **table** (`adaptersFor`) rather than
hand-written per-harness blocks, so a future adapter cannot ship without an
install path.

**What a clean install now places** (verified live 2026-10-25 in an isolated
`HOME`, so nothing touched the real machine state):

| Harness | Files placed | Patch rows |
|---|---|---|
| omp | `~/.omp/agent/hooks/pre/{tna-veto.ts,tna-discipline.ts}` + `~/.omp/agent/extensions/tna-receipts-gate.ts` | — |
| pi | `.pi/extensions/{tna-veto.ts,tna-discipline.ts}` | — |
| dsh | `.dsh/profiles/<every profile>/plugins/{tna-veto.mjs,tna-discipline.mjs}` | `tna-veto` + `tna-discipline`, idempotent per profile |

The dsh wiring is per-profile by necessity: a profile without the rows has no
veto, and `dshProfileDirs` deliberately skips `node_modules` (which lives in the
same parent and was wired as a "profile" by the first version of the fix).

**One honest limit that no installer can remove.** The evidence file
`.trust/tna-gate-state.json` is **per repository**, not per machine. A veto
therefore refuses an irreversible action in any repo that has not run its tests
in that session — including repos unrelated to TNA. That is the design (evidence
must come from the project being changed), but it is the behaviour a new user
meets first, so it is stated here rather than discovered as a bug.

### Known harness contracts (not defects — stated so they are chosen, not discovered)

- **[Claude Code] a deny blocks the WHOLE tool call.** The `PreToolUse` deny contract is exit-0 + stdout JSON `{"decision":"block","reason"}` (re-proven live 2026-10-23, probe 14/15/16, commit 2555907 — the older exit-2+stderr shape fails open to the harness's generic "hook exited with code 2" arm on codex 0.159.2). The contract has no partial-allow API: a compound command (`cat x && git commit`) is denied entire, even when its read-only prefix was harmless (observed live 2026-10-22, denial 01:17:09Z). This is the harness's semantics, not the gate's granularity — the gate classifies the whole command string because that is what executes as one unit. Split read-only inspection from the irreversible step into separate calls.

### Autonomy ladder (per-harness trust, with decay)

The Level column above is a *claim*; the trust you may actually extend is the ladder's **audit-only → veto-proven → trusted** rung, computed at **read time** by `node scripts/autonomy-ladder.mjs [--now YYYY-MM-DD]` — it parses the table above and applies a **30-day decay**: each full 30 days since the row's live proof drops one rung, floored at audit-only. A `veto` claim with no proof date (e.g. "live check open"), a future date, or an unknown rung resolves fail-closed to audit-only — a claim without proof grants nothing. Nothing is ever written back: there is no stored level to rot, no auto-downgrade state machine, and no promotion without a human landing a fresh proof date in the row (re-run the CLI after editing; the table is the state).

**OMO verdict (AC4):** audit-only is the ceiling, for a stated reason — OMO's
documented surfaces are skill routing (`~/.agents/skills/`), invocation
gating via config, and `task(category, load_skills, …)` delegation. None is
a pre-tool interception point: `load_skills` loads discipline into the
delegate, it cannot refuse a tool call the delegate then makes. No veto
adapter is claimed until a hook/tool-gate surface is found on OMO; if one is
found, it lands as a new adapter row with its own live proof, not as an edit
to this verdict.

**omp/Devin live-proof plan (AC5, review-by 2026-12-08):** each gets one
attempted live denial run on or before review-by 2026-12-08, conditional on
access (omp: local harness present; Devin: subscription present). A run that
denies promotes the row to veto with its evidence attached; a run that cannot
happen (no access) keeps doc-first WARN and sets the next review-by date in
this paragraph — the date moves only forward with a written reason, never
silently. No green fixture alone promotes any row. **Missed window, recorded
2026-11-24:** the 2026-11-13 review-by passed with no attempted run — sessions
went to the release line (through v0.1.59). Both access conditions now hold on
the maintainer machine (omp local install present; Devin session live), so the
date moved to 2026-12-08 with the miss and its reason on the record, per this
paragraph's own contract. **Executed 2026-11-24, before the new date:** the
Devin run happened in a live session — it found a real fail-open hole (the
payload carries no `cwd`, so the evidence verdict returned null), the adapter
was fixed to inject the resolved project dir, and the veto re-proved
two-sided in the same session (deny `without fresh test evidence` → fresh
run → allow, commit `6cbd4b5`); the new matrix row above carries the
receipts. The omp leg was already discharged by the 2026-10-25 live proof in
its row, so this plan's condition is met on both halves — the review-by stays
on the record as the date the run was owed by, not a still-open deadline.

## Evidence integrity

All rows above were verified against each harness's official documentation and repositories. Two verification waves: 2026-08-31 (OMO, Hermes Agent, omp/Senpi, OpenClaw) and a follow-up wave (Codex, [Claude Code] CLI, Gemini CLI, Zed). Items marked "unverified", "unknown", or "no evidence found" are stated as such — they were not assumed to be absent. A cross-tool note from the second wave: all Agent Skills standard tools converge on `~/.agents/skills/` + `.agents/skills/` as the shared path — that, alongside AGENTS.md, is the actual interoperability seam.

Rows marked **live** were additionally executed end-to-end on that harness: OMO (this repo's daily driver; full eval battery in `evals/scenarios.md`), omp (install + smoke + task fan-out + /review, 2026-09-03), Codex (full 5-dimension audit on a repo copy, 2026-09-03), and ZCode (full 12-finding audit with 4 parallel dimension reviewers, 2026-09-03). These are receipts, not capability claims — a harness without a live row has been verified against docs only. The `evals/scenarios.md` scenario 13 self-trigger battery is the standing per-harness receipt; ZCode's 9-run run is pending there.
## Tool-output compression (input axis of the context budget)

`scripts/output-trim.mjs` compresses oversized tool results deterministically
(scrub → elide with error salvage → per-session dedup; full output spills to
`.trust/output-trim-spill/`). Wiring per hook contract:

- **Output rewritable** (Claude-family `updatedToolOutput`, Copilot
  `modifiedResult`): run it as a PostToolUse hook on the stdin payload — it
  emits the documented JSON shape for each.
- **Output not rewritable** (Devin): PreToolUse `updatedInput` wraps the
  command in a run-and-compress shell wrapper — compression moves to the
  source; only trimmed text reaches the model.
- **execute.after** (OpenCode): the vendored engine in the tna-gate plugin
  (`output-trim/output-trim-compress.js` via `output-trim-hook.mjs`) mutates
  `event.result` directly, with `/output-trim` on|off|status.

Invariants, enforced rather than defaulted: the read/write/edit tool family
is never compressed (its output feeds exact-match edits); error lines are
salvaged verbatim from any elided middle; `OUTPUT_TRIM=0` and
`.trust/output-trim.json {"enabled": false}` both kill it; every failure
path is fail-open.
