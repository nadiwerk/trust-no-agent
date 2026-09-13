#!/usr/bin/env node
/**
 * Fail-first test for the update-check delivery layer (spec AC 1, 4, 10).
 * Zero dependencies. Run: node scripts/update-delivery.test.mjs
 * Seam: pure functions in update-delivery.mjs —
 *   pickBackend({ platform, report })  → { mode: 'toast'|'native'|'log-only'|'silent', reason }
 *   formatLog(report)                  → plain-text block for the log file
 * The CLI wrapper executes the backend; these tests pin the decisions only.
 */
import { pickBackend, formatLog } from './update-delivery.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const STALE = { notify: true, lines: [{ kind: 'stale', project: 'p', text: 'p: 0.1.12 → 0.2.0' }, { kind: 'changelog', text: '## [0.2.0]\n\n- scheduled update-check reminder' }] };
const CURRENT = { notify: false, lines: [{ kind: 'current', text: 'all installs current' }] };
const FAILED = { notify: false, lines: [{ kind: 'failure', text: 'upstream check failed: net down' }] };

// AC 1 — platform dispatch descriptors
{
  check('windows → toast', pickBackend({ platform: 'win32', report: STALE }).mode === 'toast');
  check('darwin → native', pickBackend({ platform: 'darwin', report: STALE }).mode === 'native');
  check('linux → native-or-log', ['native', 'log-only'].includes(pickBackend({ platform: 'linux', report: STALE }).mode));
  check('unknown platform → log-only', pickBackend({ platform: 'sunos', report: STALE }).mode === 'log-only');
}

// AC 4 — silent path: all-current never notifies on any platform
{
  for (const platform of ['win32', 'darwin', 'linux']) {
    check(`all-current silent on ${platform}`, pickBackend({ platform, report: CURRENT }).mode === 'silent',
      pickBackend({ platform, report: CURRENT }).mode);
  }
}

// Failure reports also stay silent (AC 5 delivery side) but are logged
{
  check('failure silent on windows', pickBackend({ platform: 'win32', report: FAILED }).mode === 'silent');
}

// AC 10 — log write happens for every mode; formatLog produces the block
{
  const block = formatLog({ ranAt: '2026-09-13T09:00:00Z', ...STALE });
  check('log block has header', block.startsWith('=== update-check'), block.slice(0, 40));
  check('log block contains stale line', block.includes('p: 0.1.12 → 0.2.0'));
  check('log block has changelog or delta note', block.includes('## [') || block.includes('unreadable'), block);

  const currentBlock = formatLog({ ranAt: '2026-09-13T09:00:00Z', ...CURRENT });
  check('current report still logged', currentBlock.includes('all installs current'));

  const failedBlock = formatLog({ ranAt: '2026-09-13T09:00:00Z', ...FAILED });
  check('failure still logged', failedBlock.includes('net down'));
  check('failure logs no version', !/\d+\.\d+\.\d+ →/.test(failedBlock));
}

console.log(failures === 0 ? '\nOK: all expectations hold' : `\nFAIL: ${failures} expectation(s) failed`);
process.exit(failures === 0 ? 0 : 1);
