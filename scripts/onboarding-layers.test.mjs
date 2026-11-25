#!/usr/bin/env node
/**
 * Fail-first test for the FULL-LAYER onboarding (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The adapters worked, but the INSTALL path did not deliver them. Measured
 * 2026-10-25 on a clean machine state:
 *
 *   1. `detectHarness()` had no `dsh` branch at all — it checked .opencode,
 *      .omp, .pi, ~/.codex/config.toml, ~/.claude, ~/.omo. A DeepSeek Harness
 *      user got NO hooks, NO profile patch, NO receipt line: dsh support was
 *      purely manual, which is how the whole session's work landed here.
 *   2. The hooks component copied only `tna-veto.ts` for omp/pi. The discipline
 *      adapter (floor + mandatory-gate + done-gate) had no copy path, so a fresh
 *      install shipped ONE of four layers.
 *   3. `--undo` reversed only what it knew about, so anything new copied would
 *      become residue.
 *
 * This test pins the install contract: for each of omp / pi / dsh, consenting to
 * the hooks component must place EVERY adapter the harness needs, and --undo
 * must remove exactly what it placed.
 *
 * Seam: the onboarding CLI (a subprocess), asserting on the files it leaves on
 * disk. Never on internals.
 *
 * Zero dependencies. Run: node scripts/onboarding-layers.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ONB = join(HERE, 'onboarding.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** Run onboarding in a temp repo. `--from-chat` carries the consent answers.
 *  HOME/USERPROFILE point at a temp dir so a test can never touch the real
 *  ~/.omp, ~/.pi or ~/.dsh on the machine running it. */
function onboard(dir, harnessDir, answers) {
  if (harnessDir !== null) mkdirSync(join(dir, harnessDir), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), '# project router\n');
  writeFileSync(join(dir, '.gitignore'), '.trust/\n');
  const fakeHome = join(dir, 'home');
  mkdirSync(fakeHome, { recursive: true });
  const r = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify(answers)], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, APPDATA: fakeHome, CLAUDE_PLUGIN_ROOT: '' },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const ALL_LAYERS = { components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] };

