# Research: external agent workflows vs. the TNA trust layer

A primary-source comparison of four popular agent workflow/skill repositories against the trust-layer philosophy of this project (`AGENTS.md`, `WORKFLOW.md`, `docs/design.md`). Every factual claim about the external repos is cited; findings from the first pass that were later verified are marked closed in place (no `unverified` items remain — see the Unverified section for the closure record).

- **Observation date:** 2026-10-20 (GitHub API for star counts, raw files for skill/workflow contents).
- **Sources:** each repo's README plus 3+ actual skill/workflow files read verbatim (not secondary write-ups).
- **Language note:** English, per `docs/` convention.

## TNA baseline (what we compare against)

Short recap of the position this document argues from (local sources):

- **Four Iron Laws** (`WORKFLOW.md` §3): no acting before shared understanding; no production code without a failing test; no completion claims without fresh verification evidence; no irreversible action without explicit human sign-off.
- **MANDATORY skills** (`AGENTS.md` §2): `expect-fail`, `root-cause`, `receipts` load mechanically via the router — self-trigger was measured at **0/3** in live-harness evals (`docs/design.md` §Self-trigger is unreliable), so enforcement is "encode-twice": prose for the why, a mechanical check for the boundary.
- **Delegation contract** (`WORKFLOW.md` §5): 3 repo rules + 6 prompt sections; reports are leads, not evidence.
- **Ledger** (`.trust/progress.txt`): private, gitignored, anti-compaction; agent-made decisions carry a `Ruling:` line with cost-if-wrong.
- **Classification** (`fast`/`full`/`loop`) scales ceremony to stakes; **four ground levels** (`docs/design.md`) order leverage: shape the ground > machine checks > words > human review.

---

## 1. obra/superpowers

