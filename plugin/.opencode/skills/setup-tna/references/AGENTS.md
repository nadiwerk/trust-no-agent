# trust-no-agent — AGENTS.md (the router)

Rules every agent session follows. Detail lives in WORKFLOW.md and the skills; this file decides **when** each one loads. Provenance for every rule (origin, rationale, undo): `docs/rule-inheritance.md` — the router carries rules, not stories.

## 1. Classify before anything

- `fast` — one step, verifiable at a glance → answer/do directly. No mechanism.
- `full` — 2-4 steps, one verifiable deliverable → short todos + verification.
- `loop` — multi-stage / multi-file / spans many turns → full chain, verify each stage.

**If it can't be checked at a glance, it isn't `fast`.** Skipping verification to save effort is the bug this workflow exists to prevent.

**Writing tests is never `fast`.** A test-writing task is always `full` or `loop` — a test that "passes immediately" is exactly the tautological anti-pattern `expect-fail` exists to catch (docs/design.md §The residual gap).

**`fast` skips the chain, never the registry.** Before answering any task, check the skill registry once: if a skill matches — trust-no-agent's own or an external one — propose it by name and wait for approval, regardless of class.

**Fresh-install signature → propose setup-tna (mandatory recommendation).** When this session's project has the framework's skills installed but the router (AGENTS.md at the project root) or the onboarding stamp (.trust/onboarding.json) is missing, the agent MUST propose running the setup-tna skill before doing other work — a half-installed framework underperforms silently. The model proposes; the user approves — never install without consent (Iron Law 4).

## 2. Trigger matrix

| Situation | Load |
|---|---|
| Large feature about to start (at least 2 of: 3+ files, >30 min, new logic) | `breakpoint` — runs the canonical chain (WORKFLOW.md rule 2; variant: `scribe` when decisions should be recorded as ADRs/glossary) |
| User wants to stress-test a plan | `breakpoint` |
| Conversation converged, need a written spec | `save-as` |
| Spec ready, need tickets | `fork-it` |
| Tickets approved, time to build | `make-it-so` |
| Writing tests / building test-first | `expect-fail` **MANDATORY** |
| Bug / test failure / unexpected behavior | `root-cause` **MANDATORY** |
| Before any "done" claim, commit, or PR | `receipts` **MANDATORY** |
| Review requested / changes since a fixed point | `roast-my-code` |
| Review feedback received (from anyone) | `no-thanks` |
| A ticket/feature finished | `ship-log` |
| External skill proposed (registry check hit an outside skill) | open `docs/skill-vetting.md` — audit BEFORE the user's approval |

Check this table **before responding**, including before asking clarifying questions. If there is even a 1% chance a skill applies, load it. One invariant: a user-invoked skill is invoked by a human only — it may load model-invoked skills, but never another user-invoked one. When delegating, skills reach subagents only via the delegation tool's skill-loading parameter — an unloaded skill is a dead skill.

**Engagement criteria (mechanical, not felt).** The chain engages when ANY of these holds — decided by counting, never by mood: the task touches **more than one file**, or crosses a **function boundary other code calls**, or carries a **design/architecture choice**, or is a **bug whose cause is not yet known**, or spans **more than one exchange** with the user. Anything smaller proceeds directly and is verified on its real artifact. `fast` is a classification made by these criteria — never a mood, never an excuse to skip verification.

### MANDATORY discipline skills — no self-trigger, no exception

Three skills are **MANDATORY**, not advisory (self-trigger proven unreliable — evals 0/3; docs/design.md §Self-trigger is unreliable):

- **`expect-fail`** — load before writing any test or any production code that changes behavior. No production code without a failing test first.
- **`root-cause`** — load before proposing any fix for a bug, test failure, or unexpected behavior. No fixes without root-cause investigation first.
- **`receipts`** — load before accepting any "done"/"shipped"/"fixed" claim, before committing, or before creating a PR. No completion claims without fresh verification evidence.

These three are the Iron-Law gates. If a task triggers one, load it — do not rely on the description alone, do not "respond on the merits." `scripts/eval.mjs` verifies this section stays present; dropping it fails CI.

**Mechanical boundary (mandatory-gate).** `scripts/mandatory-gate.mjs` classifies task text (bilingual EN/ID, keyword patterns, binary verdicts) against the three MANDATORY domains — a keyword signal to verify, never proof. Spec and provenance: `docs/specs/mandatory-gate.md`.

**Audit trail for MANDATORY loads.** Every ledger entry for work in a MANDATORY skill's domain carries a `Loaded: <skill>` line naming the skill actually loaded — without the line, compliance is indistinguishable from a dead skill; a domain-relevant entry missing it is a visible gap (audited by `scripts/ledger-audit.mjs` M1, surfaced by doctor C7).

