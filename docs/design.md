# Design decisions — why trust-no-agent is shaped this way

The durable design decisions behind the framework, written as the reasoning that produced them. This is the "why" that survives the work; the session-by-session history that produced it is intentionally not part of the public repo.

## The four Iron Laws

The framework rests on four non-negotiable gates, each closing a specific failure mode:

1. **No acting until the user confirms shared understanding** — a wrong guess at the start is a whole feature built in the wrong direction. The cheapest fix is a two-minute pause before code runs.
2. **No production code without a failing test first** — a test that passes immediately against user-supplied code is verification of a claim, not of a spec. The failing expectation is the only honest starting point.
3. **No completion claims without fresh verification evidence** — "should work" is a confession. Work only counts when it exits zero, and the evidence must be from this run, not a memory of a past one.
4. **No irreversible action without explicit human sign-off** — commit, push, publish, delete are never self-serve. The agent proposes; the user authorizes.

The fourth law exists because the first three are about *quality*, but the fourth is about *authority*: a system that can act on shared systems without a human gate is a liability no amount of testing fixes.

## Classification scales discipline with stakes

`fast` / `full` / `loop` — one step, a few steps, or a multi-stage chain. The insight: heavyweight process applied to every task is how frameworks get abandoned. A typo fix does not need the full ceremony; a cross-file feature does. Discipline must scale with stakes, or it collapses under its own weight.

## The ledger is private by design

The ledger is the anti-compaction mechanism: conversation memory does not survive context compaction, but a file does. It records decisions (Rulings), self-reviews, and the smallest set of information needed to continue correctly.

It is **gitignored and private** because it is working memory, not documentation. A public repo shows the finished framework; the ledger is the kitchen where it was cooked. Keeping them separate means the repo stays clean while the working history stays available to whoever is actively developing it.

## Memory modes: private by default, shared by promotion

The private ledger is the right default for solo work, and an adopting team raises the honest question: what happens to shared memory when more than one person works the repo? The answer is modes, not a public ledger:

- **Private (default)** — `.trust/` holds the active developer's working memory: raw chronology, half-formed rulings, per-unit receipts. It stays gitignored; publishing it would leak deliberation as if it were decision.
- **Shared by promotion** — when a ruling, decision, or handoff must outlive one developer, it is **promoted explicitly**: rewritten as a tracked artifact (an ADR, a glossary term, a tracker ticket, a changelog line). Promotion is an authored act with an audience, never a copy-paste of the ledger.
- **Never silently publish the private tier** — and never turn the shared docs into the agent's scratchpad. Promotion touches shared history, so when the artifact is a public one it rides the human sign-off of Iron Law 4.

## Rulings: decisions carry their cost

Any decision the agent makes on its own gets a `Ruling:` entry: `<decision> — <why> — <cost if wrong>`. The cost-if-wrong clause is the load-bearing part — it forces the decision to be honest about its downside, and it gives a future session the trigger to revisit. A decision without a stated cost is a preference wearing a decision's uniform.

## The delegation contract

Every subagent prompt carries three repo rules (verify before done, no out-of-scope refactoring, no touching files outside the allowed path list) plus six sections (TASK / EXPECTED OUTCOME / REQUIRED TOOLS / MUST DO / MUST NOT DO / CONTEXT). A vague prompt means the subagent improvises. Subagent results are verified by the orchestrator — a report is a lead, not evidence.

Two corollaries:
- **Edges are free** — deduplication, merging, flattening, and ranking are deterministic orchestrator steps, never extra subagents. Agents are for judgment; don't pay tokens for wiring.
- **Audit fake dependencies** — before running a chain stage, ask whether the next stage actually consumes the previous stage's output. If not, run them in parallel. Never queue work just because it was written down in order.

## Context is a budget

The framework's entire standing cost is the skill descriptions. Everything else loads on demand:
- **Descriptions are the only always-on cost** — keep them short and trigger-pure.
- **Reference material is never a skill** — catalogs and principle docs live in lazy-loaded files behind a one-line pointer.
- **Everything added pays rent** — a new skill, MCP server, or router section must fill a gap we actually hit, weighed before it's added.

## Portability: the stack is the asset

The core runs on any harness that reads `AGENTS.md`. Subagents, MCP servers, and background tasks are accelerators, not dependencies. The model is a commodity; the stack around it is the engineering. This is why the framework is harness-agnostic by design — the discipline layer should not be hostage to any single tool.

## Rule inheritance

