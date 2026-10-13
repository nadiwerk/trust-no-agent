# Spec: decision composition — external skills join the trust-no-agent router

Status: draft (breakpoint complete 2026-10-13; awaiting Master approval before publish)
Date: 2026-10-13
Origin: breakpoint session 2026-10-13 (3 frontier rounds, 11 decisions locked). Composable
typed-decision patterns from external research were the architectural inspiration; this
spec is trust-no-agent-native and deliberately names no external products.

## Problem Statement

Sebagai pemilik trust-no-agent, saya ingin framework ini bisa dikomposisikan dengan skill
buatan sendiri (atau adopter) tanpa memfork framework: trust-no-agent tetap router dan
workflow utama, dan skill eksternal bisa **menambah step** ke alur yang sudah ada — contoh:
skill fokus-error menambah langkah verifikasi tambahan setelah Phase 1 root-cause. Hari ini
skill hanya bisa masuk lewat dua jalan yang sama-sama cacat: menambah ke `skills/` (masuk
payload plugin, mirror, byte-identity — churn untuk setiap skill pribadi) atau tidak masuk
sama sekali (pengetahuan user mati di luar framework). Yang saya butuhkan: satu mekanisme
resmi, tervalidasi, keyless, di mana skill eksternal mendeklarasikan **kapan** ia aktif
(trigger) dan **di mana** ia menempel (anchor per-fase), sementara aturan baja framework —
skill eksternal boleh menambah step, tak pernah mengurangi gate — dijaga mekanis.

## Solution

Dari sudut pandang user: adopter menaruh skill-nya di `.trust/skills-overlay/<nama>/SKILL.md`
dengan frontmatter YAML (`name`, `extends`, `triggers` opsional, `role`). Framework:
(1) memvalidasi registry tiap kali dibaca (anchor harus ada di katalog fase kanonik yang
*diturunkan* dari heading SKILL.md kanonik; role hanya boleh insert-before/insert-after/wrap);
(2) menyusun floor sesi dengan **kanonik lebih dulu, penuh** — Iron Laws + bagian MANDATORY
selalu utuh, sisa budget diisi entri overlay bertanda `user:` (nama bertabrakan ditandai,
tak pernah menimpa); (3) mekanisme kegagalan fail-open — sesi jalan, dokter merah menunjuk
skill rusak; (4) doctor memverifikasi registry (file ada, frontmatter valid, anchor valid,
role legal) dan melaporkan hitungan overlay yang terpotong budget. Trigger bekerja dua arah:
matriks kata kunci otomatis (overlay yang mendeklarasikan triggers) + pemanggilan eksplisit
user (semua overlay, termasuk yang tanpa triggers). Eksekusi tetap kontrak teks dieksekusi
agent — tidak ada engine runtime baru. Fitur ini adalah **sistem decision TNA sendiri**:
memperluas mesin keputusan yang ada (gate, classifier, judge) dengan kemampuan mengomposisi
unit keputusan eksternal ke dalam workflow. Pola eksternal hanyalah inspirasi; tidak ada
permukaan API yang dikirim di fitur ini.

## User Stories

1. As an adopter, I want to register my own skill (e.g. error-forensics) in
   `.trust/skills-overlay/` without touching the repo's `skills/` directory, so that my
   expertise joins the workflow without forking the framework.
2. As an adopter, I want my skill triggered automatically by the keyword matrix on relevant
   prompts, so that I never have to remember to load it.
3. As an adopter, I want to invoke my overlay explicitly at any time, so that automatic
   triggering never blocks manual use.
4. As an adopter, I want my skill to declare where it attaches in the workflow (a per-phase
   anchor, e.g. `extends: root-cause/Phase-1`), so that its steps run at the right moment.
5. As an adopter, I want my skill to declare its role (`insert-before` / `insert-after` /
   `wrap`), so that composition is explicit and reviewable.
6. As the maintainer, I want any overlay trying to replace or remove a canonical step to be
   mechanically rejected, so that an external skill can never subtract a gate.
7. As the maintainer, I want overlay entries marked distinctly (`user:` prefix) in the
   session floor, so that the agent knows the authority difference between MANDATORY
   framework skills and user overlays.
8. As a newcomer, I want the canonical floor (Iron Laws + MANDATORY section) emitted in full
   regardless of overlays, so that a broken overlay never degrades the core discipline.
9. As the maintainer, I want name collisions between overlay and canonical skills allowed
   but namespaced (`user:<name>`), so that experimentation never shadows the framework.
10. As an adopter, I want a broken or malformed overlay to never break my session, so that a
    typo in my frontmatter does not take down the framework.
