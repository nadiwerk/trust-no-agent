#!/usr/bin/env node
/**
 * Regression pin for eval checks 35/36 (hardening-general 05/AC9).
 *
 * What it pins: (a) the adapter-matrix markers exist in the three live
 * files, (b) the check code exists in eval.mjs. The FAIL direction — eval
 * exits 1 when the matrix is removed — was proven live in-session
 * (2026-10-12: 8 errors, exit 1, recorded in .trust/progress.txt) before the
 * prose landed, and re-proven for THIS file by the strip-and-restore dance
 * (matrix paragraph removed → this suite FAILs; restored → PASS).
 *
 * Zero dependencies. Run: node scripts/eval-adapter.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
for (const [label, re] of [
  ['adapter matrix named', /adapter matrix/i],
  ['opencode veto adapter named', /tool\.execute\.before/],
  ['Claude/Codex pre-tool adapter named', /PreToolUse/],
  ['no-single-API rule literal', /No single harness API carries enforcement/],
]) {
  check(`35 ${label} in AGENTS.md §5`, re.test(agents), String(re));
}

const compat = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
const install = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
for (const [file, text] of [['compatibility.md', compat], ['installation.md', install]]) {
  check(`36 veto-vs-audit-only table in ${file}`, /veto vs audit-only/i.test(text), file);
  check(`36 doc-first marking in ${file}`, /doc-first/i.test(text), file);
}

const evalSrc = readFileSync(join(HERE, 'eval.mjs'), 'utf8');
check('eval.mjs carries check 35 (adapter matrix)', /---- 35\. /.test(evalSrc));
check('eval.mjs carries check 36 (veto guarantee docs)', /---- 36\. /.test(evalSrc));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
