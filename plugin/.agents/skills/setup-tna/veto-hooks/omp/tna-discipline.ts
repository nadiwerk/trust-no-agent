// trust-no-agent — omp-native discipline gate (user-global hook).
//
// Port of the senpi hooks ~/.omo/agent/hooks/tna-gate.mjs + omo-discipline-gate.mjs
// to omp's in-process hook API (HookAPI factory: default export receives `pi`,
// handlers register via pi.on). The senpi pair spoke JSON-on-stdin; omp dispatches
// typed events in-process, so only the I/O shell changed — the floor extraction,
// keyword tables, and arming contract stay in lockstep with the senpi versions.
//
// Event mapping (senpi -> omp):
//   SessionStart / PostCompact  -> before_agent_start (first prompt / post-compact
//                                  flag) injecting the discipline floor
//   UserPromptSubmit            -> before_agent_start, per-prompt mandatory-gate
//                                  classification of event.prompt
//   PreToolUse(task)            -> tool_call, arming of delegation text via
//                                  returned `input` (omp's task tool has no
//                                  load_skills field, so arming is prose-only:
//                                  the arm names the mandatory skills and the
//                                  skill roots to open them from)
//
// POSTURE — FAIL-OPEN, ALWAYS. Any error is swallowed; this hook never blocks a
// tool call (it returns no `block`), it only adds context. A discipline layer
// that can break a session is worse than no discipline layer.
//
// Floor text is EXTRACTED from the live router files (the current project's
// AGENTS.md first — the project router is primary — then the installed
// fallbacks), never copied, so it cannot drift from the rules it re-injects.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {(event: Record<string, unknown>, ctx: unknown) => unknown} HookHandler
 * @typedef {{ on(event: string, handler: HookHandler): void }} HookPi
 */

const HOME = process.env.USERPROFILE || process.env.HOME || homedir();

// Fallback router sources, in order: the installer's frozen copy beside the
// senpi hooks, then the skill payload that ships WITH the framework (the
// setup-tna references copy every harness install already carries), then the
// upstream checkout at its conventional location. The current project's
// AGENTS.md is always tried FIRST at call time (resolveFloor(cwd)), so these
// fallbacks only matter outside an adopted project.
//
// Origin 2026-10-25: the list used to be hard-coded to the maintainer's own
// `~/projects/trust-no-agent` checkout — a path no adopter has — so on a fresh
// install the floor silently found nothing and fail-open meant "no floor".
//
// REMOVED 2026-10-25 (omp fix-list #9, measured): `~/.omo/agent/hooks/router`
// used to head this list, and it was 33 lines behind the live router — including
// the three rules born that same day ("adapter matrix", "a veto proof is
// two-sided", "a veto is one of four layers"). A session run from a
// subdirectory therefore received a floor that CLAIMED rules it no longer
// contained and omitted the ones that applied, and fail-open hid it: the floor
// looked injected. A stale floor is worse than no floor — it is a false receipt
// of the rules — so that root is gone. The remaining fallbacks are shipped
// copies of THIS framework (the setup-tna references), which are refreshed by
// the installer and checked by doctor.
const ROUTER_FALLBACK_ROOTS = [
  join(HOME, '.agents', 'skills', 'setup-tna', 'references'),
  join(HOME, '.omp', 'agent', 'skills', 'setup-tna', 'references'),
  join(HOME, '.pi', 'agent', 'skills', 'setup-tna', 'references'),
  join(HOME, '.claude', 'skills', 'setup-tna', 'references'),
  join(HOME, 'projects', 'trust-no-agent', 'plugin'),
  join(HOME, 'projects', 'trust-no-agent'),
];
const ROUTER_SOURCE_FILES = ['AGENTS.md', 'WORKFLOW.md'];

// omp's skill discovery root first, then the omo mirror.
const SKILL_ROOT_TEXT =
  'MANDATORY skill files: ~/.agents/skills/<name>/SKILL.md ' +
  '(also mirrored at ~/.omo/agent/skills/). An unloaded skill is a dead skill — ' +
  'if one was not injected into your context, open its SKILL.md directly and say ' +
  'it was loaded from the file.';

const TRACE_PATH = join(HOME, '.omp', 'agent', 'hooks', 'tna-trace.log');

/** Append one JSON line to the trace log when TNA_HOOK_TRACE=1. Never throws. */
function trace(event, detail) {
  if (process.env.TNA_HOOK_TRACE !== '1') return;
  try {
    appendFileSync(
      TRACE_PATH,
      JSON.stringify({ ts: new Date().toISOString(), hook: 'tna-discipline', event, detail }) + '\n',
    );
  } catch {
    /* tracing must never fail the session */
  }
}

