#!/usr/bin/env node
/**
 * trust-no-agent ticket-graph validator (audit finding 3.1).
 * Pure Node, zero dependencies.
 * Run: node scripts/tickets.mjs [<issues-dir> ...]
 *   No args → validates every .trust/<slug>/issues/ dir found.
 * Exit 0 = graph is well-formed. Exit 1 = malformed graph.
 *
 * A well-formed local ticket graph (fork-it <local-ticket-template> shape):
 *  - one file per ticket: <NN>-<slug>.md, NN unique
 *  - H1 matches the filename NN
 *  - a **Blocked by:** line names blockers by NN ("None" = frontier ticket)
 *  - every named blocker resolves to an existing ticket (no dangling refs)
 *  - no self-dependency, no cycles (Kahn), blockers numbered first (NN order)
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILENAME_RE = /^(\d+)-.+\.md$/;
const NONE_RE = /^\s*none\b/i;

const parseTicket = (path) => {
  const text = readFileSync(path, 'utf8');
  const errors = [];
  const fileNN = (basename(path).match(FILENAME_RE) || [])[1];
  if (!fileNN) { errors.push(`${path}: filename is not <NN>-<slug>.md`); return { nn: null, blockers: [], errors }; }

  const h1 = text.match(/^#\s+(\d+)\s+[—–-]\s+(.+)$/m);
  if (!h1) errors.push(`${fileNN}: missing H1 "# <NN> — <title>" line`);
  else if (h1[1] !== fileNN) errors.push(`${fileNN}: H1 number ${h1[1]} != filename number ${fileNN}`);

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
  return { errors };
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  let dirs = process.argv.slice(2);
  if (!dirs.length) {
    const trust = join(ROOT, '.trust');
    dirs = existsSync(trust)
      ? readdirSync(trust).map((d) => join(trust, d, 'issues')).filter((p) => existsSync(p) && statSync(p).isDirectory())
      : [];
  }
  if (!dirs.length) { console.log('OK: no local ticket graphs found (.trust/*/issues), nothing to validate.'); process.exit(0); }
  let all = [];
  for (const d of dirs) { const { errors } = validateDir(d); all.push(...errors.map((e) => `${d}: ${e}`)); }
  if (all.length) { for (const e of all) console.log('ERROR ' + e); console.error(`\nFAIL: ${all.length} ticket-graph error(s).`); process.exit(1); }
  console.log(`OK: ticket graph valid in ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}.`);
}
