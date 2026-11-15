#!/usr/bin/env node
/**
 * Fail-first test for the opencode delegation gate (Gap 3: a delegation that
 * runs without the discipline block is a delegation WITHOUT its guards —
 * subagents never read AGENTS.md, so the brief is the only path the rules
 * reach them).
 *
 * Canonical source of the contract: the router itself (AGENTS.md §5
 * Delegation discipline) + scripts/mandatory-gate.mjs classifyTask for the
 * required-skill derivation. The orchestrator-brief.mjs builder referenced by
 * the router does not exist in either checkout (reference degrades per §8),
 * so this port validates the CONTRACT, not the builder: repo rules 3-liner,
 * the six sections, the VERIFY/TIMEBOX/PARTIAL execution window, and a
 * Loading line for every MANDATORY domain the task text triggers.
 *
 * Wiring: execute.before, tool in {task, subagent, agent} (OpenCode's
 * delegation tool is `task`; this machine also shows `subagent`) — deny by
 * throwing, the proven opencode veto shape.
 *
 * Run: node scripts/tna-delegate-v2.test.mjs   (exit 0 = green)
 */
const HERE = new URL('.', import.meta.url).href.replace(/file:\/\//, '');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const mod = await import(new URL('../.opencode/plugins/tna-gate/delegation-gate.mjs', import.meta.url).href)
  .catch(() => ({ delegateVerdict: null }));

check('delegation gate module exists', typeof mod.delegateVerdict === 'function', 'import failed — module not written yet');

if (typeof mod.delegateVerdict === 'function') {
  const RULES = 'Repo rules: (1) every file change is verified (typecheck/test/error output) before it\'s called done. (2) No refactoring outside the requested scope. (3) No touching files outside the allowed path list.';
  const SECTIONS = [
    'TASK: riset struktur plugin opencode',
    'EXPECTED OUTCOME: ringkasan temuan + path file',
    'REQUIRED TOOLS: read, grep, glob',
    'MUST DO: baca .opencode/plugins/, laporkan temuan',
    'MUST NOT DO: tidak menulis file apa pun',
    'CONTEXT: repo trust-no-agent, cabang master',
  ].join('\n');
  const WINDOW = 'VERIFY: node scripts/tna-gate-v2.test.mjs\nTIMEBOX: 15 menit\nPARTIAL: temuan sejauh ini, tanpa edit baru';

  // 1. A complete brief passes — even when the task text triggers a MANDATORY
  //    domain, because the Loading line is present.
  const full = mod.delegateVerdict({
    tool: 'task',
    args: {
      description: 'write a unit test for the veto adapter',
      prompt: [RULES, SECTIONS, 'Loading: expect-fail', WINDOW].join('\n'),
    },
  });
  check('complete brief with Loading passes', full.allow === true, JSON.stringify(full));

  // 2. Same task text, NO Loading line -> denied naming the skill.
  const noLoading = mod.delegateVerdict({
    tool: 'task',
    args: { description: 'write a unit test for the veto adapter', prompt: [RULES, SECTIONS, WINDOW].join('\n') },
  });
  check('missing Loading for a triggered domain denies', noLoading.allow === false && /expect-fail/.test(noLoading.reason), JSON.stringify(noLoading));

  // 3. load_skills marker also satisfies the requirement.
  const withLoadSkills = mod.delegateVerdict({
    tool: 'subagent',
    args: {
      description: 'write a unit test for the veto adapter',
      prompt: [RULES, SECTIONS, WINDOW, 'load_skills: ["expect-fail"]'].join('\n'),
    },
  });
  check('load_skills marker satisfies the MANDATORY requirement', withLoadSkills.allow === true, JSON.stringify(withLoadSkills));

  // 4. Missing sections are named, not silently swallowed.
  const noSections = mod.delegateVerdict({
    tool: 'task',
    args: { description: 'read only', prompt: [RULES, 'TASK: baca file', WINDOW].join('\n') },
  });
  check('missing sections deny and are named', noSections.allow === false && /MUST DO|CONTEXT/.test(noSections.reason), JSON.stringify(noSections));

  // 5. Missing repo-rules block denies.
  const noRules = mod.delegateVerdict({
    tool: 'task',
    args: { description: 'riset', prompt: [SECTIONS, WINDOW].join('\n') },
  });
  check('missing repo rules deny', noRules.allow === false && /Repo rules/i.test(noRules.reason), JSON.stringify(noRules));

  // 6. Missing execution window (VERIFY/TIMEBOX/PARTIAL) denies.
  const noWindow = mod.delegateVerdict({
    tool: 'task',
    args: { description: 'riset', prompt: [RULES, SECTIONS].join('\n') },
  });
  check('missing VERIFY/TIMEBOX/PARTIAL deny', noWindow.allow === false && /VERIFY|TIMEBOX|PARTIAL/.test(noWindow.reason), JSON.stringify(noWindow));

  // 7. Non-delegation tools are not this gate's business.
  const shell = mod.delegateVerdict({ tool: 'shell', args: { command: 'npm test' } });
  const editTool = mod.delegateVerdict({ tool: 'edit', args: {} });
  check('non-delegation tools pass untouched', shell.allow === true && editTool.allow === true, JSON.stringify([shell, editTool]));

  // 8. Shapeless input is safe: a non-delegation call passes untouched (the
  //    action-gate owns it), an empty delegation prompt denies with a reason.
  const junk = mod.delegateVerdict(null);
  const noPrompt = mod.delegateVerdict({ tool: 'task', args: {} });
  check('null call passes untouched, no throw', junk.allow === true, JSON.stringify(junk));
  check('delegation with no prompt denies with a reason', noPrompt.allow === false && /guards/.test(noPrompt.reason), JSON.stringify(noPrompt));
}

// --- integration: the plugin vetoes a naked delegation -----------------------
try {
  const plugMod = await import(new URL('../.opencode/plugins/tna-gate/index.js', import.meta.url).href);
  const plugin = plugMod.default;

  const mem = new Map();
  const fakeCtx = {
    location: { directory: '/tmp/whatever' },
    storage: { get: async (k) => mem.get(k), set: async (k, v) => { mem.set(k, v); } },
    tool: {
      hook: async (name, fn) => { mem.set('hook:' + name, fn); return { dispose: async () => {} }; },
    },
    event: { subscribe: (opts) => (async function* gen() { yield { type: 'session.idle', data: {} }; })() },
    session: {},
  };
  await plugin.setup(fakeCtx);
  const before = mem.get('hook:execute.before');

  // A naked delegation (no discipline block) must throw — the veto contract.
  let vetoed = null;
  try {
    await before({ tool: 'task', input: { description: 'tulis test unit', prompt: 'tulis test unit untuk adapter' } });
  } catch (e) {
    vetoed = String(e?.message ?? e);
  }
  check('plugin denies a naked delegation by throwing', vetoed !== null && /delegat|brief|discipline/i.test(vetoed), String(vetoed));

  // A complete brief passes the before-hook (nothing thrown).
  let passed = false;
  try {
    await before({
      tool: 'task',
      input: {
        description: 'write a unit test',
        prompt: [
          'Repo rules: (1) every file change is verified (typecheck/test/error output) before it\'s called done. (2) No refactoring outside the requested scope. (3) No touching files outside the allowed path list.',
          'TASK: write a unit test for the adapter',
          'EXPECTED OUTCOME: a passing test file',
          'REQUIRED TOOLS: read, write',
          'MUST DO: fail first, then implement',
          'MUST NOT DO: no refactoring',
          'CONTEXT: opencode plugin dir',
          'Loading: expect-fail',
          'VERIFY: node scripts/tna-gate-v2.test.mjs',
          'TIMEBOX: 10',
          'PARTIAL: return the failing output',
        ].join('\n'),
      },
    });
    passed = true;
  } catch (e) {
    passed = false;
  }
  check('plugin allows a complete delegation brief', passed === true);
} catch (e) {
  check('plugin integration importable and drivable', false, String(e));
}

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