// The floor spans the four Iron Laws + the MANDATORY discipline section. Router
// files shape those differently (upstream WORKFLOW.md: numbered list item
// "3. **The four Iron Laws**:"; this project's AGENTS.md: "### 2. The four Iron
// Laws" over a numbered list), so match by sentinel line, not by heading shape,
// and refuse a half floor: no law lines -> no floor (silent fail-open).
const LAW_SENTINELS = [
  /No acting until/i,
  /No production .+ without [^.]*failing test first/i,
  /No completion claims? without fresh verification/i,
  /expensive, irreversible, or shared-system action/i,
];

/**
 * Extract the discipline floor (four Iron Laws + MANDATORY section) from router
 * file text. Shape-agnostic: sentinel-matched law lines, not heading forms.
 * Returns null when any law is missing — a half floor is worse than none.
 * @param {string} text
 * @returns {string | null}
 */
export function extractFloor(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const laws = [];
  for (const re of LAW_SENTINELS) {
    const line =
      lines.find((l) => re.test(l) && /^\s*(?:\d+\.|-)\s/.test(l)) ??
      lines.find((l) => re.test(l));
    if (!line) return null;
    laws.push(line.replace(/^\s*(?:\d+\.|-)\s*/, '').trim());
  }
  const out = ['The four Iron Laws (quoted from the router, not copied):'];
  laws.forEach((l, i) => out.push(`${i + 1}. ${l}`));
  const mandStart = lines.findIndex((l) => /^#+\s*(?:\d+\.\s*)?MANDATORY discipline skills/i.test(l));
  if (mandStart !== -1) {
    out.push('');
    for (let i = mandStart; i < lines.length; i++) {
      const l = lines[i];
      if (i > mandStart && /^#+\s/.test(l)) break;
      out.push(l);
    }
  }
  return out.join('\n').trim();
}

/**
 * Project router first (primary), then installed fallbacks. Fail-open: null.
 * @param {string} cwd
 * @returns {{ floor: string, source: string } | null}
 */
export function resolveFloor(cwd) {
  const roots = [cwd, ...ROUTER_FALLBACK_ROOTS].filter(Boolean);
  for (const root of roots) {
    const texts = [];
    for (const file of ROUTER_SOURCE_FILES) {
      const path = join(root, file);
      try {
        if (existsSync(path)) texts.push(readFileSync(path, 'utf8'));
      } catch {
        /* unreadable root — try the next */
      }
    }
    if (!texts.length) continue;
    const floor = extractFloor(texts.join('\n\n'));
    if (floor) return { floor, source: root };
  }
  return null;
}

/** @type {Record<string, string>} */
const DOMAIN_INSTRUCTION = {
  'expect-fail':
    'No production code and no test without a failing test first — load the `expect-fail` ' +
    'skill before writing either. Writing tests is never `fast`.',
  'root-cause':
    'Look up the root cause before proposing any fix — load the `root-cause` skill first. A ' +
    'fix proposed before the cause is known is a guess with a receipt attached.',
  receipts:
    'No "done"/"shipped"/"fixed" claim, commit, or PR without fresh verification evidence run ' +
    "in this session — load the `receipts` skill first. The agent's own claim is not evidence.",
};

// MANDATORY keyword classification.
//
// PORTED VERBATIM from scripts/mandatory-gate.mjs (2026-10-25, omp fix-list #11).
// The hook is installed as a user-global file under ~/.omp and must not depend on
// the framework tree, so the tables are duplicated — the same trade the TEST_RUN
// matcher makes — and `scripts/omp-fixlist.test.mjs` (O11) pins the port to the
// canonical classifier on a corpus, so an edit to one side fails a test.
//
// WHY THE PORT (measured): the old table matched bare words, with no negation
// handling, so four of seven realistic prompts fired a domain that does not
// apply — and every one of them was a DECLINED request:
//   "jangan push dulu ya"                -> receipts      (canonical: none)
//   "tidak perlu commit sekarang"        -> receipts      (canonical: none)
//   "no need to write a test for this"   -> expect-fail   (canonical: none)
//   "sudah saya baca file itu, lanjut"   -> receipts      (canonical: none)
// The canonical design, kept here: keywords are PHRASES chosen to separate real
// domain work from incidental mentions, and a NEGATION inside the same clause
// suppresses the match.
const MANDATORY_KEYWORDS = {
  'expect-fail': ['write a test', 'write tests', 'unit test', 'write a spec', 'tulis test', 'buat test', 'add unit tests', 'test-first'],
  'root-cause': ['bug', 'error', 'failing', 'failure', 'regression', 'perbaiki bug', 'debug', 'crash', 'why does', 'broke', 'broken', 'why is this'],
  receipts: ['commit', 'push', 'shipped', 'ship', 'merge', 'merged', 'pr', 'release', 'done', 'selesai', 'beres', 'catat', 'log it', 'deploy'],
};

/**
 * Negation markers, EN + ID. Bare "no" is deliberately absent: it is both the
 * commonest English denial and the commonest Indonesian sentence opener ("no,
 * the tests are failing"), and a complaint is a positive signal.
 */
const NEGATION_MARKERS = [
  'no need', 'no commit', 'no commits', 'no test', 'no tests', 'no spec', 'no bug', 'no bugs', 'no error',
  'no errors', 'no fix', 'no fixes',
  'not', 'dont', "don't", 'do not', 'without', 'never', 'nothing to',
  'jangan', 'tanpa', 'belum', 'tidak perlu', 'ga perlu', 'gak perlu', 'nggak perlu',
];

/** How many tokens a negation reaches forward (one clause). */
const NEGATION_WINDOW_WORDS = 6;

/** Clause boundaries: a negation never reaches past one. */
const CLAUSE_BOUNDARY = /[.,;:!?()\n]|\s(?:but|tapi|however|namun|though|meskipun)\s/;

function clauseSpans(text) {
  const spans = [];
  let start = 0;
  const re = new RegExp(CLAUSE_BOUNDARY.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push([start, m.index]);
    start = m.index + m[0].length;
  }
  spans.push([start, text.length]);
  return spans;
}

function matchIndex(text, kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\b${esc}\\b`, 'i').exec(text);
  return m ? m.index : -1;
}

function isNegated(text, at, kw, spans) {
  const span = spans.find(([s, e]) => at >= s && at < e);
  if (!span) return false;
  const [s] = span;
  const through = text.slice(s, at + kw.length);
  const words = through.split(/\s+/).filter(Boolean);
  const tail = words.slice(-NEGATION_WINDOW_WORDS).join(' ');
  return NEGATION_MARKERS.some((marker) => {
    const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\s)${esc}(\\s|$)`, 'i').test(tail)) return true;
    return new RegExp(`(^|\\s)${esc}$`, 'i').test(through);
  });
}