## 3. The chain (for `loop`-class work)

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Rules:

- Breakpoint → spec → tickets happen in **one unbroken context window** — implementation needs the verbatim reasoning, not a summary.
- **Upstream spec gate (class `loop` only):** No fork-it without executable acceptance criteria — a spec that cannot be tested cannot be decomposed. Verification proves behavior, not intent; `fork-it` refuses to slice a spec without them.
- Each ticket execution starts **fresh** — the previous ticket's context is disposable.
- Work the **frontier**: any ticket whose blockers are all done.
- **The model proposes, the user approves — never a dead end.** After every chain stage (and every unit of work), the agent must offer the concrete next step — skill by name, why now — and wait.

## 4. Division of labor (every session)

- **Facts are the agent's job** — look them up in the codebase, don't ask.
- **Decisions are the user's job** — put each one to the user and wait.
- Any decision the agent makes on its own gets a `Ruling:` line in the ledger — the lightweight form `Ruling: <decision> — <why>` is the default; the full `— <cost if wrong>` form for weighty calls (see `ship-log` §Rulings).

## 5. Delegation discipline

Every subagent prompt MUST carry:

```
Repo rules: (1) every file change is verified (typecheck/test/error output) before it's called done. (2) No refactoring outside the requested scope. (3) No touching files outside the allowed path list.
```

…plus the 6 sections: **TASK / EXPECTED OUTCOME / REQUIRED TOOLS / MUST DO / MUST NOT DO / CONTEXT**.

Every brief also binds its execution window:

```
VERIFY: <exact command — not "run the tests", the literal command line>
TIMEBOX: <minutes> — wall-clock budget for the delegate
PARTIAL: <what to return if the TIMEBOX expires — evidence so far, no new work>
```

**Aggregate-report gate.** A delegated report that does not record (a) the exact commit SHA(s) it verified, and (b) the method each measurement used, is DROPPED — a **gap in the report never counts as a pass**. Unverifiable results are reported as unverifiable — never folded into an aggregate "success".

Filled example:

```
VERIFY: node scripts/eval.mjs
TIMEBOX: 10 minutes
PARTIAL: returns the ERROR lines printed so far and stops — no edits beyond the stated scope
```

Subagent results are verified by the orchestrator — a report is a lead, not evidence. A verifier that cannot determine an outcome reports `uncertain` with a one-line reason. Parallel writers get one git worktree each; read-only parallel work runs without them.

**Load the MANDATORY skills into every delegation that touches their domain.** A delegation that writes tests or behavior-changing code MUST carry `load_skills: ["expect-fail"]`; one that will fix a bug or diagnose a failure MUST carry `load_skills: ["root-cause"]`; one that will claim done or commit MUST carry `load_skills: ["receipts"]`. On a harness whose delegation tool lacks `load_skills`, the inline procedure carries a `Loaded: <skill>` line and the delegation prompt carries it too — an unloaded skill is a dead skill.

