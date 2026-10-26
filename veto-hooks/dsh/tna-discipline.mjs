// tna-discipline.mjs — trust-no-agent discipline plugin for DeepSeek Harness.
//
// Two layers, ported from the pi/omp discipline adapters onto dsh's cordis
// contract:
//
//   1. MANDATORY CLASSIFICATION. `agent/pre-step` reads the newest user message,
//      classifies it against expect-fail / root-cause / receipts, and appends a
//      LOAD directive to the step's messages. Keyword signal: the text says
//      "verify, this is not proof of a violation".
//   2. COMPLETION-CLAIM GATE. The same waterfall checks the closing assistant
//      text: a claim with no verifying tool call in the turn gets the receipts
//      notice appended, so the next step sees it instead of the claim landing
//      unexamined.
//
// WHY: measured 2026-10-25 — dsh shipped the veto, and its own AGENTS.md reading
// gave it a partial floor, but nothing mechanically classified a prompt against
// the MANDATORY domains and nothing guarded a completion claim. "I'll write the
// test after" and "done" with no verification both passed silently.
//
// The floor itself is NOT re-injected here: dsh reads AGENTS.md from the
// workspace natively (dsh-agent-instructions), so duplicating it would put two
// copies of the router in context and let them disagree. This plugin adds only
// what dsh does not already do.
//
// POSTURE — FAIL-OPEN, ALWAYS. Every listener swallows its own errors and
// delegates with `next()`: a discipline layer that can break a session is worse
// than no discipline layer. Blocking lives in tna-veto.mjs.
//
// dsh contract used here (quoted from @deepseek-ai/dsh-agent + the packages that
// use this seam, e.g. dsh-time-context, dsh-agent-instructions):
//   'agent/pre-step'({ agent, messages, step, turn, signal }, next)
//     -> decision { kind: 'continue' | 'reject', messages: [...] , ... }

export const name = 'tna-discipline';

export const inject = ['tools'];

/**
 * Build a user message the way dsh's own `createUserMessage` does.
 *
 * dsh messages carry a stable `id` and a `source` tag; a plain
 * `{ role, content }` object crashes the loop with "Cannot read properties of
 * undefined (reading 'kind')" (measured live 2026-10-25 on headless). dsh builds
 * them through `createUserMessage` from @deepseek-ai/dsh-llm, but this plugin is
 * loaded by PATH from a profile's plugins dir and cannot resolve that package —
 * so the same shape is constructed locally with node's own randomUUID. The
 * fields below are exactly what that helper sets (see dsh-llm: createMessage =
 * { ...input, id } + role).
 */
import { randomUUID } from 'node:crypto';

function createUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: name, form: 'snapshot' },
  };
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
// PORTED VERBATIM from scripts/mandatory-gate.mjs (2026-10-25, dsh fix-list #7).
// The plugin is loaded BY PATH from a profile and cannot resolve the framework
// package, so the tables are duplicated — the same trade the TEST_RUN matcher
// makes — and `scripts/dsh-fixlist.test.mjs` (F7) pins the port to the canonical
// classifier on a corpus, so a future edit to one side fails a test instead of
// silently drifting.
//
// WHY THE PORT (measured): the previous dsh table matched bare `test`, `fix` and
// `salah`, so three of four ordinary sentences fired a domain —
//   "fix the typo in the heading"   -> root-cause
//   "what does the test runner print" -> expect-fail
//   "perbaiki ejaan di docs"        -> root-cause
// A notice that fires on ordinary prose is noise, and noise is ignored.
//
// The canonical design, kept here: keywords are PHRASES chosen to separate real
// domain work from incidental mentions, and a NEGATION inside the same clause
// suppresses a match ("no need to write a test", "jangan tulis test dulu").
const MANDATORY_KEYWORDS = {
  'expect-fail': ['write a test', 'write tests', 'unit test', 'write a spec', 'tulis test', 'buat test', 'add unit tests', 'test-first'],
  'root-cause': ['bug', 'error', 'failing', 'failure', 'regression', 'perbaiki bug', 'debug', 'crash', 'why does', 'broke', 'broken', 'why is this'],
  receipts: ['commit', 'push', 'shipped', 'ship', 'merge', 'merged', 'pr', 'release', 'done', 'selesai', 'beres', 'catat', 'log it', 'deploy'],
};

/**
 * Negation markers, EN + ID. A keyword preceded by one of these within the word
 * window is a DECLINED mention, not a domain match. Bare "no" is deliberately
 * absent: it is both the commonest English denial and the commonest Indonesian
 * sentence opener ("no, the tests are failing"), and a complaint is a positive
 * signal. The attached forms ("no commit", "jangan", "tanpa", "belum") name the
 * withheld thing precisely.
 */
const NEGATION_MARKERS = [
  'no need', 'no commit', 'no commits', 'no test', 'no tests', 'no spec', 'no bug', 'no bugs', 'no error',
  'no errors', 'no fix', 'no fixes',
  'not', 'dont', "don't", 'do not', 'without', 'never', 'nothing to',
  'jangan', 'tanpa', 'belum', 'tidak perlu', 'ga perlu', 'gak perlu', 'nggak perlu',
];

/** How many tokens a negation reaches forward (one clause, longest real phrasing). */
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

const CLAIM_PATTERNS = [
  /\b(done|fixed|shipped|complete|completed|finished|passing|works|working)\b/i,
  /\b(selesai|beres|sudah jalan|sudah diperbaiki)\b/i,
];

