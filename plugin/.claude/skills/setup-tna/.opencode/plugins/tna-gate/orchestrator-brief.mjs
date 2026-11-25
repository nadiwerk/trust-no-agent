#!/usr/bin/env node
/**
 * orchestrator-brief — mechanical gate for delegation briefs.
 *
 * Why this exists: a subagent only receives its prompt string. Every
 * discipline the router promises it (3 repo rules, MANDATORY skill routing,
 * the six brief sections, VERIFY/TIMEBOX/PARTIAL) has to be inside that
 * prompt — an unloaded skill is a dead skill (AGENTS.md §5), and adopter
 * ledgers measured delegations shipped with no Loading line at all. This
 * gate makes the boundary countable instead of trusting model initiative.
 *
 * Contract: AGENTS.md §5. Verdicts are findings, not throws — `ok` is false
 * only when at least one finding is error-severity.
 *
 * Fail-open when wired as a hook (`--pretool`): a bug here must not break a
 * session. The CLI (`--text` / `--file` / `--json`) is the hard path.
 *
 * Usage:
 *   node scripts/orchestrator-brief.mjs --text "<plan or brief>" [--json]
 *   node scripts/orchestrator-brief.mjs --file <path> [--json]
 *   node scripts/orchestrator-brief.mjs --pretool   (stdin JSON, PreToolUse)
 *   node scripts/orchestrator-brief.mjs --tests     (self-check)
 */
import { readFileSync, existsSync } from 'node:fs';
import { KEYWORD_TABLES, MANDATORY_DOMAINS, RECOMMENDED_DOMAINS } from './mandatory-gate.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const BRIEF_CODES = Object.freeze({
  SECTION: 'brief-section-missing',
  RULES: 'brief-rules-missing',
  LOADING_MISSING: 'brief-loading-missing',
  LOADING_MISMATCH: 'brief-loading-mismatch',
  VERIFY_MISSING: 'brief-verify-missing',
  VERIFY_NOT_COMMAND: 'brief-verify-not-command',
  TIMEBOX_MISSING: 'brief-timebox-missing',
  TIMEBOX_INVALID: 'brief-timebox-invalid',
  PARTIAL_MISSING: 'brief-partial-missing',
  SCOPE_MISSING: 'brief-scope-missing',
  SCOPE_UNNAMED: 'brief-scope-unnamed',
  SCOPE_ESCAPES: 'brief-scope-escapes',
  SCOPE_NOT_RELATIVE: 'brief-scope-not-relative',
  FORBIDDEN: 'brief-forbidden-work',
  READONLY_WRITE_TOOL: 'brief-readonly-write-tool',
  PLAN_EMPTY: 'plan-empty',
  PLAN_TOO_MANY: 'plan-too-many',
  PLAN_DUPLICATE_ID: 'plan-duplicate-id',
  PLAN_ID_INVALID: 'plan-id-invalid',
  PLAN_UNKNOWN_DEP: 'plan-unknown-dependency',
  PLAN_CYCLE: 'plan-dependency-cycle',
  PLAN_OVERLAP: 'plan-overlap-serial',
  PLAN_CAP: 'plan-parallel-cap',
});

export const REQUIRED_SECTIONS = Object.freeze([
  'TASK', 'EXPECTED OUTCOME', 'REQUIRED TOOLS', 'MUST DO', 'MUST NOT DO', 'CONTEXT',
]);

export const MAX_ASSIGNMENTS = 12;
export const MAX_PARALLEL = 4;

/**
 * Work that must never reach a delegate (Iron Law 4 — shared-system and
 * destructive actions are the user's call). Detectors are deliberately
 * narrow: a past-tense mention in CONTEXT ("PR 49 merged") is not a
 * directive, so these regexes run only on directive lines (directiveText).
 */