function matchesAny(text, keywords) {
  const spans = clauseSpans(text);
  return keywords.some((kw) => {
    let from = 0;
    for (;;) {
      const idx = matchIndex(text.slice(from), kw);
      if (idx === -1) return false;
      const at = from + idx;
      if (!isNegated(text, at, kw, spans)) return true;
      from = at + kw.length;
    }
  });
}

/**
 * Strip instruction blocks that the HOST injects into the prompt before
 * classification.
 *
 * Origin 2026-10-25 (omp fix-list #11b, measured): `before_agent_start` receives
 * `event.prompt`, and in a bb session that value already carries the host-wide
 * AGENTS.md block — which names `expect-fail` and `commit` literally. Measured:
 * user text alone flagged only root-cause; user text + the bb block flagged all
 * three; the bb block alone flagged all three. The notice was firing on the
 * framework's own prose, which is how a real signal becomes noise.
 *
 * TWO shapes are recognised, because a host block arrives both ways:
 *   1. prefixed by `Instructions from: <path>` (bb's AGENTS.md injection);
 *   2. the router's own numbered section headings (`## 1. Klasifikasi sebelum
 *      apa pun`, `## 2. Trigger matrix`, `## 3. Aturan inti`), which a host may
 *      inline with no preamble at all.
 *
 * WHERE A BLOCK ENDS matters as much as where it starts: a strip that ran to the
 * end of the prompt swallowed the real request after it and turned the gate off
 * (measured — `host block + "please commit this"` stopped firing). The rule:
 * a router section runs until a non-numbered heading OR a line that is plainly
 * user prose (no markdown structure, no table, no bullet) after a blank line.
 *
 * Deliberately narrow: only these named shapes, never arbitrary prose —
 * over-stripping blinds the gate, which is worse than a noisy notice.
 */
