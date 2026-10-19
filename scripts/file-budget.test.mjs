#!/usr/bin/env node
/**
 * Fail-first test for scripts/file-budget.mjs - the file token budget guard.
 *
 * What it is: an OPT-IN pre-commit guard that blocks any staged file whose
 * size exceeds a token budget (tokens ~= bytes/4, the coarse estimator).
 * Rationale: agent-authored files grow silently; a file that reads in one
 * sitting keeps the agent (and the human) effective. The guard is style
 * enforcement, not the evidence veto - it must stay cheap, fail-open on its
 * own errors, and never run unless the adopter wires it in.
 *
 * Public seams under test (the CLI contract, driven as a real subprocess
 * against temp git repos - this is a wiring file; importing it would test a
 * different thing than what runs):
 *
 *   exit code    0 = every staged file within budget (or ignorable)
 *                1 = at least one staged file over budget
 *   stdout       names each offending file + its token count, prints split
 *                instructions, mentions the ignore file
 *   --all        audit every indexed file, not just the staged delta
 *   --limit=N    override the default 5,000-token budget
 *
 * Also pins distribution: the guard ships in every setup-tna skill payload
 * (release payload, not a repo-local artifact - the v0.1.35 lesson), so the
 * N-series checks byte-identity across all nine payload dirs.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GUARD = join(HERE, 'file-budget.mjs');

// The nine setup-tna payload dirs that ship executable scripts beside onboarding.mjs.
const PAYLOAD_DIRS = [
  'skills/meta/setup-tna',
  'plugin/skills/setup-tna',
  '.agents/skills/setup-tna',
  '.claude/skills/setup-tna',
  'plugin/.agents/skills/setup-tna',
  'plugin/.claude/skills/setup-tna',
  'plugin/.cursor/skills/setup-tna',
  'plugin/.opencode/skills/setup-tna',
  'plugin/copilot/.agents/skills/setup-tna',
];

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const BIG = 'a'.repeat(21000); // 21000 bytes ~= 5250 tokens: over the 5,000 default
const SMALL = 'export const ok = true;\n';

/** Temp git repo with one committed file so HEAD exists; returns { dir, git }. */
const mkRepo = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# t\n');
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  return { dir, git };
};

const runGuard = (dir, args = []) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// ---- A. Presence (RED until the guard and every payload mirror exist) ----
check('A1 scripts/file-budget.mjs exists', existsSync(GUARD));

// ---- B. The staged-file contract ----
{
  // B1: under-budget staged file passes.
  const { dir } = mkRepo('fb-under-');
  writeFileSync(join(dir, 'src', 'small.ts'), SMALL);
  execFileSync('git', ['add', 'src/small.ts'], { cwd: dir });
  const r = runGuard(dir);
  check('B1 under-budget staged file passes (exit 0)', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B2: over-budget staged file blocks, message names the file, the count,
  // the limit, and carries split instructions (the message IS the feature).
  const { dir } = mkRepo('fb-over-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  execFileSync('git', ['add', 'src/big.ts'], { cwd: dir });
  const r = runGuard(dir);
  check('B2 over-budget staged file blocks (exit 1)', r.code === 1, `code=${r.code}`);
  check('B2a message names the offending file', r.out.includes('src/big.ts'), r.out.slice(0, 300));
  check('B2b message carries split instructions', /split/i.test(r.out), r.out.slice(0, 300));
  check('B2c message states the token estimate and limit', /5250|5,250/.test(r.out) && /5000|5,000/.test(r.out), r.out.slice(0, 300));
  check('B2d message mentions the ignore file for legitimate big files', r.out.includes('.filebudgetignore'), r.out.slice(0, 300));
  rmSync(dir, { recursive: true, force: true });
}
{
  // B3: only STAGED files are judged - an over-budget file left unstaged passes.
  const { dir } = mkRepo('fb-unstaged-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG); // never added
  const r = runGuard(dir);
  check('B3 unstaged over-budget file is not flagged', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B4: lockfiles are ignored (machine-generated, not agent-authored).
  const { dir } = mkRepo('fb-lock-');
  writeFileSync(join(dir, 'package-lock.json'), BIG);
  execFileSync('git', ['add', 'package-lock.json'], { cwd: dir });
  const r = runGuard(dir);
  check('B4 lockfiles are ignored', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B5: the per-repo ignore file (.filebudgetignore) is honored.
  const { dir } = mkRepo('fb-ignore-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  writeFileSync(join(dir, '.filebudgetignore'), 'src/big.ts\nfixtures/\n');
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'fixtures', 'big.json'), BIG);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = runGuard(dir);
  check('B5 .filebudgetignore entries are honored (exact path and dir prefix)', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B6: binary content is ignored even with no known extension.
  const { dir } = mkRepo('fb-bin-');
  const bin = Buffer.alloc(21000, 0x00); // NUL byte in the first 8k => binary sniff
  writeFileSync(join(dir, 'blob.dat'), bin);
  execFileSync('git', ['add', 'blob.dat'], { cwd: dir });
  const r = runGuard(dir);
  check('B6 binary content is ignored', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B7: --all audits the whole index, not just the staged delta.
  const { dir, git } = mkRepo('fb-all-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  git(['add', 'src/big.ts']); // in the index but not part of the staged delta vs HEAD? It IS the delta; make it historical:
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'big']);
  const r = runGuard(dir, ['--all']);
  check('B7 --all flags an indexed over-budget file even with a clean diff', r.code === 1, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B8: nothing staged (clean tree) exits 0 - allow-empty commits stay legal.
  const { dir } = mkRepo('fb-empty-');
  const r = runGuard(dir);
  check('B8 clean staging area exits 0', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // B9: --limit=N raises the budget.
  const { dir } = mkRepo('fb-limit-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG); // ~5250 tokens
  execFileSync('git', ['add', 'src/big.ts'], { cwd: dir });
  const r = runGuard(dir, ['--limit=6000']);
  check('B9 --limit=6000 lets a ~5250-token file pass', r.code === 0, `code=${r.code} out=${r.out.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---- N. Distribution: byte-identical in every setup-tna payload ----
{
  const canonical = existsSync(GUARD) ? readFileSync(GUARD) : null;
  for (const rel of PAYLOAD_DIRS) {
    const p = join(ROOT, rel, 'scripts', 'file-budget.mjs');
    check(`N1 byte-identical in payload ${rel}`,
      canonical !== null && existsSync(p) && readFileSync(p).equals(canonical), p);
  }
}

console.log(failures === 0 ? '\nAll file-budget expectations hold.' : `\n${failures} failing expectation(s)`);
process.exit(failures === 0 ? 0 : 1);
