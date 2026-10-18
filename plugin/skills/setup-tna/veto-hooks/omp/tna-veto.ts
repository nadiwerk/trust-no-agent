// tna-veto.ts — trust-no-agent veto hook for omp (hooks/pre).
//
// Posture: FAIL-CLOSED for irreversible shell actions without fresh test
// evidence; everything else passes untouched. This is the veto layer —
// the existing tna-discipline.ts (floor injection, mandatory classification)
// stays fail-open and is NOT modified by this file's presence.
//
// Contract: reads the PROJECT's .trust/tna-gate-state.json (via the payload
// cwd), classifies the bash command against the irreversible patterns, and
// returns { block: true, reason } when the action is irreversible without
// testPassFresh. Mirrors scripts/gate-hook.mjs (Claude Code / Codex adapters)
// and scripts/action-gate.mjs (the shared classifier) — same patterns, same
// state file, same reason strings.
//
// Evidence semantics (scripts/tna-gate.mjs observeAfter):
//   state.testPassFresh === true  -> a test ran clean in this session  -> allow
//   state missing/corrupt/false   -> no fresh evidence                 -> block
//
// omp tool_call contract: return { block?: boolean; reason?: string }.
// First block stops dispatch; reason becomes the tool error text.
//
// cwd resolution (origin: omp user deny-path report 2026-10-18): the state
// file MUST be read from the PROJECT the command runs in, not from the
// harness process cwd — a harness launched from a parent directory (or a
// different checkout) reads a DIFFERENT .trust/tna-gate-state.json, and a
// stale testPassFresh=true in that file opens the gate for commits whose
// own project has no evidence at all. Resolve per-command: event/ctx cwd
// first (mirrors the pi adapter), harness cwd as last fallback. Also embed
// the resolved path in the denial reason so "(missing)" vs "true" is
// distinguishable in the wild (the user's receipt quoted exactly this).

import { readFileSync } from "node:fs";

const IRREVERSIBLE_PATTERNS = ["git commit", "git push", "npm publish", "rm -rf"];

function classifyCommand(command) {
  const cmd = String(command ?? "");
  for (const pattern of IRREVERSIBLE_PATTERNS) {
    if (cmd.toLowerCase().includes(pattern.toLowerCase())) {
      return { irreversible: true, pattern };
    }
  }
  return { irreversible: false, pattern: null };
}

function readEvidence(cwd) {
  try {
    const statePath = `${cwd}/.trust/tna-gate-state.json`;
    const raw = readFileSync(statePath, "utf8");
    const state = JSON.parse(raw);
    return { testPassFresh: state.testPassFresh === true, statePath };
  } catch {
    // Missing or corrupt state = no fresh evidence (fail-closed).
    return { testPassFresh: false, statePath: "(missing)" };
  }
}

export default function tnaVeto(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    const { irreversible, pattern } = classifyCommand(command);
    if (!irreversible) return;

    const cwd = ctx?.cwd || event?.cwd || process.cwd();
    const evidence = readEvidence(cwd);
    if (evidence.testPassFresh) return; // fresh evidence: allow

    return {
      block: true,
      reason: `tna-gate veto: "${pattern}" is irreversible and this session has no fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.statePath}`,
    };
  });
}
