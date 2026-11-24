#!/usr/bin/env node
/**
 * Fail-first pin for scripts/receipt.mjs — the receipt skeleton generator and
 * pre-append checker.
 *
 * Why it exists: the enforced receipt shape (4 blocks + 5 boolean evidence
 * lines + allowlist citations) is heavy to write by hand, and a wrong shape
 * is discovered at the veto — after the work. `--check` runs the GATE'S OWN
 * validator (receipt-enforcement.mjs), so a draft fails before the ledger
 * sees it, with zero drift between what the tool accepts and what the veto
 * enforces.
 *
 * Zero dependencies. Run: node scripts/receipt.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(HERE, 'receipt.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', cwd: ROOT, timeout: 20000, windowsHide: true,
});

// --- emit: the full enforced skeleton -------------------------------------

const full = run([]);
check('emit: exits 0', full.status === 0, `status=${full.status} err=${full.stderr.slice(0, 120)}`);
for (const block of ['**Verdict**', '**Evidence**', '**Open**', '**Next**'])
  check(`emit: block ${block}`, full.stdout.includes(block));
for (const b of ['constraints satisfied', 'evidence fresh', 'scope held', 'subject verified', 'fail-first proven'])
  check(`emit: boolean line "${b}"`, full.stdout.includes(b));
check('emit: carries a dated ledger heading', /## \d{4}-\d{2}-\d{2}/.test(full.stdout));

const fast = run(['--fast']);
check('emit --fast: one-line fast shape', fast.status === 0 && /^fast[: ]/m.test(fast.stdout.trim()));

// --- --check: the gate's own validator on a draft ---------------------------

const dir = mkdtempSync(join(tmpdir(), 'receipt-cli-'));
try {
  const GOOD = `## 2026-11-24 - unit

**Verdict** — unit done
constraints satisfied — ACs checked line by line
evidence fresh — node scripts/eval.mjs -> OK exit 0, this turn
scope held — only the named files
subject verified — the artifact read, not a proxy
fail-first proven — n/a docs-only change
**Evidence** — the eval output quoted above
**Open** — none
**Next** — next unit
`;
  const goodPath = join(dir, 'good.txt');
  writeFileSync(goodPath, GOOD);
  const r1 = run(['--check', goodPath]);
  check('check: a valid receipt exits 0', r1.status === 0, `out=${(r1.stdout + r1.stderr).slice(0, 160)}`);

  const badPath = join(dir, 'bad.txt');
  writeFileSync(badPath, GOOD.replace('**Verdict**', 'Verdict'));
  const r2 = run(['--check', badPath]);
  check('check: missing **Verdict** exits 1 and names the block',
    r2.status === 1 && /missing block "\*\*Verdict\*\*"/.test(r2.stdout + r2.stderr),
    `status=${r2.status} out=${(r2.stdout + r2.stderr).slice(0, 160)}`);

  // A command is a citation via backticks or the `<runner> <args> → <result>`
  // shape; `rm` is no gate-runner, so cite it the backtick way — the path the
  // validator checks against the allowlist.
  const badCmd = join(dir, 'badcmd.txt');
  writeFileSync(badCmd, GOOD.replace('node scripts/eval.mjs', '`rm -rf /tmp/x`'));
  const r3 = run(['--check', badCmd]);
  check('check: non-allowlisted citation exits 1', r3.status === 1,
    `status=${r3.status} out=${(r3.stdout + r3.stderr).slice(0, 160)}`);

  // --check with no file grades the repo ledger's newest entry — the same
  // thing the veto will see. It must exit 0 or 1 (never crash), and a clean
  // newest entry passes.
  const r4 = run(['--check']);
  check('check: ledger newest-entry mode never crashes', r4.status === 0 || r4.status === 1,
    `status=${r4.status}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL EXPECTATIONS HOLD' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
