# trust-no-agent — AGENTS.md (the router)

Rules every agent session follows. Detail lives in WORKFLOW.md and the skills; this file decides **when** each one loads.

## 1. Classify before anything

- `fast` — one step, verifiable at a glance → answer/do directly. No mechanism.
- `full` — 2-4 steps, one verifiable deliverable → short todos + verification.
- `loop` — multi-stage / multi-file / spans many turns → full chain, verify each stage.

**If it can't be checked at a glance, it isn't `fast`.** Skipping verification to save effort is the bug this workflow exists to prevent.

**Writing tests is never `fast`.** A test-writing task is always `full` or `loop` — never `fast` — because a test that "passes immediately" is exactly the tautological anti-pattern `expect-fail` exists to catch (evals: an agent classified a test task as `fast` and skipped the skill, writing a tautological test — evidence: docs/design.md §The residual gap). Classifying test-writing as `fast` is how the fail-first discipline silently drops.

**`fast` skips the chain, never the registry.** Before answering any task, check the skill registry once: if a skill matches — trust-no-agent's own or an external one — propose it by name and wait for approval, regardless of class. Probe evidence (2026-09-06, 2 runs): fast-classified teaching requests never considered the registry — correct-looking output from general judgment, matching skill never consulted; the same invisible-failure pattern as self-trigger, one layer earlier.

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

Check this table **before responding**, including before asking clarifying questions. If there is even a 1% chance a skill applies, load it. One invariant: a user-invoked skill is invoked by a human only — it may load model-invoked skills, but never another user-invoked one (that way lies an orchestration cycle). When delegating, skills reach subagents only via the delegation tool's skill-loading parameter — an unloaded skill is a dead skill.

### MANDATORY discipline skills — no self-trigger, no exception

Three skills are **MANDATORY**, not advisory. Self-trigger is proven unreliable (evals: 0/3 fresh agents loaded them when the scenario demanded it, even with explicit trigger words in the description — evidence and honest limits: docs/design.md §Self-trigger is unreliable). The discipline they encode is the framework's core, so it must not depend on the model choosing to load it:

- **`expect-fail`** — load before writing any test or any production code that changes behavior. No production code without a failing test first.
- **`root-cause`** — load before proposing any fix for a bug, test failure, or unexpected behavior. No fixes without root-cause investigation first.
- **`receipts`** — load before accepting any "done"/"shipped"/"fixed" claim, before committing, or before creating a PR. No completion claims without fresh verification evidence.

These three are the Iron-Law gates. If a task triggers one, load it — do not rely on the description alone, do not "respond on the merits." The mechanical check in `scripts/eval.mjs` verifies this section stays present; dropping it fails CI.

**Audit trail for MANDATORY loads.** Every ledger entry for work in a MANDATORY skill's domain carries a `Loaded: <skill>` line naming the skill actually loaded. Self-trigger is unreliable (0/3 in evals) and without the line, compliance is indistinguishable from a dead skill — the line turns discipline into a countable fact. A domain-relevant entry missing it means the skill was not loaded: either fix the gap or treat it as evidence the discipline silently dropped (eval finding 2026-09-09: components relying on runtime initiative fail silently; components backed by written artifacts work).

## 3. The chain (for `loop`-class work)

```
breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log
```

Rules:

- Breakpoint → spec → tickets happen in **one unbroken context window** — don't compact or clear between them; implementation needs the verbatim reasoning, not a summary.
- **Upstream spec gate (class `loop` only):** No fork-it without executable acceptance criteria — a spec that cannot be tested cannot be decomposed. Verification proves behavior, not intent; the gate forces testability upstream where intent is still cheap to fix. See `save-as` §Acceptance Criteria and §Adversarial self-review; `fork-it` refuses to slice a spec without them.
- Each ticket execution starts **fresh** — the previous ticket's context is disposable.
- Work the **frontier**: any ticket whose blockers are all done.
- **The model proposes, the user approves — never a dead end.** User-invoked skills are gated by approval, but proposing the next step is the agent's job: after every chain stage (and every unit of work), the agent must offer the concrete next step — skill by name, why now — and wait. The chain never stalls because the user didn't know what comes next; the arrow to the next stage is provided by the model, never left for the user to invent.

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

Subagent results are verified by the orchestrator — a report is a lead, not evidence. A verifier that cannot determine an outcome reports `uncertain` with a one-line reason; a forced choice is how silent corruption enters a project. Parallel writers get one git worktree each; read-only parallel work runs without them.

**Load the MANDATORY skills into every delegation that touches their domain.** Self-trigger is unreliable (evals: 0/3, see docs/design.md), so `load_skills` is the forcing function — the skill is placed in the subagent's context, not left to its choice. A delegation that writes tests or behavior-changing code MUST carry `load_skills: ["expect-fail"]`; one that will fix a bug or diagnose a failure MUST carry `load_skills: ["root-cause"]`; one that will claim done or commit MUST carry `load_skills: ["receipts"]`. On a harness whose delegation tool lacks `load_skills`, inject the skill's procedure inline into the prompt instead (an unloaded skill is a dead skill).

