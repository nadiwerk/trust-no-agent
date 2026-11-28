#!/usr/bin/env node
/**
 * secrets-scan.mjs — the prose-to-gate secrets check (process pack item 4).
 *
 * pr-flow already says "secrets scan before push" — this is the mechanism that
 * makes the sentence real. Zero-dependency regex scan over added lines (staged
 * diff) or whole files; precision first — a placeholder like "your-api-key"
 * or an env reference is not a secret, and a scanner that cries wolf gets
 * bypassed, which is the actual failure mode.
 *
 * CLI:
 *   node scripts/secrets-scan.mjs --staged   scan added lines of staged diff
 *   node scripts/secrets-scan.mjs <files..>  scan whole files
 *   node scripts/secrets-scan.mjs --base <ref>  scan added lines vs <ref>
 * Exit 1 on any finding.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROVIDER_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /sk-ant-[A-Za-z0-9-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

// Credential-looking assignments with a literal value long enough to matter.
const ASSIGNMENT = /(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"]([^'"]{8,})['"]/i;

// Values that are placeholders, not secrets.
const PLACEHOLDER = /^(your[-_ ]|you[-_ ]|change|changeme|xxx|test|example|dummy|fake|placeholder|redacted|insert|todo|none|null|<|\$|\{)/i;

export function scanText(text, label = '<text>') {
  const findings = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PROVIDER_PATTERNS) {
      if (p.test(line)) { findings.push(`${label}:${i + 1}: provider-token pattern (${p.source.slice(0, 30)}…)`); break; }
    }
    const m = ASSIGNMENT.exec(line);
    if (m && !PLACEHOLDER.test(m[1].trim())) {
      findings.push(`${label}:${i + 1}: literal credential assignment (${m[1].slice(0, 4)}…)`);
    }
  }
  return findings;
}

function addedLines(diffText) {
  return diffText.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let findings = [];
  if (args.includes('--tree')) {
    let tracked = [];
    try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* not a repo */ }
    for (const f of tracked) {
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|otf|lock|min\.js|min\.css)$/i.test(f)) continue;
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      try { findings.push(...scanText(readFileSync(p, 'utf8'), f)); } catch { /* binary */ }
    }
  } else if (args.includes('--staged') || args.includes('--base')) {
    const baseIdx = args.indexOf('--base');
    const gitArgs = baseIdx >= 0 ? ['diff', `${args[baseIdx + 1]}...HEAD`, '-U0'] : ['diff', '--staged', '-U0'];
    let diff = '';
    try { diff = execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }); } catch { /* empty diff */ }
    findings = scanText(addedLines(diff), 'diff');
  } else {
    const files = args.filter((a) => !a.startsWith('--'));
    for (const f of files) {
      if (!existsSync(f)) continue;
      findings.push(...scanText(readFileSync(f, 'utf8'), f));
    }
  }
  for (const f of findings) console.error(`SECRET? ${f}`);
  if (findings.length) {
    console.error(`FAIL: ${findings.length} possible secret(s) — verify each before dismissing`);
    process.exit(1);
  }
  console.log('OK: no secret patterns found.');
}
