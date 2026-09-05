# Installing trust-no-agent on every harness & CLI

Step-by-step install for the framework core (`AGENTS.md` router + `WORKFLOW.md` core rules) and the 11 skills on each verified harness. Companion to `compatibility.md` — that page says what works, this page says how to install it.

All commands assume you have cloned this repo (or reference it directly). Replace `<trust-no-agent>` with the path to your trust-no-agent checkout.

## Universal core (every harness)

The router and core rules are plain files every harness reads. Two options:

```bash
# Option 1 — copy into your project (recommended for adoption)
# Already have an AGENTS.md of your own? Stop — read "Adopting into an existing
# project" below first. Copying over a project router destroys the project's rules.
cp <trust-no-agent>/AGENTS.md   ./AGENTS.md
cp <trust-no-agent>/WORKFLOW.md ./WORKFLOW.md

# Option 2 — reference the repo directly; the agent reads the files from there.
# No copy needed — AGENTS.md in the checkout IS the canonical router.
```

## Universal skills copy (every harness with a skill system)

The 11 skill folders must sit **flattened** (category dirs removed) directly under the harness's skill root — every verified harness locates them there:

```bash
# Stage 1 — flatten and install to the shared cross-tool location (used by most harnesses)
mkdir -p ~/.agents/skills
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/
```

Per-harness location overrides below. If a harness has no skill system, the AGENTS.md trigger matrix tells the agent to open the SKILL.md files on demand — nothing to install.

---

## Adopting into an existing project

The copy commands above are the greenfield path. Most repos are not empty: they already carry a router (`AGENTS.md`, `CLAUDE.md`, rules files) and sometimes their own skill ecosystem. For those, adoption is a **merge, not a copy**:

1. **Audit the overlap first.** Read the project's router and mark what it already covers — task classification, interview/spec/ticket stages, review, logging, delegation rules. Mature routers usually cover part of the chain under different names. The framework's adoption value is usually its **gates** (fail-first, fresh-evidence receipts, human sign-off), not a second chain.
2. **One router.** The project's router stays the only router. Cherry-pick the framework rules it lacks — a MANDATORY discipline-skills section, a trigger-matrix row — **into** that router instead of copying `AGENTS.md` wholesale. Two routers claiming the same session silently disagree, and the model arbitrates by forgetting one of them.
3. **Map the names; don't rename the project.** Where a chain stage already exists under a local name, keep the local name and record the mapping so the skills still resolve. The mapping is the project's own — write it from the project's router, not from any external list.

4. **Skills project-local, not global.** An actively developed project keeps its skills in its own repo directory (`.opencode/skills/`, `.claude/skills/`) — a global skills dir is shared across projects and collides with whatever the project already has.
5. **Verify against the merged router.** Run the post-install verification below, but point it at the project's router: the Iron Laws must be recitable from the project's own files, not from this checkout. If a law cannot be recited from the project router, the merge missed a gate.

### Bootstrap the ledger (optional, one session)

Adoption is forward-looking: the ledger, lessons, and recipes start empty and compound from the first *post-adoption* completed unit. Pre-adoption knowledge stays where it already lives — git history, ADRs, docs — and is not auto-ingested. For a project with a long history, an optional one-time bootstrap seeds the ledger with that history so early recovery ("what did we do about X?") does not depend on git archaeology:

1. **Scan, don't summarize.** Read `git log --oneline` (whole history) and the project's docs/ADRs. Group commits into completed units — a unit is a feature, a fix, a release, or a docs pass — not one entry per commit.
2. **Seed entries in the ship-log format**, oldest first, one entry per unit: title, files/dirs touched (broad strokes), and the commit range as the `Verification:` line (e.g. `Verification: git 3faa122..3636d09, merged to main`). Mark them explicitly as reconstructed: `- Source: bootstrap from git history` — a seed entry is derived evidence, not a fresh receipt.
3. **No recipes, no self-review.** Recipes and the 4-dimension self-review describe work the framework witnessed; backfilling them would fabricate process data. The recipe tier starts with the first real post-adoption entry.
4. **Keep it bounded.** Target one entry per release/major unit (~10–30 entries for most repos). The ledger must stay cheap to read — rotation rules apply to seeds too. Cap the session at ~1 hour; an imperfect seed that exists beats a perfect one that doesn't.
5. **Log the bootstrap itself.** Append a final entry (`Recipe: task_type = ledger-bootstrap`) so the act is part of the history it seeds.

---

## Monorepos and nested scope

One repo can host several packages — the framework survives it if the scopes are declared:

- The **root router owns the workflow**: one router per repo (`docs/omo-integration.md`'s one-router rule applies at the root). Nested routers may **tighten** rules for their package (extra gates, stricter conventions) but never **weaken** the Iron Laws or the MANDATORY skill mandates.
- **Each package declares its own proof commands** in its own AGENTS.md (per §6); the root declares the ones that span packages.
- **One canonical ledger root** (`.trust/` at the coordinating checkout) unless a package explicitly opts out — split ledgers fragment exactly the way per-worktree ledgers do (see `ship-log`'s canonical-ledger contract).

---

## Per-harness install

### OMO (oh-my-openagent / opencode) — recommended setup
```bash
# AGENTS.md: auto-read by opencode (re-injected after compaction). Already at project root.
# Skills: the shared cross-tool location is read natively.
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/
# Invocation split: the framework's frontmatter flag is NOT read by OMO.
# Encode the 4 user-invoked skills (scribe, save-as, fork-it, make-it-so)
# in OMO config (skills.disable or agent gating) so the model does not auto-fire them.
```
Delegation uses `task(category, load_skills, run_in_background)` — the framework prompts already match this shape.

### [Claude Code] CLI
```bash
# AGENTS.md is NOT read natively — add it to CLAUDE.md:
echo "@/path/to/trust-no-agent/AGENTS.md" >> CLAUDE.md   # or symlink AGENTS.md into CLAUDE.md's @-import
# Skills:
mkdir -p .claude/skills ~/.claude/skills
cp -r <trust-no-agent>/skills/*/* .claude/skills/     # project-wide
cp -r <trust-no-agent>/skills/*/* ~/.claude/skills/   # or user-wide
```

### Codex
```bash
# AGENTS.md: read natively (root → cwd concatenation), nothing to do.
# Skills:
cp -r <trust-no-agent>/skills/*/* .agents/skills/     # repo
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/   # or user
```

### Hermes Agent
```bash
# AGENTS.md: read natively (priority chain); nothing to do at project root.
# Skills: point Hermes at the shared location, or use project-local skills.
mkdir -p ~/.agents/skills
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/
# Add to ~/.hermes/config.yaml:
#   skills:
#     external_dirs:
#       - ~/.agents/skills
# Project-local alternative (repos own their skills): copy to <project>/.agents/skills/,
# then run once inside the project:  hermes skills trust
# Every skill also surfaces as a slash command — the model/user split rides on the
# AGENTS.md trigger matrix (the flag is not read).
```

### oh-my-pi (omp) / Senpi
```bash
# Skills are discovered NON-recursively — flatten (already done by skills/*/*):
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/
# AGENTS.md: read at session start, but NOT re-injected after compaction.
# Mirror the router's trigger matrix into a sticky top-level RULES.md:
cp <trust-no-agent>/AGENTS.md RULES.md   # omp treats RULES.md as always-apply and sticky
# Worktree isolation per parallel writer is NOT native — enforce externally
# (one git worktree per concurrent writer), or run fork-it serial.
# Invocation flag IS honored (kebab-case normalized).
```

### OpenClaw
```bash
# AGENTS.md: read natively (workspace + project).
# Skills: / .agents/skills/** read at priority 2 of 6.
cp -r <trust-no-agent>/skills/*/* .agents/skills/     # project
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/   # or user
# Ensure skill dir name equals frontmatter `name`. Invocation flag honored.
```

### Cursor
```bash
# AGENTS.md: read natively (project root + subdirs, nested combine).
# Skills: / .agents/skills/, .cursor/skills/, plus Claude Code/Codex compatibility dirs.
cp -r <trust-no-agent>/skills/*/* .agents/skills/
```
Load timing for AGENTS.md is not documented by Cursor — unknown whether session-start or lazy; the trigger-matrix prose carries the split regardless.

### Gemini CLI
```bash
# Native file is GEMINI.md; AGENTS.md must be added explicitly.
# Add to settings.json (context.fileName):
#   "context": { "fileName": ["AGENTS.md"] }
# Skills:
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/     # user
cp -r <trust-no-agent>/skills/*/* .agents/skills/       # workspace
```

### Zed
```bash
# AGENTS.md: primary instruction file — read natively.
# Skills:
cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/             # global
cp -r <trust-no-agent>/skills/*/* <worktree>/.agents/skills/    # project-local (trusted worktrees)
```

---

## No-skill-system fallback (any harness reading AGENTS.md)

If the harness has no skill system, nothing is installed: the AGENTS.md trigger matrix states *when* to load each skill, and the agent opens `skills/<name>/SKILL.md` on demand from the checkout. Cost is zero until a trigger fires.

## Post-install verification

On any harness, confirm the framework is active:

1. Ask the agent: "Read AGENTS.md. What are the four Iron Laws?" — it should recite them.
2. Fire one movement skill, e.g. `scribe` (user-invoked) on a planning task — it should interview, not implement.
3. Confirm `node scripts/validate.mjs`, `node scripts/eval.mjs`, and `node scripts/tickets.test.mjs` all exit 0 (structural + ownership + ticket-graph gates).
4. Optional: add the CI workflow from `.github/workflows/ci.yml` to your repo to keep validation running automatically.
5. **Mechanical install check — `scripts/doctor.mjs`.** The steps above prove the router recites; doctor proves the enforcement is actually wired: router files present, `core.hooksPath` active with both hooks (and, in a clone, identical to the tracked copies), all 11 skills reachable from a harness discovery location, and `.trust/` gitignored once the ledger exists. Run it from the adopting project (`node <trust-no-agent>/scripts/doctor.mjs`); exit 0 = healthy, exit 1 = gaps named with their fix. This closes the gap that prose install instructions cannot: nothing in the copy commands *guarantees* the enforcement is live until doctor checks it.
