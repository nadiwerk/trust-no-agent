#!/usr/bin/env node
/**
 * receipt-draft.mjs — 4-block receipt autofill (process pack item 5).
 *
 * Receipts fail in the field not because the philosophy is wrong but because
 * writing them is expensive. This emits a draft that already passes
 * validateReceipt — four blocks, five boolean lines, evidence lines citing
 * only declared repo-gate commands — so the human fills Verdict/Open/Next
 * instead of re-deriving the shape. A draft is a floor, never a finished
 * receipt: filling in the claims is still the human's job.
 *
 * CLI:
 *   node scripts/receipt-draft.mjs                 draft with HEAD sha + recorded evidence command
 *   node scripts/receipt-draft.mjs --cmd "x" ...   cite specific gate commands
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoGateCommands } from './receipt-enforcement.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.trust', 'tna-gate-state.json');

export function draftReceipt({ sha = '<sha>', commands = [] } = {}) {
  const ev = commands.map((c) => `${c} — <result>`).join('\n');
  return `#### Receipt
**Verdict**
- constraints satisfied:
- evidence fresh:
- scope held:
- subject verified:
- fail-first proven:

**Evidence**
head: ${sha}
${ev || '<allowlisted gate command> — <result>'}

**Open**
<what remains unverified, deferred, or risky — 'none' is a claim too>

**Next**
<the one concrete forward arrow — 'none' only when the thread is closed>

<!-- Replace each trailing ':' with ' — <claim>' and fill the <...>
     placeholders. The validator rejects this draft until every boolean
     carries an evidence line — a draft that passed unedited would be a
     hollow-receipt machine, so invalid-by-default is the feature. -->`;
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allow = repoGateCommands({ root: ROOT });
  let sha = '<sha>';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }

  const cmdIdx = args.indexOf('--cmd');
  let commands = [];
  if (cmdIdx >= 0) commands = args.slice(cmdIdx + 1).filter((a) => !a.startsWith('--'));
  else {
    // Autofill from the recorded evidence state — the last gate the harness saw pass.
    try {
      const st = JSON.parse(readFileSync(STATE, 'utf8'));
      if (typeof st.command === 'string') commands = [st.command];
    } catch { /* absent state */ }
  }
  // Only gate commands may be cited — a draft must not smuggle in unverifiable evidence.
  commands = commands.filter((c) => allow.has(c));
  console.log(draftReceipt({ sha, commands }));
}