const FORBIDDEN = [
  { id: 'deploy', re: /\b(deploy|deployment|gh workflow run|docker push)\b/i, why: 'deploy needs main-session user sign-off' },
  { id: 'destructive-migration', re: /\b(drop\s+(table|column|database)|truncate\s+table|destructive\s+migration|drizzle-kit\s+migrate)\b/i, why: 'destructive migration needs main-session user sign-off' },
  { id: 'secret', re: /(\.env\b|process\.env\.[A-Z_]*(SECRET|TOKEN|KEY)|print\s+token|cat\s+\.env)/i, why: 'secrets must never reach a delegate' },
  { id: 'merge', re: /\b(gh\s+pr\s+merge|git\s+merge\b|--admin\b|\bmerge\s+(this|it|the)\s+(pr|branch))\b/i, why: 'merging is the user\'s authority' },
  { id: 'data-delete', re: /\b(delete\s+from|rm\s+-rf|drop\s+schema)\b/i, why: 'data deletion needs main-session user sign-off' },
];

/**
 * Keyword tables for skill routing: one source of truth — the classifier in
 * mandatory-gate.mjs. A copy here would let the builder demand one skill
 * while the prompt gate checked another; two tables drifting apart is how
 * routing stops holding. 'acceptance test' is added because a brief can ask
 * for one specifically.
 */
const ROUTE_KEYWORDS = {
  ...KEYWORD_TABLES,
  'expect-fail': [...KEYWORD_TABLES['expect-fail'], 'acceptance test'],
};
const ROUTED_DOMAINS = [...MANDATORY_DOMAINS, ...RECOMMENDED_DOMAINS];

function matchesAny(text, keywords) {
  return keywords.some((kw) => {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(text);
  });
}

/** Which routed skills this brief's own task text obligates. */
export function obligatedSkills(text) {
  const t = String(text ?? '').toLowerCase();
  return ROUTED_DOMAINS.filter((s) => matchesAny(t, ROUTE_KEYWORDS[s] ?? []));
}

/**
 * The domain a brief belongs to is decided by the WORK, not by its
 * boilerplate. Scanning the whole prompt would trip on the discipline block
 * itself — the rules line ends with "before being called done" (receipts
 * keyword) and PARTIAL mentions "ERROR" (root-cause keyword), so every
 * compliant brief would demand all three skills. TASK + EXPECTED OUTCOME is
 * the statement of intent; that is what routing reads.
 */
function workStatement(prompt, description = '') {
  return [sectionValue(prompt, 'TASK'), sectionValue(prompt, 'EXPECTED OUTCOME'), description]
    .filter(Boolean).join('\n');
}

/**
 * Text that tells a delegate to DO something. Forbidden-work detection reads
 * only these lines: a MUST NOT DO saying "do not deploy" is the opposite of
 * forbidden work, and a CONTEXT line describing a past merge is not a
 * directive. Scanning the whole prompt made every compliant brief fail.
 */
function directiveText(prompt) {
  return ['TASK', 'EXPECTED OUTCOME', 'MUST DO', 'VERIFY']
    .map((s) => sectionValue(prompt, s) ?? lineValue(prompt, s) ?? '')
    .filter(Boolean).join('\n');
}

const finding = (code, severity, detail) => ({ code, severity, detail });

function lineValue(prompt, label) {
  // `[ \t]` rather than `\s` on purpose: `\s` swallows the newline and an
  // empty label would capture the NEXT line — an empty section reading as
  // filled (caught by the D-empty test in the source repo).
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[ \\t]*(.*)$`, 'im');
  const m = re.exec(prompt);
  return m ? m[1] : null;
}

function sectionValue(prompt, label) {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*\\n?([\\s\\S]*?)(?=^\\S[^:\\n]*:|$)`, 'im');
  const m = re.exec(prompt);
  return m ? m[1].trim() : null;
}

// The discipline block's three rules — same fragments the opencode
// delegation-gate checks, both languages the repo's builders emit.
const RULES_FRAGMENTS = {
  'Repo rules': ['Repo rules', 'Aturan repo'],
  verified: ['verified', 'diverifikasi'],
  'No refactoring outside the requested scope': ['No refactoring outside the requested scope', 'Jangan refactor di luar scope'],
  'No touching files outside the allowed path list': ['No touching files outside the allowed path list', 'Jangan menulis/mengubah file di luar daftar path'],
};

