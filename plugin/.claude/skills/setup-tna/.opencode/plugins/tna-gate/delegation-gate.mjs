/**
 * delegation-gate — thin adapter over the canonical brief gate.
 *
 * The ONE delegation decision lives in ./orchestrator-brief.mjs
 * (delegateVerdict). This file used to re-implement the contract — the two
 * copies then disagreed about the repo's own builder output (a gate that
 * vetoes every compliant delegation is a gate that gets switched off), so the
 * copy had to go. The vendored opencode mirror imports the same shim; both
 * harnesses now veto identical things.
 *
 * Exports preserved for callers that imported the old module surface.
 */
export {
  delegateVerdict,
  DELEGATION_TOOLS,
  obligatedSkills as requiredSkills,
  BRIEF_CODES,
  validateBrief,
  validatePlan,
  validateAny,
  buildBrief,
} from './orchestrator-brief.mjs';