11. As an adopter, I want the doctor to report every overlay defect by name (missing skill
    file, invalid anchor, illegal role, malformed frontmatter), so that I can find what is
    broken.
12. As the maintainer, I want the floor budget bounded with canonical priority, so that the
    tested floor bound (<4000 chars) keeps holding.
13. As the maintainer, I want the count of overlays omitted by the budget reported, so that
    truncation is never silent.
14. As the maintainer, I want the mechanism to add zero runtime dependencies and stay keyless,
    so that the framework keeps its zero-dep, no-API-key culture.
15. As the maintainer, I want overlay skills to live outside the plugin payload, so that
    mirror byte-identity and marketplace cleanliness are untouched.
16. As an agent, I want the floor to name exactly which overlays to load, in what order, with
    their anchors, so that composition is deterministic at session start.
17. As an adopter, I want a decision-pattern overlay skill (teaching typed decision
    primitives: choice / score / yes-no with calibrated confidence) as the first citizen, so
    that the mechanism is proven with a real, non-trivial skill on day one.
18. As the maintainer, I want the spec to reference no external product names, so that the
    feature identity stays trust-no-agent-native.
19. As a future maintainer activating the deferred decision-API-provider option, I want the
    layering rule written down, so that a judgment provider never becomes a second routing
    system.
20. As the maintainer, I want overlay trust computed at read time (validator re-runs every
    doctor run), so that trust is a computed verdict, never a cached table claim.
21. As an adopter, I want overlay metadata as frontmatter inside the SKILL.md itself, so
    that one file is one skill.
22. As an adopter, I want `triggers` optional (absent = explicit-invocation-only), so that
    manual-only skills do not pollute the keyword matrix.
23. As the maintainer, I want the anchor catalog derived from canonical skill phase headings,
    so that anchors cannot drift from the skills they reference.
24. As an agent, I want overlay steps executed exactly like canonical skill steps (text
    contract, agent-executed), so that no runtime engine is needed.
25. As the maintainer, I want eval checks pinning the composition contract (add-only roles,
    `user:` prefix, canonical-first), so that the mechanism cannot silently regress.

## Decisions Already Made

- **Registry**: `.trust/skills-overlay/<name>/SKILL.md` — private per-project (gitignored),
  discovered by directory scan, outside the plugin payload. (Breakpoint round 1, Q1)
- **Trigger**: both — keyword matrix (automatic, in the session floor) and explicit user
  invocation, always available. (Round 1, Q2)
- **Anchor**: per-phase, e.g. `extends: root-cause/Phase-1`; the anchor catalog is derived
  from canonical skill phase headings (single source of truth), not hand-maintained.
  (Round 1, Q3 + round 3, identity discussion)
- **Role**: `insert-before` / `insert-after` / `wrap` only; `replace` / `remove` / `skip`
  are rejected by the validator — the add-only-never-subtract rule, mechanically enforced.
- **Authority marking**: overlays are second-class citizens — the floor marks them `user:`
  (name collisions namespaced, never shadowing canonical); the agent is told overlays may
  add steps and may never relax a gate. (Round 1, Q4)
- **Failure mode**: fail-open — a broken overlay never blocks the session; the doctor
  reports it (red) instead. (Round 1, Q5)
- **Metadata**: YAML frontmatter in the SKILL.md head — required `name`, `extends`, `role`;
  optional `triggers` (absent = explicit-only). (Round 2, Q6)
- **Name collisions**: allowed with `user:` prefix; both the canonical name and `user:<name>`
  appear in the floor. (Round 2, Q7)
- **Budget**: canonical floor first and complete; overlays fill the remainder in anchor
  order; omitted overlays are counted and reported by the doctor as a warning (never a
  failure, never silent). The existing floor bound (<4000 chars) is preserved. (Round 2, Q8)
- **Feature identity**: "decision composition" — trust-no-agent's own extension of its
  decision machinery (gates, classifier, judge) with composable external decision units.
  No external product is named anywhere in this spec; external patterns are inspiration
  only.
- **Connection direction chosen**: overlay-skill composition — the framework's decision
  machinery gains composable external units; no API surface is added. (Round 3)
- **First citizen**: a decision-pattern overlay skill (typed decision primitives:
  choice / score / yes-no with calibrated confidence), sourced from the maintainer's local
  skill collection, installed into the overlay directory with frontmatter added. It is the
  proof the mechanism works. (Round 3)