const hasFragment = (prompt, key) => RULES_FRAGMENTS[key].some((f) => prompt.includes(f));

const WRITE_TOOLS = /\b(edit|write|multiedit|notebookedit|bash|exec|shell|apply_patch)\b/i;
const READ_ONLY_LABEL = /\b(read[- ]only|read_only)\b/i;

/**
 * Validate one delegation brief against the §5 contract.
 * @param {{prompt?: string, scope?: string[]|string, files?: string[]}} brief
 */
export function validateBrief(brief = {}) {
  const prompt = String(brief.prompt ?? brief.task ?? '');
  const findings = [];

  for (const [key, forms] of Object.entries(RULES_FRAGMENTS)) {
    if (!forms.some((f) => prompt.includes(f))) {
      findings.push(finding(BRIEF_CODES.RULES, 'error',
        `discipline block missing rule fragment: '${key}'`));
    }
  }

  // Skills reach a delegate by two spellings — a `Loading:` line or a
  // harness-native `load_skills:` parameter echo. Either satisfies the line;
  // the WORK still decides which skills must appear in one of them.
  const loadingLine = lineValue(prompt, 'Loading');
  const loadSkillsLine = lineValue(prompt, 'load_skills');
  if (loadingLine === null && loadSkillsLine === null) {
    const obligated = obligatedSkills(workStatement(prompt, brief.description));
    findings.push(finding(BRIEF_CODES.LOADING_MISSING, 'error',
      obligated.length
        ? `no Loading line for routed skill(s) ${obligated.join(', ')} — the work triggers their domain`
        : 'no `Loading:`/`load_skills:` line — routed skills never reach the delegate'));
  } else {
    const named = [loadingLine, loadSkillsLine].filter(Boolean).join('\n');
    const obligated = obligatedSkills(workStatement(prompt, brief.description));
    const missing = obligated.filter((s) => !new RegExp(`\\b${s}\\b`).test(named));
    if (missing.length > 0) {
      findings.push(finding(BRIEF_CODES.LOADING_MISMATCH, 'error',
        `work obligates ${missing.join(', ')} but Loading/load_skills names only: ${named.trim()}`));
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    if (lineValue(prompt, section) === null && sectionValue(prompt, section) === null) {
      findings.push(finding(`${BRIEF_CODES.SECTION}:${section}`, 'error',
        `missing section '${section}:'`));
    }
  }

  const verify = lineValue(prompt, 'VERIFY');
  if (verify === null) {
    findings.push(finding(BRIEF_CODES.VERIFY_MISSING, 'error', 'VERIFY: required'));
  } else if (verify.trim() === '' || /^\(/.test(verify.trim())) {
    findings.push(finding(BRIEF_CODES.VERIFY_NOT_COMMAND, 'error',
      'VERIFY must be the literal command, not a placeholder'));
  }

  const timebox = lineValue(prompt, 'TIMEBOX');
  if (timebox === null) {
    findings.push(finding(BRIEF_CODES.TIMEBOX_MISSING, 'error', 'TIMEBOX: required (minutes)'));
  } else if (!/\d/.test(timebox)) {
    findings.push(finding(BRIEF_CODES.TIMEBOX_INVALID, 'error',
      `TIMEBOX "${timebox.trim()}" carries no minute count`));
  }

  if (lineValue(prompt, 'PARTIAL') === null) {
    findings.push(finding(BRIEF_CODES.PARTIAL_MISSING, 'error', 'PARTIAL: required'));
  }

  // Read-only delegates carrying write tools is a silent privilege leak.
  const tools = sectionValue(prompt, 'REQUIRED TOOLS') ?? lineValue(prompt, 'REQUIRED TOOLS') ?? '';
  if (READ_ONLY_LABEL.test(tools) && WRITE_TOOLS.test(tools.replace(READ_ONLY_LABEL, ''))) {
    findings.push(finding(BRIEF_CODES.READONLY_WRITE_TOOL, 'error',
      'brief declared read-only but REQUIRED TOOLS lists a write tool'));
  }

  // Scope: the delegate's boundary must be declared AND echoed in its prompt.
  const fieldScope = brief.scope ?? brief.files;
  const scopeFromLine = lineValue(prompt, 'Scope');
  const scope = fieldScope ?? scopeFromLine;
  if (scope == null || (Array.isArray(scope) && scope.length === 0)) {
    // Absent scope is a warn, not a veto: §5 pins the discipline block +
    // sections + window + Loading, and adopter briefs predate the field.
    // A scope that IS declared but malformed or unechoed still fails loudly.
    findings.push(finding(BRIEF_CODES.SCOPE_MISSING, 'warn',
      'no scope declared — a project-relative path list bounds the delegate'));
  } else {
    const list = Array.isArray(scope) ? scope : String(scope).split(',').map((s) => s.trim()).filter(Boolean);
    const escaping = list.filter((p) => String(p).includes('..'));
    if (escaping.length) findings.push(finding(BRIEF_CODES.SCOPE_ESCAPES, 'error',
      `scope escapes the checkout: ${escaping.join(', ')}`));
    const absolute = list.filter((p) => /^([A-Za-z]:|[\\/])/.test(String(p)));
    if (absolute.length) findings.push(finding(BRIEF_CODES.SCOPE_NOT_RELATIVE, 'error',
      `scope must be project-relative: ${absolute.join(', ')}`));
    // "declared but not echoed to the worker" is a different defect from "no
    // scope at all" — the delegate cannot know a boundary it never saw.
    const unnamed = list.filter((p) => !prompt.includes(String(p)));
    if (unnamed.length) findings.push(finding(BRIEF_CODES.SCOPE_UNNAMED, 'warn',
      `scope ${unnamed.join(', ')} not named in the prompt — delegate cannot know its boundary`));
  }

  for (const rule of FORBIDDEN) {
    if (rule.re.test(directiveText(prompt))) {
      findings.push(finding(BRIEF_CODES.FORBIDDEN, 'error', `${rule.id}: ${rule.why}`));
    }
  }

  return { ok: findings.every((f) => f.severity !== 'error'), findings };
}

/** Ids must be ASCII, unique, short-ish; referenced deps must exist. */
function validateGraph(assignments, findings) {
  const ids = assignments.map((a) => String(a?.id ?? ''));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) findings.push(finding(BRIEF_CODES.PLAN_DUPLICATE_ID, 'error', `duplicate id: ${id}`));
    seen.add(id);
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) {
      findings.push(finding(BRIEF_CODES.PLAN_ID_INVALID, 'error', `id "${id}" must be unique ASCII (1-24 chars)`));
    }
  }
  const edges = new Map(assignments.map((a) => [
    String(a?.id ?? ''), Array.isArray(a?.dependsOn) ? a.dependsOn.map(String) : [],
  ]));
  for (const [id, deps] of edges) {
    for (const d of deps) {
      if (!seen.has(d)) findings.push(finding(BRIEF_CODES.PLAN_UNKNOWN_DEP, 'error', `${id} depends_on ${d} which does not exist`));
    }
  }
  const state = new Map();
  let cycleId = null;
  const visit = (id) => {
    if (state.get(id) === 'grey') { cycleId = id; return; }
    if (state.get(id) === 'black') return;
    state.set(id, 'grey');
    for (const d of edges.get(id) ?? []) if (edges.has(d)) visit(d);
    state.set(id, 'black');
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  if (cycleId) findings.push(finding(BRIEF_CODES.PLAN_CYCLE, 'error', `dependency cycle through ${cycleId}`));
}