// ---- AC1. pi: every adapter the harness needs ----
// pi has no plugin installer for local hooks, so the extension dir is the whole
// install: veto (the blocking layer) AND discipline (floor + mandatory + done).
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-pi-'));
  const r = onboard(dir, '.pi', ALL_LAYERS);
  const ext = join(dir, '.pi', 'extensions');
  check('AC1a pi onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC1b pi gets the veto adapter', existsSync(join(ext, 'tna-veto.ts')), r.out.slice(-300));
  check('AC1c pi gets the discipline adapter (floor + mandatory + done)', existsSync(join(ext, 'tna-discipline.ts')), r.out.slice(-300));
  check('AC1d the receipt names all four layers, not just the veto',
    /floor|mandatory|discipline/i.test(r.out), r.out.slice(-500));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC2. omp: same adapters at the home hook dir ----
{
  check('AC2a omp veto adapter is shipped', existsSync(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')));
  check('AC2b omp discipline adapter is shipped', existsSync(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')));
  check('AC2c omp stop-gate adapter is shipped', existsSync(join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts')));
  check('AC2d omp manual install docs copy all three adapters',
    (() => {
      try {
        const text = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
        return ['tna-veto.ts', 'tna-discipline.ts', 'tna-receipts-gate.ts'].every((f) =>
          new RegExp(`veto-hooks/omp/${f.replace(/\./g, '\\.')}.*?\\.omp/agent/(hooks/pre|extensions)/${f.replace(/\./g, '\\.')}`, 's').test(text));
      } catch { return false; }
    })());
}

// ---- AC3. dsh: detected, patched, and every profile wired ----
// The gap that mattered most: no dsh branch at all.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-dsh-'));
  const r = onboard(dir, '.dsh', ALL_LAYERS);
  check('AC3a dsh onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC3b dsh is DETECTED as its own harness (not "unknown")',
    /harness dsh/.test(r.out), r.out.slice(-500));

  const profileDir = join(dir, '.dsh', 'profiles', 'acp');
  const patch = join(profileDir, 'cordis.patch.yml');
  check('AC3c the acp profile gets a cordis.patch.yml', existsSync(patch), profileDir);
  if (existsSync(patch)) {
    const body = readFileSync(patch, 'utf8');
    check('AC3d the patch registers tna-veto', /tna-veto/.test(body), body.slice(0, 400));
    check('AC3e the patch registers tna-discipline', /tna-discipline/.test(body), body.slice(0, 400));
  }
  check('AC3f the veto plugin file lands beside the profile', existsSync(join(profileDir, 'plugins', 'tna-veto.mjs')));
  check('AC3g the discipline plugin file lands beside the profile', existsSync(join(profileDir, 'plugins', 'tna-discipline.mjs')));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC4. --undo leaves no residue ----
// Whatever onboarding placed must be reversible; an install that cannot be
// undone is a trap, and the stamp is the record of what it placed.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-undo-'));
  const r1 = onboard(dir, '.pi', ALL_LAYERS);
  check('AC4a install exits 0', r1.status === 0, r1.out.slice(-300));
  const ext = join(dir, '.pi', 'extensions');
  check('AC4b both adapters present before undo',
    existsSync(join(ext, 'tna-veto.ts')) && existsSync(join(ext, 'tna-discipline.ts')));

  const r2 = spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home') },
  });
  check('AC4c undo exits 0', r2.status === 0, `${r2.stdout ?? ''}${r2.stderr ?? ''}`.slice(-300));
  check('AC4d the veto adapter is removed', existsSync(join(ext, 'tna-veto.ts')) === false);
  check('AC4e the discipline adapter is removed', existsSync(join(ext, 'tna-discipline.ts')) === false);
  check('AC4f the stamp is gone', existsSync(join(dir, '.trust', 'onboarding.json')) === false);
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC5. A pre-existing copy is never clobbered ----
// The owner may have edited their adapter; onboarding must not overwrite it.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-keep-'));
  mkdirSync(join(dir, '.pi', 'extensions'), { recursive: true });
  writeFileSync(join(dir, '.pi', 'extensions', 'tna-veto.ts'), '// OWNER EDITED\n');
  const r = onboard(dir, '.pi', ALL_LAYERS);
  check('AC5a onboarding exits 0 with a pre-existing adapter', r.status === 0, r.out.slice(-300));
  check('AC5b the owner copy is left untouched',
    readFileSync(join(dir, '.pi', 'extensions', 'tna-veto.ts'), 'utf8') === '// OWNER EDITED\n');
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC6. devin: adapter + gate runtime + config wiring + a TWO-SIDED veto ----
// The devin/agy/gemini adapters were live-proven but had no install path:
// detectHarness did not know them, adaptersFor copied zero files, and no config
// was ever written. Consent must land the adapter, its gate runtime under
// ~/.tna (the adapters resolve ../../plugin/scripts/gate-hook.mjs), the hook
// entries in the harness's own config, and the veto must be observed denying
// AND allowing — a deny-only gate cannot be told from a broken one.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-devin-'));
  const r = onboard(dir, '.devin', ALL_LAYERS);
  const home = join(dir, 'home');
  const tna = join(home, '.tna');
  check('AC6a devin onboarding exits 0', r.status === 0, r.out.slice(-400));
  const hook = join(tna, 'veto-hooks', 'devin', 'hook.mjs');
  check('AC6b devin adapter installed under ~/.tna', existsSync(hook), r.out.slice(-300));
  const RUNTIME = ['gate-hook', 'reinject', 'overlay-registry', 'floor-composer', 'tna-gate', 'onboarding', 'receipt-enforcement', 'action-gate', 'mandatory-gate'];
  check('AC6c gate runtime installed beside it (the adapter resolves ../../plugin/scripts/)',
    RUNTIME.every((f) => existsSync(join(tna, 'plugin', 'scripts', `${f}.mjs`))),
    RUNTIME.filter((f) => !existsSync(join(tna, 'plugin', 'scripts', `${f}.mjs`))).join(','));
  check('AC6d scripts/reinject.mjs installed for the reinject target', existsSync(join(tna, 'scripts', 'reinject.mjs')));
  const cfgPath = join(home, 'devin', 'config.json');
  check('AC6e devin config.json written', existsSync(cfgPath), r.out.slice(-300));
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { /* reported above */ }
  const evCmds = (ev) => (cfg?.hooks?.[ev] ?? []).flatMap((g) => (g?.hooks ?? []).map((h) => String(h?.command ?? ''))).join(' | ');
  const DEVIN_CMD = /devin[\\/]hook\.mjs" gate-hook/;
  check('AC6f SessionStart wires the floor (reinject target)',
    /devin[\\/]hook\.mjs" reinject/.test(evCmds('SessionStart')), evCmds('SessionStart'));
  check('AC6g PreToolUse wires the veto (gate-hook target)', DEVIN_CMD.test(evCmds('PreToolUse')), evCmds('PreToolUse'));
  check('AC6h PostToolUse wires the evidence recorder', DEVIN_CMD.test(evCmds('PostToolUse')), evCmds('PostToolUse'));
  check('AC6i UserPromptSubmit wires the mandatory gate', DEVIN_CMD.test(evCmds('UserPromptSubmit')), evCmds('UserPromptSubmit'));
  check('AC6j the receipt names what devin actually got (no generic fallback claim)',
    !/veto hooks ship with the harness plugin/.test(r.out) && /veto/i.test(r.out), r.out.slice(-400));

  // Subject-verified: run the INSTALLED adapter, deny side first.
  const hookRun = (target, payload) => spawnSync(process.execPath, [hook, target], {
    input: JSON.stringify(payload), cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DEVIN_PROJECT_DIR: dir },
  });
  const deny = hookRun('gate-hook', {
    hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: dir,
  });
  check('AC6k installed veto denies a commit with no fresh evidence',
    /"decision":"block"/.test(deny.stdout ?? ''), `status=${deny.status} out=${(deny.stdout ?? '').slice(0, 200)}`);
  // The allow side: a passing test run through exec/PostToolUse must RECORD
  // evidence — the exact path that never worked while devin's `exec` stayed
  // unmapped (SHELL_TOOLS has no 'exec', so observeAfter recorded nothing and
  // the veto could only ever deny).
  hookRun('gate-hook', {
    hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'npm test' },
    tool_response: { exitCode: 0, output: '3 passed' }, cwd: dir,
  });
  const allow = hookRun('gate-hook', {
    hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: dir,
  });
  check('AC6l the same commit is ALLOWED after a recorded test pass (two-sided, not a permanent block)',
    !/"decision":"block"/.test(allow.stdout ?? ''), `status=${allow.status} out=${(allow.stdout ?? '').slice(0, 200)}`);

  // The floor: copy the real router files so reinject has both sections, then
  // the SessionStart path must emit additionalContext — not silence.
  writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  writeFileSync(join(dir, 'WORKFLOW.md'), readFileSync(join(ROOT, 'WORKFLOW.md'), 'utf8'));
  const fl = hookRun('reinject', { hook_event_name: 'SessionStart', cwd: dir });
  check('AC6m the floor reinjects as additionalContext on SessionStart',
    /additionalContext/.test(fl.stdout ?? ''), `status=${fl.status} out=${(fl.stdout ?? '').slice(0, 160)} err=${(fl.stderr ?? '').slice(0, 160)}`);

  // Drift visibility: the doctor reads this table for the AD check.
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = home;
  try {
    const { detectInstalledAdapters } = await import('./onboarding.mjs');
    const devinGroup = detectInstalledAdapters(dir).groups.find((g) => g.harness === 'devin');
    check('AC6n doctor sees the devin adapter as installed+current',
      Boolean(devinGroup) && devinGroup.adapters.some((a) => /devin[\\/]hook\.mjs$/.test(a.path) && a.state === 'current'),
      JSON.stringify(devinGroup ?? null).slice(0, 200));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- AC7. antigravity: named hook group merged, never clobbered ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-agy-'));
  const home = join(dir, 'home');
  // Home marker, plus a FOREIGN group that must survive the merge byte-for-byte.
  mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({
    'orca-status': { SessionStart: [{ hooks: [{ type: 'command', command: 'node orca.mjs' }] }] },
  }));
  const r = onboard(dir, null, ALL_LAYERS);
  const tna = join(home, '.tna');
  check('AC7a agy onboarding exits 0', r.status === 0, r.out.slice(-400));
  const hook = join(tna, 'veto-hooks', 'antigravity', 'hook.mjs');
  check('AC7b agy adapter installed under ~/.tna', existsSync(hook), r.out.slice(-300));
  check('AC7c gate runtime installed', existsSync(join(tna, 'plugin', 'scripts', 'gate-hook.mjs')));
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(home, '.gemini', 'config', 'hooks.json'), 'utf8')); } catch { /* below */ }
  check('AC7d the tna-veto group is wired on Pre+PostToolUse',
    Array.isArray(cfg['tna-veto']?.PreToolUse) && Array.isArray(cfg['tna-veto']?.PostToolUse)
    && /veto-hooks[\\/]antigravity[\\/]hook\.mjs/.test(JSON.stringify(cfg['tna-veto'])),
    JSON.stringify(cfg).slice(0, 300));
  check('AC7e a pre-existing group is never clobbered',
    cfg['orca-status']?.SessionStart?.[0]?.hooks?.[0]?.command === 'node orca.mjs', JSON.stringify(cfg['orca-status'] ?? null));

  const hookRun = (payload) => spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload), cwd: dir, encoding: 'utf8', timeout: 30000,
  });
  const deny = hookRun({
    hookEventName: 'PreToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x' } }, cwd: dir,
  });
  check('AC7f installed veto denies a commit with no fresh evidence',
    /"decision":"deny"/.test(deny.stdout ?? ''), `out=${(deny.stdout ?? '').slice(0, 200)}`);
  hookRun({
    hookEventName: 'PostToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    tool_response: { exitCode: 0 }, cwd: dir,
  });
  const allow = hookRun({
    hookEventName: 'PreToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x' } }, cwd: dir,
  });
  check('AC7g the same commit is ALLOWED after a recorded test pass (two-sided)',
    /"decision":"allow"/.test(allow.stdout ?? ''), `out=${(allow.stdout ?? '').slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC8. gemini: settings.json merged, never clobbered ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-gemini-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.gemini'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({
    theme: 'dark',
    hooks: { BeforeTool: [{ hooks: [{ type: 'command', command: 'node foreign.mjs' }] }] },
  }));
  const r = onboard(dir, null, ALL_LAYERS);
  const tna = join(home, '.tna');
  check('AC8a gemini onboarding exits 0', r.status === 0, r.out.slice(-400));
  const hook = join(tna, 'veto-hooks', 'gemini', 'hook.mjs');
  check('AC8b gemini adapter installed under ~/.tna', existsSync(hook), r.out.slice(-300));
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8')); } catch { /* below */ }
  check('AC8c BeforeTool + AfterTool wire the adapter',
    /veto-hooks[\\/]gemini[\\/]hook\.mjs/.test(JSON.stringify(cfg?.hooks?.BeforeTool ?? []))
    && /veto-hooks[\\/]gemini[\\/]hook\.mjs/.test(JSON.stringify(cfg?.hooks?.AfterTool ?? [])),
    JSON.stringify(cfg?.hooks ?? null).slice(0, 300));
  check('AC8d unrelated settings + a foreign hook entry survive the merge',
    cfg.theme === 'dark' && /foreign\.mjs/.test(JSON.stringify(cfg?.hooks?.BeforeTool ?? [])),
    JSON.stringify(cfg).slice(0, 300));

  const hookRun = (payload) => spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload), cwd: dir, encoding: 'utf8', timeout: 30000,
  });
  const deny = hookRun({
    hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'git commit -m x' }, cwd: dir,
  });
  check('AC8e installed veto denies a commit with no fresh evidence',
    /"decision":"deny"/.test(deny.stdout ?? ''), `out=${(deny.stdout ?? '').slice(0, 200)}`);
  hookRun({
    hook_event_name: 'AfterTool', tool_name: 'run_shell_command', tool_input: { command: 'npm test' },
    tool_response: { exitCode: 0 }, cwd: dir,
  });
  const allow = hookRun({
    hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'git commit -m x' }, cwd: dir,
  });
  check('AC8f the same commit is ALLOWED after a recorded test pass (two-sided)',
    !/"decision":"deny"/.test(allow.stdout ?? ''), `out=${(allow.stdout ?? '').slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC9. --undo removes the config wiring, never the file ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-undev-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({
    'orca-status': { SessionStart: [{ hooks: [{ type: 'command', command: 'node orca.mjs' }] }] },
  }));
  const r1 = onboard(dir, null, ALL_LAYERS);
  check('AC9a install exits 0', r1.status === 0, r1.out.slice(-300));
  const hooksFile = join(home, '.gemini', 'config', 'hooks.json');
  check('AC9b tna-veto group present before undo', /"tna-veto"/.test(readFileSync(hooksFile, 'utf8')));

  const r2 = spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home },
  });
  check('AC9c undo exits 0', r2.status === 0, `${r2.stdout ?? ''}${r2.stderr ?? ''}`.slice(-300));
  const after = readFileSync(hooksFile, 'utf8');
  check('AC9d the tna-veto group is stripped from hooks.json', !/"tna-veto"/.test(after), after.slice(0, 200));
  check('AC9e the foreign group survives undo', /orca-status/.test(after), after.slice(0, 200));
  check('AC9f the installed adapter is removed', !existsSync(join(home, '.tna', 'veto-hooks', 'antigravity', 'hook.mjs')));
  check('AC9g the stamp is gone', !existsSync(join(dir, '.trust', 'onboarding.json')));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC10. Honest receipts: no generic claims, consent without an engine is named ----
{
  // unknown harness + hooks consented: nothing was installed, and the receipt
  // must SAY that — not borrow the plugin-payload line that is true only for
  // claude/codex (measured: onboarding.mjs:1119 printed it for every untabled
  // harness, including ones with no plugin at all).
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-unk-'));
  const r = onboard(dir, null, ALL_LAYERS);
  check('AC10a unknown harness never claims shipped hook adapters',
    !/veto hooks ship with the harness plugin/.test(r.out), r.out.slice(-400));
  check('AC10b the honest limit is named (audit-only / no adapter)',
    /no mechanical adapter|audit-only/i.test(r.out), r.out.slice(-400));
  rmSync(dir, { recursive: true, force: true });
}
{
  // evidenceGate without hooks: the gate is a consent label riding on the
  // hooks adapters — consenting it alone arms nothing, and the install must
  // say so instead of stamping a gate that cannot fire.
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-eg-'));
  const r = onboard(dir, '.pi', { components: { floor: false, hooks: false, overlays: false, evidenceGate: true }, mapSkills: [] });
  check('AC10c evidenceGate without hooks warns that nothing enforces it',
    /evidence.?gate/i.test(r.out) && /no engine|without.*hooks|nothing enforces|mechanically off/i.test(r.out),
    r.out.slice(-400));
  rmSync(dir, { recursive: true, force: true });
}