**(a) Premise / philosophy.** "A complete software development methodology for your coding agents, built on top of a set of composable skills." Its stated philosophy is four bullets: TDD, systematic over ad-hoc, complexity reduction, and **"Evidence over claims — Verify before declaring success"** ([README, Philosophy](https://github.com/obra/superpowers/blob/main/README.md)).

**(b) Workflow — how a task flows.** A fixed 7-stage pipeline ([README, The Basic Workflow](https://github.com/obra/superpowers/blob/main/README.md)):

1. `brainstorming` (before anything is built) → 2. `using-git-worktrees` (isolated branch, clean test baseline) → 3. `writing-plans` (tasks of 2–5 minutes, each with exact file paths + verification steps) → 4. `subagent-driven-development` or `executing-plans` → 5. `test-driven-development` (RED-GREEN-REFACTOR; deletes code written before tests) → 6. `requesting-code-review` (critical issues block progress) → 7. `finishing-a-development-branch`.

The deepest flow is [`subagent-driven-development`](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md): fresh implementer subagent per task → mandatory dual review (spec compliance **and** code quality) → capped fix loop (5 rounds; rounds 4–5 escalate the model) → scoped re-review per round → final whole-branch review on the most capable model. Progress lives in a per-plan ledger file (`.superpowers/sdd/<plan>/progress.md`) because "conversation memory does not survive compaction."

**(c) Trust / verification mechanisms.**

- [`verification-before-completion`](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) is a near-verbatim twin of TNA Iron Law 3: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE", with an explicit 5-step gate function (identify → run → read → verify → only then claim), a "claim requires / not sufficient" table, and a rationalization-prevention table. It also says "Trusting agent success reports" is a red flag — same as TNA's "a report is a lead, not evidence".
- Fail-first logic: the TDD skill mandates watch-it-fail, and the README lists "Evidence over claims" as philosophy.
- **Mechanical enforcement exists, not just prose:** a `SessionStart` hook (`startup|clear|compact`) injects the `using-superpowers` bootstrap at session start *and after compaction* ([hooks.json](https://github.com/obra/superpowers/blob/main/hooks/hooks.json)) — structurally the same fix as TNA's "router re-injection after compaction" rule. SDD runs helper scripts (`sdd-workspace`, `task-brief`, `review-package`), and skill behavior has its own eval harness (`superpowers-evals`, [README, Contributing](https://github.com/obra/superpowers/blob/main/README.md)).
- **Human sign-off:** SDD's "Rulings, not stalls" section names exactly four stop conditions — irreversible/destructive operation, security-sensitive action, side effects outside the worktree (merge/push/publish), or a plan broken beyond guesswork — which maps cleanly onto TNA Iron Law 4 (agent proposes, user authorizes).
- **Rulings format:** SDD records `Ruling: <what you decided> — <why> — <what it costs if wrong>` in the ledger ([subagent-driven-development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)) — the same cost-if-wrong contract as TNA's `Ruling:` line, arrived at independently.

**(d) Skill loading model.** Hybrid. Prose force: [`using-superpowers`](https://github.com/obra/superpowers/blob/main/skills/using-superpowers/SKILL.md) demands skill invocation before *any* response ("1% chance a skill might apply → you MUST invoke it… not negotiable") plus a rationalization red-flag table. Mechanical part: the SessionStart hook re-injects that bootstrap at `startup|clear|compact`. The *decision* to load a skill is still model-chosen prose (the layer TNA's evals measured as 0/3 reliable); what's mechanical is that the router itself always re-enters context.

**(e) Stars / date.** 302,207 stars, observed 2026-10-20 ([API](https://api.github.com/repos/obra/superpowers)).

---

## 2. addyosmani/agent-skills

**(a) Premise / philosophy.** "Production-grade engineering skills for AI coding agents" — a collection where "each skill encodes a specific process that senior engineers follow," organized by development phase ([README](https://github.com/addyosmani/agent-skills), [using-agent-skills](https://github.com/addyosmani/agent-skills/blob/main/skills/using-agent-skills/SKILL.md)).

**(b) Workflow — how a task flows.** A 16-step lifecycle sequence ([using-agent-skills](https://github.com/addyosmani/agent-skills/blob/main/skills/using-agent-skills/SKILL.md)): `interview-me` → `idea-refine` → `spec-driven-development` → `planning-and-task-breakdown` → `context-engineering` → `source-driven-development` → `incremental-implementation` → `observability…` → `doubt-driven-development` → `test-driven-development` → `code-review-and-quality` → `code-simplification` → `git-workflow…` → `documentation-and-adrs` → `deprecation…` → `shipping-and-launch`. Skill discovery is a flowchart keyed off the task's phase (bug? → `debugging-and-error-recovery`; no spec? → start with `spec-driven-development`).

**(c) Trust / verification mechanisms.**

- **Core operating behaviors** (non-negotiable, cross-cutting): surface assumptions before non-trivial work, manage confusion explicitly, push back (anti-sycophancy), enforce simplicity, scope discipline ("surgical precision, not unsolicited renovation"), and **"Verify, Don't Assume — a task is not complete until verification passes"** with a project-wide Definition of Done ([using-agent-skills](https://github.com/addyosmani/agent-skills/blob/main/skills/using-agent-skills/SKILL.md)). These mirror TNA's WORKFLOW principles 1, 3, and 4 almost line-for-line.
- [`test-driven-development`](https://github.com/addyosmani/agent-skills/blob/main/skills/test-driven-development/SKILL.md): "A test that passes immediately proves nothing" (TNA Iron Law 2), the **Prove-It Pattern** for bug fixes (reproduce first, fix second — TNA `root-cause` territory), a repo-specific test-command discovery step, red flags ("'All tests pass' but no tests were actually run"), and a final verification checklist.
- [`doubt-driven-development`](https://github.com/addyosmani/agent-skills/blob/main/skills/doubt-driven-development/SKILL.md): every non-trivial decision gets a fresh-context **adversarial** reviewer (artifact + contract only — never the claim, to avoid bias), cross-model escalation that must be *offered* to the user and never silently skipped, external CLIs requiring explicit authorization + read-only sandbox, a bounded 3-cycle stop, and a checkable "doubt theater" red flag (2+ cycles with zero actionable findings = validation, not doubt).
- **Mechanical parts — verified 2026-10-20 via [evals/README.md](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md):** a three-tier eval system — Tier 1 structural validation in CI, Tier 2 **deterministic trigger/routing checks** (stemmed TF-IDF over descriptions; CI enforces a rank-1 floor via `--min-rank1 95` and a pairwise description-collision check at ≥75% similarity), Tier 3 behavioral evals (headless agent, graded against `expectations[]`, including **pressure cases**: time pressure, sunk cost, authority pressure — "verify that the workflow still holds when the prompt argues for skipping it"). Most consequentially, their own Tier-3 data **independently confirms the self-trigger unreliability TNA measured**: skill invocation is stochastic even with optimized descriptions (a review skill fired 7/27 → 21/27 after one description clause; TDD fired 6/24 → 19/24; "better, not solved"). This is the first external cross-validation of TNA's 0/3 eval finding from a top-starred repo.

**(d) Skill loading model.** Description-driven self-trigger as the primary mechanism: the hook's own header says hosts with native description-based routing (Claude Code, Codex CLI) deliberately do **not** wire it, to avoid "a second router on top of the native one" ([hooks/session-start.sh](https://github.com/addyosmani/agent-skills/blob/main/hooks/session-start.sh)). Skills are "workflows, not suggestions" — but that instruction is prose, i.e., exactly the layer TNA measured as unreliable (0/3) and compensates for with the MANDATORY router rule.

**(e) Stars / date.** 108,679 stars, observed 2026-10-20 ([API](https://api.github.com/repos/addyosmani/agent-skills)).

---

## 3. cursor/plugins — pstack

Context: `cursor/plugins` is Cursor's official multi-plugin marketplace; **pstack** (by Lauren Tan) is one plugin: "if you want to go fast, go deep first… rigorous agent workflows you can parallelize with confidence" ([repo README](https://github.com/cursor/plugins/blob/main/README.md)). The `harness/pstack/` tree is generated from the `pstack/` sources ([harness README](https://github.com/cursor/plugins/blob/main/harness/pstack/README.md)).

**(a) Premise / philosophy.** Deep-work-first rigor: fewer, higher-quality changes, each provable. The guide's verification page opens with **"'It compiles' is not evidence"** and cites its `principle-prove-it-works` skill: check the *real artifact* before reporting success ([06-verify-and-ship.md](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/docs/guide/06-verify-and-ship.md)).

**(b) Workflow — how a task flows.** Guide stages: setup → poteto-mode → understand → design → build-and-clean → **verify-and-ship** → overnight (tree: [repo](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/docs/guide/)). `poteto-mode` drives playbooks per task shape (feature, bug-fix, investigation, autopilot, opening-a-pr, babysit, shipping…). The ship path: state the finish condition in the *first* prompt ("three checks it can run, not a mood to satisfy") → verify via a project-generated `/verify-<app>` skill → open a small ordered PR → `babysit` drives checks/reviews to merge-ready **but never merges** → `shipping` verifies each PR independently — "the agent that judges a change is never the one that wrote it" — and lands only the contiguous verified run ([06-verify-and-ship.md](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/docs/guide/06-verify-and-ship.md)).

**(c) Trust / verification mechanisms.**

- **Receipt-like artifacts:** [`show-me-your-work`](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/skills/show-me-your-work/SKILL.md) maintains an append-only TSV decision log (one row per decision: what/why/**evidence pointer**/result), local by default and committed only when a reviewer needs it — a TNA-ledger analogue that (unlike TNA's) can be promoted to a public artifact wholesale. It then **audits the log against the actual transcript** ("every row maps to a real decision; each evidence pointer resolves") and finishes with a **cross-model review subagent** ("Self-review is not a substitute") that flags weak evidence and unproven verification claims.
- **Fail-first, explicitly:** create-verification-skill's generator must prove its skill end to end before use ("If that proof fails, don't use the output"), and formal-verification skills must **show the property failing on a broken variant** — "a check you've never seen fail proves nothing" ([06-verify-and-ship.md](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/docs/guide/06-verify-and-ship.md)).
- **Evidence-vetting gates:** `/benchmark-checklist` (seven questions, verdict faster/slower/no-difference/**inconclusive**, evidence required per question) and `/blast-radius` ("proves that fact by running code, not by arguing for it") — same page.
- **TDD is gated but pragmatic:** [`tdd`](https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/skills/tdd/SKILL.md) requires a failing test before the fix ("Confirm it fails for the intended reason") but permits an "closest executable check" escape when a test is impractical — "Prefer no new test over a bad test."
- **Mechanical enforcement is the strongest of the four:** shipped scripts with their own tests (`check-plan.test.ts`, `orch.test.ts`, `watch-pr` policy tests, `worktree-audit.sh`), hooks in sibling plugins (e.g. `advisor` stop-hook), plus rules like "Prefer evidence produced by committed scripts over hand-made one-offs" (its `encode-lessons-in-structure` principle — TNA's encode-twice in different words).

**(d) Skill loading model.** Explicitly split: many operational skills carry `disable-model-invocation: true` (e.g. `show-me-your-work`, `tdd`) — **user-invoked only**, so loading is deterministic (you type the slash command). The `principle-*` skills are model-invoked (description-based). So pstack sidesteps self-trigger risk by *shrinking* what the model may auto-load, rather than forcing it — a third option next to TNA's mechanical forcing and agent-skills' pure self-trigger.

**(e) Stars / date.** `cursor/plugins` (whole repo, pstack-specific count `unknown`): 13,092 stars, observed 2026-10-20 ([API](https://api.github.com/repos/cursor/plugins)). Closed 2026-10-20: pstack's canonical standalone repo is [backnotprop/pstack](https://github.com/backnotprop/pstack) ("Use pstack with claude, codex, pi") at **2,354 stars** ([API](https://api.github.com/repos/backnotprop/pstack)); a multi-harness port exists at [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) ("Rigorous agent workflows with Cursor primitives translated for other harnesses") at **3,104 stars** ([API](https://api.github.com/repos/michael-denyer/pstack-claude)) — so the methodology's ecosystem totals roughly 5.5k stars across ports, far below the three other repos surveyed.

---

## 4. mattpocock/skills

**(a) Premise / philosophy.** "Skills for Real Engineers… not vibe coding." Explicitly anti-framework: "Approaches like GSD, BMAD, and Spec-Kit… own the process… take away your control." His skills are meant to be "small, easy to adapt, and composable" ([README](https://github.com/mattpocock/skills/blob/main/README.md)).

**(b) Workflow — how a task flows.** No single mandated pipeline — composable user-invoked orchestrators over model-invoked discipline skills. Typical: `/grill-with-docs` (interview + glossary + ADRs) → `/to-spec` → `/to-tickets` → `/implement` (or `/implement-spec` for parallel subagent execution over a task graph) → `/code-review` → `/pr`. [`implement`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md) in full: fetch the ticket, "Call the Skill tool with 'tdd' where possible, at pre-agreed seams," run typechecks regularly + full suite once at end, "call the Skill tool with 'code-review' to review the work," then **"Commit your work to the current branch."**

**(c) Trust / verification mechanisms.**

- [`tdd`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md): red-before-green, **seams pre-agreed with the user** before any test is written, and a sharp **tautological-test** anti-pattern ("the assertion recomputes the expected value the way the code does… passes by construction") — the same defect class TNA's `expect-fail` exists to catch (a test that passes immediately proves nothing). Vertical slices only; refactoring is explicitly *outside* the red-green loop (it belongs to `code-review`).
- [`diagnosing-bugs`](https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md) — **verified verbatim 2026-10-20** (closes the earlier `unverified` flag), and it is the most disciplined debugging procedure of all five repos surveyed: a 6-phase gated loop (feedback loop → reproduce+minimise → hypothesise → instrument → fix+regression-test → cleanup) with checkable completion criteria per phase ("No red-capable command, no Phase 2"; "If you catch yourself reading code to build a theory before this command exists, stop"). Structurally it is TNA's `root-cause` with more mechanical teeth in Phase 1 (10 ranked loop-construction strategies, loop-tightening criteria: red-capable / deterministic / fast / agent-runnable). Two ideas TNA's `root-cause` lacks: **minimised repro as a phase gate** (shrink until "every remaining element is load-bearing") and **the missing-seam finding** ("If no correct seam exists, that itself is the finding… The codebase architecture is preventing the bug from being locked down. Flag this for the next phase") — the same escape-valve logic TNA identified as its own Iron Law 2 gap, arrived at independently.
- **Human-gate gap:** `implement` instructs committing with no sign-off step and no completion-evidence gate beyond "full test suite once at the end"; `code-review` reviews quality/spec, not evidence receipts.
- **Mechanical enforcement:** essentially none observed — no hooks/ directory in the [repo tree](https://api.github.com/repos/mattpocock/skills/git/trees/HEAD?recursive=1) (only `.github/workflows` for release/triage). Loading control is the one mechanical bit: frontmatter `disable-model-invocation: true` on user-invoked skills.

**(d) Skill loading model.** A documented two-tier contract ([README, Reference](https://github.com/mattpocock/skills/blob/main/README.md)): **user-invoked** skills orchestrate and are reachable only by typing them; **model-invoked** skills hold reusable discipline and load on description match (self-trigger). Invariant: "A user-invoked skill may invoke model-invoked skills, but never another user-invoked one" — same one-way orchestration rule as TNA's "a user-invoked skill… may load model-invoked skills, but never another user-invoked one."

**(e) Stars / date.** 297,692 stars, observed 2026-10-20 ([API](https://api.github.com/repos/mattpocock/skills)).

---

## Compatibility assessment vs. the TNA trust layer

### Summary table

| Repo | Fail-first | Receipts/evidence gate | Human sign-off | Loading = mechanical? | Closest TNA overlap |
|---|---|---|---|---|---|
| superpowers | ✅ TDD deletes pre-test code | ✅ near-verbatim Iron Law 3 | ✅ 4 named stop conditions | ⚠️ router injected by hook; skill load still prose | `receipts` ≈ `verification-before-completion`; ledger `Ruling:` ≈ TNA `Ruling:` |
| agent-skills | ✅ Prove-It pattern | ✅ "Verify, don't assume" + DoD | ❌ none observed — sign-off gate absent (first pass `unverified`; closed 2026-10-20: [evals/README.md](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md) confirms evals measure skills, not sign-off gates) | ❌ description self-trigger (hook optional) | `root-cause` ≈ debugging skill; `breakpoint` ≈ interview/assumption-surfacing |
| pstack | ✅ with pragmatic escape hatch | ✅ TSV log + transcript audit + cross-model review | ✅ Babysit never merges; shipping verifies per-PR | ⚠️ split: user-invoked hard, principles soft; scripts tested | ledger ≈ `show-me-your-work`; `receipts` ≈ audit-trail rules |
| mattpocock | ✅ tautology guard | ⚠️ suite-once, no receipt gate | ❌ `implement` auto-commits | ❌ description self-trigger (frontmatter flags only) | `expect-fail` ≈ tautology anti-pattern; `breakpoint` ≈ grilling |

### Where the philosophies align (selaras)

1. **Fail-first is unanimous.** All four independently require a failing test / failed proof before the fix — TNA Iron Law 2 slots in without friction; the strongest cross-pollination is pstack's "a check you've never seen fail proves nothing" and mattpocock's tautology rule, which sharpen `expect-fail`'s wording.
2. **Evidence-before-claims is consensus.** superpowers states it as an Iron Law; pstack demands artifact pointers; agent-skills demands verification evidence; TNA's `receipts` is the same doctrine with an added receipt *shape* (Verdict/Evidence/Open/Next, `docs/chat-receipt.md`) and claim tiers (SHIPPED vs IMPLEMENTED-UNVERIFIED) the others lack.
3. **Ledger/decision-log exists in three of four** (superpowers SDD ledger, pstack TSV, TNA `.trust/progress.txt`) — all motivated by the same fact: memory doesn't survive compaction.
4. **Human-gate on irreversible actions** appears in superpowers (4 stop conditions) and pstack (never-merges, per-PR verification before landing) — same shape as Iron Law 4.
5. **One-way orchestration invariant** (user-invoked → model-invoked, never peer-to-peer) is shared by mattpocock and TNA — no conflict.

### Conflicts / overlaps (tumpang tindih skill)

- **Duplicate skills — TNA's registry must vet, not double-load:** `receipts` vs superpowers `verification-before-completion`; `root-cause` vs superpowers `systematic-debugging` vs agent-skills `debugging-and-error-recovery` vs pstack `principle-fix-root-causes`; `breakpoint` vs mattpocock `grilling`/`grill-me`; `roast-my-code` vs pstack `interrogate`/`reflect` vs mattpocock `code-review`; `ship-log` vs superpowers SDD ledger vs pstack `show-me-your-work`. `docs/skill-vetting.md` is the designed resolution path; loading two members of the same pair in one session should be a router-level dedup ("edges are free" — dedup is an orchestrator step).
- **Loading doctrine clash (the real disagreement).** superpowers ("1% chance → MUST invoke… not negotiable") and agent-skills ("skills are workflows, not suggestions") rely on stronger prose — precisely the layer TNA evals showed stays 0/3 regardless of description wording (`docs/design.md`). TNA's MANDATORY router rule and mechanical gates are compatible add-ons, *not* replacements: superpowers already re-injects its router mechanically via SessionStart hook, so it's the closest to TNA's model; mattpocock and agent-skills are the exposed ones.
- **Continuous-execution tension (superpowers).** SDD's "Rulings, not stalls — do not pause to check in between tasks" vs TNA Iron Law 1 (no acting until shared understanding). Resolvable: TNA scopes Law 1 to *before* the plan starts (superpowers' brainstorming stage already satisfies it); during execution both frameworks converge — self-made decisions get a `Ruling:` line, only the four named classes stop.
- **Strictness gap in the other direction (pstack).** pstack `tdd` allows skipping the failing test when impractical; TNA Iron Law 2 has no stated escape hatch. Wrapping pstack workflows with a literal Iron Law 2 would grind on pstack's documented "prefer no new test over a bad test" cases — TNA needs the impractical-test path expressed as a `Ruling:` (cost-if-wrong) rather than a silent skip.

### Gaps TNA can close when wrapping each workflow

- **superpowers** — already has hooks, ledger, rulings, capped review loops. TNA adds: the *mechanical* done-claim veto (TNA's done-receipt-gate / execute.after evidence recorder) on top of superpowers' prose gate, rule inheritance for recurring failures, and honest claim tiers (superpowers has one evidence bar; TNA distinguishes IMPLEMENTED-UNVERIFIED from SHIPPED).
- **agent-skills** — no observed human sign-off gate on irreversible actions and pure description-based loading. TNA contributes Iron Law 4 + MANDATORY loading + ledger (agent-skills has none of the three).
- **pstack** — strongest mechanical layer of the four, but no `Ruling:` cost-if-wrong discipline, no fast/full/loop classification, and its decision log is audited against transcripts only by a follow-up subagent. TNA adds: pre-action classification (pstack routes by playbook choice, not ceremony scaling), rulings with cost-if-wrong, and the always-on router (pstack leans on the user typing slash commands — model-invoked work is under-gated).
- **mattpocock** — composable and honest but prose-only: auto-commit without sign-off, no receipt gate, self-trigger loading. TNA wraps it with all three Iron-Law gates; the biggest single win is replacing "full test suite once at the end" + auto-commit with a receipts gate before commit.

### Verdict

TNA's trust layer is **structurally compatible with all four workflows** — it operates one level above them (router + gates + ledger) and none of the four has a conflicting core doctrine; three of four already contain partial duplicates of TNA's Iron Laws 2–4. The recurring friction points are exactly two: (1) prose self-trigger vs. mechanical forcing (TNA's measured advantage), and (2) the missing human sign-off gate in mattpocock/agent-skills and missing receipt tiers everywhere. No workflow requires TNA to weaken an Iron Law; the one adaptation TNA should make explicit is an impractical-test escape valve (as a `Ruling:`) so Iron Law 2 doesn't collide with pstack's documented pragmatism.

### Cross-validation (what the four repos prove about TNA's own evals)

1. **Self-trigger unreliability is now independently confirmed by two repos.** TNA measured 0/3 skill loads on fast-classified tasks (`docs/design.md`); agent-skills' Tier-3 data shows the same stochasticity with far better instruments (6/24 → 19/24 after description optimization — improved, never solved, on a pinned model); superpowers ships a mechanical SessionStart hook because prose alone was not trusted. Two top-starred repos, two independent methodologies, same conclusion: **mechanical forcing is the only stable layer.** This upgrades TNA's 0/3 from a single-repo eval finding to a replicated result.
2. **The sign-off gap is a market gap, not a TNA idiosyncrasy.** Of the four, only superpowers and pstack gate irreversible actions; the two pure-skill catalogs (agent-skills, mattpocock) have no human sign-off layer at all — mattpocock's `implement` commits unattended. For TNA's positioning as the trust layer adopters wrap around these catalogs, this is the single largest differentiation surface: Iron Law 4 is present in 2/4, and in neither of the two most "install-and-forget" catalogs.
3. **Escape valves are converging everywhere — TNA is the outlier without one.** pstack's `tdd` ("Prefer no new test over a bad test"), mattpocock's `diagnosing-bugs` ("If no correct seam exists, that itself is the finding"), and mattpocock's TDD (vertical slices, refactoring outside the loop) all express the same insight: a failing test at the wrong seam certifies nothing. TNA's Iron Law 2 has no stated valve; the `expect-fail` rationalization table implies one but never states it. This is TNA's gap to close, not theirs to adopt.

### Adoption playbook — installing the trust layer over each workflow

The mechanism already exists (`docs/installation.md` §Overlay composition + §Bring your own workflow): install the universal core, map the external skills as overlays (add-only, never gate-relaxing), and the trust machinery wraps whatever workflow runs underneath. Per workflow:

- **superpowers** (hook-native, closest to TNA): install TNA's veto + receipts as a second enforcement layer *beside* their SessionStart hook — the two hooks are structurally identical, so both floors ride the same re-injection. Map `verification-before-completion` as an overlay extending `receipts` (role: insert-after) rather than letting both load: TNA's receipt shape (Verdict/Evidence/Open/Next + claim tiers) is the superset. Keep their 4 stop conditions; TNA's Iron Law 4 subsumes them.
- **agent-skills** (16-step lifecycle, self-trigger loading): this is the highest-value wrap because they have none of the three trust primitives. Install the TNA floor unchanged; their `using-agent-skills` meta-skill becomes an overlay `insert-before` `fork-it` (their lifecycle = a chain variant). Their doubt-driven-development's adversarial reviewer maps onto `roast-my-code` — dedup at the router ("edges are free"), never double-load. TNA's veto covers their missing sign-off gate on external-CLI and cross-model actions.
- **pstack** (strongest mechanical layer, script-heavy): TNA contributes only what pstack lacks — `Ruling:` cost-if-wrong lines, fast/full/loop classification, and the router floor for model-invoked work (their principle-* skills load on description match, under-gated by TNA's standard). Conversely, **do not** wrap their `tdd` with a literal Iron Law 2: the impractical-test valve (below) is the compatibility requirement. Their `show-me-your-work` TSV and TNA's ledger coexist: TSV rows carry evidence pointers the ledger's receipts can cite.
- **mattpocock** (composable, prose-only): the biggest single win. TNA's receipts gate replaces "full test suite once at the end" + auto-commit; the veto catches the unattended `git commit` their `implement` issues; `diagnosing-bugs` maps onto `root-cause` as an overlay (insert-after Phase 1 — their feedback-loop construction is stronger than TNA's Phase 1, per the two-way findings below).

### Improvement candidates — two directions

**TNA → workflow (what the trust layer adds to each):**

1. **Mechanical done-claim veto** (all four): superpowers has the prose gate only; agent-skills/mattpocock have none; pstack audits transcripts post-hoc via a subagent. TNA's `execute.after` evidence recorder + commit veto are the only pre-action enforcement among all five frameworks.
2. **Receipt tiers** (all four): every repo has one evidence bar ("verified" / "evidence exists"); none distinguishes IMPLEMENTED-UNVERIFIED from SHIPPED, none has a staleness window, none has a claim-tier ledger. TNA's `receipts` is the most granular completion contract of the five.
3. **Sign-off gate** (agent-skills, mattpocock): Iron Law 4 is simply absent there. Highest-impact single add.
4. **Rule inheritance** (all four): none has a governance path from review finding → permanent router rule (gated, scoped, reversible). Lessons in the other repos live in docs or nowhere; TNA's rule-inheritance register is unique among the five.

**Workflow → TNA (what the top-starred repos do better):**

5. **Impractical-test escape valve for Iron Law 2** (from pstack + mattpocock): state it explicitly in `expect-fail` — when no correct seam exists, the *finding* is the missing seam (flag it, route to architecture work), and a `Ruling:` records the decision. Silent skips stay forbidden; documented valves are new. All three other fail-first frameworks have an equivalent; Iron Law 2 without one collides with documented reality ("prefer no new test over a bad test").
6. **Trigger-eval floor for skill descriptions** (from agent-skills Tier 2): TNA checks descriptions by prose rules (trigger-pure, eval check); agent-skills runs a *deterministic* TF-IDF routing check in CI with a rank-1 floor and a collision check. Adopting the shape — a mechanical routing-accuracy check over the 12 skills — would close the last prose-only layer in TNA's own registry. Their pressure cases (time/sunk-cost/authority pressure tests for discipline skills) are also directly portable to TNA's eval battery.
7. **Pressure-tested discipline skills** (from agent-skills Tier 3): TNA's evals measure whether skills load and apply; agent-skills additionally measures whether they *hold under pressure* ("the workflow still holds when the prompt argues for skipping it"). The self-trigger evals partially cover this; a named pressure-case tier would make the coverage explicit.
8. **Minimised-repro phase gate in `root-cause`** (from mattpocock `diagnosing-bugs`): "shrink until every remaining element is load-bearing" is a checkable gate between reproduce and hypothesise; TNA's `root-cause` phases lack it. Also their 10-ranked loop-construction catalog for Phase 1.

Ranked by trust-layer leverage: **#5** (closes TNA's own Iron Law 2 gap, required for pstack compatibility) > **#3** (the market's biggest missing gate) > **#6** (mechanizes TNA's last prose layer) > **#1, #2, #4** (already shipped TNA strengths — these are the differentiation story, not work items) > **#7, #8** (eval/procedure depth, nice-to-have).

---

## Sources

### obra/superpowers
- Repo: https://github.com/obra/superpowers
- Metadata (stars, 2026-10-20): https://api.github.com/repos/obra/superpowers
- README: https://raw.githubusercontent.com/obra/superpowers/main/README.md
- Skill — verification-before-completion: https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md
- Skill — using-superpowers: https://github.com/obra/superpowers/blob/main/skills/using-superpowers/SKILL.md
- Skill — subagent-driven-development: https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md
- Hooks (SessionStart injection): https://github.com/obra/superpowers/blob/main/hooks/hooks.json
- File tree: https://api.github.com/repos/obra/superpowers/git/trees/HEAD?recursive=1

### addyosmani/agent-skills
- Repo: https://github.com/addyosmani/agent-skills
- Metadata (stars, 2026-10-20): https://api.github.com/repos/addyosmani/agent-skills
- Skill — using-agent-skills (meta/router): https://github.com/addyosmani/agent-skills/blob/main/skills/using-agent-skills/SKILL.md
- Skill — test-driven-development: https://github.com/addyosmani/agent-skills/blob/main/skills/test-driven-development/SKILL.md
- Skill — doubt-driven-development: https://github.com/addyosmani/agent-skills/blob/main/skills/doubt-driven-development/SKILL.md
- Hook — session-start.sh: https://github.com/addyosmani/agent-skills/blob/main/hooks/session-start.sh
- File tree: https://api.github.com/repos/addyosmani/agent-skills/git/trees/HEAD?recursive=1

### cursor/plugins (pstack)
- Repo: https://github.com/cursor/plugins
- Metadata (stars, 2026-10-20): https://api.github.com/repos/cursor/plugins
- README (plugin table incl. pstack): https://raw.githubusercontent.com/cursor/plugins/main/README.md
- Harness tree README: https://github.com/cursor/plugins/blob/main/harness/pstack/README.md
- Guide — verify and ship: https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/docs/guide/06-verify-and-ship.md
- Skill — show-me-your-work: https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/skills/show-me-your-work/SKILL.md
- Skill — tdd: https://github.com/cursor/plugins/blob/main/harness/pstack/claude-code/skills/tdd/SKILL.md
- File tree: https://api.github.com/repos/cursor/plugins/git/trees/HEAD?recursive=1

### mattpocock/skills
- Repo: https://github.com/mattpocock/skills
- Metadata (stars, 2026-10-20): https://api.github.com/repos/mattpocock/skills
- README: https://raw.githubusercontent.com/mattpocock/skills/main/README.md
- Skill — tdd: https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md
- Skill — implement: https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md
- Skill — diagnosing-bugs: https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md
- File tree: https://api.github.com/repos/mattpocock/skills/git/trees/HEAD?recursive=1

### pstack ecosystem (closed 2026-10-20)
- Canonical repo: https://github.com/backnotprop/pstack
- Multi-harness port: https://github.com/michael-denyer/pstack-claude
- Metadata: https://api.github.com/repos/backnotprop/pstack, https://api.github.com/repos/michael-denyer/pstack-claude

### TNA (local, no URL)
- `AGENTS.md`, `WORKFLOW.md`, `docs/design.md`, `docs/chat-receipt.md`, `docs/skill-vetting.md`, `docs/compatibility.md`, `skills/` (12 installed SKILL.md files).

### Unverified items

~~All three items below were `unverified` in the first pass (2026-10-20); all three were subsequently **closed verbatim** same-day:~~

- ~~pstack-specific star count~~ → closed: canonical repo backnotprop/pstack = 2,354 stars; multi-harness port pstack-claude = 3,104 stars ([API](https://api.github.com/repos/backnotprop/pstack), [API](https://api.github.com/repos/michael-denyer/pstack-claude), observed 2026-10-20).
- ~~agent-skills evals runtime strength~~ → closed: [evals/README.md](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md) read verbatim — three-tier system, CI-enforced rank-1 routing floor, behavioral pressure cases; see §Cross-validation.
- ~~mattpocock `diagnosing-bugs` phase detail~~ → closed: [SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md) read verbatim — 6-phase gated loop; see §Gaps (mattpocock bullet).

No `unverified` items remain.
