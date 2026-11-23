#!/usr/bin/env node
/**
 * ledger-lint.mjs — structural integrity check for a project ledger.
 * Pure Node, zero dependencies. Complements scripts/ledger-audit.mjs: the
 * audit reads CONTENT markers for compliance findings; the lint guards the
 * file's structural integrity so markers stay readable at all.
 *
 * Measured adopter evidence (2026-11): a 3-way ledger merge left ~29 entries
 * duplicated byte-for-byte; a `|- ` prefix drift made 124 `Loaded:` and 58
 * `Next:` lines unreadable to the audit regexes; 82% of entries lacked a
 * `Harness:` line so per-harness quality could not be compared.
 *
 * CLI contract (the public seam; see ledger-lint.test.mjs):
 *   node scripts/ledger-lint.mjs [path-to-ledger] [--warn-only]
 *   Default path resolution: .trust/progress.txt, else progress.txt at cwd.
 *   exit 0  clean ledger (or --warn-only with findings)
 *   exit 1  findings present
 *   exit 2  bad usage / no ledger found
 *
 * Findings (each names a line number):
 *   duplicate-entry      heading + normalized body identical to an earlier entry
 *   noncanonical-marker  marker line the audit regexes cannot read
 *                        (`|- `, `**Next:**`, indented `**Loaded:**` — anything
 *                        carrying a field name outside the `- Field:` shape)
 *   entry-without-date   an entry header before any `## <YYYY-MM-DD>` section
 * Metrics (never fail, always printed):
 *   Harness coverage, Loaded coverage — report-only; coverage is a lead, not a defect.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function lintLedger(text) {
  const lines = text.split('\n');
  const findings = [];
  const entries = []; // {line, title, bodyKey, hasHarness, hasLoaded}
  let dateSeen = false;
  let cur = null;

  const flush = () => {
    if (cur) entries.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (/^##\s+\d{4}-\d{2}-\d{2}/.test(line)) { dateSeen = true; continue; }
    if (/^###\s/.test(line) && !/^###\s+(Self-Review|Archive)/.test(line)) {
      flush();
      if (!dateSeen)
        findings.push({ kind: 'entry-without-date', line: i + 1, message: `entry "${line.slice(4).trim()}" appears before any ## <YYYY-MM-DD> date header` });
      cur = { line: i + 1, title: line, parts: [line], hasHarness: false, hasLoaded: false };
      continue;
    }
    if (!cur) continue;
    cur.parts.push(line);

    // Non-canonical marker shapes: carries a field name the audit regexes miss.
    // Canonical is `- Field: value`; flag the drifted forms a merge or a
    // different-harness writer produced.
    if (/^\s*\|-\s/.test(raw) || /^-\s+\*\*\s*(?:Loaded|Next|Lesson|Tags|Harness)\s*\*\*/.test(line) || /^\*\*\s*(?:Loaded|Next|Lesson|Tags|Harness)\s*[:*]/.test(line))
      findings.push({ kind: 'noncanonical-marker', line: i + 1, message: `marker drift — "${line.slice(0, 60)}" is not the canonical "- Field:" shape the audit reads` });

    if (/^-?\s*Harness\s*:/.test(line)) cur.hasHarness = true;
    if (/^-?\s*Loaded\s*:/.test(line)) cur.hasLoaded = true;
  }
  flush();

  // Duplicates: same heading + same normalized body = merge artifact.
  const seen = new Map();
  for (const e of entries) {
    const key = e.parts.join('\n').replace(/\s+/g, ' ').trim();
    if (seen.has(key))
      findings.push({ kind: 'duplicate-entry', line: e.line, message: `byte-identical copy of the entry at line ${seen.get(key)} — merge artifact, keep the earliest` });
    else seen.set(key, e.line);
  }

  return {
    findings,
    stats: {
      entries: entries.length,
      harness: entries.filter((e) => e.hasHarness).length,
      loaded: entries.filter((e) => e.hasLoaded).length,
    },
  };
}

function resolveLedgerPath(cwd) {
  for (const rel of ['.trust/progress.txt', 'progress.txt']) {
    const p = join(cwd, ...rel.split('/'));
    if (existsSync(p)) return p;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2).filter((s) => s !== '--warn-only');
  const warnOnly = process.argv.includes('--warn-only');
  const path = args[0] || resolveLedgerPath(process.cwd());
  if (!path || !existsSync(path)) {
    console.error('ledger-lint: no ledger found (looked for .trust/progress.txt then progress.txt)');
    process.exit(2);
  }
  const { findings, stats } = lintLedger(readFileSync(path, 'utf8'));
  for (const f of findings) console.log(`${f.kind.padEnd(20)} line ${f.line}: ${f.message}`);
  const pct = (n) => (stats.entries ? Math.round((100 * n) / stats.entries) : 0);
  console.log(`metrics: ${stats.entries} entr${stats.entries === 1 ? 'y' : 'ies'} — Harness coverage ${pct(stats.harness)}%, Loaded coverage ${pct(stats.loaded)}%`);
  if (findings.length) {
    console.log(`${findings.length} finding(s)`);
    process.exit(warnOnly ? 0 : 1);
  }
  console.log('ledger-lint: clean');
  process.exit(0);
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
} catch {
  main();
}
