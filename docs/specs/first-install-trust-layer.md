# First-install trust-layer contract

Status: contract, lifecycle policies, and ticket breakdown accepted. Tickets 01-05 are verified locally and uncommitted; integrated review, hosted CI, commit, and release await owner decision.
This document specifies intended behavior. It does not certify the current installation.

## Problem statement

An adopter can consent to the trust layer and still receive no active gate, an incomplete installation, or an inaccurate health report. Removing one project's installation can disable another project's gates. A successful legacy test run does not cover these cases.

The owner wants the trust layer to work on first installation. The adopter's router and workflow can retain their existing structure and conventions. Installed discipline must not disappear when those files are merged.

## Solution

Make each entry point satisfy the same installation contract. Determine readiness from required files, usable registrations, and behavior, not consent labels or files that happen to exist.

Preserve unrelated configuration and other projects throughout installation, refresh, failure, and undo. Report a partial, unsupported, or unverified layer as such. Never call the installation fully functional when a required layer is absent or unverified.

## User stories

### Installation

1. As an adopter, I want terminal and chat entry points to install the components I approved, so the consent channel does not change enforcement.
2. As an adopter, I want the distributed setup skill to work without a maintainer checkout, so the published installation path is usable.
3. As an adopter, I want a missing runtime dependency to be detected, so a disabled gate cannot appear healthy.
4. As an adopter, I want a missing hook registration to be detected, so a working veto is not confused with a working evidence recorder.
5. As an adopter, I want malformed configuration or a missing prerequisite to fail installation clearly, so consent does not become a false readiness claim.

### Safe lifecycle

6. As an adopter, I want undo to remove only owned hook entries, so unrelated commands survive even inside a group with a framework-like name.
7. As an owner of two adopted projects, I want undoing one installation to preserve the other, so shared adapter files do not create cross-project failures.
8. As an adopter, I want the discipline check to reject placeholder content, so headings alone cannot certify the four Iron Laws and mandatory skills.
9. As an adopter, I want supported native write and edit tools to reach the ledger guard, so the history cannot be overwritten through an unwired tool.

### Existing work and evidence

10. As an adopter, I want my router, workflow, skills, and unrelated configuration preserved, so adopting the trust layer does not replace my project's way of working.
11. As an adopter, I want per-layer capabilities and evidence stated accurately, so an adapter self-test is never presented as proof of a live host integration.

## Decisions already made

- Audit the existing dirty working tree. Preserve changes from the earlier session.
- Use isolated temporary projects and homes for installation and lifecycle verification.
- Permit local repairs after the required specification and ticket stages. No global installation or shared-system action is authorized.
- Retain the adopter's router and workflow conventions. Require the non-router discipline contract independently of those conventions.
- Separate live verification from adapter self-tests. An unavailable host remains unverified.
- Shared runtime has project-level ownership. Undo withdraws the selected project's ownership and must preserve all remaining owners. Shared resources may be removed only after the final owner releases them and only when removal is safe.
- Validate prerequisites before writes. Roll back operation-owned changes on failure. If rollback is unsafe, retain an explicit recoverable partial-install record and return a nonzero status.

## Testing decisions

The owner confirmed these boundaries before the audit: the onboarding CLI, installed payload/configuration, the adapter's deny/evidence/allow cycle, installation-health detection, and refresh/undo behavior.

Use subprocesses against isolated homes/projects. Assert observable files, registrations, hook outputs, exit statuses, and preservation of existing data. Keep pure helper checks only where the defect is the exported contract itself. An actual host consuming the hook is a separate integration check.

New behavior changes require an observed failing repository regression test before implementation. Transfer each relevant audit expectation into a maintained repository test through a vertical fail/pass cycle. The temporary audit runner is evidence, not the finished regression suite.

### Existing evidence

- The frozen audit JSON and stdout record nine selected contract failures. This is not an exhaustive defect count or a readiness percentage.
- The existing onboarding-layer suite prints ALL PASS. The existing Devin adapter suite prints ALL EXPECTATIONS HOLD.
- These outcomes describe the dirty working tree based on commit dffda5ee348b386a5d4e9d0f98c71b5bcdac0009. They do not describe that commit in isolation.

## Constraints

### Behavior and compatibility

- Preserve every existing owner change. Do not overwrite or rename an adopter's router or workflow.
- A failed installation must not claim active layers or leave new active resources without a recoverable ownership record.
- A consent record describes approval, not readiness. Effective status must reflect the installed result.
- Undo and refresh must preserve foreign entries and another project's active installation.
- Validate untrusted stamp/config paths before any write or removal. Do not broaden the current filesystem authority to solve an ownership defect.

### Evidence and execution