const overlaps = (a, b) => {
  const rel = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const pa = rel(a), pb = rel(b);
  return pa === pb || pa.startsWith(pb + '/') || pb.startsWith(pa + '/');
};

/** Validate a whole orchestration plan ({assignments:[...]}). */
export function validatePlan(plan) {
  const findings = [];
  const normalized = normalizePlan(plan);
  const assignments = Array.isArray(normalized?.assignments) ? normalized.assignments : [];
  if (!assignments.length) findings.push(finding(BRIEF_CODES.PLAN_EMPTY, 'error', 'plan has no assignments'));
  if (assignments.length > MAX_ASSIGNMENTS) {
    findings.push(finding(BRIEF_CODES.PLAN_TOO_MANY, 'error', `${assignments.length} assignments > cap ${MAX_ASSIGNMENTS}`));
  }
  validateGraph(assignments, findings);

  assignments.map(validateBrief).forEach((r, i) => {
    for (const f of r.findings) {
      findings.push({ ...f, detail: `[${assignments[i]?.id ?? i}] ${f.detail}` });
    }
  });

  // Topological wave counting for the parallel cap.
  const deps = new Map(assignments.map((a) => [String(a?.id ?? ''), (a?.dependsOn ?? []).map(String)]));
  const wave = new Map();
  const waveOf = (id, stack = new Set()) => {
    if (wave.has(id)) return wave.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const ds = (deps.get(id) ?? []).filter((d) => deps.has(d));
    const w = ds.length === 0 ? 0 : 1 + Math.max(...ds.map((d) => waveOf(d, stack)));
    stack.delete(id);
    wave.set(id, w);
    return w;
  };
  for (const id of deps.keys()) waveOf(id);
  const byWave = new Map();
  for (const w of wave.values()) byWave.set(w, (byWave.get(w) ?? 0) + 1);
  const widest = Math.max(0, ...byWave.values());
  if (widest > MAX_PARALLEL) {
    findings.push(finding(BRIEF_CODES.PLAN_CAP, 'warn',
      `widest wave ${widest} > ${MAX_PARALLEL} concurrent delegates — split the orchestration`));
  }

  // Overlapping scopes without a dependency order = silent serialisation.
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const A = assignments[i], B = assignments[j];
      const sa = (Array.isArray(A?.scope) ? A.scope : [A?.scope]).filter(Boolean);
      const sb = (Array.isArray(B?.scope) ? B.scope : [B?.scope]).filter(Boolean);
      if (!sa.some((p) => sb.some((q) => overlaps(p, q)))) continue;
      const ordered = (deps.get(String(B?.id ?? '')) ?? []).includes(String(A?.id ?? ''))
        || (deps.get(String(A?.id ?? '')) ?? []).includes(String(B?.id ?? ''));
      if (!ordered) {
        findings.push(finding(BRIEF_CODES.PLAN_OVERLAP, 'warn',
          `scopes of ${A?.id} and ${B?.id} overlap without depends_on — will run serially`));
      }
    }
  }
  return { ok: findings.every((f) => f.severity !== 'error'), findings };
}

