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

// The eight setup-tna payload dirs that ship executable scripts beside onboarding.mjs.
const PAYLOAD_DIRS = [
  'skills/meta/setup-tna',
  'plugin/skills/setup-tna',
  '.agents/skills/setup-tna',
  '.claude/skills/setup-tna',
  'plugin/.agents/skills/setup-tna',
  'plugin/.claude/skills/setup-tna',
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

// ---- G. The ratchet: pre-existing offenders are PINNED, growth is refused ----
// Why this exists: the guard only ever judged the staged delta, so a repo with
// 80 pre-existing over-budget files ran it 500+ times and was never once told.
// Ignoring those files hides them; splitting all of them at once is a rewrite.
// The ratchet is the third option — the baseline records each offender's size
// as a CEILING, so an offender can shrink freely but can never grow, and the
// guard becomes load-bearing the day it is wired in.
const baselineOf = (dir, obj) => writeFileSync(join(dir, '.filebudget-baseline.json'), JSON.stringify(obj, null, 2));
{
  // G1: an over-budget file listed in the baseline at its current size passes.
  const { dir } = mkRepo('fb-ratchet-ok-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG); // ~5250 tokens
  baselineOf(dir, { 'src/big.ts': 5300 });
  execFileSync('git', ['add', 'src/big.ts', '.filebudget-baseline.json'], { cwd: dir });
  const r = runGuard(dir);
  check('G1 a pinned over-budget file passes at its baseline', r.code === 0, `code=${r.code} out=${r.out.slice(0, 300)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // G2: growth past the pinned ceiling blocks, and the message names BOTH numbers.
  const { dir } = mkRepo('fb-ratchet-grow-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG); // ~5250 tokens
  baselineOf(dir, { 'src/big.ts': 5300 });
  execFileSync('git', ['add', 'src/big.ts', '.filebudget-baseline.json'], { cwd: dir });
  writeFileSync(join(dir, 'src', 'big.ts'), BIG + 'b'.repeat(8000)); // ~7250 tokens
  execFileSync('git', ['add', 'src/big.ts'], { cwd: dir });
  const r = runGuard(dir);
  check('G2 growth past the pinned ceiling blocks (exit 1)', r.code === 1, `code=${r.code} out=${r.out.slice(0, 300)}`);
  check('G2a the message names the baseline ceiling', /5,?300/.test(r.out), r.out.slice(0, 400));
  check('G2b the message names the current size', /7,?2\d\d|7,?3\d\d|7,?4\d\d/.test(r.out), r.out.slice(0, 400));
  check('G2c the message says how to re-pin deliberately', /--update-baseline/.test(r.out), r.out.slice(0, 400));
  rmSync(dir, { recursive: true, force: true });
}
{
  // G3: a baseline entry for SOME OTHER file must not weaken the guard for an
  // unlisted file. This is the failure mode that would make the ratchet a
  // rubber stamp: "a baseline exists, therefore everything is excused".
  const { dir } = mkRepo('fb-ratchet-other-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  writeFileSync(join(dir, 'src', 'other.ts'), SMALL);
  baselineOf(dir, { 'src/other.ts': 999999 });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = runGuard(dir);
  check('G3 an unrelated baseline entry does not excuse an unlisted offender', r.code === 1, `code=${r.code} out=${r.out.slice(0, 300)}`);
  rmSync(dir, { recursive: true, force: true });
}
{
  // G4: --update-baseline re-pins from what is on disk, and exits 0.
  const { dir } = mkRepo('fb-ratchet-update-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  execFileSync('git', ['add', 'src/big.ts'], { cwd: dir });
  const r = runGuard(dir, ['--update-baseline']);
  check('G4 --update-baseline exits 0', r.code === 0, `code=${r.code} out=${r.out.slice(0, 300)}`);
  const saved = existsSync(join(dir, '.filebudget-baseline.json'))
    ? JSON.parse(readFileSync(join(dir, '.filebudget-baseline.json'), 'utf8')) : {};
  check('G4a --update-baseline records the offender at its current size',
    typeof saved['src/big.ts'] === 'number' && saved['src/big.ts'] >= 5250 && saved['src/big.ts'] <= 5350,
    JSON.stringify(saved));
  rmSync(dir, { recursive: true, force: true });
}
{
  // G5: --report prints the current over-budget set ignoring the baseline, so a
  // stale baseline cannot be re-pinned from a number nobody measured.
  const { dir } = mkRepo('fb-ratchet-report-');
  writeFileSync(join(dir, 'src', 'big.ts'), BIG);
  baselineOf(dir, { 'src/big.ts': 999999 });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = runGuard(dir, ['--report']);
  check('G5 --report lists an offender even when the baseline would excuse it',
    r.code === 0 && /src\/big\.ts\s+~?\d+/.test(r.out), `code=${r.code} out=${r.out.slice(0, 300)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---- H. This repo's own baseline is honest (no stale entry, no silent gap) ----
{
  const basePath = join(ROOT, '.filebudget-baseline.json');
  const haveBase = existsSync(basePath);
  check('H1 the repo pins its over-budget files in .filebudget-baseline.json', haveBase, basePath);
  if (haveBase) {
    const pinned = JSON.parse(readFileSync(basePath, 'utf8'));
    // --report is the measured truth; the baseline may only agree with it.
    const r = spawnSync(process.execPath, [GUARD, '--report'], { cwd: ROOT, encoding: 'utf8' });
    const measured = new Map((r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [rel, tok] = l.split(/\s+/); return [rel, Number(String(tok).replace(/[^\d]/g, ''))]; }));
    const missing = [...measured.keys()].filter((rel) => !(rel in pinned));
    const stale = Object.keys(pinned).filter((rel) => !measured.has(rel));
    const slack = [...measured.entries()].filter(([rel, tok]) => rel in pinned && pinned[rel] < tok);
    check('H2 every measured offender is pinned (a new offender cannot slip in)', missing.length === 0, missing.slice(0, 5).join(', '));
    check('H3 no stale pin (a file split below budget must be removed from the baseline)', stale.length === 0, stale.slice(0, 5).join(', '));
    check('H4 no pin below its measured size (the ceiling is never a lie)', slack.length === 0, slack.slice(0, 5).map(([r2, t]) => `${r2} pin=${pinned[r2]} now=${t}`).join('; '));
  }
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
