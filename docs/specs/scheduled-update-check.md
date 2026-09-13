# Spec: Scheduled Update-Check Reminder (OS-level + in-session)

Status: DRAFT — awaiting owner approval before publishing to GitHub Issues with `ready-for-agent`. Open Questions resolved 2026-09-13 by owner (see Decisions Already Made).

## Problem Statement

A user who installs trust-no-agent into projects never hears about upstream releases unless they happen to run `scripts/doctor.mjs` or an agent proactively checks. Skills are copied frozen at install time; an upstream release does not reach an installed copy by itself (docs/installation.md §Updating). The result: installs silently go stale, and the user only learns when something breaks or when they remember to ask. A working prototype exists on the owner's machine (detection script + Windows Task Scheduler task + toast notification), proving the concept — but it lives outside the repo, so no other user of the framework gets it.

## Solution

The repo ships an opt-in installer that registers an OS-level scheduled check (weekly, Monday 09:00) which compares the latest upstream version against every stamped install on the machine and reports stale ones — as an OS notification where the platform supports it, and always to a local log file. Additionally, the router gains a small rule: when a session starts on a Monday (or when the weekly log reports stale installs), the agent opens with the update report — version delta plus the relevant CHANGELOG entries — and asks the user whether to update, waiting for an explicit yes. Detection is mechanical; the update decision is always the user's.

## User Stories

1. As a trust-no-agent user, I want to run one command to enable a weekly update check on my machine, so that I do not have to remember to run doctor myself.
2. As a trust-no-agent user on Windows, I want the check registered in Task Scheduler, so that it runs even when no harness/CLI/IDE session is open.
3. As a trust-no-agent user on macOS, I want the check registered via launchd, so that the reminder works on my platform.
4. As a trust-no-agent user on Linux, I want the check registered via cron or a systemd timer, so that the reminder works on my platform.
5. As a user who did NOT opt in, I want no scheduled task, background process, or notification created by installation itself, so that installing the framework never adds OS-level machinery I did not ask for.
6. As a user receiving a stale report, I want it to name each stale project with its stamped version and the upstream version, so that I know exactly what is behind.
7. As a user receiving a stale report, I want the relevant CHANGELOG entries between my stamped version and upstream, so that I can judge whether the update matters to me.
8. As a user whose installs are all current, I want silence at the OS level (no toast/banner), so that I am not spammed by good news — the weekly run is still recorded in the log.
9. As a user whose network is down at check time, I want the failure recorded and no version claimed, so that the system never reports a guess as fact.
10. As an agent session starting on a Monday in a project with a stamped install, I want the router rule telling me to open with the update report and a consent question, so that the user hears about updates in-session even if the OS notification was missed.
11. As a user, I want updates to never be applied without my explicit yes, so that the Iron Law against unauthorized writes to shared skill dirs is preserved by the reminder system itself.
12. As a user who changes their mind later, I want a documented uninstall path that removes the scheduled task and its log directory, so that opting out is as easy as opting in.
13. As a repo maintainer, I want the check logic as pure functions, so that the behavior is testable fail-first on any machine without mutating OS state.
14. As a repo maintainer, I want the installer to degrade gracefully on platforms where notification APIs are unavailable, so that the check still runs and logs even when the toast/banner cannot be shown.

## Decisions Already Made

- **Opt-in, not default.** Running the installer is a user decision; installing trust-no-agent itself never registers an OS task (user story 5 exists precisely because this was made explicit).
- **Schedule: weekly, Monday 09:00 local time.** Matches the prototype the owner already approved and ran on Windows.
- **Two delivery surfaces.** (a) OS-level: notification where supported (Windows toast via PowerShell; macOS/Linux notification where a supported tool exists) plus a local log file always. (b) In-session: a router rule making the Monday (or stale-log-informed) report a stated obligation, following the existing "update reporting" pattern in the router.
- **Detection logic mirrors the proven prototype:** fetch the upstream CHANGELOG, read the highest `## [x.y.z]` heading, scan the projects root for `.trust/tna-version` stamps, compare, report delta; never install or stamp anything.
- **Testing seam: pure functions, doctor.test.mjs pattern.** The user confirmed this explicitly. Platform-specific registration (schtasks/launchd/cron commands) is verified by human inspection at install time, not automated tests; the pure layer covers staleness comparison, report formatting, platform dispatch decision (which scheduler backend + command shape for the detected OS), and notification-fallback logic.
- **Fail-first applies.** Per repo discipline, tests are written before the implementation they verify (expect-fail MANDATORY).
- **Windows toast implementation follows the prototype's approach** (PowerShell ToastNotificationManager), which the owner has visually verified working ("notif disebelah kanan bawah").
- **Notification on "all current" = silence** (owner decision, 2026-09-13): the OS toast/banner fires only when at least one install is stale; a fully-current run logs its result but shows no notification. Story 8 and its acceptance criterion were rewritten accordingly.
- **Scan root is configurable, defaulting to `~/projects`** (owner decision, 2026-09-13): the installer accepts a projects-root override (flag or environment variable baked into the registered task); the default keeps prototype behavior.
- **Upstream source is overridable in the installer, defaulting to `nadiwerk/trust-no-agent` CHANGELOG at master** (owner decision, 2026-09-13): a fork maintainer can point the check at their own repo; the default matches the prototype's proven behavior.

