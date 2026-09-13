#!/usr/bin/env node
/**
 * Fail-first test for the update-check installer decisions (spec AC 1, 8, 11).
 * Zero dependencies. Run: node scripts/update-install.test.mjs
 * Seam: pure functions in update-install.mjs —
 *   installPlan({ platform, projectsRoot, upstreamUrl }) → { taskName, schedule, command, backend }
 *   uninstallPlan({ platform })                          → { taskName, removal }
 * Real OS registration is human-verified at install time (documented step); these
 * tests pin the decisions, never execute registration.
 */
import { installPlan, uninstallPlan } from './update-install.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// AC 1 — per-OS registration plan
{
  const w = installPlan({ platform: 'win32', projectsRoot: 'C:/u/projects', upstreamUrl: 'https://x/CHANGELOG.md' });
  check('win32 backend is Task Scheduler', w.backend === 'schtasks', JSON.stringify(w.backend));
  check('win32 schedule weekly Monday 09:00', w.schedule === 'weekly MON 09:00', w.schedule);
  check('win32 command invokes update-check cli', /update-check-cli\.mjs/.test(w.command), w.command);
  check('win32 command carries config', w.command.includes('C:/u/projects') && w.command.includes('https://x/CHANGELOG.md'), w.command);
  check('task name is stable and named', w.taskName.includes('update-check'), w.taskName);

  const m = installPlan({ platform: 'darwin', projectsRoot: '/u/projects', upstreamUrl: 'https://x/CHANGELOG.md' });
  check('darwin backend is launchd', m.backend === 'launchd', JSON.stringify(m.backend));
  const l = installPlan({ platform: 'linux', projectsRoot: '/u/projects', upstreamUrl: 'https://x/CHANGELOG.md' });
  check('linux backend is cron', l.backend === 'cron', JSON.stringify(l.backend));
}

// AC 11 — defaults when installer gets no overrides; single source of truth
{
  const d = installPlan({ platform: 'win32' });
  check('default config baked into command', /projects/.test(d.command) && d.command.includes('nadiwerk/trust-no-agent'), d.command);
  // config default must come from resolveConfig, not a second copy of the rule
  const { resolveConfig } = await import('./update-check.mjs');
  const cfg = resolveConfig({});
  const viaResolve = installPlan({ platform: 'win32', projectsRoot: cfg.projectsRoot, upstreamUrl: cfg.upstreamUrl });
  check('defaults identical to resolveConfig output', d.command === viaResolve.command, `${d.command} vs ${viaResolve.command}`);
}

// Config validation — injection surface at the trust boundary
{
  let threw = false;
  try { installPlan({ platform: 'win32', projectsRoot: 'C:/bad"root' }); } catch { threw = true; }
  check('rejects quote in projectsRoot', threw);
  threw = false;
  try { installPlan({ platform: 'linux', upstreamUrl: 'http://not-https/x' }); } catch { threw = true; }
  check('rejects non-https upstreamUrl', threw);
  threw = false;
  try { installPlan({ platform: 'linux', projectsRoot: '/x\n0 0 * * * evil' }); } catch { threw = true; }
  check('rejects newline injection in projectsRoot', threw);
}

// AC 8 — uninstall mirrors install task name
{
  const w = installPlan({ platform: 'win32' });
  const u = uninstallPlan({ platform: 'win32' });
  check('uninstall targets same task name', u.taskName === w.taskName, `${u.taskName} vs ${w.taskName}`);
  check('uninstall has removal command', typeof u.removal === 'string' && u.removal.length > 0, u.removal);
}

console.log(failures === 0 ? '\nOK: all expectations hold' : `\nFAIL: ${failures} expectation(s) failed`);
process.exit(failures === 0 ? 0 : 1);
