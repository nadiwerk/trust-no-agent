/**
 * delegation-gate — the Gap-3 classifier behind the opencode plugin: a
 * delegation whose prompt carries no discipline block is a delegation WITHOUT
 * its guards (subagents never read AGENTS.md; the brief is the only path the
 * rules reach them — WORKFLOW.md rule 4, AGENTS.md §5).
 *
 * Canonical contract: the router's Delegation discipline section (3-line repo
 * rules + six sections + VERIFY/TIMEBOX/PARTIAL execution window + a Loading
 * line for every MANDATORY domain the task text triggers). The
 * orchestrator-brief.mjs builder the router names does not exist in either
 * checkout (references degrade, AGENTS.md §8), so this port validates the
 * CONTRACT itself; the required-skill derivation reuses the canonical
 * keyword classifier, copied VERBATIM into this plugin dir as
 * mandatory-gate.mjs (re-copy on upstream updates).
 *
 * Pure core: no I/O, no throw — the plugin's thin layer turns a deny verdict
 * into the opencode veto (deny by throwing) and logs it. The verdict runs on
 * the delegation tools {task, subagent, agent} only; everything else passes
 * untouched (the action-gate owns those).
 */
import { classifyTask, MANDATORY_DOMAINS } from './mandatory-gate.mjs';

/** OpenCode tool names that spawn a subagent. */
export const DELEGATION_TOOLS = new Set(['task', 'subagent', 'agent']);

/**
 * The three repo rules, as fragments the brief must carry. Checked as plain
 * substrings (case-sensitive fragments of the canonical wording) — a brief
 * that paraphrases them away is exactly the hole this gate exists to close.
 */
export const REPO_RULES_FRAGMENTS = [
  'Repo rules',
  'verified',
  'No refactoring outside the requested scope',
  'No touching files outside the allowed path list',
];

/** The six brief sections (router §5). Matched as line-start labels. */
export const BRIEF_SECTIONS = [
  'TASK',
  'EXPECTED OUTCOME',
  'REQUIRED TOOLS',
  'MUST DO',
  'MUST NOT DO',
  'CONTEXT',
];

/** The execution window keys (router §5). Matched as line-start labels. */
export const WINDOW_KEYS = ['VERIFY', 'TIMEBOX', 'PARTIAL'];

function sectionBody(prompt, name) {
  // Line-start label: "TASK:", "## TASK", "**TASK**:", tolerating markdown bold.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:#+\\s*|\\*\\*)?${esc}(?:\\*\\*)?\\s*:?[\\s:\\-]`, 'im');
  const m = re.exec(prompt);
  if (!m) return null;
  const start = m.index + m[0].length;
  // End: the next section label of any brief section, or end of text.
  const rest = prompt.slice(start);
  const nextRe = new RegExp(
    `^(?:#+\\s*|\\*\\*)?(?:${[...BRIEF_SECTIONS, ...WINDOW_KEYS]
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})(?:\\*\\*)?\\s*:?[\\s:\\-]`,
    'im',
  );
  const next = nextRe.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Which MANDATORY domains the brief's TASK text triggers. The task text is
 * the union of the delegation's description and the TASK section body — the
 * boilerplate itself is deliberately excluded, because the discipline block
 * contains the words ("test", "done", "commit") and would otherwise obligate
 * skills for its own presence.
 * @param {string} description
 * @param {string} prompt
 * @returns {string[]} triggered skill names
 */
export function requiredSkills(description, prompt) {
  const taskText = [String(description ?? ''), sectionBody(prompt ?? '', 'TASK') ?? ''].join('\n');
  const v = classifyTask(taskText);
  return MANDATORY_DOMAINS.filter((s) => v[s]);
}

/** True when the brief carries a Loading line (or load_skills) for `skill`. */
function hasLoading(prompt, skill) {
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loading = new RegExp(`(^|\\n)\\s*(?:\\*\\*)?Loading(?:\\*\\*)?\\s*:.*\\b${esc}\\b`, 'i');
  const loadSkills = new RegExp(`load_skills[^\\n]*\\b${esc}\\b`, 'i');
  return loading.test(prompt) || loadSkills.test(prompt);
}

/**
 * @param {{tool: string, args: {description?: string, prompt?: string} | null}} call
 * @returns {{allow: boolean, reason: string}}
 */
export function delegateVerdict(call) {
  const tool = String(call?.tool ?? '').toLowerCase();
  if (!DELEGATION_TOOLS.has(tool)) return { allow: true, reason: 'not a delegation tool' };

  const prompt = String(call?.args?.prompt ?? '');
  const description = String(call?.args?.description ?? '');
  const missing = [];

  for (const frag of REPO_RULES_FRAGMENTS) {
    if (!prompt.includes(frag)) missing.push(`repo rules: "${frag}"`);
  }
  for (const section of BRIEF_SECTIONS) {
    if (sectionBody(prompt, section) === null) missing.push(`section ${section}`);
  }
  for (const key of WINDOW_KEYS) {
    const re = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${key}(?:\\*\\*)?\\s*:`, 'i');
    if (!re.test(prompt)) missing.push(`execution window ${key}`);
  }
  if (!prompt.trim()) missing.push('delegation prompt is empty');

  const triggered = requiredSkills(description, prompt);
  const unfulfilled = triggered.filter((s) => !hasLoading(prompt, s));
  for (const s of unfulfilled) missing.push(`Loading line for MANDATORY skill ${s} (task text triggers its domain)`);

  if (missing.length) {
    return {
      allow: false,
      reason:
        'delegation without its discipline guards — the brief must carry: ' +
        missing.join('; '),
    };
  }
  return { allow: true, reason: 'brief carries the discipline block and its required skills' };
}
