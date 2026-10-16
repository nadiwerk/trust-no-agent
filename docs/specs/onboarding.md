# Spec: onboarding — first-run consent + skill mapping

Status: draft (breakpoint complete 2026-10-14, 11 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-14
Origin: breakpoint session 2026-10-14 (3 frontier rounds, 11 decisions locked).
Companion to decision-composition (v0.1.28) — onboarding is the front door that
makes the router, the gates, and the overlay mechanism discoverable and consented.

## Problem Statement

As a new adopter, when first installing trust-no-agent I face a pile of
files (AGENTS.md, WORKFLOW.md, 12 skills, hooks, doctor) with no single
official door: what am I consenting to when this framework goes active in
my sessions? (the commit veto without evidence, the per-session floor, the
receipt discipline). Skills already installed on my machine are not mapped
into the workflow — they die outside the framework. Installation also has
gaps nobody has named: Codex skips the hook until the user trusts it, older
machines have no consent stamp, and "update later" is left unexplained.
What I need: one onboarding command that (1) asks explicit consent per
component, (2) maps installed skills and proposes merging them into the
workflow, (3) issues a receipt + an undo path — without breaking a single
existing install.

## Solution

From the adopter's point of view: run `node scripts/onboard.mjs` once.
Onboarding: (1) shows a concise briefing of the router + floor (Iron Laws
+ the MANDATORY section) and the "what will change in your sessions"
briefing — including your harness's row from compatibility.md and the
Codex hook-trust warning when relevant; (2) asks for consent PER COMPONENT
(session floor / mechanical hooks / skill overlay / evidence gate — real
opt-in: what you decline is genuinely off, the doctor records it); (3)
scans installed skills (project + personal directories) and PROPOSES each
skill as an overlay (name + trigger keywords derived from its content),
which the adopter confirms or edits; names colliding with the 12 canonical
ones are skipped and recorded; (4) writes the `.trust/onboarding.json`
stamp (private, per-machine) + the approved overlays; (5) closes with a
4-block receipt. `--map-only` re-runs the mapping when new skills are
installed without asking for consent again; `--undo` reverses everything
onboarding did. Existing installs (hooksPath + skills found, no stamp) are
GRANDFATHERED: the doctor prints a warn "run onboard.mjs for stamp +
briefing" and does not fail. The v1 package also carries: the per-harness
briefing, the Codex hook-trust warning, the first-task rehearsal (a guided
procedure: recite the 4 Iron Laws + one task through the receipt shape),
and the exit + update section.

## User Stories

1. As a new adopter, I want to run one command that asks my explicit consent
   per component before the framework's rules activate in my sessions, so
   that I know what I am agreeing to.
2. As a new adopter, I want a briefing of what changes in my sessions (the
   floor, the commit veto, the receipt discipline, the MANDATORY skills)
   before the first veto ever denies me, so that expectations are set before
   the denial.
3. As an adopter on a specific harness, I want to see my harness's row from
   the compatibility table at onboarding (what is mechanical vs prose on my
   harness), so that I know which guarantees actually hold where I work.
4. As a Codex adopter, I want the one-time hook-trust step named loudly
   during onboarding, so that my install is not silently running without
   the discipline floor.
5. As an adopter with skills already installed, I want them discovered
   (project + personal directories) and proposed as overlays with suggested
   frontmatter I can confirm or edit, so that my expertise joins the
   workflow instead of dying outside it.
6. As an adopter, I want a skill whose name collides with a canonical skill
   skipped with a recorded note, so that I do not duplicate what the
   framework already provides.
7. As an adopter, I want my consent to be REAL — a component I decline is
   mechanically off (declining the evidence gate means commits stop being
   vetoed), so that the menu is not decoration.
8. As an adopter, I want the consent stamp private (`.trust/`, gitignored)
   while the router stays tracked, so that my personal consent does not leak
   into the shared repo.
9. As an adopter, I want `--map-only` to re-scan when new skills appear
   without re-asking consent, so that the mapping never goes stale.
10. As an adopter, I want `--undo` to reverse everything onboarding did
    (stamp, overlays it created, hooksPath if it set it), so that leaving is
    as clean as arriving.
11. As an adopter, I want a 4-block receipt on every onboarding run (what
    was consented, what was mapped, what is pending, what is next), so that
    the setup itself follows the framework's own discipline.
12. As an adopter, I want a guided rehearsal (recite the four Iron Laws +
    one small task through the receipt shape) as the last step, so that I
    have seen the discipline alive once, not only read it.
13. As an adopter, I want the exit and update paths explained (how to remove
    cleanly, how updates are detected), so that onboarding does not trap me.
14. As an existing adopter upgrading to this version, I want my working
    install to keep working (grandfathered, warned to run onboarding), so
    that the update never reddens my machine.
15. As the maintainer, I want the doctor to record declined components by
    name, so that a lighter install is a visible decision, not a silent one.
16. As the maintainer, I want the onboarding contract pinned by an eval
    check, so that the front door cannot silently regress.
17. As the maintainer, I want the onboarding user-facing text to name no
    external products, so that the framework keeps its own vocabulary
    (the decision-composition discipline, extended).
18. As an adopter, I want non-interactive mode (`--yes`) for scripted
    installs, so that automation is possible without pretending to be a
    human.
19. As an adopter, I want the suggested trigger keywords to be proposals
    only — nothing lands without confirmation (interactive) or explicit
    `--yes`, so that a bad heuristic never silently enters my session floor.
20. As the maintainer, I want the onboarding CLI runnable only by a human
    (not an agent-driven skill), so that consent never flows through an
    agent.

## Decisions Already Made

- **Front door**: `scripts/onboard.mjs`, human CLI; agents point at it, they
  never drive it. Non-interactive: `--yes` (default menu), `--map-only`
  (re-scan), `--undo` (reverse). (Round 1 Q1, round 3 Q10)
- **Consent granularity**: per component — floor / hooks / overlays /
  evidence gate — each opt-in. (Round 1 Q2)
- **Consent is real**: a declined component is mechanically off; the doctor
  records "declined at onboarding". No menu decoration. (Round 2 Q8)
- **Discovery scope**: project directories (./skills, project
  .agents/.claude/.cursor/.opencode skills dirs) + personal directories
  (~/.agents/skills, ~/.claude/skills, ~/.omo/agent/skills) — the doctor C3
  discovery surface. (Round 1 Q3)
- **Merge depth**: propose per skill — name + suggested trigger keywords
  from the skill's own content; the adopter confirms or edits interactively
  (or `--yes` accepts). Anchors are left empty by default (explicit-only);
  attaching to a phase is the adopter's edit. (Round 1 Q4)
- **Canonical collision**: skipped with a recorded note (the 12 canonical
  names are the skip set). (Round 1 Q5)
- **Stamp**: `.trust/onboarding.json` — private, gitignored, per-machine:
  consentedAt, routerVersion, components, harness, and what onboarding did
  (for `--undo`). (Round 1 Q1/Q6)
- **Cadence**: consent once (stamp); `--map-only` re-scans for new skills
  without re-consenting. (Round 1 Q6)
- **Extras in v1** (all five): the what-changes briefing; the per-harness
  briefing (read from compatibility.md's verdict rows — one source; the
  briefing DEGRADES to a generic note when compatibility.md is absent,
  because plugin installs carry no docs/ and a missing source must never
  break the front door); the Codex hook-trust warning (detected via
  ~/.codex/config.toml presence); the guided first-task rehearsal (a
  PROCEDURE the adopter runs with the agent — recite the Iron Laws, one
  small task through the receipt shape — not an automated test); the exit +
  update section. (Round 2 Q7)
- **Output**: 4-block receipt on every run; `--undo` reverses the stamp,
  the overlays onboarding created, and hooksPath if onboarding set it.
  (Round 2 Q9)
- **Existing installs**: grandfathered — hooksPath set + skills found + no
  stamp = doctor WARN ("run onboard.mjs for stamp + briefing"), never fail.
  (Round 3 Q11)
- **Module surface** (decisions, not paths): a pure planning seam (discovery
  + proposal + skip logic), a pure stamp seam (parse/serialize), a pure
  grandfather verdict in doctor-checks (the hookVerdict/overlayVerdict
  precedent), the CLI, the doctor wiring, and one eval check. Existing
  seams preferred over new ones (see Testing Decisions).

## Testing Decisions

- **Primary seam**: two pure functions — the onboarding planner
  (discovered skills + canonical names + existing overlays → proposals +
  skipped + notes) and the grandfather verdict (hooksWired + skillsFound +
  stamped → warn/pass). Tested as external behavior; prior art:
  `validateBehavioralEval`, `overlayVerdict`, `firstRunVerdict`.
- **CLI smoke**: non-interactive runs (`--yes`, `--map-only`, `--undo`)
  against temp fixture directories with a spawned child process — the
  gate-hook.test F-section / doctor.test P-section pattern. Assertions: the
  stamp's shape, the overlays created and registry-valid, `--map-only`
  adding only the new skill, `--undo` leaving the tree as found.
- **Interactive path**: the consent + proposal flow driven through piped
  stdin (the gate-hook.test input pattern), asserting the recorded choices
  match the piped answers.
- **Doctor**: unit tests for the grandfather verdict both directions, plus
  the live doctor run proving the wiring (the K-group precedent).
- **eval**: one new check (44) pinning the onboarding contract — the seam
  exists, the consent-is-real rule named, grandfather named — pinned in
  eval-adapter.test.mjs like checks 39-43.
- **What counts as a good test here**: external behavior only — CLI output,
  stamp shape, doctor verdicts, floor composition. Never implementation
  details.

## Constraints

1. Zero new runtime dependencies; keyless; no network; the CLI is plain
   Node.
2. Consent is human-CLI only — never an agent-driven skill surface.
3. Consent is real: a declined component is mechanically off, and the
   doctor records it by name. The evidence gate is the boundary component —
   its opt-out weakens the repo's fail-closed posture by the adopter's
   explicit choice, so the doctor names it loudly (a lighter install is a
   visible decision, never a silent one).
4. No existing install ever breaks: the grandfather path warns, never
   fails; `--undo` reverses only what onboarding did.
5. The stamp is private (`.trust/`, gitignored, per-machine); the router
   stays tracked (per-repo). Consent is personal.
6. Suggested trigger keywords are proposals: nothing lands without
   interactive confirmation or explicit `--yes`.
7. Canonical collisions are skipped and recorded, never registered.
8. A 4-block receipt is emitted on every run — the setup follows the
   framework's own discipline.
9. The onboarding user-facing text names no external products.
10. The rehearsal is a guided procedure (the adopter runs it with the
    agent), not an automated test of the agent's behavior.
11. The per-harness briefing reads compatibility.md — never a second copy
    of the verdict data.

## Acceptance Criteria

1. (US1) A `--yes` run writes a valid `.trust/onboarding.json` stamp with
   the default components recorded and consentedAt set. — automated test
   (CLI smoke).
2. (US1/US2) The CLI output includes the what-changes briefing (floor,
   commit veto, receipt discipline, MANDATORY skills named) before asking
   for consent. — automated test (output shape).
3. (US3) With the evidence-gate component declined in the stamp, a live
   hook run no longer vetoes an evidence-less commit; with it consented,
   the veto fires. — automated test (gate-hook behavior with stamp
   fixtures, both directions).
4. (US4) Discovery finds fixture skills placed in a project directory and
   in a personal directory (HOME/USERPROFILE redirected for the child), and
   names each in the proposal output. — automated test (CLI smoke).
5. (US5) Each discovered skill produces a proposal carrying a suggested
   name and at least one suggested trigger keyword derived from the skill's
   own content. — automated test (planner seam).
6. (US5/US19) With piped interactive answers, exactly the confirmed skills
   land as overlays; with no confirmation (aborted input), nothing lands.
   — automated test (interactive path).
7. (US5) Confirmed overlays parse clean through the registry seam and
   appear in the composed floor marked `user:`. — automated test (registry
   + composer seams).
8. (US6) A skill whose name matches one of the 12 canonical names is
   skipped and appears in the run's skipped list, never as an overlay.
   — automated test (planner seam).
9. (US9) `--map-only` on a tree with one new skill since the stamp adds
   exactly that skill and does not re-ask consent (no prompt, exit 0).
   — automated test (CLI smoke).
10. (US10) `--undo` on an onboarded tree removes the stamp and the overlays
    onboarding created, restores hooksPath if onboarding set it, and leaves
    pre-existing files untouched (verified by before/after tree hashes).
    — automated test (CLI smoke).
11. (US11) Every run's output carries the four receipt blocks (consented /
    mapped / pending / next), named. — automated test (output shape).