- **Deferred with reasons**: (A) the framework as an MCP/HTTP provider exposing its
  verdicts — new network/auth/trust surface vs zero-dep local culture; (B) the framework
  consuming an external hosted decision-model API for its judgment slot — reverses the
  explicit no-API-key rejection (K6/K9 doctrine). Both recorded in Out of Scope, not
  rejected outright. (Round 3)
- **Layering rule for deferred B** (recorded now so activation cannot fork the architecture):
  a decision-API provider would enter the *existing* trigger and judgment tiers as an
  optional provider — keyword matrix stays tier one (free, deterministic), provider last
  resort — and would never become a second routing system. The key would arrive as adopter
  env config (the same pattern `behavioral-eval/run.mjs` already uses for its external
  endpoint); absent key = `inconclusive`, never a fabricated verdict.
- **Execution model**: text contract, agent-executed — the floor names the skills and their
  anchors; the agent runs the steps, exactly as it does for the 11 canonical skills today.
  No runtime engine, no phase-execution machinery.
- **Anchor derivation rule**: anchors derive from canonical skill phase headings where they
  exist; a canonical skill without phase headings exposes no anchors, so no overlay can
  attach to it (attachment requires a named phase). This keeps the catalog a derived,
  single-source artifact.
- **Module surface** (decisions, not paths): a pure registry parser/validator seam; a pure
  floor-composition seam (bounded, canonical-first); doctor wiring that recomputes overlay
  trust at read time; one eval check pinning the contract. Existing seams preferred over new
  ones (see Testing Decisions).

## Testing Decisions

- **Primary seam**: two pure functions, tested as external behavior — the registry parser
  (frontmatter in → parsed entries + named errors) and the floor composer (canonical floor +
  overlay entries → bounded floor text, canonical first). One seam each, following the
  repo's prior art: `validateBehavioralEval` (behavioral-eval), `parseLessons`/`classify`
  (stale-probe), `firstRunVerdict`/`runGate` (first-run).
- **Wiring smoke**: a live-derivation test against the real `.trust/skills-overlay/` — the
  pattern of gate-hook.test's E-section and stale-probe.test's H-section (the real tier
  parses; a suite pinning only the pure seam would stay green with the directory scan
  deleted).
- **Doctor**: unit tests for each overlay-defect verdict (missing file, bad anchor, illegal
  role, malformed frontmatter, budget-omission count), plus the live doctor run proving the
  validator is wired — the K-group precedent in doctor.test.mjs.
- **eval**: one new check pinning the composition contract (add-only roles, `user:` prefix,
  canonical-first), pinned in eval-adapter.test.mjs like checks 39-42.
- **What counts as a good test here**: external behavior only — floor text, doctor verdicts,
  parser errors, eval markers. Never implementation details (no asserting on internal call
  order or data structures beyond the documented frontmatter shape).

## Constraints

1. Zero new runtime dependencies (repo-wide rule; the parser reads YAML frontmatter with
   node builtins only).
2. Keyless by default — no API key is ever required for the framework to run; the feature
   introduces no network surface.
3. Add-only-never-subtract: `replace` / `remove` / `skip` roles are rejected by the
   validator; the canonical Iron Laws and MANDATORY section can never be altered by an
   overlay.
4. Canonical floor first and complete — overlays fill only the budget remainder.
5. The floor stays bounded (the existing <4000-char guarantee holds; an E1-equivalent test
   pins it).
6. Overlays live in `.trust/skills-overlay/` — outside the plugin payload; mirror
   byte-identity and marketplace cleanliness are untouched (plugin.test stays green with
   zero plugin-file changes).
7. Session fail-open: a broken overlay never blocks the session; the doctor reports it.
8. No silent truncation: budget-omitted overlays are counted and reported by the doctor.
9. Trigger priority: canonical MANDATORY routing keeps priority; overlays add domains only.
10. The anchor catalog is derived from canonical skill phase headings, not hand-maintained.
11. Overlay execution is text-contract/agent-executed — no runtime engine.
12. No external product is named in this spec or in shipped user-facing material for this
    feature; external patterns are inspiration only.
13. Overlay trust is recomputed at read time on every doctor run — never cached.

## Acceptance Criteria

1. (US1) A well-formed overlay (valid frontmatter `name`/`extends`/`role`, parseable
   SKILL.md) yields zero registry errors. — automated test (registry parser seam).
2. (US4) An overlay whose `extends` names a phase that does not exist in the derived anchor
   catalog is rejected with a named error identifying the bad anchor. — automated test.
3. (US5/US6) An overlay declaring role `replace`, `remove`, or `skip` is rejected with a
   named error; only `insert-before`/`insert-after`/`wrap` are accepted. — automated test.
