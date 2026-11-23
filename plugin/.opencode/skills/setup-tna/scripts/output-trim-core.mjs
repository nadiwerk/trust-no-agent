/**
 * output-trim-core — the pure half of output-trim: text in, text out, no I/O.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested without a .trust/ dir and reused by any adapter. State, spill
 * recovery, dedup persistence, payload shaping and the CLI live in
 * output-trim.mjs; see that file's header for the full contract.
 */

// One threshold set — the only values ever benchmarked on the production
// side. Env overrides each.
export const THRESHOLDS = { maxChars: 8000, headLines: 60, tailLines: 40 };

// Tools whose output is safe to elide. Read/Edit/Write are absent on purpose:
// their output feeds exact-match edits. mcp__* are read-only info tools.
const SAFE_TOOLS = ['Bash', 'exec', 'Agent', 'WebFetch', 'WebSearch', 'Grep', 'Glob'];
const NEVER_COMPRESS = ['read', 'edit', 'write', 'multiedit', 'notebookedit', 'notebookread', 'notebook_edit', 'apply_patch', 'patch', 'create', 'str_replace', 'insert', 'view', 'todowrite', 'todoread'];

// Lowercase-runtime tool names (OpenCode/Devin-style harnesses): read-only
// shell/search tools safe to elide; the read/write family is hard-blocked by
// NEVER_COMPRESS above before any allowlist is consulted.
const SAFE_TOOLS_LOWER = ['bash', 'shell', 'exec', 'powershell', 'grep', 'glob', 'webfetch', 'websearch', 'web_fetch', 'web_search', 'list', 'task'];

/**
 * Failure markers that must survive elision. Letter/digit boundaries, not
 * \b: `_` is a word char, so \b misses severities inside codes like
 * FATAL_MEMORY_PROBE. The ✗/✘/× and ELIFECYCLE additions are the adopter's
 * measured patch — vitest's failure glyph and npm's terminal failure line
 * were being elided from the middle of 400-line dumps, leaving a root-cause
 * session reading 400 green lines and no failure.
 */
const SALVAGE_RE = /(?<![A-Za-z0-9])(?:err!|(?:error|fail(ed|ure|ing)?|exception|traceback|panic|fatal|denied|refused|timed?[ _-]?out|assert(ion)?|segfault|npe|undefined reference|cannot find|not found|warning|ELIFECYCLE)(?![A-Za-z0-9])|[✗✘×])/i;
const MAX_SALVAGED = 12;
const MAX_SALVAGE_LINE = 300;

export const SCRUB_MIN = 1024;
const REPEAT_MIN = 4;
export const MIN_WIN = 64;
const NOISE_MIN = 6;

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const NOISE_RE = /^\s*(?:[✓✔√]\s|PASS\s|ok \d+\b|\[PASS\])|\sPASSED\b|^\s*(?:Downloading|Downloaded|Fetching|Resolving|Receiving objects|Compiling|Installing|Extracting|Unpacking|Progress)\b/;

// ---- surrogate-pair safe slicing ----
function splitsSurrogatePair(text, index) {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF;
}
function safePrefix(text, maxChars) {
  let end = Math.max(0, Math.min(text.length, maxChars));
  if (splitsSurrogatePair(text, end)) end -= 1;
  return text.slice(0, end);
}
function safeSuffix(text, maxChars) {
  let start = Math.max(0, text.length - Math.max(0, maxChars));
  if (splitsSurrogatePair(text, start)) start += 1;
  return text.slice(start);
}
function safeSlice(text, start, end) {
  let safeStart = Math.max(0, Math.min(text.length, start));
  let safeEnd = Math.max(safeStart, Math.min(text.length, end));
  if (splitsSurrogatePair(text, safeStart)) safeStart += 1;
  if (splitsSurrogatePair(text, safeEnd)) safeEnd -= 1;
  return text.slice(safeStart, Math.max(safeStart, safeEnd));
}

function salvageLine(line) {
  const match = SALVAGE_RE.exec(line);
  if (!match) return null;
  if (line.length <= MAX_SALVAGE_LINE) return line;
  const contentLimit = MAX_SALVAGE_LINE - 2;
  const start = Math.max(0, Math.min(
    match.index - Math.floor((contentLimit - match[0].length) / 2),
    line.length - contentLimit,
  ));
  const end = start + contentLimit;
  return (start > 0 ? '…' : '') + safeSlice(line, start, end) + (end < line.length ? '…' : '');
}

/**
 * The correctness invariant, enforced rather than merely defaulted: the
 * read/write family's output feeds later exact-match edits. OUTPUT_TRIM_TOOLS
 * overrides the ALLOWLIST only — it can never switch this off.
 */