Accepted review findings become permanent router lines before the work is logged. Recurring failures inherit the same way: the fix lands as a rule, not as a story in the transcript. Where a rule can be checked mechanically, encode it twice — prose for the why, a mechanical check (lint rule, hook, script, test) for the boundary. Rule entry is gated, scoped, and reversible.

## Failure classification

Before retrying a failed verification, classify the failure: missing capability, wrong instruction, environment gap, or context gap (the window lacked material the pass needed — never fetched, compacted away, or stale). Prefer the fix that repairs the class, not just this instance. A rerun without classification is a guess.

## Trigger-pure descriptions

Skill descriptions state *when to load them*, never what the workflow inside does. A description that summarizes the workflow teaches the agent to skip it. The trigger is the contract; the body is the procedure.

## Self-trigger is unreliable — enforcement must be mechanical

The framework's core promise is that a model *correctly loads* the discipline skills when a task demands them. Live-harness evals proved this promise false, and the fix reshaped how the router and delegation contract work.

### The evidence (live-harness evals, fresh agents, no pre-load)

Three scenarios, each demanding one of the Iron-Law discipline skills (`receipts`, `expect-fail`, `root-cause`), run against fresh agents with the skill installed and visible in the registry:

- **Without the router rule** — 0/3 agents loaded the skill. All three behaved correctly anyway (refused unverified claims, wrote failing tests, refused symptom fixes), but **from general model judgment, not from the skill**. The skill was never consulted. A control test confirmed the agents *had* full skill-registry access — they chose not to load it. This is a genuine trigger failure, not an access failure.
- **With trigger words added to the descriptions** — still 0/3. Explicit trigger phrases ("done", "shipped", "log it", "broken", "500", "try/catch") in the description did not raise the load rate. Description quality is not the lever.
- **With the router rule (MANDATORY) in context** — 3/3 loaded the skill. Agents attributed the change to the rule: "the rule forced me to demand a receipt", "the rule forced me to explicitly load expect-fail". Caveat: the eval prompt named the skills, so this is an upper bound, not a real-session number.

### The danger this hides

Because the model behaves correctly *without* the skill on simple scenarios, the framework looks like it works while the skill is never used. The failure is invisible until a hard case arrives — where the skill's stricter procedure (the 5-boolean categorical gate, the seam rules, the four root-cause phases) is exactly what's needed and is silently absent.

### The decision: enforcement is mechanical, not self-triggered

A condition that can be checked mechanically is checked mechanically, never left to the model's self-assessment. Three layers, each closing a different gap:

1. **Router MANDATORY** — the three Iron-Law skills are marked **MANDATORY** in the trigger matrix, with a dedicated section stating they are not advisory and must not be skipped by "responding on the merits". The router is auto-loaded every session, so the rule is always in context — unlike a skill description, which only appears if the model chooses to load the skill.
2. **Forced `load_skills` in delegation** — a delegation that touches a discipline domain MUST carry `load_skills: ["expect-fail"]` / `["root-cause"]` / `["receipts"]`. Verified: `load_skills` injects the full skill content into the subagent's context, not just its name. On a harness without `load_skills`, the skill's procedure is injected inline into the prompt instead.
3. **Mechanical checks in `scripts/eval.mjs`** — the router's MANDATORY markers and the delegation contract are verified by a HARD check (check #6). Dropping the marker fails CI. Verified by negative test: removing the marker makes `eval.mjs` exit 1; restoring it exits 0.

### Why only three skills are MANDATORY

MANDATORY is reserved for skills that are (a) **model-invoked** (self-trigger, proven unreliable) AND (b) **enforce an Iron Law** (output quality depends on them). The three discipline skills meet both. The others do not:

- **User-invoked skills** (`scribe`, `save-as`, `fork-it`, `make-it-so`) are already gated by the user — no self-trigger gap exists.
- **`breakpoint`** (model-invoked, enforces Iron Law 1) is not MANDATORY because its skip is *visible*: load it or not, the user is present when work opens, and an agent that acts without asking is caught on the spot — the invisible-failure problem of "The danger this hides" does not apply. The trigger matrix loads it at the work-opening moment.
- **Review skills** (`roast-my-code`, `no-thanks`) are triggered by a clear review moment, not an Iron Law; over-enforcing them costs without benefit.
- **`ship-log`** is important but not a quality gate; failure loses memory, not correctness.

### The residual gap: skill in context ≠ skill applied

`load_skills` guarantees the skill is *present*, not that the agent *uses* it. An application test found `receipts` and `root-cause` applied their unique procedures, but `expect-fail` did not — the agent classified the test-writing task as `fast` and skipped the skill, writing the tautological test the skill forbids. The fix attacked the *classification*, not the description:

- **"Writing tests is never `fast`"** — a test-writing task is always `full` or `loop`, never `fast`, because a test that "passes immediately" is exactly the tautological anti-pattern `expect-fail` exists to catch. Enforced by a HARD mechanical check (check #7). Re-tested: the agent now classifies test-writing as `full`, refuses the tautology, and asks for seam confirmation.

### The residual gap, generalized: `fast` classification skipped the registry

The test-writing fix (check #7) carved out one domain, but the probe that followed showed the pattern is not about tests. With the full registry installed and no skill named in the prompt, fresh agents proposed a matching external skill on full-class tasks 2/2 (`archify`, `prototype`) yet on fast-classified teaching requests answered directly 2/2 — correct-looking output from general judgment, the registry never consulted, the matching skill (`teach`) never proposed. The failure lives one layer earlier than self-trigger: the classification step itself hides the gap, because every downstream check assumed the registry was already considered. The fix generalized the carve-out into a rule — **"`fast` skips the chain, never the registry"**: before answering any task, the skill registry is checked once and a matching skill (the framework's own or an external one) is proposed by name and waits for approval, regardless of class. Enforced by a HARD mechanical check (check #20), verified fail-first (rule removed → exit 1, restored → exit 0). Evidence: `evals/live-results.md` §External-skill registry probe (2026-09-06).

### The upstream spec gate

Downstream verification (receipts, tests) proves behavior, not intent: a wrong spec that passes its tests still ships wrong code. The decision was to focus the framework's next lever UPSTREAM — forcing specification testability before execution — without adding a skill:

- **`save-as`** gained two sections: **Acceptance Criteria** (one falsifiable, traceable assertion per requirement, each carrying its check method) and an **Adversarial self-review** step run before publish (ambiguity, contradiction, hidden assumptions, untestable criteria — the translation from conversation to document is where new ambiguity is born, and the reviewer there runs in the same context as the writer).
- **`fork-it`** refuses to slice a spec without acceptance criteria — criteria invented at slicing time are implementation wishes, not requirements.
- **`expect-fail`** carries the upstream Iron Law cousin: *no fork-it without a failing acceptance test per requirement* (class `loop` only — discipline scales with stakes; `full` specs are recommended, not gated).
- **`scripts/eval.mjs`** check #12 (HARD) guards the markers; verified fail-first — the check was written first, observed failing (5 errors), then the prose landed and it exited 0.

### The residual gap the spec gate leaves open

The gate forces **testability**, not **truth**: an intent that is wrong but cleanly testable passes the gate, and no mechanical check can close that — spec correctness is prose-level, not exit-code-level. Adversarial self-review reduces this residual (a second pass catches contradictions the writer missed) but cannot eliminate it. If field use shows clean-but-wrong specs still reaching `make-it-so`, the next lever is a dedicated spec-review skill (`roast-my-spec`) — deliberately deferred to keep the standing cost at zero until proven needed.

### The "certifying the bug" gap

A live behavioral eval of `expect-fail` (scenario 6, pre-existing buggy `sum`) exposed a residual the tautology rule did not cover: the agent derived the expected value from the code's own output (`sum(1,2)` returned `4`, so it asserted `4`), never questioned the `+1`, and shipped the bug with a passing test as its alibi. The "test passed immediately" rationalization row existed but did not name the failure mechanism — deriving truth from observation. The fix is prose in `expect-fail`: a **certifying the bug** anti-pattern (derive expected values from intent — name, spec, requirement — and treat intent-vs-observation conflict as the bug) plus a rationalization row ("the expected value came from running the code"). One rerun of the same scenario did the full red-green loop unprompted, so the behavior is reproducible but not deterministic on this harness/model.

Honest classification: this fix is **judgment-level, not mechanically encodable** — there is no exit-code check that can detect an expected value derived from observed output, so unlike the spec gate (encode-twice: prose + check #12), this one carries prose only. The eval that found it (2 runs, 1 failure) is also the only evidence it helps; hit-rate before/after is measured on 3 runs, not a distribution.

### The honest limits of this evidence

- The router eval named the skills in its prompt, so 3/3 is an upper bound for real sessions, not a guarantee.
- All evals ran on one model and one harness; other models/harnesses may differ.
- `load_skills` failed to resolve `root-cause` in one run (registry staleness, see design-notes #2) — the inline fallback is what makes the framework robust to this.
- The evals measure whether the skill is loaded and applied, not whether the applied procedure produces correct output on hard cases; that remains unmeasured.