/** Block types that carry a tool call. dsh emits `"tool-call"` (see below). */
const TOOL_BLOCK_TYPES = new Set(['tool-call', 'tool_use', 'toolCall']);

const EVIDENCE_TOOLS = new Set([
  'bash', 'pwsh', 'powershell', 'shell', 'exec_command', 'read', 'grep', 'glob', 'eval',
  'terminal_send', 'terminal_open', 'str_replace_editor', 'edit', 'write',
]);

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * Classify a prompt against the three MANDATORY domains (keyword signal).
 * @param {string} prompt
 * @returns {Record<string, boolean>}
 */
export function classifyPrompt(prompt) {
  const text = String(prompt ?? '').toLowerCase();
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
export function buildPromptNotice(prompt) {
  if (!prompt) return null;
  const hits = Object.entries(classifyPrompt(prompt))
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!hits.length) return null;
  const lines = hits.map((h) => `- **${h}** — ${DOMAIN_INSTRUCTION[h]}`);
  return (
    'MANDATORY DOMAIN DETECTED — trust-no-agent mandatory-gate flagged this request (keyword ' +
    'signal — verify, it is not proof of a violation):\n\n' +
    lines.join('\n') +
    '\n\nLoad each flagged skill before the work it governs. If a flag does not apply to what ' +
    'was actually asked, say so and proceed — do not perform the ritual.'
  );
}

/** Text of a dsh message's content blocks. */
function messageText(message) {
  if (!isObject(message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => isObject(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** The newest user message's text, or ''. */
function lastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isObject(message) || message.role !== 'user') continue;
    const text = messageText(message);
    if (text.trim() !== '') return text;
  }
  return '';
}

/** The newest assistant message's text, or ''. */
function lastAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isObject(message) || message.role !== 'assistant') continue;
    const text = messageText(message);
    if (text.trim() !== '') return text;
  }
  return '';
}

/**
 * Tool names used anywhere in the message list.
 *
 * Origin 2026-10-25 (dsh fix-list #6, measured): this checked only `tool_use`
 * and `toolCall`, but dsh emits `block.type === "tool-call"`
 * (@deepseek-ai/dsh-agent-loop). The gate therefore never SAW the evidence a
 * turn had actually produced, so a claim that HAD run its tests still got the
 * receipts notice — a false positive that teaches the reader to ignore the
 * notice, which is worse than no gate at all.
 */
function toolNamesIn(messages) {
  const names = new Set();
  if (!Array.isArray(messages)) return names;
  for (const message of messages) {
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isObject(block)) continue;
      if (typeof block.name === 'string' && TOOL_BLOCK_TYPES.has(block.type)) {
        names.add(block.name.toLowerCase());
      }
    }
  }
  return names;
}

/**
 * Resolve the project cwd; every failure degrades to the process cwd rather
 * than throwing inside a pre-step gate.
 */
async function resolveCwd(ctx, agent) {
  const directories = ctx?.get?.('workingDirectory');
  if (directories !== undefined && agent !== undefined) {
    try {
      const cwd = await directories.ensure(agent);
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    } catch {
      /* fall through */
    }
  }
  return process.cwd();
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    // `next()` is called EXACTLY ONCE. Calling it again from a catch block is
    // what broke the first version of this plugin: the waterfall's index has
    // already advanced, so the second call resolves undefined and the harness
    // dies with "Cannot read properties of undefined (reading 'kind')".
    // Measured live 2026-10-25 on `dsh --profile headless`.
    let decision;
    try {
      decision = await next();
    } catch {
      return undefined; // a throwing later listener owns its own failure
    }

    try {
      if (signal?.aborted) return decision;
      if (!isObject(decision) || decision.kind === 'reject') return decision;

      const parts = [];

      // Only classify the opening step of a turn: a directive repeated on every
      // step would drown the context it is meant to protect.
      if (step === 1) {
        const notice = buildPromptNotice(lastUserText(messages));
        if (notice !== null) parts.push(notice);
      }

      const claimText = lastAssistantText(messages);
      if (claimText !== '') {
        const claim = CLAIM_PATTERNS.map((re) => re.exec(claimText)?.[0]).find(Boolean);
        const evidenced = [...toolNamesIn(messages)].some((name) => EVIDENCE_TOOLS.has(name));
        if (claim !== undefined && !evidenced) {
          const mode = String(process.env.DONE_GATE_ENFORCE || 'warn').trim().toLowerCase();
          if (mode !== 'off' && mode !== 'false' && mode !== '0') {
            parts.push(
              [
                '## receipts gate — completion claim with no verification in this turn',
                '',
                `The closing text asserts completion (matched: "${claim}"), but no tool call ran in`,
                'this turn that could be its evidence. The `receipts` skill is explicit: the',
                'verification command must run in THIS message — a run from an earlier message',
                'proves nothing about the current state.',
                '',
                'Either run the proof command now and cite its output, or state plainly which part',
                'is unverified and why the claim still holds.',
              ].join('\n'),
            );
          }
        }
      }

      if (parts.length === 0) return decision;

      return {
        ...decision,
        messages: [
          ...(Array.isArray(decision.messages) ? decision.messages : []),
          ...parts.map((text) => createUserMessage(text)),
        ],
      };
    } catch {
      // Fail-open: hand back the decision we already have, never call next() again.
      return decision;
    }
  });
}