The routing graph itself is part of the contract:

- **Rule inheritance** — review findings that get accepted become 1-3 permanent lines in this router before the work is logged. Recurring failures inherit the same way: the fix lands as a rule, not as a story in the transcript. A review finding accepted today must guard every session from tomorrow; the system never runs on memory. Where a rule can be checked mechanically, encode it twice: prose for the why, a mechanical check (lint rule, hook, script, test) for the boundary — the guide explains the reason, the check enforces it. Rule entry is gated, scoped, and reversible — see docs/rule-inheritance.md before a rule lands (origin, rationale, scope, undo required; one-off noise and session lessons do not become rules).
- **Edges are free** — deduplication, merging, flattening, and ranking of subagent results are deterministic orchestrator steps, never extra subagents. Agents are for judgment; don't pay tokens for wiring.
- **Audit fake dependencies** — before running a chain stage, ask: does the next stage actually consume the previous stage's output? If not, run them in parallel — never queue work just because it was written down in order.

## 6. Verification commands

Each project declares its proof commands in its own AGENTS.md (typecheck / test / lint / build / browser-with-real-data). Until declared, derive them from `package.json` scripts and say so. See the `receipts` skill for the gate function.
Close every `full`/`loop` unit in chat with the 4-block receipt — Verdict / Evidence / Open / Next — shape: `docs/chat-receipt.md`. `fast` units skip the ceremony (classification precedes the chain). A receipt missing any block is a partial receipt: it proves nothing.

**Update reporting (framework installs).** When a doctor check (C6) or any version check shows the installed trust-no-agent skills are stale, the agent reports the update to the user — version delta + relevant CHANGELOG entries — and asks whether to update, then waits. Re-running the install without an explicit "yes" is an unauthorized write to a shared skill dir (Iron Law 4); detection is mechanical, the update is the user's decision (`docs/installation.md` §Updating).

Rules inherited from eval findings (origins, rationale, undo: `docs/rule-inheritance.md` register):

- **Narration claims are graded as claims.** Every narration claim needs its own artifact — a promotion claimed requires the ADR file on disk, a user sanction claimed requires it to have actually happened. Correct behavior paired with overstated narration is a defect to flag, never license (origin: A3 narration defect, recurring DSH/Codex/ZCode-1 rounds).
- **Ad-hoc verification never earns SHIPPED.** Verification outside the repo (scratch probes, uncommitted runs) is at most `IMPLEMENTED-UNVERIFIED`; `SHIPPED` requires the committed fail-first test plus a fresh run in-session (origin: D2 strict-reading precedent, 3/4 harnesses DSH/Pi/[CC] vs ZCode-loose).

## 7. Ledger

Every completed unit of work is appended to the private ledger (`.trust/progress.txt`, gitignored) **before starting the next one** (the `ship-log` skill). Parallel writers: a worktree-local ledger is **provisional** — gitignored files do not survive `git worktree remove`; the canonical ledger lives in the coordinating checkout, and a ticket is not closed until its handoff lands there (see `ship-log`'s canonical-ledger contract). After a long pause, compaction, or fresh session: re-read todos + `progress.txt` + this file, state the next step — never resume from partial memory.

## 8. Context is a budget (lazy by default)

The framework's entire standing cost is the skill descriptions — keep it that way:

- **Descriptions are the only always-on cost.** Keep them short and trigger-pure; a bloated description taxes every request, forever.
- **Reference material is never a skill.** Catalogs, checklists, and principle docs live in lazy-loaded files behind a one-line pointer, read only when the work calls for them. A skill costs on every request; a file costs only when read.
- **Depth goes in sub-files.** A skill stays a thin orchestrator and links to deep reference files that load only when that path is taken (`expect-fail` is the pattern).
- **One precise lookup beats many cheap ones.** Climb the lookup ladder — code index where the project has one (e.g. codegraph — see docs/omo-integration.md) → LSP/symbol-level search → grep-and-read loops last. Fastest available tool; same rule on every harness.
- **Everything added pays rent.** A new skill, MCP server, or router section must fill a gap we actually hit — its standing cost is weighed before it's added, not after.
- **References degrade, never hard-fail.** A mention that cannot be resolved — a skill name, file path, selector, or ticket reference that no longer exists or was never created — degrades to its plain label (or the closest real one) and execution continues; residual markers are scrubbed so unresolved tokens never reach the user or the next stage. Hard errors are reserved for references whose resolution is load-bearing (a gate, a merge base, a blocking ticket); everything else degrades gracefully, because a stalled pipeline over a missing footnote is the failure mode, not the missing footnote itself.