/**
 * Build a compliant delegate brief — the forcing function behind the gate:
 * a caller that uses this cannot forget the discipline block, and `Loading:`
 * is DERIVED from the task text with the same keyword tables the gate
 * checks, so routing cannot drift from what the work obligates.
 *
 * It refuses to invent what it does not know: no scope in -> no scope out
 * (the gate then fails loudly instead of a guessed path reaching a worker).
 */
export function buildBrief(input = {}) {
  const {
    id, scope, task = '', outcome = '', verify, timebox, mode,
    tools, mustDo, mustNotDo, context, partial, dependsOn,
  } = input;

  const readOnly = mode === 'read-only';
  const toolsLine = tools ?? (readOnly ? 'Read, Grep, Glob (read-only)' : 'Read, Edit, Write, Bash');

  const obligated = obligatedSkills(`${task}\n${outcome}`);
  const loading = obligated.join(', ') || '(none — no routed domain triggered)';

  const scopeList = Array.isArray(scope) ? scope : scope ? [scope] : [];
  const scopeText = scopeList.length > 0 ? scopeList.join(', ') : '(not specified)';

  const rules =
    'Repo rules: (1) every file change is verified (typecheck/test/error output) before being ' +
    'called done — no done claim without evidence. (2) No refactoring outside the requested ' +
    'scope; edit only the lines that complete the task. (3) No touching files outside the ' +
    'allowed path list; report back if another file is needed.';

  const lines = [
    `Loading: ${loading}`,
    `Scope: ${scopeText}`,
    ...(readOnly ? ['Mode: read-only'] : []),
    rules,
    `TASK: ${task}`,
    `EXPECTED OUTCOME: ${outcome || '(fill in the verifiable result)'}`,
    `REQUIRED TOOLS: ${toolsLine}`,
    `MUST DO: ${mustDo || (readOnly
      ? `Read only inside scope: ${scopeText}. Return findings as re-checkable file:line citations.`
      : `Work only inside scope: ${scopeText}. Run VERIFY before reporting done; report its output verbatim.`)}`,
    `MUST NOT DO: ${mustNotDo || (readOnly
      ? 'Write or modify any file (read-only mode); leave the scope; claim without file:line citation.'
      : 'Leave the scope above; refactor outside the task; claim done without evidence; touch .env/secrets; deploy/merge/destructive migrations.')}`,
    `CONTEXT: ${context || `Scope allowed: ${scopeText}. Router: AGENTS.md + WORKFLOW.md.`}`,
    `VERIFY: ${verify || (readOnly ? 'return a list of re-checkable file:line citations' : '(fill in the literal verification command)')}`,
    `TIMEBOX: ${Number.isFinite(Number(timebox)) ? Number(timebox) : 30}`,
    `PARTIAL: ${partial || 'Return the evidence collected so far (command output, changed files, ERROR lines) then stop — do not start new work.'}`,
  ];

  const brief = { id, files: scopeList, prompt: lines.join('\n') };
  if (Array.isArray(dependsOn) && dependsOn.length) brief.depends_on = dependsOn;
  return brief;
}

