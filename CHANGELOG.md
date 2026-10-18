# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GitHub Copilot marketplace manifest** —
  `.github/plugin/marketplace.json` (the location `copilot plugin
  marketplace add nadiwerk/trust-no-agent` looks for first) lists the
  trust-no-agent plugin with source `./plugin` and a version matching the
  payload manifest; the README Copilot install block now mirrors the
  Claude Code / Codex two-command shape (`marketplace add` +
  `plugin install`). New pins B11–B16 in marketplace-copilot.test.mjs
  (manifest exists, parses, lists the plugin, source resolves on disk,
  listed version == payload version).

## [0.1.41] - 2026-10-18

### Added

- **Cursor marketplace listing** — `.cursor-plugin/marketplace.json` lists
  the trust-no-agent plugin (source `./plugin`), mirroring the
  `.claude-plugin/marketplace.json` pattern: the plugin is now
  marketplace-installable, not just checkout-installable.
- **GitHub Copilot payload** — `plugin/copilot/` ships the AGENTS.md router
  (Copilot's coding agent reads it natively), the 12 skills via the Agent
  Skills standard (`.agents/skills/`), and the veto-hooks adapters;
  manifest + marketplace listing (`.agents/plugins/copilot-marketplace.json`)
  mirror the claude/codex pattern. New fail-first guard:
  `scripts/marketplace-copilot.test.mjs` (manifest shape, byte-identity of
  payload copies, marketplace listings), registered in CI.
- **README: Copilot install block** — the Install section covers Copilot:
  point the coding agent at a checkout, AGENTS.md router live, skills via
  the standard path.

### Added

- **Cursor install in the README** — the Install section gains a Cursor
  block (plugin install from the repo checkout, what the veto hooks cover,
  AGENTS.md natively read) and the harness counts are updated: the veto
  layer reaches six harnesses, the TNA gates core runs on all six, and the
  honest-limits line now says five harnesses await live proof (Cursor
  joined the doc-first group).

### Added

- **Cursor plugin payload: the veto layer reaches Cursor** — a Cursor
  Plugin manifest (`.cursor-plugin/plugin.json` declaring skills,
  commands, hooks), a `hooks/hooks.json` wiring `beforeShellExecution`,
  `sessionStart`, and `preCompact` through a thin event-name shim
  (`.cursor/scripts/gate-hook-shim.mjs`) onto the shared gate-hook brain —
  the same classifier Claude Code and Codex use, exit-2 block contract.
  New fail-first guard: `scripts/cursor-plugin.test.mjs` (manifest shape,
  hook wiring, shim thinness — no pattern duplication, block-contract
  forwarding, honesty of the compatibility row), registered in CI.
  Compatibility row updated honestly: doc-first WARN until a live deny
  fires on a real Cursor session (documented Cursor caveats: malformed
  hook JSON fails open, `ask` decision not enforced on
  beforeShellExecution).

## [0.1.40] - 2026-10-18

### Added

- **Cursor plugin: the veto layer reaches Cursor** — a Cursor Plugin
  manifest (`.cursor-plugin/plugin.json`) declaring skills, commands, and
  hooks; `hooks/hooks.json` wiring `beforeShellExecution`, `sessionStart`,
  and `preCompact` through a thin event-name shim
  (`.cursor/scripts/gate-hook-shim.mjs`) onto the shared gate-hook brain —
  the same classifier Claude Code and Codex use, exit-2 block contract.
  New fail-first guard: `scripts/cursor-plugin.test.mjs`, registered in CI.
  Compatibility row updated honestly: doc-first WARN until a live deny
  fires on a real Cursor session.
- **Cursor install in the README** — the Install section gains a Cursor
  block and the harness counts are updated: the veto layer reaches six
  harnesses, the TNA gates core runs on all six, and the honest-limits
  line now says five harnesses await live proof.

### Fixed

- **The omp/pi veto adapters were runtime-broken — fixed** (second bug
  report from the same omp user): both `tna-veto.ts` files called
  `readFileSync` without importing `node:fs` — the veto blocked FOREVER
  even with fresh test evidence. Runtime-verified in both branches.
- **The private ledger is append-only, now mechanically** (ledger-overwrite
  incident): a `write`/`edit` targeting `.trust/progress.txt` is vetoed
  regardless of evidence; bash overwrite forms gated; `>>` stays open.
- **Veto adapters resolve cwd per-command** (the deny-path anomaly):
  evidence is read from the PROJECT the command runs in, not the harness
  process cwd — a stale harness-cwd state file no longer opens the gate.

### Changed

- **design.md names where trust is built** — the four ground levels and
  the strict leverage ordering, stated in the framework's own vocabulary.
- README polish carried from the previous Unreleased (five pillars, TNA
  gates, honest limits, table alignment, four questions, verification
  gates current-suite).

## [0.1.39] - 2026-10-18

### Fixed

- **Veto adapters resolve cwd per-command** (origin: omp user deny-path
  report 2026-10-18, hypothesis confirmed by elimination): the omp adapter
  read evidence via the HARNESS process cwd — a harness launched from a
  parent directory (or another checkout) with a stale
  `testPassFresh: true` state file opened the gate for commits whose own
  project had no evidence at all; that is the deny-path anomaly their
  receipt reported as INCONCLUSIVE. Both adapters now resolve the project
  cwd per-command (event cwd → ctx cwd → harness cwd last), verified by a
  three-tree runtime test (project-with-evidence → allow,
  project-without → block, stale harness-cwd state → ignored). The omp
  adapter also gains the pi adapter's ctx fallback, and the denial reason
  continues to embed the resolved state path so "(missing)" vs "true" is
  distinguishable in the wild.

## [0.1.38] - 2026-10-18

### Fixed

- **The omp/pi veto adapters were runtime-broken — fixed** (second bug
  report from the same omp user, on the v0.1.37 adapters): both
  `tna-veto.ts` files called `readFileSync` without importing `node:fs`,
  so the handler threw `ReferenceError` inside `readEvidence`, the catch
  swallowed it, and every read resolved "(missing)" — the veto blocked
  FOREVER even with fresh test evidence (fail-closed into uselessness;
  reproduced locally before the fix). The adapters now import what they
  call, verified at runtime in both branches (fresh evidence → allow, no
  evidence → block). New runtime-correctness pins L1b/L4b: the shipped
  adapter must self-contain its fs identifiers — a copied-but-broken file
  can never pass green again (RED observed: `unresolved: readFileSync`
  on both adapters before the import landed).


- **The private ledger is append-only, now mechanically** (ledger-overwrite
  incident 2026-10-18): a `write`/`edit` targeting `.trust/progress.txt` is
  vetoed by the shared classifier regardless of evidence — fresh test
  evidence cannot restore overwritten history. Bash overwrite/truncate
  forms naming the ledger are gated too (doubt blocks); the append form
  (`>>`) stays fail-open because appending IS the contract. Ordinary
  writes, state files, and onboarding.json stay fail-open (H4 suite).
  New H-series pins in action-gate.test.mjs (RED observed first: 13 H1/H2/H3
  FAILs + H6 before the classifier knew the ledger). Ships to every
  harness through the shared core: opencode plugin (vendored copy synced),
  Claude Code and Codex hooks (gate-hook.mjs reads the same classifier).

### Changed

- **design.md names where trust is built** — the four ground levels (shape
  the ground, let the machine check, say it in words, spend a human) and
  the strict leverage ordering (the closer a fix sits to the code, the
  more it compounds), then states the framework's position in one line:
  this framework is that principle built out — the enforcement ladder is
  the ordering as an operating procedure, the gates and veto are level 2
  made mechanical, and the honest-limits boundary is where a human
  judgment begins.

## [0.1.37] - 2026-10-17

### Fixed

- **The omp/pi veto adapters ship in the release now** (bug report from an
  omp user, root cause confirmed): the two `tna-veto.ts` adapters lived
  under gitignored `.trust/` and were never committed — v0.1.35 and
  v0.1.36 shipped the onboarding copy CODE but not the payload, so
  onboarding failed open with "Veto hook (omp): source not found -
  skipping" and the veto stayed off. The adapters moved to the tracked
  `veto-hooks/{omp,pi}/tna-veto.ts` and byte-identical copies ride every
  skill payload (`veto-hooks/` sibling of each `scripts/`, 7 locations);
  onboarding resolves them relative to its own location, so both repo
  checkouts and skills-installed trees work. New release-integrity pins:
  the adapters must be git-tracked and byte-identical across all payloads
  (L0a/L0b/L0c, RED observed first — the checks the release needed all
  along), and the L-series no longer seeds a synthetic fixture: it copies
  the real shipped files, so a missing payload can never pass green again.
  Verified end-to-end from the adopter's path: payload copy -> omp tree ->
  onboarding -> `~/.omp/agent/hooks/pre/tna-veto.ts` == canonical, no
  "source not found", stamp records the copy.

### Changed

- **README: the three skill tables are pipe-aligned** — all 18 table lines
  now share the same global column widths, so pipes land at identical
  positions across Engineering, Discipline, and Meta: vertical lines drawn
  across all three tables are straight, matching the reference image. The
  eval's user-invoked check was widened to accept padded columns
  (`| `name`   | user   |`), keeping the pin alive.

- **README: honest limits gains the veto-proof limit** — the live denial
  proofs exist on OpenCode; the other four harnesses' deny contracts are
  wired from documented hook APIs but not yet proven by a live run
  (doc-first in the compatibility matrix, review-by 2026-11-13).
- **README: "thirty gates" freed from the count** — the pinned number rotted
  (34 script steps in CI today); both mentions now say "the full gate
  suite", matching the framework's own rule that a claim without fresh
  verification is a rumor.

### Changed

- **README: the TNA gates are named** — a new enforcement-layer bullet
  introduces the named core (`tna-gate` evidence recording +
  `action-gate` irreversible-command classification), and the veto
  bullet now states the four blocked command patterns and corrects the
  harness count four → five (OpenCode, Claude Code, Codex, OMP, Pi).

### Changed

- **README: four questions, not two** — the intro adds "why does the same
  bug keep coming back?" (lesson capture + rule promotion) and "can I trust
  the agent with destructive actions?" (sign-off veto) to the existing
  correctness and next-step questions.
- **README: bring-your-own is any repo, not four** — the example repos stay
  but now close with "and yours?" so the section says what it always meant:
  any workflow, any skill set, same trust layer.

### Changed

- **README: the core loop explained stage by stage** — claim, evidence,
  receipt, guardrail each get a table row (what happens, what makes it
  honest) instead of one buried prose sentence; the loop stays bold prose,
  keeping exactly one fenced chain line in the README (eval pin).
- **README: the verification gates updated to the current suite** — each of
  the four repo commands now names the property it proves (structure /
  discipline / tickets / doctor), the stale recorded outputs are replaced
  with gate roles, and CI's full-suite scope (changelog-guard,
  plugin-mirror, ledger-audit, onboarding, receipt-enforcement, and more)
  is stated instead of implying four commands are all there is.