12. (US14) The live doctor on a tree with no stamp and a working-install
    signal (hooksPath set OR skills found) prints the grandfather WARN
    naming onboard.mjs and exits 0; with the stamp present the warning is
    gone. — automated doctor test + live run.
13. (US15) The doctor on a tree whose stamp declines the evidence gate
    records the declined component by name. — automated doctor test.
14. (US4) On a tree with ~/.codex/config.toml present, the onboarding
    output names the one-time hook-trust step. — automated test (CLI
    smoke).
15. (US16) eval.mjs carries check 44 pinning the onboarding contract (the
    seam named, consent-is-real named, grandfather named), pinned in
    eval-adapter.test.mjs. — automated eval check + adapter pin.
16. (US17) The onboarding user-facing strings contain no external product
    name (grep over the CLI's output strings — the spec-scrub discipline
    extended to shipped text). — automated test.
17. (US18) `--yes` in a non-TTY environment (piped stdin, no prompt)
    completes and writes the stamp — scripted installs possible. —
    automated test.
18. (US8) The stamp file is gitignored (`git check-ignore` confirms) and
    lives under `.trust/`. — automated test.
19. (US20) The onboarding is invocable only as a human CLI: importing the
    module does not run the flow (the argv guard precedent), and no skill
    surface drives it. — automated test + review.
20. (US13) The exit + update section appears in the onboarding output
    (named, not decorative). — automated test (output shape).

## Out of Scope

- An agent-driven onboarding skill (consent through an agent) — decided
  against; the CLI is the only surface.
- Auto-wiring hooksPath without consent (hooks is an opt-in component;
  onboarding offers, consent decides).
- Writing to the tracked router files — the router is per-repo; onboarding
  is per-machine.
- Migrating or rewriting existing overlays created outside onboarding.
- Any network, API, or key surface.
- The rehearsal as an automated test of the agent's recital — it is a
  guided procedure the human runs.

## Open Questions

- Harness detection for the per-harness briefing (config-dir presence vs
  asking the adopter) — never discussed.
- The exact default menu for `--yes` (assumed: floor + hooks + overlays;
  evidence gate default) — never confirmed.
- Whether `--yes` is acceptable for team/CI installs (automation consenting
  on a human's behalf) — assumed yes, never discussed.
- Trigger-keyword suggestion quality (count, source headings) — heuristic
  to be tuned against the first real skills, never specified.