**Enforcement is an adapter matrix, not one API.** No single harness API carries enforcement. One adapter per harness, same boundary (irreversible actions need sign-off plus fresh evidence; words alone never gate): OMO carries `load_skills` on delegation; opencode carries the tool.execute.before deny-by-throw veto plus the execute.after evidence recorder (`.opencode/plugins/tna-gate/`, evidence in ctx.storage with the project's `.trust/` copy read-preferred); Claude Code and Codex carry the PreToolUse hook veto (`plugin/hooks/hooks.json`, `plugin/hooks/codex.hooks.json`, same state file). Harnesses without a live veto proof stay doc-first WARN — see the veto vs audit-only table in docs/compatibility.md. Where no adapter can run, the inline `Loaded:` fallback is the only layer, and its gap stays countable, never silent.

The routing graph itself is part of the contract:

- **Rule inheritance** — accepted review findings become 1-3 permanent lines in this router before the work is logged; gated, scoped, reversible — `docs/rule-inheritance.md` before a rule lands. Where a rule can be checked mechanically, encode it twice: prose for the why, a mechanical check for the boundary.
- **Edges are free** — deduplication, merging, and ranking of subagent results are deterministic orchestrator steps, never extra subagents. Agents are for judgment; don't pay tokens for wiring.
- **Audit fake dependencies** — before running a chain stage, ask: does the next stage actually consume the previous stage's output? If not, run them in parallel — never queue work just because it was written down in order.

## 6. Verification commands

Each project declares its proof commands in its own AGENTS.md (typecheck / test / lint / build / browser-with-real-data). Until declared, derive them from `package.json` scripts and say so. See the `receipts` skill for the gate function.

Close every `full`/`loop` unit in chat with the 4-block receipt — Verdict / Evidence / Open / Next — shape: `docs/chat-receipt.md`. `fast` units skip the ceremony (classification precedes the chain). A receipt missing any block is a partial receipt: it proves nothing.

**Update reporting (framework installs).** When a doctor check or any version check shows the installed trust-no-agent skills are stale: report the delta + relevant CHANGELOG entries, ask whether to update, and wait — re-running the install without an explicit "yes" is an unauthorized write to a shared skill dir (Iron Law 4). With the opt-in scheduled check installed, the same obligation fires when the check's log names stale installs.

Rules inherited from eval findings (origins, rationale, undo: `docs/rule-inheritance.md` register):

- **Narration claims are graded as claims.** Every narration claim needs its own artifact — a promotion claimed requires the ADR file on disk, a user sanction claimed requires it to have actually happened.
- **Ad-hoc verification never earns SHIPPED.** Verification outside the repo (scratch probes, uncommitted runs) is at most `IMPLEMENTED-UNVERIFIED`; `SHIPPED` requires the committed fail-first test plus a fresh run in-session.
- **Verify the artifact the user reads, never a proxy.** A claim about a rendered page/site is verified live (curl the deployed URL, open the page); a claim about committed content is verified via `git show`. A green receipt against the wrong target is a false receipt.
- **Rendered-output claims need rendered evidence** (screenshot/browser check of the actual render), **not a string match on the deployed source.**
- **Owner visual feedback is a context to confirm, not an order to execute.** Before fixing anything from a screenshot/diagram, restate what is seen — display context, the exact block, the symptom — as a `Context confirmed:` line, and let the owner correct it if wrong. Audited mechanically by `scripts/ledger-audit.mjs` (M3).
- **Reply shape: no preamble, no recap, no closers.** **Cap lists to 5 items** — beyond that, split into ranked groups. **Matter-of-fact errors** — an error is stated plainly: what failed, the evidence, the next step; no apologizing openers, no softening that buries the failure.
- **`Next: none` only when the whole thread is closed.** Every close carries one concrete forward arrow in the owner's terms — a named action (which skill, why now) or the one decision the owner owns; "want me to X?" is a hanging offer, not a Next. Mechanical twin: `scripts/ledger-audit.mjs` M7.

## 7. Ledger

Every completed unit of work is appended to the private ledger (`.trust/progress.txt`, gitignored) **before starting the next one** (the `ship-log` skill). Parallel writers: a worktree-local ledger is **provisional** — gitignored files do not survive `git worktree remove`; the canonical ledger lives in the coordinating checkout, and a ticket is not closed until its handoff lands there (see `ship-log`'s canonical-ledger contract). After a long pause, compaction, or fresh session: re-read todos + `progress.txt` + this file, state the next step — never resume from partial memory.

**Router re-injection (compaction/resume guard).** Where the harness drops AGENTS.md after compaction, the Iron Laws and the MANDATORY section fall out of context. The closure is mechanical: `node scripts/reinject.mjs` prints the router's discipline floor (Iron Laws + MANDATORY section, derived from the live router so it cannot drift from it) **from both router files** — a caller that hands it a single file's text gets the other half named NOT FOUND and exit 1 rather than a half floor that passes as complete. On harnesses with a session-start/resume/compact hook, wire the injection there; otherwise re-print the block by hand as the first act after compaction or resume. Tested fail-first by `scripts/reinject.test.mjs`.

## 8. Context is a budget (lazy by default)

The framework's entire standing cost is the skill descriptions — keep it that way:

- **Descriptions are the only always-on cost.** Keep them short and trigger-pure; a bloated description taxes every request, forever.
- **Reference material is never a skill.** Catalogs, checklists, and principle docs live in lazy-loaded files behind a one-line pointer, read only when the work calls for them. A skill costs on every request; a file costs only when read.
- **Depth goes in sub-files.** A skill stays a thin orchestrator and links to deep reference files that load only when that path is taken (`expect-fail` is the pattern).
- **One precise lookup beats many cheap ones.** Climb the lookup ladder — code index where the project has one (e.g. codegraph — see docs/omo-integration.md) → LSP/symbol-level search → grep-and-read loops last. Fastest available tool; same rule on every harness.
- **Everything added pays rent.** A new skill, MCP server, or router section must fill a gap we actually hit — its standing cost is weighed before it's added, not after.
- **References degrade, never hard-fail.** A mention that cannot be resolved degrades to its plain label (or the closest real one) and execution continues. Hard errors are reserved for references whose resolution is load-bearing (a gate, a merge base, a blocking ticket).
