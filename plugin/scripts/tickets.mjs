#!/usr/bin/env node
/**
 * trust-no-agent ticket-graph validator (audit finding 3.1).
 * Pure Node, zero dependencies.
 * Run: node scripts/tickets.mjs [<issues-dir> ...]
 *   No args → validates every .trust/<slug>/issues/ dir found UNDER THE
 *   CURRENT WORKING DIRECTORY — the graded project, never this script's own
 *   repo (F2: the payload copy used its install dir, so an adopter running it
 *   from their project silently validated the wrong tree or nothing).
 * Exit 0 = graph is well-formed. Exit 1 = malformed graph.
 *
 * A well-formed local ticket graph (fork-it <local-ticket-template> shape):
 *  - one file per ticket: <NN>-<slug>.md, NN unique
 *  - H1 matches the filename NN
 *  - a **Blocked by:** line names blockers by NN ("None" = frontier ticket)
 *  - at least one acceptance criterion ("- [ ] <criterion>", cited from the spec;
 *    the template's unfilled `<criterion 1 …>` placeholder does not count)
 *  - every named blocker resolves to an existing ticket (no dangling refs)
 *  - no self-dependency, no cycles (Kahn), blockers numbered first (NN order)
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILENAME_RE = /^(\d+)-.+\.md$/;
const NONE_RE = /^\s*none\b/i;
// A criterion is an unchecked or checked list item whose text is real — not the
// template's `<criterion 1 — cited from the spec>` placeholder left unfilled.
const CRITERION_RE = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/gm;
const PLACEHOLDER_RE = /^<.*>$/;

/** Criteria lines that carry actual content (template placeholders excluded). */
const realCriteria = (text) =>
  [...text.matchAll(CRITERION_RE)]
    .map((m) => m[1].trim())
    .filter((body) => body.length > 0 && !PLACEHOLDER_RE.test(body));

