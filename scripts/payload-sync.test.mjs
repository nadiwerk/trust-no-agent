#!/usr/bin/env node
/**
 * Fail-first test for scripts/sync-payloads.mjs — the payload generator.
 *
 * Origin: install-path audit 2026-10-19. Three of nine setup-tna payload
 * roots carried PRE-0.1.39 veto adapters (the gate-opens-on-stale-cwd bug a
 * real user reported) and plugin/scripts/ shipped two pre-hardening modules —
 * while every pin stayed green, because the pins enumerated a REMEMBERED list
 * of mirrors and the drifted roots were not on it. This test drives the
 * generator's check mode: zero drift anywhere is the contract, and the
 * generator discovers payload roots by walking the tree, so a new payload
 * location is covered by construction, never by updating a list.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = join(HERE, 'sync-payloads.mjs');
const ROOT = join(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const run = (args, cwd = ROOT) => {
  const r = spawnSync(process.execPath, [GEN, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// ---- D. Discovery is real (guards the generator's core mechanism) ----
{
  // Discovery must find at least the six known DISTRIBUTION roots — walked,
  // not listed. (Root .agents/.claude install dirs are junctions on this
  // machine — local install state, structurally excluded.)
  const r = run(['--list']);
  check('D1 generator runs (--list exits 0)', r.code === 0, r.out.slice(0, 200));
  const count = (r.out.match(/^payload root: /gm) || []).length;
  check('D2 discovery finds >= 6 distribution payload roots', count >= 6, `found ${count}`);
  check('D3 discovery includes the copilot payload root (the one L0c missed)',
    /plugin[/\\]copilot[/\\]\.agents[/\\]skills[/\\]setup-tna/.test(r.out), r.out.slice(0, 400));
  check('D4 discovery never walks .trust (the overlay workspace is user state)',
    !/^payload root: [^\n]*\.trust[^\n]*$/im.test(r.out), r.out.slice(0, 400));
  // D5 is proven structurally in the fixture below (D5-fixture): a junctioned
  // setup-tna root must be skipped by structure. It cannot be asserted against
  // the real tree — on this dev machine .claude/skills/setup-tna is a junction,
  // on a Linux CI checkout it is a real directory (git does not store
  // junctions); both are valid repo states.
  check('D6 router mirrors are discovered by structure (plugin copy + the canonical payload references copy)',
    /^router mirror: plugin[/\\]AGENTS\.md$/im.test(r.out) &&
    /router mirror: skills[/\\]meta[/\\]setup-tna[/\\]references[/\\]AGENTS\.md/im.test(r.out), r.out.slice(0, 600));
}

// ---- D5f. Junction skip is structural (portable proof via fixture) ----
{
  // Build a fixture with a REAL root and a JUNCTIONED root; only the real one
  // may be discovered. Junction = dir junction on win32, symlink on POSIX
  // (no privilege needed for either).
  const home = mkdtempSync(join(tmpdir(), 'sync-junc-'));
  const realRoot = join(home, 'real', 'setup-tna');
  const junctionRoot = join(home, 'linkdir', 'setup-tna');
  mkdirSync(realRoot, { recursive: true });
  writeFileSync(join(realRoot, 'SKILL.md'), 'real root\\n');
  mkdirSync(join(home, 'linkdir'), { recursive: true });
  let linkOk = true;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('cmd', ['/c', 'mklink', '/J', junctionRoot, realRoot], { encoding: 'utf8' });
      linkOk = r.status === 0 && existsSync(junctionRoot);
    } else {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(realRoot, junctionRoot, 'dir');
    }
  } catch { linkOk = false; }
  if (!linkOk) {
    console.log('skip - D5f junction fixture (link creation unavailable)');
  } else {
    const rl = run(['--list'], home);
    const rootsFound = rl.out.split(/\\r?\\n/).filter((l) => l.startsWith('payload root:'));
    check('D5f the real fixture root is discovered', rootsFound.some((l) => l.includes('real')), rl.out.slice(0, 300));
    check('D5f the junctioned root is NEVER a mirror (skip by structure)',
      !rootsFound.some((l) => l.includes('linkdir')), rl.out.slice(0, 300));
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- Z. Zero drift (the contract; RED until --write repairs) ----
{
  const r = run([]);
  check('Z1 check mode reports zero drift across every discovered root', r.code === 0, r.out.slice(-600));
}

// ---- W. Write mode repairs a synthetic drift (the repair seam, sandboxed) ----
{
  // Build a fake payload root with a drifted file, run --write, expect repair.
  const home = mkdtempSync(join(tmpdir(), 'sync-probe-'));
  const fake = join(home, 'fake', 'setup-tna');
  mkdirSync(join(fake, 'scripts'), { recursive: true });
  writeFileSync(join(fake, 'SKILL.md'), 'drifted\n');
  writeFileSync(join(fake, 'scripts', 'onboarding.mjs'), 'drifted\n');
  const r = run(['--write'], home);
  const { readFileSync } = await import('node:fs');
  check('W1 --write repairs a discovered drifted root (exit 0)', r.code === 0, r.out.slice(-300));
  check('W2 the repaired SKILL.md is byte-identical to canonical',
    readFileSync(join(fake, 'SKILL.md'), 'utf8') === (await import('node:fs')).readFileSync(join(ROOT, 'skills', 'meta', 'setup-tna', 'SKILL.md'), 'utf8'));
  check('W3 the repaired onboarding.mjs is byte-identical to canonical',
    readFileSync(join(fake, 'scripts', 'onboarding.mjs')).equals((await import('node:fs')).readFileSync(join(ROOT, 'scripts', 'onboarding.mjs'))));
  check('W4 repair created the missing veto adapter (release-payload contract)',
    existsSync(join(fake, 'veto-hooks', 'omp', 'tna-veto.ts')));
  rmSync(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll payload-sync expectations hold.' : `\n${failures} failing expectation(s)`);
process.exit(failures === 0 ? 0 : 1);