export function toolAllowed(name) {
  if (!name || typeof name !== 'string') return false;
  if (NEVER_COMPRESS.includes(name.toLowerCase())) return false;
  if (process.env.OUTPUT_TRIM_TOOLS) {
    return process.env.OUTPUT_TRIM_TOOLS.split(',').map((s) => s.trim()).filter(Boolean).includes(name);
  }
  return SAFE_TOOLS.includes(name) || SAFE_TOOLS_LOWER.includes(name.toLowerCase()) || name.startsWith('mcp__');
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
export function limitsFor() {
  return {
    maxChars: envInt('OUTPUT_TRIM_MAX_CHARS', THRESHOLDS.maxChars),
    headLines: envInt('OUTPUT_TRIM_HEAD_LINES', THRESHOLDS.headLines),
    tailLines: envInt('OUTPUT_TRIM_TAIL_LINES', THRESHOLDS.tailLines),
  };
}

// ---- response text extraction / rebuild (Claude-family snake_case shape) ----
export function extractText(response) {
  if (response == null) return null;
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) {
    const parts = response.map((b) => (b && typeof b.text === 'string') ? b.text : extractText(b && b.content)).filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof response === 'object') {
    const parts = [];
    for (const key of ['stdout', 'stderr', 'output', 'content', 'text', 'result']) {
      const val = response[key];
      if (typeof val === 'string' && val) parts.push(val);
      else if (val && typeof val === 'object') { const t = extractText(val); if (t) parts.push(t); }
    }
    if (parts.length) return parts.join('\n');
    try { return JSON.stringify(response); } catch { return null; }
  }
  return String(response);
}

/**
 * Put the compressed text back into the ORIGINAL response shape — the harness
 * validates updated output against the tool's own schema, so a bare string
 * for an object-shaped result is rejected on every call (the hook appears to
 * work while the model still receives full output). Return null — skip —
 * rather than emit a shape the harness will refuse.
 */
export function rebuildResponse(response, updated) {
  if (response == null || typeof response === 'string') return updated;
  if (typeof response === 'object' && !Array.isArray(response)) {
    for (const key of ['stdout', 'output', 'content', 'text', 'result']) {
      if (typeof response[key] === 'string') {
        const out = { ...response, [key]: updated };
        // extractText already folded stderr into the compressed text; leaving
        // the original stderr in place would duplicate it.
        if (key === 'stdout' && typeof response.stderr === 'string') out.stderr = '';
        return out;
      }
    }
  }
  return null;
}

// ---- Tier 1: lossless scrub ----
function minifyJson(text) {
  const s = text.trim();
  if (!/^[[{]/.test(s) || !/\n\s/.test(s)) return text;
  try { JSON.parse(s); } catch { return text; }
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') out += c;
  }
  return out;
}

export function scrub(text) {
  let t = minifyJson(text.replace(ANSI_RE, ''));
  t = t.replace(/[ \t]+$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  // Collapse runs of identical non-empty lines.
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    if (n >= REPEAT_MIN && lines[i].trim()) {
      out.push(lines[i], `... [output-trim: line repeated ${n}×] ...`);
    } else {
      for (let k = 0; k < n; k++) out.push(lines[i]);
    }
    i = j;
  }
  // Collapse runs of passing-test/progress lines; error-like lines break a run.
  const noisy = (l) => NOISE_RE.test(l) && !SALVAGE_RE.test(l);
  const kept = [];
  for (let i = 0; i < out.length;) {
    let j = i;
    while (j < out.length && noisy(out[j])) j++;
    if (j - i >= NOISE_MIN) {
      kept.push(out[i], out[i + 1], `... [output-trim: ${j - i - 3} more passing/progress lines like these] ...`, out[j - 1]);
    } else {
      j = Math.max(j, i + 1);
      for (let k = i; k < j; k++) kept.push(out[k]);
    }
    i = j;
  }
  return kept.join('\n');
}

// ---- Dedup: byte-identical to this tool's previous output in the session ----
export function duplicateMarker(toolName, text, reference = 'previous') {
  const lines = text.split('\n');
  const prior = reference === 'previous' ? 'the previous' : 'an earlier';
  const preview = lines.slice(0, 5)
    .map((l) => l.length > MAX_SALVAGE_LINE ? safePrefix(l, MAX_SALVAGE_LINE - 1) + '…' : l);
  return '[output-trim: output byte-identical to ' + prior + ' ' + toolName + ' result — ' +
    text.length.toLocaleString('en-US') + ' chars / ' + lines.length + ' lines, already in context]\n' +
    preview.join('\n');
}

// ---- Tier 2: elision. spillPath names the recovery copy, or null ----
export function compress(text, limits, spillPath) {
  const { maxChars, headLines, tailLines } = limits;
  const lines = text.split('\n');
  const recover = spillPath ? ' Full output: ' + spillPath + ' (grep it, do not re-run)' : '';

  if (lines.length <= headLines + tailLines) {
    const keep = Math.floor(maxChars / 2);
    const elided = text.length - 2 * keep;
    if (elided <= 0) return null;
    return safePrefix(text, keep) +
      '\n... [output-trim: elided ' + elided.toLocaleString('en-US') + ' chars from the middle.' + recover + '] ...\n' +
      safeSuffix(text, keep);
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const middle = lines.slice(headLines, lines.length - tailLines);

  const salvaged = [];
  for (const line of middle) {
    if (salvaged.length >= MAX_SALVAGED) break;
    const candidate = salvageLine(line);
    if (candidate) salvaged.push(candidate);
  }

  const marker = '... [output-trim: elided ' + middle.length.toLocaleString('en-US') +
    ' lines, kept first ' + headLines + ', last ' + tailLines +
    (salvaged.length ? ', and ' + salvaged.length + ' error-like line(s) below' : '') +
    '.' + recover + '] ...';

  const out = head.concat([marker], salvaged, tail).join('\n');
  return out.length < text.length ? out : null;
}
