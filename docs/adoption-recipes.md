# Adoption recipes — wrapping the four top-starred workflows with the trust layer

The trust layer wraps any workflow (`docs/installation.md` §Bring your own
workflow); this page is the concrete recipe per external workflow surveyed in
`docs/research-external-workflows.md`. Each recipe is the same three moves:
**install the universal core unchanged**, **map the external skills as
add-only overlays**, **let the trust machinery do what the workflow cannot**.
No recipe weakens a gate; no recipe requires forking the external workflow.

## Why wrap at all (the evidence, one line each)

- **superpowers** (302k★): prose-only done-gate — its `verification-before-completion` is verbatim Iron Law 3 but carries no mechanical veto, no claim tiers.
- **agent-skills** (108k★): description self-trigger loading (their own evals show invocation is stochastic — 6/24 → 19/24 after tuning, never solved) and no human sign-off gate on irreversible actions.
- **pstack** (~5.5k★ across ports): the strongest mechanical layer of the four, but no `Ruling:` cost-if-wrong, no ceremony scaling, and model-invoked principle skills under-gated.
- **mattpocock/skills** (297k★): composable and honest about tautologies, but `implement` auto-commits — no sign-off, no receipt gate.

## superpowers (hook-native — the closest to TNA)

| Move | How |
|---|---|
| Core | Universal install unchanged. Its SessionStart hook and TNA's reinject rule are structurally identical (`startup\|clear\|compact`) — both floors ride the same re-injection; no conflict. |
| Overlays | Map `verification-before-completion` as an overlay on `receipts` (`role: insert-after`) instead of letting both load — TNA's receipt shape (Verdict/Evidence/Open/Next, claim tiers, staleness window) is the superset. |
| Trust adds | The mechanical done-claim veto (TNA's commit veto fires where superpowers' prose gate alone can only advise); rule inheritance for recurring failures; the SHIPPED / IMPLEMENTED-UNVERIFIED distinction. |
| Keep theirs | The 4 stop conditions (irreversible, security, outside-worktree, broken-plan) — Iron Law 4 subsumes them; their capped review loops (5 rounds, model escalation) are good workflow, not trust. |

## agent-skills (16-step lifecycle, self-trigger loading — the highest-value wrap)

| Move | How |
|---|---|
| Core | Universal install unchanged — they have none of the three trust primitives (no sign-off, no mechanical loading, no ledger). |
| Overlays | Their `using-agent-skills` meta-skill becomes an overlay `insert-before` the chain entry (their lifecycle is a chain variant). `doubt-driven-development`'s adversarial reviewer maps onto `roast-my-code` — dedup at the router, never double-load. |
| Trust adds | Iron Law 4 sign-off on their external-CLI and cross-model escalation steps (their own skill requires authorization; TNA makes it a gate); MANDATORY loading for the discipline skills their prose cannot force; the private ledger for their lifecycle's decisions. |
| Keep theirs | Their 3-tier eval system and pressure cases — the best in the ecosystem; adopt the shape, run both. |

## pstack (script-heavy, strongest mechanics — lightest wrap)

| Move | How |
|---|---|
| Core | Universal install unchanged. |
| Overlays | Minimal: their operational skills are already user-invoked (deterministic). Map `show-me-your-work`'s TSV alongside the ledger — TSV rows carry evidence pointers the ledger's receipts can cite; do not merge them. |
| Trust adds | `Ruling:` cost-if-wrong lines (absent); fast/full/loop classification (they route by playbook, not by stakes); the router floor for model-invoked `principle-*` skills (description-loaded = under-gated by TNA's measured standard). |
| Keep theirs | Everything mechanical — their tested scripts, transcript-audit, cross-model review. **Do not** impose a literal Iron Law 2 here: their `tdd` escape hatch ("prefer no new test over a bad test") is exactly the impractical-test valve Iron Law 2 now documents (`expect-fail` §The impractical-test valve) — express the skip as a `Ruling:`, and the two doctrines compose. |

## mattpocock/skills (composable, prose-only — the biggest single win)

| Move | How |
|---|---|
| Core | Universal install unchanged. |
| Overlays | `diagnosing-bugs` maps onto `root-cause` as an overlay (`insert-after` Phase 1 — their feedback-loop construction and minimised-repro gate are stronger there); `tdd`'s tautology anti-pattern is already in `expect-fail` (no overlay needed). |
| Trust adds | The receipts gate replaces "full test suite once at the end" + auto-commit; the commit veto catches the unattended `git commit` their `implement` issues — the agent proposes, the user authorizes. |
| Keep theirs | The user-invoked orchestration surface (`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement`) — TNA does not replace the workflow, it gates its exits. |

## The one invariant across all four recipes

Overlays add steps; they never relax gates (`role: insert-before/after/wrap`
only — `replace`/`remove`/`skip` are rejected by the validator). A workflow
that wants to skip verification does not get wrapped — it gets declined at
vetting (`docs/skill-vetting.md` router-weakening red flag).
