# Spec: `slice-it` — split suggestion di entry kerja `full`/`loop`

## Problem Statement

Trust-no-agent hanya menyarankan pemecahan kerja jauh di dalam chain `loop` (setelah breakpoint → save-as → fork-it). Kerja `full` tidak pernah mendapat saran pecahan, dan kerja `loop` baru dipecah setelah spec — sehingga unit kerja tergabung, lifecycle branch/worktree/PR improvissasi, dan tidak ada kontrak cleanup sama sekali.

## Solution

Skill baru `slice-it` sebagai **pre-chain stage** (bukan stage dalam panah chain): setelah classify menghasilkan `full` atau `loop`, sebelum kerja dimulai, agent mengeluarkan proposal pecahan full-stack — tiket, branch, worktree, urutan PR, dan cleanup — dalam satu tabel, lalu menunggu approve/override/skip. slice-it memiliki peta lifecycle dari lahir sampai teardown; fork-it tetap authoritative untuk dekomposisi tiket pada `loop`; teardown dieksekusi pr-flow pasca-merge.

## User Stories

1. As a user, I want a split proposal before any `full`/`loop` work starts, so that I approve the shape before code exists.
2. As a user, I want every ticket to get its own branch, so that no work is merged together by accident.
3. As a user, I want blocked tickets stacked on their blocker's branch, so that each PR's diff stays reviewable.
4. As a user, I want independent tickets executable in parallel worktrees, so that wall-clock shrinks without merge conflicts.
5. As a user, I want the proposal to name the merge order, so that stacked PRs land correctly.
6. As a user, I want cleanup declared up front, so that merged branches and worktrees don't become zombies.
7. As a user unfamiliar with harness mechanics, I want each ticket's execution mode stated plainly, so that approving requires no worktree knowledge.
8. As a framework maintainer, I want the proposal serialized to `.trust/<slug>/plan.md`, so that resume reads written state, not memory.
9. As a reviewer, I want per-ticket review scheduled in the plan, so that every review answers one question.
10. As a user, I want to override or skip the proposal, so that discipline never becomes a hard gate.

## Decisions Already Made

- Trigger scope: `full` + `loop` only; `fast` untouched.
- Preflight: before drafting, the agent verifies a clean `git status`, a current base, and the tools the Verify column will call — a dirty or stale ground is reported, never built on.
- The Undo column names the retreat command per ticket (revert / worktree-remove+branch-delete / close-PR); Cleanup is the scheduled end, Undo is the emergency exit.
- Proposal shape: always the full-stack table (Ticket | Branch | Worktree | PR | Cleanup | Undo | Verify), even when it holds one row.
- Mechanism: new skill `skills/engineering/slice-it/` + router lines (AGENTS.md §1 + §2 trigger-matrix row).
- Mechanical signal: new RULE in `scripts/stack-select.mjs` emitting `slice-it` (+ `engineering-small-prs` where installed) on split-related keywords — keyword hint, never proof.
- Worktree: plain `git worktree`, one per parallel writer, harness-agnostic; **no Orca/orca-cli dependency**.
- Authority: entry proposal is provisional; on `loop`, `fork-it` produces the authoritative decomposition after the spec gate — single source of truth per phase.
- Teardown: contract owned by `slice-it` (it owns the mapping, so it owns the unmapping), executed by `pr-flow` post-merge — worktree remove + local/remote branch delete + ticket marked landed.
- Execution mode per ticket stated in plain language inside the proposal.
- slice-it is **model-invoked** (no `disable-model-invocation`) — automatic suggestion is the point; fork-it/make-it-so stay user-invoked.

## Testing Decisions

- Good test here: structural assertions in `scripts/*.test.mjs` (`check()` pattern), plus behavioral eval fixture for the proposal-fires-on-classify behavior.
- Modules tested: `stack-select.mjs` rule output; skill file existence/mirror parity (covered free by `plugin.test.mjs` D1/E1); router trigger-matrix row presence.
- Prior art: `plugin.test.mjs`, `mandatory-gate.test.mjs`, `reinject.test.mjs` (fail-first structural guards).

## Constraints

- Propose & wait only — never a hard gate; user may approve, override, or skip, and a skip is recorded.
- No duplication of fork-it's vertical-slice rules or ticket template — slice-it cites, never re-defines.
- No `disable-model-invocation` on slice-it; no MANDATORY-domain promotion (it is not an Iron-Law gate).
- `fast` class gains zero ceremony.
- Mirror contract: canonical → `plugin/skills/slice-it` + per-harness payloads byte-identical (`sync-payloads.mjs`).
- Skill description stays short and trigger-pure (context budget, router §8).
- `plugin.json` skill-count strings updated (13→14); CHANGELOG entry; version bump.

## Acceptance Criteria

1. (US1, human verification/eval) A prompt classifying `full` or `loop` produces a split-proposal table containing Ticket/Branch/Worktree/PR/Cleanup/Undo/Verify columns before production work begins.
2. (US1, automated test) `AGENTS.md` §2 trigger matrix contains a row mapping "work classified full or loop is about to start" to `slice-it`.
3. (US4+US6, automated test) `skills/engineering/slice-it/SKILL.md` exists, is model-invoked, contains `git worktree`, and contains no `orca` reference.
4. (US2/US3/US5, automated test) skill text states: blocked tickets stack on the blocker's branch; a PR on an open PR targets that PR's branch.
5. (US6, automated test) skill text declares the teardown contract: `git worktree remove` + branch deletion after merge, executed via `pr-flow` post-merge.
6. (US8, automated test) skill text requires serializing the proposal to `.trust/<slug>/plan.md`.
7. (US-loop, automated test) skill text marks the `loop` proposal provisional and names `fork-it` the authoritative decomposition.
8. (mechanical signal, automated test) `stackSkillsForPrompt` returns `slice-it` for a split/breakdown prompt — new `scripts/stack-select.test.mjs`, fail-first.
9. (mirror, automated test) `node scripts/plugin.test.mjs` passes with `slice-it` present flat and byte-identical.
10. (metadata, automated check) `plugin.json` says 14 skills; `CHANGELOG.md` has a `0.1.63` entry — `changelog-guard` + `doctor` pass.
11. (regression) `fork-it` spec gate and ticket template unchanged — `node scripts/tickets.test.mjs` and `plugin.test.mjs` stay green.

## Out of Scope

- A MANDATORY-gate domain or hard gate for split proposals.
- Changes to fork-it's internals, ticket format, or spec gate.
- Orca/orchestration integration; harness-specific worktree helpers.
- Auto-dispatching subagents (proposal suggests; it never dispatches).

## Open Questions

- Whether to add a `slice-it` scenario to `evals/scenarios.md`/self-trigger battery now, or land the skill first and measure.
- Version bump convention for skill additions (patch `0.1.63` assumed — confirm at PR time).