/**
 * Normalize a plan into the validator's shape. Harness orchestrators spell
 * the fields differently — accept both, prefer tasks|assignments:
 *   tasks|assignments -> assignments; files|scope -> scope;
 *   depends_on|dependsOn -> dependsOn
 */
export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const list = Array.isArray(plan.tasks) ? plan.tasks
    : Array.isArray(plan.assignments) ? plan.assignments : null;
  if (!list) return null;
  return {
    ...plan,
    assignments: list.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const out = { ...t, scope: t.scope ?? t.files };
      const d = t.dependsOn ?? t.depends_on;
      if (d !== undefined) out.dependsOn = Array.isArray(d) ? d : [d];
      return out;
    }),
  };
}

/** Pull a <tna_orchestration>{...}</tna_orchestration> plan out of text. */
export function extractBriefs(text) {
  const m = String(text ?? '').match(/<tna_orchestration>([\s\S]*?)<\/tna_orchestration>/i);
  if (!m) return null;
  try { return normalizePlan(JSON.parse(m[1].trim())); } catch { return null; }
}

/** Validate whatever the caller has: a wrapped plan, a bare plan, or a single brief. */
export function validateAny(text) {
  const plan = extractBriefs(text);
  if (plan) return { kind: 'plan', ...validatePlan(plan) };
  let parsed = null;
  try { parsed = JSON.parse(String(text ?? '').trim()); } catch { /* not JSON */ }
  const bare = normalizePlan(parsed);
  if (bare && Array.isArray(bare.assignments)) return { kind: 'plan', ...validatePlan(bare) };
  if (parsed && (parsed.prompt || parsed.scope || parsed.files)) {
    return { kind: 'brief', ...validateBrief(parsed) };
  }
  return { kind: 'brief', ...validateBrief({ prompt: String(text ?? '') }) };
}

/** Tool names that spawn a subagent across harnesses. */
export const DELEGATION_TOOLS = Object.freeze(new Set([
  'agent', 'task', 'subagent', 'general-purpose', 'run_subagent', 'spawn_agent',
]));

/**
 * The ONE delegation decision, shared by every harness adapter. Pure: no I/O,
 * no throw — callers turn `allow: false` into their own veto shape (exit 2 /
 * deny JSON / thrown veto).
 */
