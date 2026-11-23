# Spec: Unattended-Run Contract (automation, scheduled agents, GUI "goals")

Status: CANONICAL — the contract every unattended run follows. Companion
artifacts: `.trust/automation.json` (shape below, validated by
`scripts/automation-lint.mjs`), `.trust/goals.md` (goal binding —
`fork-it` §Standing goals, `scripts/goals.mjs`).

## Problem

Every modern harness ships an automation surface — scheduled runs, trigger
rules, standing-goal agents, background workers. Each of those is **a session
with no user in it**, and TNA's kernel assumes a user: Iron Law 4 waits for
approval, the dry-run gate waits for sign-off, the receipt lives in chat,
escalation means asking. Unattended, those gates either stall the run forever
or get configured permissive and skipped silently — a stall and a silent skip
are the same failure wearing different clothes.

## Contract

An unattended run is bound by **three pre-authorized artifacts**, never by
mid-run judgment:

### 1. Scope — `.trust/automation.json`

```json
{
  "version": 1,
  "runs": [
    {
      "id": "weekly-dep-audit",
      "schedule": "weekly Monday 09:00",
      "harness": "opencode",
      "task": "audit dependency drift; report findings",
      "rung": "veto-proven",
      "proofDate": "2026-11-20",
      "goals": ["faster cold start"],
      "allowedActions": ["read", "write", "test"],
      "receipt": ".trust/automation-reports/weekly-dep-audit.md",
      "escalate": ["commit", "push", "install", "deploy"]
    }
  ]
}
```

- `rung` + `proofDate` are the CLAIM; the effective rung is recomputed at read
  time by the same 30-day decay `scripts/autonomy-ladder.mjs` applies — a
  stale proof grants nothing.
- `allowedActions` are tiered, and the tier ceiling is the EFFECTIVE rung:
  - `audit-only` → read/report/analyze only. The run observes and writes its
    receipt; it changes nothing else.
  - `veto-proven` → + write/edit/test/install inside the project.
  - `trusted` → + shared-system actions (`commit`, `push`, `pr`, `publish`)
    — and even then only when listed, because shared-system reach is never
    implied by the rung alone.
- `escalate` names what is ALWAYS kicked upstairs regardless of rung — the
  overlap of `allowedActions` and `escalate` is a config defect (lint flags it).

### 2. Goal binding — `.trust/goals.md`

A run works a standing goal only when the goal is `Status: active`, its
`Scope` covers the run's task, and its `Never` list does not intersect the
run's `allowedActions`. No goals file = no standing-goal work unattended —
the run reduces to its literal task.

### 3. Receipt — artifact, not chat

There is no chat. The run's receipt is its `receipt` artifact plus one ledger
line (`Automation: <id>` in `progress.txt`) containing: what ran, the exact
verification output, and **pending decisions** — anything needing the user is
NAMED in the report, never asked mid-run. A report with a question mark where
a decision belongs is a malformed receipt.

## Cold-start floor

An automation session opens with nothing in context. The harness's
session-start wiring (or the run's own first step) injects the floor via
`node scripts/reinject.mjs` — Iron Laws + MANDATORY section — before any work.
A run that cannot inject the floor stays at `audit-only`: report-only is the
only run that needs no trust.

## Mechanical boundary

`node scripts/automation-lint.mjs` validates `.trust/automation.json`:
required fields, rung/decay resolution, action-tier ceiling per effective
rung, allowed∩escalate overlap, receipt path present, referenced goals
existing and active. Fail-closed on shape — an unverifiable claim grants
nothing — fail-open on absence (no file = no automations configured = valid).

## Explicit non-goals

- No self-scheduling: the harness/OS owns the trigger; this contract owns
  what the run may DO once triggered.
- No auto-promotion: a trusted run does not raise its own rung; proofs land
  through humans, per the autonomy ladder.
- No silent writes to shared systems at any rung — `push`/`publish`/`deploy`
  need `trusted` AND a listing AND absence from `escalate`.
