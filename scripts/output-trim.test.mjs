/**
 * output-trim.test.mjs — fail-first seam tests for scripts/output-trim.mjs.
 * Pure seams: scrub/compress/transform/toolAllowed/dedup markers; plus an
 * end-to-end stdin→stdout run of the real hook against a fixture payload.
 */
import { transform, compress, scrub, toolAllowed, extractText, rebuildResponse, duplicateMarker, THRESHOLDS } from './output-trim.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const dir = mkdtempSync(join(tmpdir(), 'output-trim-'));
mkdirSync(join(dir, '.trust'), { recursive: true });
const stateDir = join(dir, '.trust');
const BIG = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');

// ---- A. Allowlist invariants ----
check('A1 Bash/exec output is trimmable', toolAllowed('Bash') && toolAllowed('exec'));
check('A2 Read/Edit/Write family is never trimmable',
  !toolAllowed('Read') && !toolAllowed('edit') && !toolAllowed('write') && !toolAllowed('view'));
{
  process.env.OUTPUT_TRIM_TOOLS = 'read,edit,Bash';
  const r = !toolAllowed('read') && toolAllowed('Bash');
  delete process.env.OUTPUT_TRIM_TOOLS;
  check('A3 allowlist override cannot unlock the read/write family', r);
}

// ---- B. Scrub tier ----
{
  const noisy = Array.from({ length: 10 }, (_, i) => `ok ${i + 1} test passed`).join('\n') +
    '\nreal error: boom\n' + 'tail line';
  const out = scrub(noisy);
  check('B1 passing-run collapses with marker', out.includes('more passing/progress lines'));
  check('B2 the error line survives the collapse', out.includes('real error: boom'));
}
{
  const dup = 'same line\n'.repeat(8) + 'end';
  const out = scrub(dup);
  check('B3 identical-line run collapses once', out.includes('line repeated 8×'));
}

// ---- C. Elision: head+tail+salvage, spill written ----
{
  const middle = Array.from({ length: 400 }, (_, i) => `filler ${i}`).join('\n') +
    '\nnpm ERR! Command failed with exit code 1\n' +
    Array.from({ length: 40 }, (_, i) => `tail ${i}`).join('\n');
  const big = 'head context line\n' + middle;
  const out = compress(big, THRESHOLDS, join(stateDir, 'x.txt'));
  check('C1 head kept', out.startsWith('head context line'));
  check('C2 tail kept', out.includes('tail 39'));
  check('C3 error line salvaged from the middle', out.includes('npm ERR!'));
  check('C4 marker names the elision + spill path', out.includes('elided') && out.includes('grep it'));
  check('C5 smaller than original', out.length < big.length);
}

// ---- D. transform: small output untouched, big output trimmed + spilled ----
{
  check('D1 under-SCRUB_MIN output is untouched', transform('tiny', THRESHOLDS, 'Bash', stateDir) === null);
  const big = BIG + '\n' + 'x'.repeat(9000);
  const out = transform(big, THRESHOLDS, 'Bash', stateDir);
  check('D2 big output is transformed', typeof out === 'string' && out.length < big.length);
  check('D3 spill file written under .trust', existsSync(join(stateDir, 'output-trim-spill')));
}

// ---- E. extractText / rebuildResponse shapes ----
{
  check('E1 object response extracts stdout+stderr',
    extractText({ stdout: 'a', stderr: 'b' }) === 'a\nb');
  const rebuilt = rebuildResponse({ stdout: 'a', stderr: 'b' }, 'T');
  check('E2 rebuilt keeps object shape, folds stderr',
    rebuilt.stdout === 'T' && rebuilt.stderr === '');
  check('E3 unrecognized shape returns null (skip, never guess)',
    rebuildResponse([{ type: 'x' }], 'T') === null);
}

// ---- F. Dedup marker ----
{
  const m = duplicateMarker('Bash', 'a\nb\nc');
  check('F1 dedup marker names the tool + size', m.includes('Bash') && m.includes('byte-identical'));
}

// ---- G. End-to-end: real hook, real stdin payload ----
{
  const payload = {
    hookEventName: 'PostToolUse', tool_name: 'Bash', cwd: dir,
    session_id: 's1',
    tool_response: { stdout: BIG + '\n' + 'y'.repeat(9000), stderr: '' },
  };
  const run = () => spawnSync('node', [join(process.cwd(), 'scripts', 'output-trim.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8',
  });
  const r1 = run();
  const out1 = JSON.parse(r1.stdout || '{}');
  check('G1 oversized Bash output emits updatedToolOutput',
    out1?.hookSpecificOutput?.updatedToolOutput?.stdout?.length <
      payload.tool_response.stdout.length, `out=${r1.stdout.slice(0, 160)}`);
  check('G1b stats ledger written', existsSync(join(stateDir, 'output-trim-stats.json')));
  const r2 = run();
  const out2 = JSON.parse(r2.stdout || '{}');
  check('G2 identical repeat emits the dedup marker',
    String(out2?.hookSpecificOutput?.updatedToolOutput?.stdout || '').includes('byte-identical'),
    `out=${r2.stdout.slice(0, 160)}`);
}
{
  // Read-tool payload: never compressed
  const r = spawnSync('node', [join(process.cwd(), 'scripts', 'output-trim.mjs')], {
    input: JSON.stringify({ tool_name: 'Read', cwd: dir, session_id: 's1',
      tool_response: { stdout: BIG + '\n' + 'z'.repeat(9000) } }),
    encoding: 'utf8',
  });
  check('G3 Read payload passes through untouched', r.stdout.trim() === '');
}
{
  // Malformed stdin fails open
  const r = spawnSync('node', [join(process.cwd(), 'scripts', 'output-trim.mjs')], {
    input: 'not json', encoding: 'utf8' });
  check('G4 malformed payload fails open', r.status === 0 && r.stdout.trim() === '');
}
{
  // Kill switch honored
  const r = spawnSync('node', [join(process.cwd(), 'scripts', 'output-trim.mjs')], {
    env: { ...process.env, OUTPUT_TRIM: '0' },
    input: JSON.stringify({ tool_name: 'Bash', cwd: dir, session_id: 's2',
      tool_response: { stdout: BIG + '\n' + 'z'.repeat(9000) } }),
    encoding: 'utf8',
  });
  check('G5 OUTPUT_TRIM=0 disables compression', r.stdout.trim() === '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
