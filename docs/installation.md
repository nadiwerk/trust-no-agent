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

If an **agent** runs this install (rather than you pasting the commands), the same gate applies: it proposes the install and waits for your explicit "yes" — writing the router into a project is an action on shared state, not a read-only lookup.

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

The copy commands above are the greenfield path. Most repos are not empty: they already carry a router (`AGENTS.md`, `CLAUDE.md`, rules files) and sometimes their own skill ecosystem. For those, adoption is a **merge, not a copy** — nothing in your project is overwritten, replaced, or deleted.

### The adoption interview (interactive)

Before touching anything, the agent runs this short interview. It should ask the questions and **wait for your answers** — no file is read, merged, or written until you have answered and confirmed:

1. **"Does this project already have a router — `AGENTS.md`, `CLAUDE.md`, `RULES.md`, or similar at the root?"**
   - *No* → greenfield path: the plain copy commands at the top of this page apply; the interview ends here.
   - *Yes* → continue to question 2.
2. **"What does your router already cover — task classification, planning stages, review, logging, delegation rules?"**
   - The agent reads your router and marks the overlap itself (step 1 below), then reports back: *"Your router covers X, Y; trust-no-agent would add the gates it lacks: Z."* You confirm which parts to adopt.
3. **"Where should skills live — project-local (`.agents/skills/`, `.claude/skills/`) or a shared global dir?"**
   - Actively developed project → project-local is the safe default (step 4 below): a global dir collides with whatever the project already has.
4. **"Any chain stage you want mapped to a local name instead of adopted?"**
   - If your router already has a stage under a different name, the local name stays and a mapping is recorded (step 3 below) — the project is never renamed around the framework.

Only after your answers does the agent produce a **merge plan** — which lines go where, what stays untouched — shows it to you, and waits for an explicit "yes" before writing. Each step below is then applied additively; the diff is shown, and any step you dislike is reverted before the next one runs.

### Why this cannot break your existing router

Adoption touches your project additively only:

- **The project's router stays the only router.** Nothing copies over it, nothing replaces it — framework rules are cherry-picked *into* the file you already have, under its existing structure. Your rules keep their priority; the framework only fills gaps.
- **No overlap means no conflict.** The audit in step 1 marks what your router already covers; those parts are skipped, not duplicated. Two routers claiming the same session is exactly the failure this flow exists to prevent — the merge guarantees there is still only one.
- **Skills are additive files in a new directory.** Skill folders land in a dedicated skills dir; they add files, they do not modify existing ones. If your project has its own skill with the same name, the interview surfaces the collision and you pick the location — nothing is silently overwritten.
- **Reversible by construction.** The merged router is version-controlled — a normal `git diff` shows every added line, and `git checkout -- AGENTS.md` undoes the whole adoption. The ledger (`.trust/`) is new and gitignored; deleting it removes nothing of the project's.

With the interview answered and the merge plan confirmed, adoption proceeds as a merge in five steps:

1. **Audit the overlap first.** Read the project's router and mark what it already covers — task classification, interview/spec/ticket stages, review, logging, delegation rules. Mature routers usually cover part of the chain under different names. The framework's adoption value is usually its **gates** (fail-first, fresh-evidence receipts, human sign-off), not a second chain.
2. **One router.** The project's router stays the only router. Cherry-pick the framework rules it lacks — a MANDATORY discipline-skills section, a trigger-matrix row — **into** that router instead of copying `AGENTS.md` wholesale. Two routers claiming the same session silently disagree, and the model arbitrates by forgetting one of them.
3. **Map the names; don't rename the project — but never keep a dead name.** Where a chain stage already exists under a local name, keep the local name and record the mapping so the skills still resolve. The mapping is the project's own — write it from the project's router, not from any external list. The premise of a mapping is that the name **still resolves**: if the skill behind a local name is later removed or migrated, drop the mapping with it — a mapping that outlives its target is dead weight the router keeps citing for weeks with nothing detecting it.

4. **Skills project-local, not global.** An actively developed project keeps its skills in its own repo directory (`.opencode/skills/`, `.claude/skills/`) — a global skills dir is shared across projects and collides with whatever the project already has.
5. **Verify against the merged router.** Run the post-install verification below, but point it at the project's router: the Iron Laws must be recitable from the project's own files, not from this checkout. If a law cannot be recited from the project router, the merge missed a gate.
6. **Verify every name resolves (post-adoption sweep).** After adoption — and again whenever skills are removed or migrated — check that every skill name the router mentions resolves in a registry the harness actually discovers (grep the router for skill names, then confirm each exists as a skill dir at the project-local or global discovery location). A name in the trigger matrix with no skill behind it is a dead reference: fix it by removing the mapping or restoring the skill, not by leaving both to rot.

### De-adoption: retiring skills and old routing