- Do not install globally or change the user's actual home during verification.
- Do not commit, push, publish, create a PR, change tags/releases, or update shared skill directories without separate approval.
- Load expect-fail before tests/behavior changes, root-cause before fixes, and receipts before completion claims.
- No new independent enforcement mechanism or duplicate validator without a demonstrated need. Reuse a canonical contract where it exists.
- A host with a missing or unverified required layer cannot receive a full-readiness verdict. Report the specific gap instead of inventing an integration.

## Acceptance Criteria

Each criterion maps to the user story with the same number.

### Installation criteria

1. In fresh fixtures for supported installer paths, terminal consent, terminal --yes, and forwarded chat consent install the same approved mechanical components. A decline remains off. Check: CLI regression tests; the current terminal-entry-installs-hooks audit case fails.
2. An actual distributed setup payload installs its declared skill/runtime dependencies without a framework checkout. Verify the installed adapter can deny an evidence-less inert action and allow the same action after recorded evidence. Check: payload-copy CLI tests, not the repository CLI; the current distributed-payload-full-install case fails.
3. For each required installed runtime file, removing that file in a fixture produces a named missing-file defect rather than omitting it from the health result. Check: installed-scanner regression tests; the current missing-runtime-is-detected case fails.
4. Removing any required lifecycle registration produces a named registration defect. A surviving pre-tool entry cannot certify the post-tool recorder. Check: parsed configuration/scanner tests; the current missing-recorder-registration-is-detected case fails.
5. Malformed configuration, unavailable sources, or missing required runtime files cause a nonzero installer result and a named partial/failure status. No active resource can become unowned after an abort. Check: CLI failure/retry tests comparing pre/post state; the current invalid-config-is-not-success case fails, and the payload case records writes before abort.

### Safety criteria

6. Installing and undoing with a foreign hook in a framework-named group preserves that foreign hook and its unrelated settings. Remove only the entries owned by that installation. Check: CLI lifecycle regression tests; the current undo-preserves-foreign-hook case fails.
7. Install projects A and B in one fixture home, then undo A. B's adapter and required registrations still function. A's consent withdrawal follows the owner-approved lifecycle policy. Check: two-project CLI lifecycle tests and an inert gate invocation; the current undo-project-a-preserves-project-b case fails.
8. Placeholder fenced content under an Iron Laws heading and a MANDATORY heading without the three required skills produce an incomplete floor verdict. Complete supported merged-router forms remain valid. Check: extractor/doctor regression tests and complete merged-router fixtures; the current floor-check-rejects-empty-discipline case fails.
9. Every supported native write/edit event in the installed hook manifest reaches the append-only ledger guard. An attempted overwrite is refused; an allowed non-ledger write and an append remain possible. Check: manifest routing plus real adapter invocations with inert payloads; the current claude-ledger-write-reaches-gate case fails for Write and Edit.

### Preservation and readiness criteria

10. Fresh install, refresh, failed-install retry, and undo preserve the byte content of pre-existing router/workflow files and the values of unrelated configuration. A merged-router adopter is not required to copy the framework router verbatim. Check: fixture byte comparisons and parsed-value assertions.
11. Installation output and health output name each required layer as active, declined, missing, unsupported, or unverified using available evidence. No overall full-readiness claim is emitted when any required layer is missing, unsupported, or unverified. Check: CLI/doctor output assertions against fixture manifests; live host checks are recorded separately and remain open when unavailable.

## Evidence locations

The current frozen audit records are .scratch/first-install-reaudit-results.json and .scratch/first-install-reaudit-output.txt. Existing-suite stdout is in .scratch/first-install-existing-layers.txt and .scratch/first-install-existing-devin.txt.

These local ignored artifacts are the evidence for this draft, not portable release assets. Each repair must add its maintained regression evidence before a completion claim.

## Out of scope

- Changing another project's files, global skills, actual host configuration, published releases, or Git history.
- Replacing the adopter's router or workflow with the framework's preferred chain.
- Promising that unknown future hosts or unavailable host APIs enforce the full contract.
- Adding unrelated refactors, performance work, or new always-loaded router rules.

## Open questions

- Missing host APIs and live proof remain implementation evidence gaps. An unavailable host cannot receive a full-readiness verdict.
- The owner must accept the proposed ticket breakdown before implementation starts. No global installation or shared-system action is authorized.

## Adversarial self-review

- The initial requirement "full everywhere" has no finite proof. The acceptance contract instead requires each declared layer and forbids unsupported full-readiness claims.
- The audit runner covers selected negative cases. Positive cases, retry behavior, maintained regressions, and live host integration remain distinct requirements.
- The owner explicitly selected project ownership and preflight plus rollback after reviewing this draft. Ticket details must preserve those outcomes rather than reopen or silently change the policies.
- All acceptance criteria have a failure condition and a check method. No production implementation, deployment, or publication is implied by this specification.
