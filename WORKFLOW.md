# WORKFLOW.md — core rules

Non-negotiable. Procedure detail lives in AGENTS.md and the skills.

## The four principles

1. **Surface assumptions before building.** Hidden assumptions and ambiguous scope get surfaced and resolved before code is written. When a request has several valid readings, the readings get named — never silently picked.
2. **Simplicity first.** The simplest implementation that solves today's problem. No speculative architecture for needs that don't exist yet; abstraction is added only when the requirement actually appears, and refactored then.
3. **Surgical changes.** Only the lines that solve the requested problem. No drive-by refactors, no restyling, no preference-driven rewrites. Match the repo's existing style. Orphan-cleanup asymmetry: remove import/variable/function that YOUR edit made unused; leave pre-existing dead code alone — just mention it.
4. **Verifiable goals, not vague orders.** "Add validation" becomes "write the failing test for invalid input, then make it pass"; "fix the bug" becomes "reproduce it in a test, then make it green". Multi-step work is written as steps with a verify per step.

## Rules

1. **Classify first**: `fast` (1 step, glance-verifiable) → answer directly; `full` (2-4 steps) → short todos + verification; `loop` (multi-stage/multi-file) → full chain + verify each stage. Can't be checked at a glance = not `fast`.

2. **Large features run the chain** (at least 2 of: 3+ files, >30 min, new logic): `breakpoint → save-as → fork-it → make-it-so → roast-my-code → ship-log`. No coding before spec & tickets exist.

3. **The four Iron Laws**:
   - No acting until the user confirms shared understanding.
   - No production code without a failing test first.
   - No completion claims without fresh verification evidence.
   - No expensive, irreversible, or shared-system action (commit, push, publish, delete, destructive migration) without the user's explicit sign-off. The agent proposes; the user authorizes. The dry-run form for this gate — proposed action, predicted effects, irreversibility rubric, hard-cap rule — lives in `make-it-so`'s Dry-run gate section.

4. **Facts are the agent's, decisions are the user's.** Self-made decisions get a `Ruling:` line in the ledger. Iron-Law-4 actions are never a self-made decision — they always wait for explicit sign-off.

5. **Every subagent prompt** carries the 3-line repo rules + 6 sections (TASK/OUTCOME/TOOLS/MUST DO/MUST NOT DO/CONTEXT). Verify subagent output yourself — reports are leads, not evidence. Accepted review findings become permanent router lines — gated, scoped, and reversible (see `docs/rule-inheritance.md`); recurring failures inherit the same way: the fix lands as a rule, not a transcript story.

6. **Log hard rule**: a finished unit of work → append the private ledger (`.trust/progress.txt`, gitignored) (session summary + verification evidence + self-review) before moving to the next one.

7. **Recovery after a long pause**: re-read todos + the private ledger + this file + AGENTS.md, state the next step out loud — never resume from partial memory.

8. **Verification is honest**: a passed gate proves only what that gate verifies — "tests pass" proves the tests ran green, not that the task is done or the UI looks right; each claim gets its own gate and its own receipt. Reaching a limit (round cap, token/time budget) is a stop, not success. Before each retry, classify the failure (missing capability / wrong instruction / environment gap / context gap) and prefer the fix that repairs the class, not the instance. If the workspace is unchanged since the failure, a re-run cannot pass — prove progress with a real change first.

9. **Session hygiene**: cut the session before it turns giant — ~3 hours or ~150 messages is the practical ceiling. Symptoms of a saturated context: tool/verification timeouts and retries that stop making progress. When symptoms appear: stop delegating, run `ship-log` for the current state, and start a fresh session — rule 7's recovery is cheap by design (live ledger rotated per `ship-log`), so nothing is lost by cutting.

## These rules are working if

Signals that this workflow is doing its job — check them across sessions, not per task:

- Clarifying questions arrive **before** implementation mistakes, not after.
- Diffs stay surgical: changed lines trace to the request, drive-by edits are rare.
- Completion claims cite fresh verification evidence **without being asked**.
