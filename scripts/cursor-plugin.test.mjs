#!/usr/bin/env node
/**
 * Fail-first test for the Cursor plugin payload (.cursor-plugin/plugin.json,
 * .cursor/hooks/hooks.json): the veto layer must reach Cursor the same way it
 * reaches Claude Code and Codex - as a real block contract, wired through the
 * same gate-hook classifier. Run: node scripts/cursor-plugin.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = Cursor payload drift or missing.
 *
 * Cursor specifics this pins (per cursor.com/docs, 2026-10):
 *  - Cursor Plugin manifest lives at .cursor-plugin/plugin.json and declares
 *    skills, commands, hooks, rules components
 *  - hooks/hooks.json uses lowerCamelCase event names (beforeShellExecution,
 *    sessionStart, preCompact) with "version": 1
 *  - exit code 2 on beforeShellExecution blocks the command (same contract
 *    the Claude PreToolUse adapter relies on)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PLUGIN = join(ROOT, 'plugin');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. The Cursor Plugin manifest exists and is valid ----
{
  const manifestPath = join(PLUGIN, '.cursor-plugin', 'plugin.json');
  check('A1 .cursor-plugin/plugin.json exists', existsSync(manifestPath));
  if (existsSync(manifestPath)) {
    let m = null;
    try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { check('A2 manifest parses as JSON', false, e.message); }
    if (m) {
      check('A2 manifest parses as JSON', true);
      check('A3 declares the trust-no-agent plugin', m.name === 'trust-no-agent', JSON.stringify({ name: m.name }));
      check('A4 declares skills component', typeof m.skills === 'string' || Array.isArray(m.skills), JSON.stringify(m.skills ?? null));
      check('A5 declares hooks component', typeof m.hooks === 'string' || typeof m.hooks === 'object', JSON.stringify(m.hooks ?? null));
      check('A6 declares commands component', typeof m.commands === 'string' || Array.isArray(m.commands), JSON.stringify(m.commands ?? null));
      check('A7 manifest declares a version', typeof m.version === 'string', m.version ?? 'missing');
    }
  }
}

// ---- B. The Cursor hooks config exists with the right shape ----
{
  const hooksPath = join(PLUGIN, '.cursor', 'hooks', 'hooks.json');
  check('B1 .cursor/hooks/hooks.json exists', existsSync(hooksPath));
  if (existsSync(hooksPath)) {
    let h = null;
    try { h = JSON.parse(readFileSync(hooksPath, 'utf8')); } catch (e) { check('B2 hooks.json parses', false, e.message); }
    if (h) {
      check('B2 hooks.json parses', true);
      check('B3 carries "version": 1 (Cursor requirement)', h.version === 1, JSON.stringify(h.version));
      const hooks = h.hooks ?? {};
      check('B4 wires beforeShellExecution (the block contract)', Array.isArray(hooks.beforeShellExecution) && hooks.beforeShellExecution.length > 0);
      check('B5 wires sessionStart (the floor injection)', Array.isArray(hooks.sessionStart) && hooks.sessionStart.length > 0);
      check('B6 wires preCompact (floor re-injection after compaction)', Array.isArray(hooks.preCompact) && hooks.preCompact.length > 0);
      const allCommands = JSON.stringify(h);
      check('B7 every hook command routes through the shim (one classifier, all harnesses)',
        (allCommands.match(/gate-hook-shim\.mjs/g) || []).length >= 3);
      check('B8 no absolute drive or home paths in commands', !/\/(Users|home|mnt|cygdrive)[\\/]|[A-Z]:\\/.test(allCommands.replace(/\\"/g, '')));
    }
  }
}

// ---- C. The hooks point at scripts that exist in the plugin payload ----
{
  const gateHook = join(PLUGIN, 'scripts', 'gate-hook.mjs');
  check('C1 plugin/scripts/gate-hook.mjs present (the shared veto brain)', existsSync(gateHook));
  const shim = join(PLUGIN, '.cursor', 'scripts', 'gate-hook-shim.mjs');
  check('C2 the Cursor shim exists (event-name mapping, no discipline logic)', existsSync(shim));
  if (existsSync(shim)) {
    const src = readFileSync(shim, 'utf8');
    check('C3 the shim is thin - no IRREVERSIBLE_PATTERNS duplicated', !src.includes('IRREVERSIBLE_PATTERNS'), 'pattern table must stay in action-gate.mjs only');
    check('C4 the shim forwards exit 2 (the block contract)', /exit\(2\)/.test(src));
  }
}

// ---- D. The compatibility matrix row is honest about Cursor ----
{
  const compat = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
  const cursorRow = compat.split('\n').find((l) => /^\| \*\*Cursor\*\*/.test(l));
  check('D1 the compatibility matrix has a Cursor row', !!cursorRow);
  if (cursorRow) {
    check('D2 the Cursor row states the hook wiring exists in the payload', /hooks\.json|beforeShellExecution|veto/i.test(cursorRow), cursorRow.slice(0, 160));
  }
}

// ---- E. The README Cursor install path is REAL (origin: install-path audit
// 2026-10-19). The shipped `cursor plugin marketplace add` + `install` block
// was a Claude/Codex-shaped fiction: the cursor CLI (probed 3.24.12, --help)
// has NO plugin subcommand. `​/add-plugin` exists only as an in-editor chat
// command and searches the CURATED marketplace — it finds nothing until the
// plugin is actually listed. Until that submission is approved, the honest
// README carries NO Cursor install block at all; users ride the universal
// path below. Flip E2 the day the listing goes live: then require the real
// marketplace install shape instead of forbidding the block.
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  check('E1 README carries no fictional "cursor plugin" CLI command', !/^\s*cursor\s+plugin\s+(install|marketplace|add)/im.test(readme));
  const installSection = readme.split(/^## /m).find((s) => s.startsWith('Install'));
  check('E2 README carries no Cursor install block (no listing yet - see the flip note above)',
    !installSection || !/^Cursor$/m.test(installSection.replace(/\*\*/g, '')) && !installSection.includes('**Cursor**'),
    'a Cursor block exists while the marketplace listing does not - remove it or wire the real listing first');
}

console.log(failures === 0 ? '\nAll cursor-plugin expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
