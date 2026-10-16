# Spec: receipt enforcement — the hilir (downstream, end of chain) side becomes steel

Status: draft (breakpoint complete 2026-10-14, 11 decisions locked; awaiting Master
approval before publish)
Date: 2026-10-14
Origin: breakpoint session 2026-10-14 (3 frontier rounds, 11 decisions locked).
Companion to the hulu (upstream, front of chain) strengthening chain: where
breakpoint/save-as/fork-it sharpened
intent at the chain's front, this spec makes the done-claim at the chain's back
un-cheatable.

## Problem Statement

As the owner of trust-no-agent, I reject four deviations at the end of the
chain: **fabricated evidence** (*membuat-buat*: a "36/36 gates green" claim without a
real run), **the blanket yes** (*iya-iya*: an "all-yes" verdict without per-point
justification), **undisciplined** (units closed without a receipt), and
**melewati receipt** (a done-claim landing in a commit without a valid
receipt). Today the hilir machinery checks the
PRESENCE + FRESHNESS of evidence — M9 flags all-yes claims lacking
evidence, but a fabricated citation slips through; the only mechanical
cross-check is the commit veto (the evidence-test state file), not the
prose receipt in the ledger. Old claims are never re-verified. What I
need: receipts whose evidence is per-point and literal, bypass denied all
the way to the commit, and claims that decay with time like the autonomy
ladder.

## Solution

From the maintainer's point of view: every closed unit writes a prose
receipt in the ledger — but that receipt is now **shape-validated**: five
booleans (constraints satisfied / evidence fresh / scope held / subject
verified / fail-first proven), each of which MUST carry its own evidence
(a blanket "all-yes" verdict is rejected), and the cited verification
commands must be literal and among the repo gates (an allowlist derived
from ci.yml — "tests pass" is not evidence, and non-repo commands are
rejected as proof). Ledger-audit (already running in CI + pre-commit)
checks every entry: a done-claim without a valid receipt is a HARD
finding. The commit veto is extended: the NEWEST ledger entry must carry a
valid receipt, otherwise the commit is DENIED with a named reason — the
receipt becomes a prerequisite for landing, not documentation. Claims
older than 14 days are treated as STALE (computed, not remembered) and
must be re-verified before they may GATE anything: re-verification = the
audit RUNNING the cited gate command through the hardened runner (no
shell, allowlist, timeout — the stale-probe pattern). A claim's status
follows the stale-probe statuses: fresh (<14 days) / re-verified (stale,
re-run passed) / stale (stale, re-run failed or not yet) / unverifiable
(no evidence command); only fresh and re-verified may GATE. Even fast
units get a MINIMAL mandatory receipt (one line: claim + command +
result) — nothing truly bypasses the receipt. Pre-feature entries are
GRANDFATHERED: warn, not fail. The doctor surfaces stale claims as a warn
at the start of a session.

## User Stories

1. As the maintainer, I want every full/loop receipt to carry per-boolean evidence
   (each of the five booleans justified, not one blanket sentence), so that a
   blanket-yes verdict cannot pass as a receipt.
2. As the maintainer, I want cited verification commands to be literal repo gates
   (an allowlist derived from the CI workflow), so that "tests pass" is not
   evidence and agent-authored commands cannot become proof.
3. As the maintainer, I want a done-claim without a valid receipt to hard-fail the
   audit, so that skipping the receipt is a visible defect, not a silent choice.
4. As the maintainer, I want the commit veto to deny when the newest ledger entry
   lacks a valid receipt, so that undisciplined work cannot land.
5. As the maintainer, I want a receipt claim older than 14 days to be computed as
   stale (never remembered as true), so that trust decays like the autonomy
   ladder.
6. As the maintainer, I want stale claims re-verified by RE-RUNNING their cited
   gate commands, so that old claims are proven with real runs, not trusted.
7. As the maintainer, I want the re-run hardened (no shell, interpreter allowlist,
   timeout — the stale-probe pattern), so that a re-run cannot become an injection
   surface.
8. As the maintainer, I want fast units to carry a minimal mandatory receipt (one
   line: claim + command + result), so that nothing truly skips the receipt.
9. As the maintainer, I want pre-feature ledger entries grandfathered (warn, never
   fail), so that a new rule never reddens history.
10. As the maintainer, I want the checks carried by ledger-audit (already in CI +
    pre-commit) and surfaced by the doctor at session start, so that they run
    without anyone remembering.
11. As the maintainer, I want the enforcement contract pinned by an eval check, so
    that it cannot silently regress.
12. As an adopter, I want the receipt template documented in the receipts skill and
    the receipt doc, so the enforced format is knowable before it bites.
13. As the maintainer, I want the veto's receipt linkage to be the newest ledger
    entry (simple, testable), so that the check cannot be gamed by diff-mapping.
14. As the maintainer, I want re-runs executed only for stale claims, so that the
    audit stays fast (a full battery per audit is not scalable).