De-adoption is a **user decision** — the agent prepares and proposes (grep the references, map the install locations, present the removal plan), and deletion runs only on explicit approval: removing skill files is irreversible and, for a global dir, touches every other project on the machine. What needs no sign-off is the non-destructive side — dropping a dead name from the router's prose is a fix, not a removal.

Adoption is forward-looking; so is removal. A framework that documents how to install but not how to retire leaves zombie skills alive — a retired chain stage keeps "resurrecting" from a global dir or registry long after the project moved on (observed: a pre-adoption skill chain survived in the global skills dir and could still fire weeks after adoption):

1. **Remove the skill files** from every install location they were copied to (project-local dir, global dir). A skill left in the global dir outlives the project's adoption — global dirs are shared across projects and nothing in the project repo signals it is dead.
2. **Clean the router.** Remove or re-point every trigger-matrix row, mapping, and prose mention that cites the retired skill (step 3's dead-name rule applies: the mapping goes when the target goes).
3. **Verify nothing still references it.** Grep the repo for the skill name; check `docs/skills/` mirrors if present. Then run the post-adoption sweep above — every name the router cites must resolve.
4. **Log the retirement** in the ledger (`Recipe: task_type = skill-deadoption`) so the removal is part of the history — a skill that vanishes without a trace invites re-installation.

### Precedence: global vs project-local skills

When the same skill name exists in both a project-local dir and a global dir, the harness picks one — and the choice is per-harness and under-documented (some prefer project-local, some prefer global, some merge). Two rules hold regardless of which wins:

- **One skill, one location per project.** If a project owns its copy of a skill, remove or update the global copy's intent accordingly — updating a skill in one location while a stale copy sits in the other changes behavior with **no diff in the repo** to explain it. When in doubt, install project-local (step 4 of the merge) and treat the global dir as the fallback for projects without their own copy. Removing or editing the **global** copy is a user-approved action — same gate as de-adoption: it touches every other project on the machine.
- **Treat the global dir as shared infrastructure, not project state.** Whatever lands in `~/.agents/skills/` (or any user-level dir) affects every project on the machine — retiring a project's skills from there is part of de-adoption, and archiving (move to a subfolder outside the discovery path) is safer than deletion when other projects may still use them.



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

## Updating

Skills are copied frozen at install time — an upstream release does not reach an installed copy by itself. Detection is mechanical, the update is a decision:

1. **Detect** — run `node <trust-no-agent>/scripts/doctor.mjs` in the project: check C6 compares the stamped version (`.trust/tna-version`) against the upstream release and warns when the install is stale or carries no marker.
2. **The model proposes** — when a check shows an update is available, the agent reports it to the user with the version delta and the relevant CHANGELOG entries, then asks whether to update. This is a router obligation, not a judgment call.
3. **The user approves** — only on an explicit "yes" does the agent re-run the install (`npx skills add nadiwerk/trust-no-agent`, re-copy the router, re-run the post-install verification), then stamp the new version: `printf '<new-version>' > .trust/tna-version`. Removing or overwriting an existing install without approval is the same gate as de-adoption.

A reference-style install (Option 2 at the top of this page) needs only `git pull` in the trust-no-agent checkout — the version stamp does not apply.

## No-skill-system fallback (any harness reading AGENTS.md)

If the harness has no skill system, nothing is installed: the AGENTS.md trigger matrix states *when* to load each skill, and the agent opens `skills/<name>/SKILL.md` on demand from the checkout. Cost is zero until a trigger fires.

## Post-install verification

On any harness, confirm the framework is active:

1. Ask the agent: "Read AGENTS.md. What are the four Iron Laws?" — it should recite them.
2. Fire one movement skill, e.g. `scribe` (user-invoked) on a planning task — it should interview, not implement.
3. Confirm `node scripts/validate.mjs`, `node scripts/eval.mjs`, and `node scripts/tickets.test.mjs` all exit 0 (structural + ownership + ticket-graph gates).
4. Optional: add the CI workflow from `.github/workflows/ci.yml` to your repo to keep validation running automatically.
5. **Mechanical install check — `scripts/doctor.mjs`.** The steps above prove the router recites; doctor proves the enforcement is actually wired: router files present, `core.hooksPath` active with both hooks (and, in a clone, identical to the tracked copies), all 11 skills reachable from a harness discovery location, `.trust/` gitignored once the ledger exists, and the corrective tier enforced — a ledger with entries but no `.trust/lessons.md` warns during a 14-day grace period (measured from the oldest dated ledger entry), then fails. Run it from the adopting project (`node <trust-no-agent>/scripts/doctor.mjs`); exit 0 = healthy, exit 1 = gaps named with their fix. This closes the gap that prose install instructions cannot: nothing in the copy commands *guarantees* the enforcement is live until doctor checks it.