### Added

- **README carries the site's five pillars**: the core, the verification
  gates, and the ledger sections added (the chain and the Iron Laws were
  already there) — README and the landing page now tell the same story,
  and the canonical-chain eval pin still holds (exactly one fenced chain
  line; the core loop renders as bold prose, not a second fence).

## [0.1.36] - 2026-10-17

### Added

- **Onboarding fixture M3/M3b/M4** (`scripts/onboarding.test.mjs`): the
  workflow-choice contract is now proven for all three values, not one —
  `tna-chain` and `both` record in the stamp (M3, M4), and a mapping-only
  re-run on a stamped tree preserves the recorded choice instead of
  dropping it (M3b). M3/M3b caught a real bug fail-first: the mapping-only
  stamp rewrite did not carry `workflowChoice` through — fixed in
  `scripts/onboarding.mjs` (payload copies re-synced byte-identical).
- **Bring-your-own docs completed** (repositioning ticket 2): the
  "Bring your own workflow" section in `docs/installation.md` (both
  postures, workflow-choice stamp tie-in, identical enforcement),
  contributor positioning in `CONTRIBUTING.md` (trust layer is the
  identity; domain-skill and enforcement contributions equally welcome),
  and the philosophy behind the separation in `docs/design.md` (trust
  and workflow are separable; gates are workflow-agnostic).
- **Reply-shape rule in the router** (§6): no preamble/recap/closers, lists
  capped at 5 items (split into ranked groups beyond that), matter-of-fact
  errors — for every reply, receipts included. Prose in the §6 bullet and
  `docs/chat-receipt.md` §Reply shape; mechanically enforced by eval
  check 49 (encode-twice).


## [0.1.35] - 2026-10-16

### Added