15. As the maintainer, I want claim statuses to mirror the stale-probe vocabulary
    (fresh / re-verified / stale / unverifiable), so that one decay model governs
    memory and claims alike.

## Decisions Already Made

- **Surface**: the receipt stays prose in the ledger, but its SHAPE is validated:
  the four blocks mandatory, the five booleans each carrying their own evidence
  (blanket verdicts rejected), cited commands literal and allowlisted. (Round 1
  Q1)
- **Cross-check depth**: presence + freshness + per-boolean. A sample re-run of
  fresh claims is deferred (may follow); stale claims ARE re-run (see below).
  (Round 1 Q2)
- **Bypass**: hard-fail in the audit AND the commit veto extended — the newest
  ledger entry must carry a valid receipt, else the commit is DENIED with a named
  reason. (Round 1 Q3)
- **Staleness**: a claim older than 14 days (RECEIPT_STALE_DAYS, between the
  lessons' 21 and the ladder's 30) is stale by computation and must be
  re-verified before it may gate anything. (Round 1 Q4, round 3 Q10)
- **Commands**: only repo gates (the `node scripts/*` references in the CI
  workflow) may be cited as evidence or re-run; anything else is rejected as
  proof. The allowlist derives from the FRAMEWORK repo's CI workflow (vendored
  beside the validator), not from the adopter's tree — an adopter without a
  workflow file of their own still gets the same gates. (Round 1 Q5)
- **Re-verification**: the audit re-runs the cited gate commands through the
  hardened runner (no shell, allowlist, timeout — the stale-probe pattern);
  a re-run that passes marks the claim re-verified, a failing re-run marks it
  stale. (Round 3 Q11)
- **Status vocabulary**: fresh / re-verified / stale / unverifiable — the
  stale-probe statuses applied to claims; only fresh and re-verified may gate.
  (Round 3 Q11, derived)
- **Receipt shape template** (the enforced minimum; the receipts skill and the
  receipt doc carry this same template as the marker source for check 45):
  the four blocks (Verdict / Evidence / Open / Next) plus, under Verdict, five
  evidence lines — one per boolean, each naming its own proof, e.g.
  `constraints satisfied — <the constraint list checked>`,
  `evidence fresh — <literal repo-gate command + result, e.g. 37/37 green>`,
  `scope held — <files in / out of scope>`, `subject verified — <the artifact
  checked, not a proxy>`, `fail-first proven — <RED evidence cited>`. A blanket
  "all five hold" is not a verdict. Fast units: one line — claim, one
  allowlisted command, its result.
- **Retroactivity**: the hard rule is forward-only; pre-feature entries are
  grandfathered with a warn (the onboarding grandfather pattern). (Round 2 Q6)
- **Scope**: fast units get a minimal mandatory receipt (one line); full/loop
  keep the four-block shape. (Round 2 Q7)
- **Veto linkage**: the newest ledger entry (the last `## YYYY-MM-DD` section),
  not a diff-to-entry mapping. (Round 2 Q8)
- **Runtime**: ledger-audit carries the checks (CI + pre-commit already run it);
  the doctor surfaces stale claims as a warn at session start. (Round 2 Q9)
- **Module surface** (decisions, not paths): a pure receipt-validator seam (shape
  + per-boolean + command allowlist), a pure staleness seam (age + status +
  canGate — the stale-probe classify/canGate precedent), the ledger reader (the
  newest entry), the gate-hook veto wiring (vendored byte-identical), the
  ledger-audit wiring, the doctor surface, and one eval check. Existing seams
  preferred over new ones (see Testing Decisions).

## Testing Decisions

- **Primary seam**: a pure receipt validator (receipt text → blocks + booleans +
  commands + verdict) and a pure staleness seam (claim + today + re-run result →
  status + canGate). Tested as external behavior; prior art: `parseLessons` /
  `classify` / `canGate` (stale-probe), `grandfatherVerdict` (doctor-checks).
- **Veto wiring**: live spawn of the hook with ledger fixtures in temp cwds — the
  gate-hook.test J-section pattern (consent stamps) — asserting deny/allow both
  directions with named reasons.
- **Audit wiring**: unit tests for each finding class (missing receipt, blanket
  verdict, non-allowlisted command, stale claim) plus the live ledger-audit run
  over fixture ledgers — the K-group precedent in doctor.test / the P-section
  precedent.
- **Re-run seam**: the hardened runner tested with fixture gates (a passing and a
  failing repo-gate script in a temp tree), asserting no-shell invocation and the
  status transitions.
- **eval**: one new check (45) pinning the contract (the shape rule, the
  allowlist, the veto, the staleness window named), pinned in
  eval-adapter.test.mjs like checks 39-44.
- **What counts as a good test here**: external behavior only — validator output,
  veto verdicts, audit findings, status computations. Never implementation
  details.

## Constraints