## Testing Decisions

- **External behavior only:** a test asserts what a function returns/decides (e.g. "stale installs produce a report line naming project, stamped version, upstream version"), never how the string is concatenated internally.
- **Modules under test:** the pure functions behind (1) staleness comparison — reusing the existing `checkStale` in `scripts/corrective-tier.mjs` where it fits rather than duplicating it; (2) report formatting; (3) platform dispatch (returns the correct backend descriptor per OS); (4) notification fallback (unsupported platform → log-only path).
- **Prior art:** `scripts/doctor.test.mjs` — zero-dependency, `ok -`/`FAIL -` assertion helper, pure-function seams with injected inputs (`today`, config), deterministic fixtures. New tests follow this exact pattern and run via the repo's existing test entry point.
- **OS registration is human-verified,** one command at install time, documented in the installer's output (this matches how doctor treats hooks: mechanical check where possible, documented step where the OS is the boundary).

## Constraints

- **Zero new dependencies.** The check and installer are pure Node (`node:child_process`, `node:fs`, `fetch`), matching every existing script.
- **Detection-only.** Neither the scheduled check nor the installer may ever run an install, copy skills, or stamp versions. The update act requires an explicit user yes given in a session; the reminder's output ends at the report.
- **No task registered by installation itself.** Only the explicit opt-in command registers anything at OS level.
- **No secrets, no telemetry.** The check talks to the public upstream CHANGELOG URL and writes locally; nothing else leaves the machine.
- **Router additions stay short.** The in-session rule is added to the existing router §Update reporting block as a few lines, not a new section — context is a budget (router rule 8).
- **Cross-platform honesty.** Where an OS notification mechanism is unavailable, the system degrades to log-only (references degrade, never hard-fail — router rule 8); the installer must name what was and was not registered.
- **Fail-first tests gate merging.** No implementation lands without its failing test first; mechanical router checks in `scripts/eval.mjs` (if extended) must keep passing.

## Acceptance Criteria

1. (Story 1, 2, 3, 4) Running the opt-in installer on a machine registers exactly one scheduled task/launchd job/cron entry named per spec, whose command invokes the check script — verified by human inspection of the OS scheduler listing at install time; on CI-less pure-function level, the platform-dispatch function returns the correct backend descriptor for each of windows/darwin/linux (automated test).
2. (Story 6) Given a set of stamps and an upstream version where at least one is behind, the report function returns a report containing every stale project's name, its stamped version, and the upstream version — including the arrow-form `stamped → upstream` delta proven in the prototype (automated test).
3. (Story 7) Given two versions, the report includes the CHANGELOG entries between them; given a CHANGELOG lacking those entries, the report degrades to a version-delta line and states the entries were unreadable — never invents content (automated test).
4. (Story 8) Given all stamps equal to upstream, the report is the single line "all current", no stale lines exist, and the dispatch function selects the silent path (no OS notification; log write only) (automated test).
5. (Story 9) Given the upstream fetch fails, the run records a failure line and reports no version — no fallback to a remembered or guessed version (automated test).
6. (Story 10) The router's update-reporting section names the Monday/weekly condition and the required report shape (delta + CHANGELOG entries + consent question, then wait) — verified by reading the committed router text (human verification).
7. (Story 11) Neither the check script nor the installer contains any code path that writes skills, stamps versions, or mutates a project outside its own log — verified by automated test asserting the report/decide functions have no side effects on project directories (test inspects behavior via a temp projects root), plus human review.
8. (Story 12) An uninstall command/path is documented and, when run on the prototype's Windows machine, removes the existing task — the uninstaller's platform dispatch is covered by the same pure-function test as criterion 1 (automated test + human verification).
9. (Story 13) The test file follows the doctor.test.mjs pattern, runs with zero dependencies, and fails when the implementation's behavior drifts — proven by the fail-first history (the test was written first and observed failing) (automated test).
10. (Story 14) On a platform where the notification backend is unsupported, the dispatch function selects the log-only path and the report still lands in the log file (automated test for the dispatch decision; log write verified in the temp-root test).
11. (Story 1) The installer accepts a projects-root override (flag or environment variable baked into the registered task) and an upstream-source override; when neither is given it defaults to `~/projects` and the nadiwerk/trust-no-agent CHANGELOG respectively (automated test on the installer's pure configuration-decision function).

## Out of Scope

- Auto-updating installs, background daemons, or any scheduled act beyond detection + report.
- Non-weekly schedules or per-project custom schedules.
- A GUI/notification-center app; the Windows toast uses the existing PowerShell approach, no new notification framework.
- Changes to doctor C6's own behavior (the scheduled check complements it, does not modify it).
- Porting the owner's prototype wholesale — the repo version is written fresh against this spec, with the prototype as reference only.

## Open Questions

None remaining — all three original questions were answered by the owner on 2026-09-13 and moved into Decisions Already Made.