- **The veto layer reaches OMP and Pi**: both harnesses have a real
  `tool_call` block contract (research replaced the outdated "no hook
  surface observed" assumption in the compatibility matrix). New
  `tna-veto.ts` adapters — hooks/pre for OMP (`~/.omp/agent/hooks/pre/`),
  extensions for Pi (`.pi/extensions/`) — classify shell commands via the
  same tna-gate core (IRREVERSIBLE_PATTERNS + `.trust/tna-gate-state.json`)
  and block irreversible actions without fresh test evidence. The existing
  fail-open discipline hooks are untouched (veto is additive).
- **Onboarding distribution**: consenting to hooks on an OMP or Pi tree
  copies the adapter (never clobbering a pre-existing copy), records it in
  the stamp (`vetoHookCopiedOmp` / `vetoHookCopiedPi`), and `--undo`
  removes exactly what onboarding copied. L1–L6 fixtures proven RED→GREEN.
- `detectHarness` now reads project-local `.omp` and `.pi` dirs.

### Fixed

- `docs/jev-vs-tna-gates.md` comparison table corrected against source
  before publication (a draft claim that TNA vetoes `git reset --hard`
  was false — the patterns are commit/push/publish/rm -rf only).

## [0.1.34] - 2026-10-16

### Added

- **Fail-closed consent in the onboarding CLI**: an empty Enter no longer
  means yes — empty or unrecognized answers are re-asked, three unclear
  answers abort with "nothing was written (fail-closed)" (K1/K2 fixtures,
  RED→GREEN). `mapSkills` is type-validated: a non-array aborts before any
  write; non-string entries are skipped with a named message (K3/K4).
- **The consent source is visible in every receipt and the stamp** —
  `interactive prompts` or `forwarded via --from-chat (agent channel)` —
  so a receipt names its trust boundary (K5).

### Fixed

- **Receipt labels are fixed English tokens** — Verdict / Evidence / Open /
  Next are contract names, never translated; the body under each label
  follows the user's language. Declared in `docs/chat-receipt.md` and the
  receipts skill, pinned by eval check 45d (strip-dance proven), recorded as
  an A6 row in the rule-inheritance register (origin: display-language
  strike 4).
- **README install section**: the Claude Code and Codex plugin commands now
  sit in separate labeled blocks.


## [0.1.33] - 2026-10-16

### Added

- **`/setup-tna` now wires the veto plugin on OpenCode**: consenting to the
  hooks component makes the onboarding CLI copy
  `.opencode/plugins/tna-gate/` into the project (never over a copy you
  own; recorded as `did.vetoPluginCopied` in the stamp so `--undo` removes
  exactly what onboarding created). The skill body carries the per-harness
  branches honestly — verify-not-rewire on Claude Code/Codex, audit-only
  where no hook API exists — and doctor-lite gains the veto-plugin-present
  check. Spec: `docs/specs/veto-plugin-onboarding.md`.

## [0.1.32] - 2026-10-16

### Added

- **The setup-tna skill (the 12th)** (`skills/meta/setup-tna/`): the onboarding
  front door is now a real skill carrying its own payload — byte-identical
  copies of the router, the core rules, and the onboarding CLI, pinned to the
  root sources by eval check 47. The universal one-liner becomes
  `npx skills add nadiwerk/trust-no-agent` alone; typing `/setup-tna` copies
  the router into the project root only after explicit consent (never over an
  existing router), runs the consent + mapping flow, and closes with
  doctor-lite proof. The `/setup-tna` command file is now a thin wrapper
  routing to the skill body (one procedure source). The router gains a
  fresh-install rule: when the skills are present but the router is not, the
  agent must propose setup-tna. Hardened per review: the CLI's `--undo`
  re-validates overlay names against the write-time whitelist before any
  deletion (a tampered stamp can no longer name traversal targets), and the
  hooks wiring refuses to set `core.hooksPath` when `scripts/hooks` does not
  exist in the tree (no silent hook disabling from a skill-payload run).

- **Full-English pass**: every published file — nine specs translated
  faithfully (structure byte-preserved), owner quotes carried with
  `[translated]` markers, coined spec terms given English-primary forms with
  their originals as gloss. Classifier keyword tables and test fixtures stay
  as data.

### Hardened

- **The onboarding CLI's `--undo`** re-validates overlay names against the
  write-time whitelist before any deletion (G3 fixture: a tampered stamp can
  no longer name traversal targets; proven RED→GREEN).
- **Hooks wiring** refuses to set `core.hooksPath` when `scripts/hooks` does
  not exist in the tree — running the CLI from a skill payload can no longer
  silently disable an adopter's pre-commit enforcement.

### Fixed

- The audit pass: personal/machine identifiers removed from published files,
  and the README rewritten around the enforcement layer (plugin-first
  install with the live-verified Claude Code and Codex command pairs).

## [0.1.31] - 2026-10-16

### Added

- **Engagement criteria** (router §1): the chain engages by counting, never
  by mood — the task touches more than one file, or crosses a function
  boundary other code calls, or carries a design/architecture choice, or is
  a bug whose cause is not yet known, or spans more than one exchange with
  the user. Anything smaller proceeds directly and is verified on its real
  artifact. Self-trigger was proven unreliable (0/3); engagement is now a
  mechanical count. Pinned by eval check 6-ENG.
- **The INCONCLUSIVE verdict** (receipts skill): a verification that ran but
  proved nothing is INCONCLUSIVE — first-class, never a pass; reporting it is
  mandatory, covering it up is the covered-up failure the rule kills.
  Consistent with the local judge's J4. Pinned by eval check 45a.
- **The aggregate-report gate** (router §5): a delegated report that does not
  record (a) the exact commit SHA(s) it verified and (b) the method each
  measurement used is dropped and the worker respawned once; a gap in the
  report never counts as a pass; unverifiable results are reported as
  unverifiable. Pinned by eval check 45b.
- **Labeled claims** (chat-receipt rule 3 + receipts skill): every prose
  claim in a receipt or report carries its evidence or its label (measured /
  inferred / guess) in the same sentence; an unlabeled assertion is an
  opinion wearing a receipt's clothes. Pinned by eval check 45b.
- **Blind reviewers** (roast-my-code, step 4): a review subagent never
  receives the orchestrator's verdict — its prompt carries only the diff
  command, the commit list, its axis brief, and its axis's reference
  material. Pass the inputs to verify, not the conclusions drawn; findings
  raised independently by more than one axis are the highest-signal
  findings. Pinned by eval check 45c.
- **The enforcement ladder** (docs/rule-inheritance.md, new section): a rule
  lands at the highest level that works — architecture, then types/lint,
  then behavior tests, then docs/agent-rules LAST. A mistake class counts at
  two occurrences; every new check must be proven to fail on a real past
  mistake; a rule with no enforcer is itself a repeat failure. The noise
  filter's one-off rule now references the class-of-two threshold. Pinned by
  eval check 45c.

Both adaptation waves follow the encode-twice discipline (prose where it is
read, an eval marker where it is enforced, an adapter pin where it is
regression-guarded) and were proven able to fail via strip-dance.

- **The `/setup-tna` chat front door** (`.opencode/command/setup-tna.md`,
  mirrored byte-identical into the plugin payload per harness): type
  `/setup-tna` in your chat session and the agent guides the entire
  onboarding — briefing, consent, skill mapping, doctor as final proof —
  without opening a terminal. Installations predating the command keep
  working; `node scripts/onboarding.mjs` remains the terminal fallback.
  Also in this release: the doctor's ledger-audit rollup display fix
  (`3bb991a`).

## [0.1.30] - 2026-10-14

### Added

- **Receipt enforcement** (`scripts/receipt-enforcement.mjs`): the hilir side
  becomes steel — the receipt shape is validated (the five booleans each
  carrying their own evidence; a blanket "all five hold" is not a verdict),
  cited verification commands must be repo gates (allowlist), a done-claim
  without a valid receipt hard-fails the audit AND the commit veto (the newest
  ledger entry must carry one), claims older than 14 days are stale by
  computation and must be re-verified — their cited gates re-run through the
  hardened runner — before gating, fast units carry a minimal receipt, and
  pre-feature entries are grandfathered. Pinned by eval check 45.

## [0.1.29] - 2026-10-14

### Added

- **First-run onboarding** (`scripts/onboarding.mjs`): a human CLI front door
  that briefs what changes in your sessions, asks consent per component
  (floor / hooks / skill mapping / evidence gate — a declined component is
  mechanically OFF and the doctor records it), maps your installed skills
  (project + personal directories) into the workflow as overlays you confirm
  per skill, and writes the private stamp `.trust/onboarding.json` with a
  4-block receipt. `--yes` for scripted installs, `--map-only` to re-scan
  new skills, `--undo` to reverse everything. Existing installs keep
  working (grandfather warning, never a failure). Pinned by eval check 44.

## [0.1.28] - 2026-10-13

### Added

- **Decision composition.** User skills join the framework's workflow without
  forking it: a skill in `.trust/skills-overlay/<name>/` declares frontmatter
  (`name`/`extends`/`role`, optional `triggers`) and attaches to a canonical
  phase — roles are `insert-before`/`insert-after`/`wrap` only, so an overlay
  may add steps and never subtract gates. The session floor emits the
  canonical floor first and complete, appending `user:`-marked overlay
  entries within the bounded budget; the doctor reports defects by name and
  budget-omitted overlays by count; sessions fail open. Keyless,
  zero-dependency, no runtime engine — the composition is text the agent
  executes. Pinned by eval check 43; the adopter doc is
  `docs/installation.md` §Overlay composition.

## [0.1.27] - 2026-10-13

### Added

- **Newcomer onboarding hardening.** `docs/installation.md` install steps
  carry one-line `Verify:` commands, adoption refuses dual-router setups by
  name, stale-skill purge and the post-adoption sweep are documented, and
  support starts from the doctor output. Pinned by eval check 37.
- **First-run gate** (`scripts/first-run.mjs`): one verdict from doctor green
  plus the full floor emitted — either side missing fails closed.
- **Full enforcement.** Doubt-deny veto under any tool name, CI red when a
  boundary gate is dropped from the workflow (ci-guard M7), per-harness veto
  rows bound to live proof, and remaining-harness verdicts (OMO audit-only
  with reason, omp/Devin dated live-proof plans).
- **Findings adaptation.** An external agent-discipline research corpus,
  adapted into mechanical gates — each adaptation named by what it now
  enforces:
  - **Delegation briefs carry their execution window.** VERIFY (the exact
    command line, not "run the tests"), TIMEBOX (wall-clock minutes), and
    PARTIAL (what to return if the box expires) are required fields — a
    subagent cannot report "tests pass" without the literal command
    (eval check 39).
  - **Per-harness autonomy ladder with decay.** Trust claims are re-read at
    read time; a claim older than its window drops a rung by computation,
    never by memory (check 40).
  - **Stale lessons must be re-verified before they may gate.** Probes
    execute only with the explicit `--allow-exec` sign-off — no shell, an
    interpreter allowlist — so agent-authored command lines in memory
    files can no longer execute by default (check 41).
  - **Bounded judgment, deterministic-first and keyless.** Free-form code
    graders decide before any model call; the model judge is last resort
    and fails closed to `inconclusive`, never a fabricated pass
    (check 42).
  - **The behavioral-eval harness gained an honest measurement seam.**
    Per-row fault tagging (infra vs agent, through one row seam),
    physically split `dev/` and `test/` fixtures (tuning cannot leak into
    reported numbers), a per-side negatives floor, and pass@k/pass^k in
    the trial summary.

## [0.1.26] - 2026-09-30

The repo now serves two agent marketplaces from one payload, and the second one
was verified with its real installer rather than by reading its docs.

### Added

- **Codex marketplace.** `.agents/plugins/marketplace.json` (the path Codex
  reads) points at `./plugin`, and `plugin/plugin.json` is the portable Agent
  Plugins manifest: `$schema`, `skills: ./skills/`, and hooks routed to the Codex
  variant. Shapes taken from real installed marketplaces on the development
  machine, not from prose.
- **`plugin/hooks/codex.hooks.json`** — the same wiring with `${PLUGIN_ROOT}`,
  the variable Codex substitutes; `${CLAUDE_PLUGIN_ROOT}` is Claude-only, so the
  two hook files cannot be one file. `SessionStart`, `PostCompact`, and
  `UserPromptSubmit` are wired.
- **`scripts/codex-plugin.test.mjs`** — a fail-first guard for the second
  payload (19 expectations observed RED before it existed), wired into
  pre-commit and CI beside the Claude mirror guard, so one payload serving two
  marketplaces cannot drift in either direction.

### Note

- **No new hook code was needed.** Codex's hook contract is
  `hookSpecificOutput.additionalContext`, which `gate-hook.mjs` already emitted,
  and Codex also exports `CLAUDE_PLUGIN_ROOT` for compatibility. Verified end to
  end with the real CLI: `codex plugin marketplace add <repo>` →
  `codex plugin add trust-no-agent@trust-no-agent` reports `installed, enabled`
  at `0.1.26`, and the installed payload emits the session floor (both halves)
  when driven directly.
- **Codex skips plugin hooks until the user trusts them.** Its config records a
  `trusted_hash` per hook file, and a fresh plugin has none — so the floor's
  hooks fire only after a one-time trust prompt. That is a user action, and this
  release does not pretend otherwise.

## [0.1.25] - 2026-09-30

A release-artifact fix, prompted by the release step itself corrupting the file
twice in two consecutive releases.

### Added

- **`scripts/changelog-guard.mjs` (+ test, wired into pre-commit and CI).** The
  compare-link block is now structurally checked: it must sit at the TAIL with
  no heading inside it (the shape that lets an anchored edit swallow a section),
  every release heading must have its compare link and every link its heading,
  exactly one `[Unreleased]` pair, and headings must be newest-first by numeric
  comparison. Every test case reproduces a real corrupt shape — both incidents
  verbatim — plus the counter-direction that a sound file passes.

### Fixed

- **Three release sections had been silently swallowed.** `## [0.1.22]` and
  `## [0.1.23]` were deleted during their own release steps and restored from
  the tags that carried them; `## [0.1.21]` had been missing since the v0.1.22
  release — its body was still in the file but headerless, folded into the
  previous section, and only the new guard made that visible. Its text is
  restored byte-identically (1238 bytes) and its compare link, which had never
  existed, was added.
- **Eight release headings had no compare link** (`0.1.17` … `0.1.8`). They are
  completed rather than tolerated, so the guard's invariant holds against the
  real artifact instead of being weakened to fit it.

### Note

- The guard is a check on the artifact, not on the runtime: it rides whichever
  release follows, and it fails the commit that would corrupt the file.

## [0.1.24] - 2026-09-30

Two gaps found by walking a fresh adopter's install path, both of them the same
class: an artifact claiming a state nobody verified.

### Fixed

- **The session floor asserted where skills live.** It ended with "Skills are
  installed globally (`~/.claude/skills`)" — false for every install that came
  through the marketplace, whose skills live under the plugin root. The floor
  now checks both candidate roots and names only those that exist; when none
  does, it tells the agent to verify the install instead of pointing at an
  empty directory.
- **A missing hook was silent.** Fail-open is deliberate — a discipline layer
  must never break session startup — but the cost is that a session with no
  floor looks exactly like a session with one. `gate-hook.mjs --self-check` now
  prints what it resolved (`router:`, `skills:`, `classifier:`) and says NOT
  FOUND for anything absent, making "wired and quiet" distinguishable from "not
  wired". It is opt-in; the paths the harness calls are unchanged.

### Added

- `docs/installation.md` documents both behaviours, including the fact that no
  `CLAUDE.md` edit is needed when the plugin wires the hooks — the router is
  quoted from the plugin payload, and a project's own `CLAUDE.md` is untouched.

Four defects surfaced by measuring the ledger audit against a REAL adopter
ledger (911 lines, 65 dated entries) instead of against its own fixtures. Each
is pinned by a test that was observed failing before the fix.

### Added

- **A third date source: the session heading's own day label.** The adopter
  writes `### Ringkasan Sesi - … (27 Sep, lanjutan 3)` and puts no
  `## YYYY-MM-DD` header before most sections, so 16 entries whose date was
  present and unambiguous came back as unprovable coverage gaps. A heading label
  now dates its entry when no header precedes it — the header stays the
  authority, the year comes from the nearest preceding header (or the audit's
  reference date) and is never guessed beyond that. Measured: coverage gaps
  **16 → 1**, and what surfaced (previously invisible entries) is now audited.
- **Lesson-format diagnosis (M9).** `lesson-gap` alone could not distinguish a
  starving tier from an unmatchable one: the measured adopter tier held 66
  lessons with **none dated and none in the documented form**, so every repair
  in the window read as an unattributed gap. The audit now says that once, in
  those words. `ship-log` teaches the dated form and `scripts/eval.mjs` check 34
  guards the template plus the format string.
- **Per-day rollup for high-volume finding kinds.** `next-gap` on that ledger
  produced 44 findings and read as a wall; it now prints as one scannable line
  (`44 × next-gap across 4 day(s) — 2026-09-27 (22), …`). The total printed IS
  the finding count, so nothing is hidden — the adopter ledger reports the
  identical 113 findings before and after the change.

### Fixed

- **`Next:` was demanded from entries that close nothing.** An index-pointer
  line routes the reader elsewhere; it owes no forward arrow. The arrow is now
  demanded from entries that close a unit, without weakening the rule for them.
- **Gate findings are annotated, not suppressed.** The first design hid
  `gated-loaded-gap` findings that duplicated the literal audit. Measurement
  killed it: on the real ledger **22 of 33** gate findings were entries the
  literal audit cannot see at all, so the filter would have deleted two thirds
  of the real signal. The reader now sees the split as a number instead.

### Note

- `gated-loaded-gap` is still additive to `loaded-gap` on purpose: the keyword
  classifier catches phrasings the literal markers miss. If a project's ledger
  already emits the literal lines, its gate findings are mostly unique signal,
  not duplication — that is the case this release measured.

## [0.1.23] - 2026-09-30

Four defects surfaced by measuring the ledger audit against a REAL adopter
ledger (911 lines, 65 dated entries) instead of against its own fixtures. Each
is pinned by a test that was observed failing before the fix.

### Added

- **A third date source: the session heading's own day label.** The adopter
  writes `### Ringkasan Sesi - … (27 Sep, lanjutan 3)` and puts no
  `## YYYY-MM-DD` header before most sections, so 16 entries whose date was
  present and unambiguous came back as unprovable coverage gaps. A heading label
  now dates its entry when no header precedes it — the header stays the
  authority, the year comes from the nearest preceding header (or the audit's
  reference date) and is never guessed beyond that. Measured: coverage gaps
  **16 → 1**, and what surfaced (previously invisible entries) is now audited.
- **Lesson-format diagnosis (M9).** `lesson-gap` alone could not distinguish a
  starving tier from an unmatchable one: the measured adopter tier held 66
  lessons with **none dated and none in the documented form**, so every repair
  in the window read as an unattributed gap. The audit now says that once, in
  those words. `ship-log` teaches the dated form and `scripts/eval.mjs` check 34
  guards the template plus the format string.
- **Per-day rollup for high-volume finding kinds.** `next-gap` on that ledger
  produced 44 findings and read as a wall; it now prints as one scannable line
  (`44 × next-gap across 4 day(s) — 2026-09-27 (22), …`). The total printed IS
  the finding count, so nothing is hidden — the adopter ledger reports the
  identical 113 findings before and after the change.

### Fixed

- **`Next:` was demanded from entries that close nothing.** An index-pointer
  line routes the reader elsewhere; it owes no forward arrow. The arrow is now
  demanded from entries that close a unit, without weakening the rule for them.
- **Gate findings are annotated, not suppressed.** The first design hid
  `gated-loaded-gap` findings that duplicated the literal audit. Measurement
  killed it: on the real ledger **22 of 33** gate findings were entries the
  literal audit cannot see at all, so the filter would have deleted two thirds
  of the real signal. The reader now sees the split as a number instead.

### Note

- `gated-loaded-gap` is still additive to `loaded-gap` on purpose: the keyword
  classifier catches phrasings the literal markers miss. If a project's ledger
  already emits the literal lines, its gate findings are mostly unique signal,
  not duplication — that is the case this release measured.

## [0.1.22] - 2026-09-29

### Added

- **M8 lesson-gap — a repair must leave a lesson dated with it** (2026-09-29,
  closing audit 2026-09-27 §7b). `receipts` requires the corrective tier to be
  fed on every repair, but nothing mechanical verified a lesson existed for the
  repair being closed: the only link was a free-text backfill tag applied
  inconsistently. `scripts/ledger-audit.mjs` now compares each entry's repair
  markers (root-cause / done-claim) against `.trust/lessons.md` lesson lines
  whose `[YYYY-MM-DD]` annotation matches the entry's date — a repair with no
  such lesson is a finding. `doctor.mjs` feeds the tier text in; a caller that
  supplies none keeps M8 silent rather than inventing gaps (pinned by test L7),
  and a missing lessons file remains C5's starvation report, not per-entry noise.
- **`scripts/eval.mjs` check 33 (HARD): the ledger writer's template is now
  guarded.** The `Loaded:` and `Next:` lines were prose contracts with
  mechanical readers (audit M1/M7) that had dropped out of the Log Format
  template, so entries written from it inherited the omission — seven of this
  repo's own early-September entries carry findings for exactly those two lines.
  The check is scoped to the template block itself (not a prose mention
  elsewhere in the skill), so teaching the format and reading it can no longer
  drift apart silently.

### Fixed

- **`scripts/ledger-audit.mjs`: the lesson reader matched only the `Lesson:`
  marker** while the date annotation sits at the end of the line
  (`… | correction = … [YYYY-MM-DD]`), so every tier read as dateless and every
  repair would have been flagged (found during this wiring — the failing L2 test
  caught it). The reader now takes the whole lesson line, pinned by L8–L10.

### Added

## [0.1.21] - 2026-09-28

### Added

- **Installable plugin + marketplace.** The repo is now its own marketplace
  (`.claude-plugin/marketplace.json`) with a `plugin/` payload that ships the
  router, the hook layer, and all 11 skills in one install:
  `claude plugin marketplace add nadiwerk/trust-no-agent`. The payload is flat
  (`plugin/skills/<name>/`) because the installer does not flatten and
  non-recursive discoverers cannot see a nested tree; `scripts/plugin.test.mjs`
  guards every mirror byte-for-byte so the published copy cannot drift.
- **`scripts/gate-hook.mjs` is now tracked.** It was the only file in the
  enforcement layer that existed exclusively in an installed plugin directory —
  absent from the repo and from all git history — so losing that folder meant
  rewriting the hook entry point from memory. Its fail-open contract and both
  event paths are pinned by `scripts/gate-hook.test.mjs`.
- Cross-harness skill mirrors under `plugin/` (`.claude/`, `.cursor/`,
  `.agents/`, `.opencode/`) so non-Claude marketplaces install from one repo.

### Fixed

- `hooks.json` used a machine-specific absolute path in the hand-copied install,
  so the plugin worked on exactly one machine. It now resolves through
  `${CLAUDE_PLUGIN_ROOT}`.

## [0.1.20] - 2026-09-23

### Added
- Receipt delivery contract — plain chat text, blocks separated (2026-09-23, two owner findings at the render layer in one session): (1) a receipt sent inside a fenced code block rendered in the owner's chat UI as a clipped scrollable file card ("the md file is fine, but the most important thing is that the receipt's content appears directly in chat" [translated]); (2) four tight single-newline lines collapsed by markdown renderers into one merged paragraph ("I can't tell which line is done, evidence, open, next. Separate them or add spacing so it reads" [translated]). `docs/chat-receipt.md` gains two Delivery paragraphs: the receipt is plain chat text in the message body — never a fenced code block (a fence is a file, not a card) — and each block starts its own paragraph with a bold lead (verdict line bold; `Evidence:`/`Open:`/`Next:` bolded labels), because spacing is the skim test's rendering prerequisite. Archive files (ledger, `evidence.md`) supplement the in-chat receipt, never replace it. Encode twice: `scripts/eval.mjs` check 26 now guards all four receipt markers literally (skim test + delivery + separation). Teeth verified, not assumed: a neutralized marker turned eval RED (exit 1, naming the rule), a byte-identical restore turned it GREEN. Register rows, the corrective-tier lesson, and the private memory record kept aligned. Deliberate limit, stated: render quality itself is judged by the owner's eyes — no automated check claims it. Verified: full battery 12/12 EXIT 0 (validate, eval + all 10 suites) plus the pre-commit hook gates re-running at `5c7ad3f` and at the release commit.

### Fixed
- The chat-receipt Example taught a rule violation (2026-09-23, found by the consistency sweep the owner asked for with the commit): `Next: none` on T01, a chain ticket, contradicts rule 4's tightened "none" semantics (whole-thread-closed only) — the example now shows "proceed to T02". The Shape and Example also demonstrated the pre-delivery form (tight unlabeled lines), teaching every reader the exact shape the contract now forbids; both are rewritten in the canonical separated, bold-labeled form.

## [0.1.19] - 2026-09-23

### Added
- Every close now carries a forward arrow — `Next: none` only when the whole thread is closed, enforced twice (2026-09-23, owner feedback: "as a user I sometimes don't know what I'm supposed to do, myself included. So the next step really matters" [translated] — receipts whose `Next:` was missing or read "none pending" mid-chain left the owner stranded even when the work itself was correct; ledger drift confirmed: `Next:` lines routinely ended "none pending" while work waited). The receipt contract (`docs/chat-receipt.md` rule 4) now states that "none" is a value, not an absence — it means the whole thread is closed and nothing waits anywhere — and AGENTS.md §6 gains the permanent rule via `docs/rule-inheritance.md` (register row with origin/rationale/scope/undo; scope: global). Mechanical twin: `scripts/ledger-audit.mjs` M7 `next-gap` flags any in-window entry with no `- Next:` line (presence bar, literal-line doctrine as `LOADED_LINE`), surfaced through doctor C7 like its M1–M6 siblings — `Next: none` counts as a value, only silence is the gap. Fail-first: K1/K4/K6 (flag when the line is missing; cousin phrases like `Next steps:` don't satisfy it; additive to `loaded-gap`) were RED before the check existed (3 expectations broke, exit 1) and GREEN after (62/62, exit 0); H5's fixture gained `- Next: none` because the new boundary invalidated its cleanliness assertion — the fixture was completed, the assertion not weakened. Deliberate limit, stated: a false "none" mid-thread is NOT mechanically detected (a genuinely closed-then-reopened thread would false-positive) — that half is prose-guarded. Verified: fresh in-session batch — `ledger-audit.test.mjs`, `doctor.test.mjs`, `eval.mjs`, `validate.mjs`, `reinject.test.mjs` all EXIT 0; doctor C7 live against this repo's own ledger proves the pipeline on the real artifact (8 legacy entries flagged as WARN leads, the new entry clean). Cost, stated honestly: +104/−3 LOC across 5 files, one regex test per ledger entry, no new dependencies; adopters will see `next-gap` WARN leads for legacy entries inside the 14-day window — a signal to verify, never a failure.

## [0.1.18] - 2026-09-23

### Fixed
- Ledger audit counted Self-Review checklist bullets as churn evidence (2026-09-23, found while cleaning 125 warnings on the Metrian adopter ledger — the same reader-creates-the-signal class as v0.1.15): `KNOWN_SUBSECTIONS` folds every `### Self-Review` head into the parent entry's body before M5's bullet scan, so each session's `- [x] **Maintainability**: … (revert 3001)` checklist line was read as an ordinary revert bullet. `normalizeRevertTarget` reduces any such line to the shared fixed prefix `x maintainability` (`[x]`→`x`, `**Maintainability**`→`maintainability`), so two unrelated sessions' checklists collided and the audit demanded the owner be re-consulted about churn that never happened. Fixed: M5 skips checkbox lines (`- [x]` / `- [ ]`) — a completed review checklist is a template repeat, not revert evidence; genuine `- Reverted …` bullets inside a Self-Review subsection still count. Fail-first: F5 reproduces the adopter collision (RED pre-fix with the exact `"2 reverts on x maintainability"` message, GREEN after); F6 counter-tests that real revert bullets in the folded subsection keep firing pre- and post-fix. Verified: full suite PASS via pre-commit hook; adopter ledger re-audit 125 → 122 findings with context-gap 0 and churn 0 (remaining findings are historical `loaded-gap`s inside the 14-day window, aging out).

## [0.1.17] - 2026-09-21

### Fixed
- Router re-injection could never emit the Iron Laws (2026-09-21, found by wiring the extractor into a real Claude Code `SessionStart` hook — the first caller to run it against the real two-file router): `buildReinject` demanded a heading matching `Iron Laws` followed by a backtick fence to find the laws, a shape no file in this repo has — the four laws live in `WORKFLOW.md` as a nested list under `## The four principles` (no heading of their own, no fence), and the CLI defaulted to reading `AGENTS.md`, which carries no law text at all. Every caller therefore got the MANDATORY half, silence about the other half, and no signal that half was missing. The test suite shared the same fictional assumption — its fixtures were single-file, both-sections transcripts, 8/8 green, while the real path never once produced the laws: a green suite over a fixture the repo does not contain, which is the silent-failure mode this framework exists to catch, reproduced inside the framework. Fixed: `extractLaws` gains a second form — the four law stems in order, within 12 source lines (the historical heading+fence form is still honored, so no existing caller breaks); `buildReinject` never returns a half floor silently, naming the missing half alongside the file it lives in; the CLI reads `WORKFLOW.md` and `AGENTS.md` by default and exits 1 when the block names a missing half. Fail-first: F1 (law extraction from list form) and G2 (the missing-half block names both source files) were RED before the change and GREEN after; D1 asserted the old "empty block" contract the fix deliberately contradicts and was replaced by D1/D1b/D3 — strictly more specific, checked against the only real consumer (`scripts/behavioral-eval/run.mjs`). Verified: `scripts/reinject.test.mjs` 14/14, `node scripts/reinject.mjs` exit 0 with all four laws present, all 10 repo suites PASS, `validate.mjs` and `eval.mjs` exit 0. Cost, stated honestly: no performance change (no build step; +236/−21 LOC); the injected block is ~3064 chars at every SessionStart, which is new standing context — see AGENTS.md §8.

### Added
- Installation docs: the [Claude Code] CLI section now carries the mechanical half (2026-09-21, same finding): installing the skills without the hooks leaves them inert on a harness whose session-start injection is hook-driven — the discipline floor only re-enters context if something puts it there. `docs/installation.md` §[Claude Code] CLI documents session-start floor injection via `scripts/reinject.mjs` (both router files, exit 1 on a half floor), per-prompt `mandatory-gate` classification, both placement shapes (local plugin via `.claude-plugin/plugin.json` + `hooks/hooks.json` + `enabledPlugins`, or direct `settings.json` hooks), the fail-open requirement that a discipline layer must never break session startup, and a post-install verification step. Teeth first: `eval.mjs` check 31 was written and verified RED with 4 errors before the docs changed (the section existed and mentioned neither hooks nor the scripts); exit 0 after. The check was proven non-decorative by removing the hook paragraph (2401 chars) and watching the identical 4 errors return, then restoring it. `docs/compatibility.md` porting-checklist item 9 now states the floor spans two files, the bare-CLI default, and the exit-1 contract; `AGENTS.md` §7 says the same.

## [0.1.16] - 2026-09-20

### Added
- Mandatory-gate — a mechanical pre-gate for MANDATORY skill routing (2026-09-20, full breakpoint → save-as → fork-it → make-it-so chain, owner-approved): `scripts/mandatory-gate.mjs` classifies task text (bilingual EN/ID keyword patterns, binary verdicts, zero dependencies) against the three MANDATORY domains (`expect-fail`, `root-cause`, `receipts`), closing the encode-twice gap for the trigger matrix — AGENTS.md §2 gains the paragraph (the why), the script plus its fail-first test are the check. Consumers: the ledger audit adds a `gated-loaded-gap` finding (WARN-level by contract — a keyword signal to verify, never proof; additive to M1's literal markers, bound by test K6) for a gated entry that carries no `Loaded:` line; doctor gains C8 (`gateVerdict` in `doctor-checks.mjs`), which runs the gate's self-test file as evidence — strict in repo mode, warn in adopter mode (the C2 lesson); CI runs both new self-tests. Fail-first throughout (classifier 33 checks, audit J-suite, doctor K-suite), three-axis roast findings fixed (domain-list import over duplication, boundary-matched keyword coverage, generic `expect` keyword dropped, CI wiring, warn-contract binding, C8 wiring test + audited-tree-execution documented). Spec with 10 falsifiable acceptance criteria: `docs/specs/mandatory-gate.md`. Provenance: the principle (mechanical enforcement over model initiative) is the framework's own — `docs/design.md` §Self-trigger is unreliable; original implementation, no external code reused.

## [0.1.15] - 2026-09-19

### Fixed
- Ledger audit no longer produces false signals on a real adopter ledger (2026-09-19, stress test against a 6-day / 71-commit project): running the audit against `ads-tracker/progress.txt` returned 67 findings + 127 coverage gaps on a healthy ledger — ~95% artifacts of the reader, not defects in the ledger. The reader had been built and tested against ONE writer shape; a second writer is in production, prescribed by adopter routers. Now fixed: **titled date headers** (`## 2026-09-19 — Rebrand X` — 131 of 144 headers in the real ledger carried a title the bare-only regex could not see); **flat entries** (a date header followed directly by bullets, no `###` heading — 43 such sections were invisible and their bullets leaked into the previous entry); **`Loaded:` lists** (`,` `;` `+` ` / ` all parse, so `- Loaded: expect-fail, root-cause, receipts` counts three skills instead of one — M4 was undercounting 5–8x: 126 bullets containing `receipts` counted as 16); **CRLF ledgers** (Windows adopters); and the same strict date regex in `checkStarve`, where it meant the corrective-tier grace clock never started on an adopter ledger. `docs/installation.md` gains §The ledger contract documenting both accepted shapes and both ledger locations, enforced by eval check 29.
- M3 (context-gap) fires on owner-supplied feedback instead of on the word "screenshot" (2026-09-19): the trigger was a bare `screenshot|mockup|diagram` match, and `screenshot` sat in BOTH the M2 rendered-evidence list and the M3 trigger list — so an entry that *provided* rendered evidence was accused of skipping confirmation. On the real 6-day ledger it fired 60 times with zero owner-attributed entries. Attribution is now required, by line proximity rather than mere co-presence: the rule was derived empirically (bare word: 60 flagged, all false; any owner/master title in the entry: 14 flagged, all false on inspection; attribution adjacent to the artifact on one line: 2 flagged, both genuine — and the canonical `Owner screenshot showed the collision` fixture still fires). A request FOR an artifact ("need a screenshot ... from the owner" [translated]) is excluded, verified load-bearing by neutralizing it (2 → 1 context-gap).
- Doctor reads the project it is actually checking (2026-09-19, found by running it against a real adopter): it FAILED on `core.hooksPath` in a project installed exactly as the README documents, and it hardcoded `.trust/progress.txt` while the adopter convention is `progress.txt` at the root — so the audit never ran on the ledger it exists to check. Doctor now derives its mode (repo vs adopter): repo mode keeps the strict hook contract, adopter mode checks for any hook and never fails there, while a *set* `hooksPath` pointing at an empty dir is a warning rather than a false PASS. Ledger resolution reports when two ledgers exist and one shadows the other, and each audit line names the file it read. Finding output is grouped by kind with entry dates — the first live adopter run printed 18 warning lines that buried the two real signals.

### Added
- `scripts/doctor-checks.mjs` (2026-09-19): `hookVerdict` / `pickLedgerPath` / `blindSpotWarning` extracted as pure functions so doctor's decision logic is testable without its CLI side effects (the `corrective-tier.mjs` pattern). `blindSpotWarning` gives M4's `stats.mandatoryMentions` its first consumer — the anti-blind-spot stat had been computed and read by nobody since it was introduced, the exact silent-failure mode AGENTS.md §5 names; eval check 30 now fails if the call is removed. `formatFindingGroup` lives in `ledger-audit.mjs` beside the messages it formats.

## [0.1.14] - 2026-09-13

### Added
- Scheduled update-check reminder (2026-09-13, full save-as → fork-it → make-it-so chain from owner request): an opt-in OS-level weekly check that turns release detection into a working reminder on every user's machine — `node scripts/update-check-cli.mjs install` registers a Monday-09:00 task (Windows Task Scheduler toast, macOS launchd plist, Linux cron), the check compares the upstream CHANGELOG's highest version against every `.trust/tna-version` stamp under the configured projects root (default `~/projects`, overridable via `--projects-root`; upstream source overridable via `--upstream-url`), writes the report to `update-check.log`, and notifies **only when an install is stale** (all-current and fetch-failure runs log silently). Detection-only by constraint: nothing in the chain ever installs skills or stamps versions. The router's update-reporting obligation now also fires when a session starts on a Monday or when the log names stale installs: the agent opens with the version delta + CHANGELOG entries + consent question, then waits. Config is validated at the trust boundary (https-only URL, no quote/substitution/newline characters) before reaching any scheduler command. Spec with 11 falsifiable acceptance criteria: `docs/specs/scheduled-update-check.md`; fail-first tests at pure-function seams (`scripts/update-check.test.mjs`, `update-delivery.test.mjs`, `update-install.test.mjs`, doctor.test.mjs pattern); three-axis roast findings (incl. a `file://` URL that broke node under the Windows Task Scheduler and nested PowerShell quoting) fixed and verified live (`schtasks /Run` → `LastTaskResult 0`). Uninstall: `node scripts/update-check-cli.mjs uninstall`.

## [0.1.13] - 2026-09-12

### Added
- Breakpoint question-delivery contract (2026-09-12, owner standing order): every user-facing question is delivered through the harness's interactive question mechanism — structured prompt, options, one recommended default — when the harness provides one; the numbered `➡️` list is the documented fallback on harnesses without it. Content contract is identical in both channels (one frontier per round, every question carries a recommendation, user confirmation resumes execution). Enforced by eval check 28 (HARD), verified fail-first.

### Fixed
- Ledger audit blindness closed (2026-09-12): `ship-log` wrote no per-entry date header while `scripts/ledger-audit.mjs` and `scripts/corrective-tier.mjs` parsed `## YYYY-MM-DD` from inside the ledger — so every real ledger audited as vacuously clean (zero findings because zero entries parsed, indistinguishable from a genuinely clean ledger), and the audit's own test asserted the wrong premise ("matches the ship-log format the repo actually writes: a date header"). The writer now emits a `## <YYYY-MM-DD>` header per entry (invariant enforced by eval check 27, HARD); the parser is entry-based and reports undated entries as coverage gaps (`unprovable`) instead of silently dropping them — "blind" is now distinguishable from "clean"; the doctor's ledger verdict is three-valued (`clean` / `findings` / `unprovable`), still WARN, extracted as testable `ledgerVerdict`. Fail-first: the undated-entry fixture was observed failing (no `gaps` field) before the parser change and passing after.

## [0.1.12] - 2026-09-10
- Release of the behavioral-eval batch: router re-injection guard, behavioral eval tier + two recorded runs, and the chat-receipt skim test (all detailed under the dated entries below). Tag tracks master head per standing Ruling.
- Router re-injection guard (2026-09-10): `scripts/reinject.mjs` derives the router's discipline floor (Iron Laws + MANDATORY section) from the live AGENTS.md — the injected block cannot drift from the rules it re-injects — and prints it for re-injection after compaction/resume on harnesses that drop AGENTS.md (fail-open CLI; harnesses without hooks re-print it by hand). Router §7 rule + porting-checklist item 9 landed; fail-first tested by `scripts/reinject.test.mjs`, wired into pre-commit.
- Behavioral eval tier (2026-09-10): `scripts/behavioral-eval/` — the second tier of proof the static checks cannot provide (they prove rules exist; this proves rules change behavior). Weighted 11-dimension rubric with a mandatory `error-causal-honesty` anti-fabrication dimension, condition-blind judge template, 10 scenario cases, offline validator (`behavioral-eval.mjs`) fail-first tested, and an env-driven external runner (`run.mjs`, any Anthropic-compatible endpoint) with per-trial A/B label shuffling, lenient judge-JSON parsing, and transcripts archived before judging so judge failures never burn responder output.
- First behavioral eval results (2026-09-10, `RESULTS.md`): two full runs (10 cases × 2 conditions × 3 trials, GLM judge). Weighted delta **+0.445** both runs (4.078→4.522; 4.113→4.558); win rate 20/29 → 22/30 after fixes. Gains concentrated in framework-core dimensions: test-first +1.7–2.4, spec-gate +1.1–1.6, error-causal-honesty +1.0–1.1, state-restatement +1.1, completion-honesty +0.7–0.9. Run 1 regressions (tangent-suppression −1.93, artifact-target −0.41) were fixed in the candidate prefix and verified closed/improved by the run 2 re-run; the residual rubric-vs-shape tension is recorded, not re-weighted away.
- Chat receipt skim test (2026-09-10): a receipt is built to be read at a skim — a reader who reads only the first and last line must know what just happened and what happens next; "want me to X?" is a hanging offer, not a Next. Enforced mechanically by eval check #26.

### Fixed
- Update detection bootstrap gap (found by live testbed test 2026-09-09: an install without `.trust/` produced no detection — the remind happened only because the user asked): an unstamped install now reports level `unstamped` — "detection cannot tell stale from current, stamp it now" — instead of the false-positive "update available"; stamping the version is documented as part of every install path, not an update-time afterthought; and the Updating section states the honest limit that router prose does not propagate by re-install — rule updates are a user-reviewed re-merge.

### Added
- Update detection + user-approved updates (2026-09-09): doctor check C6 compares the installed version stamp (`.trust/tna-version`) against the upstream release and warns when skills are stale or unmarked; `checkStale` in `corrective-tier.mjs` (fail-first tested in `doctor.test.mjs`, 5 expectations). AGENTS.md §6 obliges the agent to report an available update to the user and ask before re-running the install — detection is mechanical, the update is the user's decision. `docs/installation.md` gains an "Updating" section (detect → model proposes → user approves → re-install + stamp).
- Approval-gate audit pass (2026-09-09): gates implied by Iron Law 4 but never stated are now explicit — de-adoption and global-dir skill edits are user decisions (installation.md); spec publish to the issue tracker waits for the user's spec approval (save-as); ticket publish to a real tracker rides the breakdown sign-off, and parallel-worktree merges route through make-it-so's dry-run gate (fork-it); receipts gains the "verification is not authorization" red flag (commit still needs human sign-off); rule-inheritance states entry is user-decided ("a rule that lands without sign-off is smuggled, not inherited"); agent-run greenfield install requires explicit approval. Found by a read-only audit subagent against the philosophy; the eval.mjs memory-modes check caught and forced alignment on the ship-log promotion wording.
- Ledger audit gates (2026-09-09, evaluation-driven, all fail-first): `scripts/ledger-audit.mjs` (+ 20-expectation test, wired into doctor C7 and the pre-commit hook) mechanically audits the private ledger — M1 flags domain-relevant entries missing the `Loaded:` audit-trail line, M2 flags site/ changes verified by string-match instead of rendered evidence, M3 flags fixes from owner visual feedback without a literal `Context confirmed:` restatement, M4 computes per-skill Loaded: counts (the 47-receipts-vs-0 blind spot made countable), M5 flags 2+ reverts on one target within 14 days as the Iron-Law-1 churn signature. Eval checks #22-25 guard the wiring plus two new router §6 rules (rendered evidence; owner feedback is a context to confirm) and the ship-log `Context confirmed:` line; 3 rule-inheritance register rows landed.
- Porting checklist in `docs/compatibility.md` (2026-09-09): 8 harness-specific failure modes hit on real harnesses (cwd drift, bg-registry loss, mid-session skill invisibility, flatten-on-install, worktree-provisional ledger, pristine fixtures, exit-0-is-not-a-receipt, environment-vs-installation degradation), each with origin — adopters on a new harness walk the list before diagnosing anything new.

## [0.1.11] - 2026-09-09
- Release of the 2026-09-09 evaluation batch: ledger audit gates (M1-M5), the two router §6 verification rules, the ship-log `Context confirmed:` line, eval checks #22-25, and the portability checklist (all detailed under [Unreleased] above). Tag tracks master head per standing Ruling.
- Skill-load audit trail (external-eval finding 2026-09-09, ads-tracker testbed): ledger entries for work in a MANDATORY skill's domain now carry a `Loaded: <skill>` line (AGENTS.md §2 + ship-log log format), turning self-trigger discipline into a countable fact — previously compliance was indistinguishable from a dead skill (0 Ruling lines, ~5 skill mentions across 79 sessions).
- De-adoption section in `docs/installation.md`: how to retire skills and old routing (remove files from every install location, clean the router, verify no references remain, log the retirement) — closing the gap where a pre-adoption skill chain survives in a global dir and resurrects weeks later.
- Precedence note (global vs project-local skills) in `docs/installation.md`: same-named skills in both locations change behavior with no repo diff; one skill, one location per project; global dir treated as shared infrastructure.

### Changed
- Adoption step 3 (name mapping) now states its premise — a mapping only lives while the name resolves; dead names are dropped, with a post-adoption sweep added as merge step 6 (every skill name the router cites must resolve in a discovered registry).
- `Ruling:` format lightened (AGENTS.md §4 + ship-log §Rulings): the two-part `Ruling: <decision> — <why>` is the default; the three-part cost-if-wrong form reserved for weighty calls. Origin: 79 sessions produced 0 Ruling lines — a ceremony nobody performs dies silently.

## [0.1.9] - 2026-09-06

### Added
- Interactive adoption interview in `docs/installation.md`: before any merge into a project that already has a router, the agent asks four questions (existing router?, what it covers — with the overlap audit performed by the agent, skill location, name mapping), presents a merge plan, and waits for explicit confirmation before writing a single line.
- Merge-safety guarantees section ("Why this cannot break your existing router"): the project's router stays the only router, overlapping rules are skipped rather than duplicated, skills land as new files in their own directory (name collisions surfaced in the interview, never silently overwritten), and the whole adoption is reversible via `git diff` / `git checkout`.
- README install section now states the adoption safety contract inline: guided interview → merge, not a copy → additive, reversible, no overwrite of the existing setup.

## [0.1.8] - 2026-09-06

### Added
- AGENTS.md §3 proposal-handoff rule (commit `863d9fb`, eval check #19): after every chain stage and every unit of work the model proposes the concrete next step — skill by name, why now — and waits for approval, so a user-invoked chain never stalls because the user didn't know the next skill.
- AGENTS.md §1 registry-check rule (commit `f7ac9bb`, eval check #20): "`fast` skips the chain, never the registry" — before answering any task, the skill registry is checked once and a matching skill (the framework's own or an external one) is proposed by name regardless of class. Origin: designed probe (2026-09-06, 4 runs) — fast-classified requests never considered the registry (2/2 recurrence); results in `evals/live-results.md`.
- README restructured for focus (~219 → ~149 lines): the per-skill chain bullets, Contributing detail, and Portability duplication moved/linked to CONTRIBUTING.md and docs/; the differentiator table gains memory-tiers, rule-inheritance, real-data-UI, and lazy-by-default rows; classification now carries the registry-check rule.
- `evals/self-trigger-battery.md` — standalone protocol for scenario 13 (`evals/scenarios.md` S13): tests whether fresh agents load MANDATORY discipline skills unprompted across harnesses (OMO, DSH, Pi, Codex, Claude Code, ZCode). Includes pre-flight checks, launch procedure (9 runs per harness), grading rubric, and anti-manufacture rules to ensure honest evaluation of self-triggering capability.
- `scripts/doctor.mjs` C5 raised from WARN to grace-then-HARD (user-approved 2026-09-06): a ledger with entries but no `.trust/lessons.md` warns during a 14-day grace period measured from the oldest dated entry (ship-log `## YYYY-MM-DD` headers), then FAILS with exit 1 — after grace, lesson capture is mandatory, not optional. Decision logic extracted to `scripts/corrective-tier.mjs` (`checkStarve`, testable without doctor's CLI side effects); a ledger with no parseable dates degrades to WARN. Test override: `TNA_DOCTOR_GRACE_DAYS`.
- `scripts/doctor.test.mjs` — fail-first self-test for the grace logic (7 expectations: warn/fail boundary, lessons-exists, no-dates, empty ledger). Wired into CI (validate + windows jobs) and pre-commit; the contributing gate list grows from three to four commands.
- AGENTS.md trigger-matrix row (commit `ebf3a3c`): an external skill proposed by the registry check opens `docs/skill-vetting.md` — audited BEFORE the user's approval — closing the gap where the checklist existed but nothing in the always-read router pointed to it.
- `docs/skill-vetting.md` — red-flag response ladder (commit `976a87a`): refuse approval first, ask the publisher (or the proposing agent) to explain, continue only on an explanation that holds; unexplained, the rejection is permanent — deleting the skill from disk stays the user's call ("a gate refuses, it does not remove"). Two red-flag categories added — data exfiltration beyond credentials, persistence and side channels — bringing the list to six.

### Changed
- `evals/self-trigger-battery.md` — S13 result framing reworded to the honest outcome (commit `976a87a`): "No harness passed S13. OMO alone ran the battery to completion - and scored TRIGGER 0/9 twice, a real failure signal, not an incomplete run"; a battery another harness could not run is never recorded as a pass.

## [0.1.7] - 2026-09-06

### Added
- `scripts/corrective-tier.mjs` — corrective tier starvation check for doctor.mjs C5
- `scripts/doctor.test.mjs` — fail-first test for doctor C5
- `evals/self-trigger-battery.md` — standalone protocol for scenario 13 self-trigger battery

### Changed
- `scripts/doctor.mjs` — C5 now enforces corrective tier with a 14-day grace period before failing; uses checkStarve from corrective-tier.mjs; added TNA_DOCTOR_GRACE_DAYS test override
- `evals/scenarios.md` — updated S13 description to clarify battery completion steps and added note about updating three places when a battery completes

### Removed
- README — the "What 'verifiable' means", "What 'reviewable' means", and
  "What 'honest' means" sections from 0.1.6 are reverted after user review.
  The trio keeps its one-line mention in the intro; the depth stays in
  [docs/philosophy.md](docs/philosophy.md) and The honest limits section.

## [0.1.6] - 2026-09-05

### Added

- `docs/chat-receipt.md` — the 4-block chat receipt (Verdict / Evidence /
  Open / Next) closing every `full`/`loop` unit in chat, recorded in
  `docs/rule-inheritance.md` as the router's first gated rule (§6).

### Fixed

- `docs/chat-receipt.md` — the Evidence block no longer demands a visible
  fail-first cycle for non-behavioral units (docs, config, typo): provide
  existence/exit-code evidence instead; inventing a FAIL to fill the template
  is forbidden.
- `AGENTS.md` §6 — receipt duty scoped to `full`/`loop` units; `fast` units
  skip the ceremony (classification precedes the chain), matching the
  "don't run the full ceremony on a typo" principle.
- `evals/live-results.md` — binding grading note added: the ZCode round's A3
  PASS covers behavior only; narration that invents user sanction is a defect
  to flag, never a grading precedent.

### Changed

- README — "verifiable" is now shown, not just named: a one-line concrete
  definition ("every 'done' ships with the command, the output, and the exit
  code from this session — if you can't re-run it, it isn't done") plus a
  side-by-side claim-vs-evidence section ("What 'verifiable' means") placed
  right after the philosophy one-liner.
- README — "reviewable" gets the same treatment: a "What 'reviewable' means"
  section with a without/with contrast (wall-of-diff vs scoped, AC-bound,
  severity-labeled review) and a sample interview dialog showing decisions
  arriving to the user as questions.
- README — "honest" completes the trio: a "What 'honest' means" section that
  points back at the receipt's own Open line as the proof ("nothing forced
  that line to exist"), a gate-semantics line, and the self-applied twist —
  the framework states its own limits (The honest limits).

## [0.1.5] - 2026-09-04

### Added

- `scripts/doctor.mjs` — installation self-check for adopters: verifies router
  files present, `core.hooksPath` active with both hooks (and identical to the
  tracked copies when run from a clone), all 11 skills reachable from a harness
  discovery path (repo, project-local, or `~/.agents/skills`), and `.trust/`
  gitignored once the ledger exists. Exit 0 = healthy, exit 1 = gaps named with
  their fix. Pointed to from `docs/installation.md` §Post-install verification.
- CI: a `hooks` job exercises pre-commit + commit-msg on a scratch repo
  (valid commit passes, non-conventional message is rejected) and a `windows`
  job runs both gates on Windows — hooks can no longer rot silently, and the
  Windows dev surface is covered.
- `evals/scenarios.md` scenario 13 — rerunnable self-trigger battery for the
  MANDATORY skills: 3 tasks × 3 runs per harness, nothing pinned, graded on
  whether the skill is actually *loaded* (not on correct behavior from general
  judgment). Includes a self-trigger evidence log with the original 0/3 claim
  rows and a pending row for ZCode as the third harness.
- `docs/compatibility.md`: ZCode row (live audit 2026-09-03, 4 parallel
  dimension reviewers) + Evidence column distinguishing doc-verified from
  live-executed rows + ZCode adapting note (skills discovered at session start;
  mid-session installs need a reload).
- `scripts/tickets.mjs` + `scripts/tickets.test.mjs` — mechanical ticket-graph
  validator for `fork-it` local tickets (`.trust/<slug>/issues/`): blockers
  resolve, numbering stays blockers-first, graph is acyclic (Kahn). Wired into
  CI (validate + windows jobs), pre-commit, and the `fork-it` publish gate.
- `scripts/eval.mjs` checks 13/14/15 (HARD) — canonical large-feature chain
  identical across WORKFLOW.md, AGENTS.md, docs/skills/README.md, root README;
  trigger-matrix large-feature row bound to the chain; `fork-it` publish gate
  marker present. Closes all 3 Required findings of the 2026-09-03 omx audit.

### Fixed

- `scripts/validate.mjs` check 7 — the mirrored `docs/skills/` pages are now
  walked for stale backtick skill references; the pre-existing `walkFiles`
  helper finally has a call site (it was dead code). Skill-shaped tokens only,
  so code identifiers (`relay.ts`, `ECONNRESET`) are not false positives.
- `scripts/eval.mjs` check 6c (HARD) — each MANDATORY skill must carry its own
  Iron Law sentence inside its own SKILL.md body, not just be named in the
  router trigger matrix. Proven non-tautological: stripping an Iron Law fails
  eval with exit 1.
- Trimmed skill descriptions (`no-thanks`, `expect-fail`, `save-as`) —
  editorial content and redundant trigger lists removed; trigger-pure per §8
  (context is a budget), YAML quoting preserved.

## [0.1.4] - 2026-09-03

### Fixed

- `.omx/` (orchestrator runtime dir) is now gitignored and excluded from the
  validator's file walk, so runtime junk cannot leak into commits or confuse
  the backtick-reference scan.
- `CHANGELOG.md` is no longer gitignored — the contributing contract requires
  updating it, which was impossible while it was ignored.
- `make-it-so` repair loop: the cap is now unambiguously a hard two-round
  stop (previously the "continue while improving" clause contradicted the cap
  and the mirror doc).
- `roast-my-code`: added a serial fallback for harnesses whose delegation
  tool cannot spawn three parallel subagents — the same axis briefs run
  sequentially in fresh contexts, preserving the context-isolation goal.
- `docs/installation.md` skill-folder count corrected to 11 (was "12"), and
  `docs/compatibility.md` OMO setup now includes `root-cause` in the
  model-invoked list (it was the one skill missing from both lists).

### Notes

- This release applies the first batch of findings from a full read-only audit
  of the repo (skills / workflow-router / harness / graph-loop dimensions).
  Remaining audit findings (enforcement depth, docs cleanup, description
  trims) land in subsequent patch releases.

## [0.1.3] - 2026-09-02

### Added

- Dedicated contributing guide (CONTRIBUTING.md), linked from the README, with
  the repo tree and hook activation instructions.

### Changed

- README: core-loop section reformatted as bullets; contributing bullets
  tightened (hook command inlined, then restored as a code block).

## [0.1.2] - 2026-09-02

### Added

- Live eval results for the tier A-D scenario suite (10/10 pass) recorded in
  `evals/live-results.md`.

## [0.1.1] - 2026-09-02

### Fixed

- Pre-commit and commit-msg hooks are committed executable (100755).

### Changed

- CI actions (checkout, setup-node) pinned to full SHAs.
- README notes the npx supply-chain verification step before install.
- commit-msg hook documented as a quality gate, not a security boundary.

## [0.1.0] - 2026-09-02

### Added

- Initial public framework: AGENTS.md router, WORKFLOW.md core rules, 11
  skills across discipline/engineering/meta tiers, validator + eval scripts,
  git hooks, CI, and full docs (design, philosophy, installation,
  compatibility, rule-inheritance, per-skill pages).

[Unreleased]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.41...HEAD
[0.1.41]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.40...v0.1.41
[0.1.40]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.39...v0.1.40
[0.1.39]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.38...v0.1.39
[0.1.38]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.37...v0.1.38
[0.1.37]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.36...v0.1.37
[0.1.36]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.35...v0.1.36 
[0.1.35]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.32...v0.1.33
[0.1.32]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.22...v0.1.23

[0.1.22]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.20...v0.1.21
[0.1.17]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.13...v0.1.14
[0.1.12]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.9...v0.1.11
[0.1.9]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.7...v0.1.8
[0.1.20]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.17...v0.1.18
[0.1.13]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.12...v0.1.13
[0.1.7]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nadiwerk/trust-no-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nadiwerk/trust-no-agent/releases/tag/v0.1.0