export function delegateVerdict(call) {
  const tool = String(call?.tool ?? '').toLowerCase();
  if (!DELEGATION_TOOLS.has(tool)) return { allow: true, reason: 'not a delegation tool' };

  const args = call?.args ?? call?.tool_input ?? {};
  const prompt = String(args.prompt ?? args.task ?? '');
  const description = String(args.description ?? args.title ?? '');
  const text = [prompt, description].filter((x) => x.trim() !== '').join('\n');
  if (text.trim() === '') return { allow: false, reason: 'delegation prompt is empty — no discipline guards reach the delegate' };

  // Skill obligation reads the work statement — TASK/OUTCOME/description —
  // never the boilerplate. Feed the description through at the primary pass:
  // the old port scanned description+prompt, so a second pass would let the
  // two paths disagree.
  let r;
  try {
    const plan = extractBriefs(text) ?? (() => {
      try { return normalizePlan(JSON.parse(text)); } catch { return null; }
    })();
    r = plan && Array.isArray(plan.assignments)
      ? { kind: 'plan', ...validatePlan(plan) }
      : { kind: 'brief', ...validateBrief({ prompt, description }) };
  } catch (e) {
    return { allow: true, reason: `gate error, allowing (${String(e?.message ?? e)})` };
  }
  const errors = r.findings.filter((f) => f.severity === 'error');
  if (!errors.length) {
    return { allow: true, reason: 'brief carries the discipline block and its routed skills' };
  }
  return {
    allow: false,
    reason: 'delegation without its discipline guards — the brief must carry: ' +
      errors.map((f) => `${f.code} (${f.detail})`).join('; '),
    findings: errors,
  };
}

function format(result) {
  const lines = result.findings.map((f) =>
    `${f.severity === 'error' ? 'ERROR' : 'WARN '} ${f.code} — ${f.detail}`);
  return [`${result.ok ? 'PASS' : 'FAIL'} (${result.kind})`, ...lines].join('\n');
}

function main(argv) {
  const has = (f) => argv.includes(f);
  const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

  // --pretool: PreToolUse veto on delegation tools. The DOCUMENTED deny shape
  // on Claude Code AND Codex is exit 0 + stdout JSON permissionDecision:"deny"
  // (gate-hook.mjs denyPreTool — measured 2026-10-22: exit 2 + stderr fails
  // OPEN on codex 0.159.2, every blocked commit landed). Fail-open on anything
  // unexpected: a broken gate must not wedge a session.
  if (has('--pretool')) {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
    const tool = String(payload?.tool_name ?? '');
    if (!DELEGATION_TOOLS.has(tool.toLowerCase())) return 0;

    const input = payload?.tool_input ?? {};
    const text = [input.prompt ?? input.task, input.description ?? input.title]
      .filter((x) => typeof x === 'string' && x.trim() !== '').join('\n');
    if (text.trim() === '') return 0;

    let dv;
    try { dv = delegateVerdict({ tool, args: input }); } catch { return 0; }
    if (dv.allow) return 0;

    const reason =
      `[orchestrator-brief] Delegation denied — the prompt carries no discipline block. ` +
      (dv.findings ?? []).map((f) => `${f.code} (${f.detail})`).join('; ') +
      ` Rebuild it with buildBrief() from scripts/orchestrator-brief.mjs ` +
      `(check first: --text "<plan>"), then resend. Contract: AGENTS.md §5.`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n');
    return 0;
  }

  let text = argOf('--text');
  const file = argOf('--file');
  if (!text && file) {
    if (!existsSync(file)) { process.stderr.write(`no such file: ${file}\n`); return 2; }
    text = readFileSync(file, 'utf8');
  }
  if (!text && has('--tests')) {
    const good = buildBrief({ id: 'A', scope: ['src/'], task: 'write the failing test', verify: 'node scripts/orchestrator-brief.test.mjs' });
    const r = validatePlan({ assignments: [good] });
    process.stdout.write(format({ kind: 'plan', ...r }) + '\n');
    return r.ok ? 0 : 1;
  }
  if (!text) {
    process.stderr.write('usage: --text <s> | --file <f> | --pretool | --tests [--json]\n');
    return 2;
  }
  const r = validateAny(text);
  process.stdout.write(has('--json') ? JSON.stringify(r, null, 2) + '\n' : format(r) + '\n');
  return r.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