const parseTicket = (path) => {
  const text = readFileSync(path, 'utf8');
  const errors = [];
  const fileNN = (basename(path).match(FILENAME_RE) || [])[1];
  if (!fileNN) { errors.push(`${path}: filename is not <NN>-<slug>.md`); return { nn: null, blockers: [], errors }; }

  const h1 = text.match(/^#\s+(\d+)\s+[—–-]\s+(.+)$/m);
  if (!h1) errors.push(`${fileNN}: missing H1 "# <NN> — <title>" line`);
  else if (h1[1] !== fileNN) errors.push(`${fileNN}: H1 number ${h1[1]} != filename number ${fileNN}`);

  // Acceptance criteria — the field fork-it's spec gate is named after. Without
  // this, a ticket could validate green with an empty body: the graph was
  // checked, the thing the graph exists to deliver was not.
  if (realCriteria(text).length === 0)
    errors.push(`${fileNN}: no acceptance criterion — add at least one "- [ ] <criterion>" line, cited from the spec (fork-it spec gate: a ticket with nothing testable is not a slice)`);

  const blockedLine = text.match(/^\*\*Blocked by:\*\*\s*(.+)$/m);
  if (!blockedLine) { errors.push(`${fileNN}: missing "**Blocked by:**" line`); return { nn: fileNN, blockers: [], errors }; }

  const raw = blockedLine[1].trim();
  const blockers = NONE_RE.test(raw) ? [] : [...new Set([...raw.matchAll(/\b(\d+)\b/g)].map((m) => m[1]))];
  if (!NONE_RE.test(raw) && blockers.length === 0)
    errors.push(`${fileNN}: "Blocked by" names no ticket numbers (use NN numbers, or "None — can start immediately")`);
  for (const b of blockers)
    if (b === fileNN) errors.push(`${fileNN}: self-dependency (blocked by itself)`);
  return { nn: fileNN, blockers, errors };
};

export const validateDir = (dir) => {
  const errors = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => FILENAME_RE.test(f)).sort() : [];
  const tickets = new Map(); // nn -> { path, blockers }
  for (const f of files) {
    const p = join(dir, f);
    const { nn, blockers, errors: perr } = parseTicket(p);
    errors.push(...perr);
    if (!nn) continue;
    if (tickets.has(nn)) { errors.push(`${nn}: duplicate ticket number (${basename(p)} vs ${basename(tickets.get(nn).path)})`); continue; }
    tickets.set(nn, { path: p, blockers });
  }
  const known = new Set(tickets.keys());
  for (const [nn, t] of tickets) {
    for (const b of t.blockers) {
      if (!known.has(b)) errors.push(`${nn}: dangling blocker — ticket ${b} does not resolve to an existing file`);
      else if (b >= nn) errors.push(`${nn}: dependency-order violation — blocker ${b} must be numbered before ${nn} (blockers first)`);
    }
  }
  // Kahn acyclicity: edge blocker -> ticket; leftover nodes with indegree > 0 form a cycle.
  const indeg = new Map([...tickets.keys()].map((nn) => [nn, 0]));
  for (const [nn, t] of tickets) for (const b of t.blockers) if (known.has(b)) indeg.set(nn, indeg.get(nn) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([nn]) => nn);
  const seen = new Set();
  while (queue.length) {
    const n = queue.pop(); seen.add(n);
    for (const [nn, t] of tickets)
      if (t.blockers.includes(n) && !seen.has(nn)) { indeg.set(nn, indeg.get(nn) - 1); if (indeg.get(nn) === 0) queue.push(nn); }
  }
  const cyclic = [...tickets.keys()].filter((nn) => !seen.has(nn));
  if (cyclic.length) errors.push(`cycle detected among tickets: ${cyclic.sort().join(', ')}`);
  // `count` is what the CLI gates on. Existence of the directory proves nothing:
  // an empty issues/ dir has no errors to report, and a validator that reports
  // "OK" over zero tickets is a check that cannot fail (F2's own defect class,
  // surviving inside the F2 fix).
  return { errors, count: tickets.size };
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  // Root = the graded project = the working directory. Never this script's
  // own install dir: the plugin payload ships this file, and a script that
  // resolves its tree from import.meta.url audits its plugin copy, not the
  // adopter's project (ticket F2 — the wrong-tree "OK" bug).
  const ROOT = process.cwd();
  const explicit = process.argv.slice(2);
  let dirs;
  if (explicit.length) {
    // An explicitly named dir that does not exist used to reach validateDir,
    // which reads a missing dir as "no files, no errors" — a phantom graph
    // validating green.
    const missing = explicit.filter((d) => !existsSync(d) || !statSync(d).isDirectory());
    if (missing.length) {
      console.error(`FAIL: issue dir not found — ${missing.join(', ')}. Pass a directory that exists and holds <NN>-<slug>.md tickets.`);
      process.exit(1);
    }
    dirs = explicit;
  } else {
    const trust = join(ROOT, '.trust');
    dirs = existsSync(trust)
      ? readdirSync(trust).map((d) => join(trust, d, 'issues')).filter((p) => existsSync(p) && statSync(p).isDirectory())
      : [];
  }
  if (!dirs.length) {
    console.error(explicit.length
      ? 'FAIL: none of the given directories exist or contain a ticket graph.'
      : `FAIL: no ticket graphs found — no .trust/*/issues/ under ${ROOT}. Run this from the project root whose tickets you want validated (or pass issue dirs explicitly).`);
    process.exit(1);
  }
  let all = [];
  let validated = 0;
  for (const d of dirs) {
    const { errors, count } = validateDir(d);
    validated += count;
    all.push(...errors.map((e) => `${d}: ${e}`));
  }
  if (all.length) { for (const e of all) console.log('ERROR ' + e); console.error(`\nFAIL: ${all.length} ticket-graph error(s).`); process.exit(1); }
  // Gate on tickets validated, not on directories found. An empty issues/ dir
  // has nothing to complain about, so reporting OK there is a check that cannot
  // fail — the exact defect class F2 was meant to end.
  if (!validated) {
    console.error(`FAIL: validated zero tickets — ${dirs.length} issue director${dirs.length === 1 ? 'y' : 'ies'} exist${dirs.length === 1 ? 's' : ''} but hold no <NN>-<slug>.md ticket. Nothing was validated, so nothing may report OK.`);
    process.exit(1);
  }
  console.log(`OK: ticket graph valid — ${validated} ticket${validated === 1 ? '' : 's'} in ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}.`);
}