// ---- T02. Installation-health scanner sees incomplete user-level installs ----
// First-install trust-layer ticket 02. These fixtures exercise the exported
// scanner contract consumed by doctor, using only temporary HOME/USERPROFILE/
// APPDATA locations. Expected paths are hand-written from the ~/.tna install
// contract, never copied from scanner output.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-t02-scan-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.tna', 'veto-hooks', 'devin'), { recursive: true });
  writeFileSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'), '// fixture adapter\n');
  const oldEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.APPDATA = home;
  try {
    const { detectInstalledAdapters } = await import('./onboarding.mjs');
    const scan = detectInstalledAdapters(dir);
    const runtime = scan.groups.find((g) => g.harness === 'tna-runtime');
    const missingGateHook = join(home, '.tna', 'plugin', 'scripts', 'gate-hook.mjs');
    const missingReinject = join(home, '.tna', 'scripts', 'reinject.mjs');
    check('T02a runtime evidence makes every required missing runtime file visible',
      Boolean(runtime) && runtime.adapters.filter((a) => a.state === 'missing').length === 10,
      JSON.stringify(runtime ?? null).slice(0, 500));
    check('T02b missing runtime rows carry their exact destination paths',
      Boolean(runtime) && runtime.adapters.some((a) => a.state === 'missing' && a.path === missingGateHook)
      && runtime.adapters.some((a) => a.state === 'missing' && a.path === missingReinject),
      JSON.stringify(runtime?.adapters?.filter((a) => a.state === 'missing') ?? null).slice(0, 500));
  } finally {
    if (oldEnv.HOME === undefined) delete process.env.HOME; else process.env.HOME = oldEnv.HOME;
    if (oldEnv.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldEnv.USERPROFILE;
    if (oldEnv.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldEnv.APPDATA;
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-t02-reg-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.tna', 'veto-hooks', 'devin'), { recursive: true });
  mkdirSync(join(home, 'devin'), { recursive: true });
  writeFileSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'), '// fixture adapter\n');
  const cmd = 'node "' + join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs').replace(/\\/g, '/') + '" gate-hook';
  writeFileSync(join(home, 'devin', 'config.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: cmd }] }] },
  }));
  const oldEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.APPDATA = home;
  try {
    const { detectInstalledAdapters } = await import('./onboarding.mjs');
    const scan = detectInstalledAdapters(dir);
    const devin = scan.groups.find((g) => g.harness === 'devin')?.adapters?.find((a) => /devin[\\/]hook\.mjs$/.test(a.path));
    check('T02c a surviving veto registration cannot certify the recorder',
      Boolean(devin) && devin.state === 'unregistered' && Array.isArray(devin.missingRegistrations)
      && devin.missingRegistrations.includes('PostToolUse:gate-hook'),
      JSON.stringify(devin ?? null));
    check('T02d the scanner names every other absent devin event registration',
      Boolean(devin) && ['SessionStart:reinject', 'UserPromptSubmit:gate-hook']
        .every((x) => devin.missingRegistrations?.includes(x)),
      JSON.stringify(devin ?? null));
  } finally {
    if (oldEnv.HOME === undefined) delete process.env.HOME; else process.env.HOME = oldEnv.HOME;
    if (oldEnv.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldEnv.USERPROFILE;
    if (oldEnv.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldEnv.APPDATA;
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-t02-empty-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const oldEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.APPDATA = home;
  try {
    const { detectInstalledAdapters } = await import('./onboarding.mjs');
    const scan = detectInstalledAdapters(dir);
    check('T02e a fixture with no user-level TNA evidence reports no runtime defect',
      !scan.groups.some((g) => g.harness === 'tna-runtime'), JSON.stringify(scan.groups));
  } finally {
    if (oldEnv.HOME === undefined) delete process.env.HOME; else process.env.HOME = oldEnv.HOME;
    if (oldEnv.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldEnv.USERPROFILE;
    if (oldEnv.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldEnv.APPDATA;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