4. (US7) The composed floor marks every overlay entry with the `user:` prefix, distinct from
   MANDATORY entries. — automated test (floor composer seam).
5. (US8) With any number of overlays registered, the composed floor emits the Iron Laws and
   the MANDATORY section verbatim and complete, before any overlay entry. — automated test.
6. (US12) The composed floor stays under the existing bound (<4000 chars) with a registry
   sized so the composed floor would exceed it without the budget rule (boundary-exercising
   fixture). — automated test.
7. (US9) An overlay named identically to a canonical skill appears in the floor as
   `user:<name>` alongside the canonical entry, never in its place. — automated test.
8. (US10) A malformed overlay (bad YAML, missing `extends`) leaves the floor's canonical
   portion byte-identical to the no-overlay floor, and is reported by the doctor. —
   automated test (composer ignores broken entries; doctor unit test).
9. (US11) The doctor names every overlay defect by skill and kind (missing file, bad anchor,
   illegal role, malformed frontmatter). — automated doctor test + live doctor run.
10. (US13) When overlays exceed the budget, the doctor reports the count of omitted overlays
    (a number, never silence). — automated test.
11. (US14) The feature introduces no new runtime dependency (static scan: no `import` of
    anything outside `node:` in the new modules; the local-judge A-section precedent). —
    automated test.
12. (US15) The plugin SKILLS payload (`plugin/skills/` and its four mirror
    directories) is unchanged by this feature — no overlay content ever
    enters the payload; the mechanism modules ARE vendored into
    `plugin/scripts/` byte-identical (the vendored hook imports them),
    guarded by plugin.test. — existing test suite + diff check in review.
13. (US16) The composed floor is deterministic: identical registry + identical canonical
    floor produce byte-identical output. — automated test.
14. (US22) An overlay with absent/empty `triggers` parses as explicit-only and does not
    enter the keyword matrix. — automated test.
15. (US23) The anchor catalog is derived from canonical skill headings: an overlay anchored
    to a real phase passes; one anchored to nothing fails; adding a phase heading to a
    canonical skill makes the previously-failing anchor pass without any registry edit. —
    automated test (round-trip against the real skills).
16. (US20) Overlay trust is computed at read time: mutating a registry file and re-running
    the doctor changes the verdict with no cache in between. — automated doctor test.
17. (US25) eval.mjs carries a new check pinning the composition contract (add-only roles
    named, `user:` prefix named, canonical-first named), pinned in eval-adapter.test.mjs. —
    automated eval check + adapter pin.
18. (US17) The first-citizen overlay exists in `.trust/skills-overlay/` with valid
    frontmatter and parses clean, and its `extends` anchor resolves against the derived
    catalog. — automated registry smoke (live-derivation test).
19. (US18) The spec contains no external product name (a grep over the spec file for the
    two most recent external product names discussed with the owner returns zero hits). —
    automated test (spec-scrub check).
20. (US19) The spec's Out of Scope entry for the deferred decision-API-provider option
    states the layering rule and the env-key fail-closed pattern. — human verification at
    spec review.
21. (US24) No runtime engine exists: the feature adds no phase-execution machinery (the
    floor is text; execution stays with the agent) — verified by review + the absence of any
    new long-running process in the diff. — human verification.

## Out of Scope

- **The framework as an MCP/HTTP provider** exposing its verdicts to other systems (deferred
  A). New network/auth/trust surface against the zero-dep local culture.
- **The framework consuming an external hosted decision-model API** for its judgment slot
  (deferred B). Reverses the explicit no-API-key rejection (K6/K9 doctrine); if ever
  activated: the key arrives as adopter env config (the same pattern
  `behavioral-eval/run.mjs` already uses for its external endpoint), absent key =
  `inconclusive`, and the provider enters the *existing* trigger/judgment tiers as an
  optional last resort — keyword matrix stays tier one — and never becomes a second routing
  system.
- Runtime workflow engine (phase-execution machinery); overlays are text contracts executed
  by the agent, like the 11 canonical skills.
- Auto-downgrade or decay for overlay trust claims (the autonomy ladder stays per-harness).
- Distributing overlays through the plugin marketplace payload.
- Any network, API, or key surface in this feature.
- Overlay skills for the delegation-brief template (J2) — never discussed.

## Open Questions

- Ordering when multiple overlays attach to the same anchor — never discussed.
- Whether the doctor should audit overlay skills for staleness (21-day re-verification, the
  lessons-tier pattern) — never discussed.
- Whether explicit invocation bypasses the keyword matrix entirely — assumed yes in the
  design, never confirmed with the owner.