1. Zero new runtime dependencies; keyless; no network; the runner is plain Node.
2. Cited commands must be repo gates (allowlist derived from the CI workflow);
   non-allowlisted commands are rejected as evidence.
3. Re-runs execute only for stale claims (> RECEIPT_STALE_DAYS = 14), through the
   hardened runner (no shell, allowlist, timeout).
4. The veto denies a commit when the newest ledger entry lacks a valid receipt —
   a named reason, both directions tested.
5. Blanket verdicts are rejected: each of the five booleans must carry its own
   evidence.
6. Fast units carry a minimal mandatory receipt; full/loop carry the four-block
   shape.
7. Pre-feature entries are grandfathered (warn, never fail).
8. The veto linkage is the newest ledger entry — not a diff-to-entry mapping.
9. Claim statuses mirror the stale-probe vocabulary; only fresh and re-verified
   may gate.
10. The receipts skill and the receipt doc carry the enforced template (the eval
    check's marker source).

## Acceptance Criteria

1. (US1) A receipt whose Verdict claims all five booleans in one sentence without
   per-boolean evidence is rejected with a named error. — automated test (receipt
   validator seam).
2. (US1) A receipt with each of the five booleans carrying its own evidence line
   validates. — automated test (receipt validator seam).
3. (US2) A receipt citing a non-allowlisted command (e.g. `rm -rf x`) as evidence
   is rejected; a receipt citing a repo gate from the CI workflow passes the
   allowlist. — automated test.
4. (US3) A ledger entry claiming done with no receipt block is a hard audit
   finding. — automated test (audit over a fixture ledger).
5. (US4) A live hook run denies a commit when the newest ledger entry has no
   valid receipt, with a reason naming the receipt rule; allows when the entry is
   valid. — automated test (gate-hook live spawn, both directions).
6. (US5) A claim dated 15 days before today is computed stale and 13 days is
   fresh; age 14 exactly is stale (the window is inclusive, mirroring the
   lessons' 21-day rule). — automated test (staleness seam).
7. (US5/US15) canGate returns true for fresh and re-verified, false for stale and
   unverifiable. — automated test (staleness seam).
8. (US6) A stale claim whose cited gate re-runs green becomes re-verified and may
   gate again; a failing re-run makes it stale and non-gating. — automated test
   (re-run seam with fixture gates).
9. (US7) The re-run invokes the cited command with no shell (spawn args, not a
   shell string) and within the timeout; a probe with shell metacharacters cannot
   chain. — automated test (re-run seam, both directions).
10. (US8) A fast unit's one-line receipt validates; a fast claim with neither
    command nor result is rejected. — automated test (receipt validator seam).
11. (US9) A fixture ledger with pre-feature entries produces grandfather warns,
    not hard findings; the audit still exits over the hard rule for new entries.
    — automated test (audit over a fixture ledger).
12. (US10) The live ledger-audit reports a deliberately planted receipt defect in
    the project ledger (strip-dance fixture), and the live doctor surfaces a
    stale claim as a warn. — automated tests (audit + doctor live runs).
13. (US11) eval.mjs carries check 45 pinning the contract (the shape rule, the
    allowlist, the veto, the 14-day window named), pinned in eval-adapter.test.mjs.
    — automated eval check + adapter pin.
14. (US12) The receipts skill and the receipt doc carry the enforced template
    (the five evidence lines + the allowlist rule), readable as the marker
    source. — automated marker check + human review.
15. (US13) The veto's receipt linkage is the newest entry: a fixture with a valid
    receipt in an OLDER entry but none in the newest still denies; the reverse
    allows. — automated test (gate-hook live spawn).
16. (US14) A fresh claim is not re-run during the audit (no spawn for claims
    under the window) — the audit's runtime stays bounded. — automated test (audit
    over a fixture with only fresh claims; assert no re-run happened).
17. (US4) A commit on a tree whose ledger's newest entry carries a valid receipt
    exits 0 silent. — automated test (gate-hook live spawn).

## Out of Scope

- Sample re-run of FRESH claims (the deferred cross-check; stale claims only).
- Diff-to-entry mapping for the veto (the newest-entry linkage is the v1
  decision).
- Structured receipt registers (.trust/receipts.jsonl) — prose ledger, validated
  shape.
- Telemetry or any data leaving the machine.
- Automatic re-attestation by humans (the re-run is the mechanism).

## Open Questions

- A tree with NO ledger at all (fresh repo, first commit ever): the veto denies
  with the named reason (assumed; never discussed — the existing evidence-state
  precondition already denies a commit without a test-run record).
- Whether a re-verified claim resets its clock to fresh or keeps its original
  date with a re-verified marker (assumed: keeps the date, status
  re-verified — the stale-probe model; never discussed).
- Whether the veto should also validate fast receipts' minimal shape (assumed
  yes — any valid receipt shape, minimal or full; never discussed).
