// tna-veto.ts — trust-no-agent veto extension for pi (.pi/extensions).
//
// Same contract as the omp adapter (ticket 01): fail-closed for irreversible
// shell actions without fresh test evidence; everything else passes.
// Classification reads the PROJECT's .trust/tna-gate-state.json via the
// session cwd (ctx.cwd), mirroring scripts/gate-hook.mjs and the omp adapter.
//
// Pi contract: pi.on("tool_call", handler) returning
//   { block?: boolean; reason?: string }
// First block stops dispatch; reason becomes the tool error text.

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
    return { testPassFresh: false, statePath: "(missing)" };
  }
}

export default function tnaVeto(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    const { irreversible, pattern } = classifyCommand(command);
    if (!irreversible) return;

    const cwd = ctx?.cwd || process.cwd();
    const evidence = readEvidence(cwd);
    if (evidence.testPassFresh) return; // fresh evidence: allow

    return {
      block: true,
      reason: `tna-gate veto: "${pattern}" is irreversible and this session has no fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.statePath}`,
    };
  });
}