export function stripHostInstructions(prompt) {
  const text = String(prompt ?? '');
  const lines = text.split(/\r?\n/);
  const ROUTER_HEADING = /^\s*#{1,3}\s*(\d+\.\s*)?(Klasifikasi sebelum|Trigger matrix|Aturan inti|Discipline floor|Trust No Agent)\b/i;
  const ANY_HEADING = /^\s*#{1,3}\s+\S/;
  const kept = [];
  let inside = false;
  let sawBlank = false;

  for (const line of lines) {
    if (/^\s*Instructions from:/i.test(line)) { inside = true; sawBlank = false; continue; }
    if (ROUTER_HEADING.test(line)) { inside = true; sawBlank = false; continue; }

    if (inside) {
      if (ANY_HEADING.test(line) && !ROUTER_HEADING.test(line)) {
        // A non-router heading: the host block is over, keep this line.
        inside = false;
        kept.push(line);
        sawBlank = false;
        continue;
      }
      // Router sections are markdown-structured: headings, tables, bullets,
      // emphasis, code. A blank line followed by plain prose is the user's turn.
      const structured = /^\s*(#{1,6}\s|\||[-*+]\s|\*\*|`|>\s|\d+\.\s)/.test(line);
      if (line.trim() === '') { sawBlank = true; continue; }
      if (sawBlank && !structured && !ROUTER_HEADING.test(line)) {
        inside = false;
        kept.push(line);
        sawBlank = false;
        continue;
      }
      sawBlank = false;
      continue; // still inside the host block
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/**
 * Classify a user prompt against the three MANDATORY domains (keyword signal).
 * @param {string} prompt
 * @returns {Record<string, boolean>}
 */
export function classifyPrompt(prompt) {
  const text = stripHostInstructions(prompt).toLowerCase();
  /** @type {Record<string, boolean>} */
  const verdict = {};
  for (const [domain, keywords] of Object.entries(MANDATORY_KEYWORDS)) {
    verdict[domain] = matchesAny(text, keywords);
  }
  return verdict;
}

/**
 * @param {string} prompt
 * @returns {string | null}
 */
function buildPromptNotice(prompt) {
  if (!prompt) return null;
  const hits = Object.entries(classifyPrompt(prompt))
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!hits.length) return null;
  const lines = hits.map((h) => `- **${h}** — ${DOMAIN_INSTRUCTION[h]}`);
  return (
    'trust-no-agent mandatory-gate flagged this request against the MANDATORY domains (keyword ' +
    'signal — verify, it is not proof of a violation):\n\n' +
    lines.join('\n') +
    '\n\nLoad each flagged skill before the work it governs. If a flag does not apply to what ' +
    'was actually asked, say so and proceed — do not perform the ritual.'
  );
}

// Delegation arming. Domain routing: `receipts` is the floor on every spawn (any
// delegation can end in a completion claim); expect-fail / root-cause route on
// the caller's own text. Over-arming costs a few tokens; under-arming costs the
// discipline.
const DOMAIN_RULES = [
  {
    skill: 'expect-fail',
    re: /\b(test|tests|testing|spec|specs|tdd|unit test|integration test|e2e|coverage|assert)\w*\b/i,
  },
  {
    skill: 'root-cause',
    re: /\b(bug|bugs|broken|fails?|failing|failure|error|errors|crash|regression|root cause|debug|why is|unexpected|not working|doesn'?t work)\b/i,
  },
];

/**
 * Which mandatory skills this delegation text must carry (receipts always).
 * @param {string} text
 * @returns {string[]}
 */
export function routeMandatorySkills(text) {
  const haystack = typeof text === 'string' ? text : '';
  const picked = new Set(['receipts']);
  for (const rule of DOMAIN_RULES) {
    if (rule.re.test(haystack)) picked.add(rule.skill);
  }
  return [...picked];
}

const ARM_MARKER = 'Trust No Agent — delegated-execution contract';

/**
 * @param {string[]} routed
 * @returns {string}
 */
function buildArm(routed) {
  const bullets = routed.map((s) => `- \`${s}\``).join('\n');
  return [
    `## ${ARM_MARKER} (injected by the omp discipline gate)`,
    '',
    'You are a delegated worker. The parent router\'s rules apply to you; they were not',
    'otherwise present in your context. Obey these:',
    '',
    '**Iron Laws.** (1) No acting until shared understanding is confirmed when requirements are',
    'materially ambiguous — ask rather than guess. (2) No production behavior change without',
    'observing a failing test first. (3) No completion claim without fresh verification output,',
    'read in this turn, with exit status checked. (4) No expensive, irreversible, or shared-system',
    'action without explicit sign-off.',
    '',
    '**MANDATORY discipline skills for this task.** Load before the work they govern:',
    bullets,
    '- `expect-fail` — before writing any test or behavior-changing code.',
    '- `root-cause` — before proposing any fix for a bug, failure, or unexpected behavior.',
    '- `receipts` — before any "done"/"fixed"/"shipped" claim.',
    SKILL_ROOT_TEXT,
    '',
    '**Report honestly.** A partial result stated as partial beats a complete-sounding guess.',
    'If you cannot determine an outcome, state exactly which commands you ran and paste the',
    'decisive output. No bare `sudah/hapus/beres` without its artifact in the same turn.',
    '',
  ].join('\n');
}

const DELEGATION_TOOLS = new Set(['task', 'workpool']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

/** @param {HookPi} pi */
export default function factory(pi) {
  // Per-session state lives in the factory closure (a fresh load = fresh state).
  let floorInjected = false;
  let needsFloorAfterCompact = false;

  pi.on('session_start', () => {
    floorInjected = false;
    needsFloorAfterCompact = false;
    trace('session_start', {});
  });

  pi.on('session_compact', () => {
    // PostCompact equivalent: the compacted session lost the floor from its
    // visible context — re-inject at the next prompt.
    needsFloorAfterCompact = true;
    trace('session_compact', {});
  });

  pi.on('before_agent_start', (event, ctx) => {
    try {
      const parts = [];
      if (!floorInjected || needsFloorAfterCompact) {
        // The SESSION's cwd, not the process's. Origin 2026-10-25 (fix-list #9):
        // `process.cwd()` is wherever omp was launched, so a session working in a
        // subdirectory resolved the wrong project (or fell through to a stale
        // fallback router) while the floor still looked injected.
        const sessionCwd =
          (typeof ctx?.cwd === 'string' && ctx.cwd) ||
          (typeof event?.cwd === 'string' && event.cwd) ||
          process.cwd();
        const resolved = resolveFloor(sessionCwd);
        if (resolved) {
          parts.push(
            'trust-no-agent — the router is installed and active in this session. These rules are ' +
              `quoted from the router at ${resolved.source}:\n\n${resolved.floor}\n\n` +
              'No performative agreement or performative refusal: agreement is a technical claim + ' +
              'evidence (file:line, fresh output), dissent is a technical reason + alternative. A ' +
              'bare `sudah/hapus/beres` with no artifact in the same turn is a rumor, never a receipt.'
          );
          floorInjected = true;
          needsFloorAfterCompact = false;
        }
      }
      const prompt = typeof event.prompt === 'string' ? event.prompt : String(event.prompt ?? '');
      const notice = buildPromptNotice(prompt);
      if (notice) parts.push(notice);
      if (!parts.length) return;
      trace('before_agent_start', { floor: floorInjected, flagged: Boolean(notice) });
      return {
        message: {
          customType: 'tna-floor',
          content: parts.join('\n\n'),
          display: false,
          attribution: 'agent',
        },
      };
    } catch {
      /* fail-open */
    }
  });

  pi.on('tool_call', (event) => {
    try {
      if (!DELEGATION_TOOLS.has(String(event.toolName ?? ''))) return;
      const input = event.input;
      if (!isObject(input)) return;
      const batch = Array.isArray(input.tasks) ? input.tasks : null;
      const single = typeof input.task === 'string' && batch === null;
      const items = batch && batch.length ? batch : single ? [input] : null;
      if (!items) return;

      let mutated = 0;
      const next = items.map((item) => {
        if (!isObject(item) || typeof item.task !== 'string') return item;
        if (item.task.includes(ARM_MARKER)) return item;
        const routingText = [
          item.task,
          typeof item.context === 'string' ? item.context : '',
          typeof item.name === 'string' ? item.name : '',
        ].join('\n');
        mutated += 1;
        return { ...item, task: `${buildArm(routeMandatorySkills(routingText))}---\n\n${item.task}` };
      });
      if (!mutated) return;
      trace('tool_call.arming', { toolName: String(event.toolName), items: mutated });
      // WRAP IN `input` — omp only replaces the tool input when the handler's
      // return value carries an `input` key. Its merge helper (`dist/cli.js`):
      //
      //   let { additionalContext, input, ...rest } = a;
      //   return { ...rest, ...(input !== undefined ? { input } : {}) };
      //
      // Origin 2026-10-25 (omp fix-list #1, measured): the previous version
      // returned `{ ...input, tasks }` at the TOP level, so the helper saw no
      // `input`, discarded the arming, and the delegated-execution contract
      // never reached the child prompt — silently, with no error, while doctor
      // reported the adapter "PASS". A layer that is installed and inert is the
      // exact failure mode this framework exists to catch.
      const revised = batch && batch.length
        ? { ...input, tasks: next }
        : { ...input, task: next[0].task };
      return { input: revised };
    } catch {
      /* fail-open */
    }
  });
}
