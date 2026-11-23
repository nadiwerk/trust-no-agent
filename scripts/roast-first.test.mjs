/**
 * roast-first.test.mjs — fail-first seam tests for scripts/roast-first.mjs.
 * Pure seam: roastFirstVerdict + matchesChurn + fingerprint. The CLI's I/O
 * (stdin payload, git spawn, state file) is covered by the end-to-end block
 * at the bottom, which runs the real script against a fixture project.
 */
import { matchesChurn, fingerprint, roastFirstVerdict } from './roast-first.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Path matching ----
check('A1 dir/** matches inside the dir', matchesChurn('src/sync/engine.ts', 'src/sync/**'));
check('A2 dir/** does not match a sibling', !matchesChurn('src/syncer/x.ts', 'src/sync/**'));
check('A3 exact path matches only itself',
  matchesChurn('a/b.ts', 'a/b.ts') && !matchesChurn('a/b2.ts', 'a/b.ts'));

// ---- B. Fingerprint is order-insensitive, content-sensitive ----
check('B1 same fileset sorts to one fingerprint',
  fingerprint(['b.ts', 'a.ts']) === fingerprint(['a.ts', 'b.ts']));
check('B2 different filesets differ', fingerprint(['a.ts']) !== fingerprint(['b.ts']));

// ---- C. Verdict ----
{
  const v = roastFirstVerdict({
    stagedFiles: ['src/sync/engine.ts', 'README.md'],
    churnSources: ['src/sync/**'],
    seenFingerprints: [],
  });
  check('C1 churn-touching commit blocks once', v.block && v.matched.includes('src/sync/engine.ts'));
  const v2 = roastFirstVerdict({
    stagedFiles: ['src/sync/engine.ts', 'README.md'],
    churnSources: ['src/sync/**'],
    seenFingerprints: [v.fingerprint],
  });
  check('C2 identical retry passes (fingerprint seen)', !v2.block);
}
{
  const v = roastFirstVerdict({
    stagedFiles: ['README.md'],
    churnSources: ['src/sync/**'],
    seenFingerprints: [],
  });
  check('C3 clean commit never blocks', !v.block && v.matched.length === 0);
}
{
  const v = roastFirstVerdict({
    stagedFiles: ['src/sync/engine.ts'],
    churnSources: [],
    seenFingerprints: [],
  });
  check('C4 empty config is inert', !v.block);
}

// ---- D. End-to-end: fixture project, real script, real git ----
{
  const dir = mkdtempSync(join(tmpdir(), 'roast-first-'));
  spawnSync('git', ['init'], { cwd: dir });
  writeFileSync(join(dir, 'x.ts'), 'x');
  mkdirSync(join(dir, 'src', 'sync'), { recursive: true });
  writeFileSync(join(dir, 'src', 'sync', 'e.ts'), 'e');
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, '.trust', 'roast-first.json'), JSON.stringify({ churnSources: ['src/sync/**'] }));
  spawnSync('git', ['add', '.'], { cwd: dir });

  const run = () => spawnSync('node', [join(process.cwd(), 'scripts', 'roast-first.mjs')], {
    input: JSON.stringify({ hookEventName: 'PreToolUse', tool_name: 'exec',
      cwd: dir, tool_input: { command: 'git commit -m x' } }),
    encoding: 'utf8',
  });

  const r1 = run();
  const out1 = JSON.parse(r1.stdout || '{}');
  check('D1 first commit touching churn source is denied',
    out1?.hookSpecificOutput?.permissionDecision === 'deny' && r1.status === 0,
    `status=${r1.status} out=${r1.stdout.slice(0, 200)}`);
  check('D1b deny names the review instruction',
    /roast-my-code/.test(out1?.hookSpecificOutput?.permissionDecisionReason || ''));

  const r2 = run();
  check('D2 identical retry exits silently (allow)',
    r2.status === 0 && r2.stdout.trim() === '', `out=${r2.stdout.slice(0, 100)}`);
  check('D3 state file recorded the fingerprint',
    existsSync(join(dir, '.trust', 'roast-first-state.json')) &&
    readFileSync(join(dir, '.trust', 'roast-first-state.json'), 'utf8').includes('fingerprints'));
}
{
  // D4 fail-open: malformed stdin never wedges
  const r = spawnSync('node', [join(process.cwd(), 'scripts', 'roast-first.mjs')], {
    input: 'not json', encoding: 'utf8' });
  check('D4 malformed payload fails open', r.status === 0 && r.stdout.trim() === '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
