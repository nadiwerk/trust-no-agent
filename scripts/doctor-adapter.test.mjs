#!/usr/bin/env node
/**
 * Fail-first test for C10 — the per-harness ADAPTER check (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The doctor checked the router, the git hooks, the skills and the ledger — but
 * never the thing that actually enforces the veto on omp/pi/dsh. Measured
 * 2026-10-25: `~/.pi/agent/extensions/tna-discipline.ts` and
 * `~/.omp/agent/hooks/pre/tna-discipline.ts` had drifted from the shipped
 * copies, and `node scripts/doctor.mjs` printed "installation healthy". The
 * operator had no way to discover a stale adapter without a manual probe — and
 * the whole point of a self-check is that the machine tells you.
 *
 * Contract pinned here (pure function, no CLI side effects):
 *   - absent adapter            -> WARN naming the file and the install command
 *   - present + hash matches     -> PASS
 *   - present + hash differs     -> WARN naming both hashes and `--refresh`
 *   - no harness detected        -> PASS with an explicit "not applicable"
 *   - a hash recorded in the stamp but a DIFFERENT file on disk -> WARN
 *
 * Warn-level, never fail: a stale adapter breaks no gate by itself (it is an
 * older working gate), and the repair is a write to an installed artifact — the
 * operator's decision, not the doctor's.
 *
 * Zero dependencies. Run: node scripts/doctor-adapter.test.mjs
 */
import { adapterVerdict } from './doctor-checks.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A1. Every adapter current -> PASS ----
{
  const v = adapterVerdict({
    harness: 'pi',
    adapters: [
      { path: '/home/u/.pi/agent/extensions/tna-veto.ts', state: 'current' },
      { path: '/home/u/.pi/agent/extensions/tna-discipline.ts', state: 'current' },
    ],
  });
  check('A1 all-current is a pass', v.level === 'pass', JSON.stringify(v));
  check('A1b the pass names the count', /2 adapter/.test(v.message), v.message);
}

// ---- A2. A missing adapter -> WARN naming the file ----
{
  const v = adapterVerdict({
    harness: 'omp',
    adapters: [{ path: '/home/u/.omp/agent/hooks/pre/tna-veto.ts', state: 'missing' }],
  });
  check('A2 missing adapter is a warn', v.level === 'warn', JSON.stringify(v));
  check('A2b the message names the missing path', /tna-veto\.ts/.test(v.message), v.message);
  check('A2c the message names the install command', /onboarding\.mjs/.test(v.message), v.message);
}

// ---- A3. A drifted adapter -> WARN with both hashes + --refresh ----
{
  const v = adapterVerdict({
    harness: 'pi',
    adapters: [{ path: '/home/u/.pi/agent/extensions/tna-discipline.ts', state: 'drift', installed: 'aaaa1111bbbb', shipped: 'cccc2222dddd' }],
  });
  check('A3 drift is a warn', v.level === 'warn', JSON.stringify(v));
  check('A3b both hashes are named', /aaaa1111bbbb/.test(v.message) && /cccc2222dddd/.test(v.message), v.message);
  check('A3c the repair is named (--refresh)', /--refresh/.test(v.message), v.message);
  check('A3d the file is named', /tna-discipline\.ts/.test(v.message), v.message);
}

// ---- A4. No harness -> explicit not-applicable PASS, never silence ----
{
  const v = adapterVerdict({ harness: 'unknown', adapters: [] });
  check('A4 unknown harness is a pass', v.level === 'pass', JSON.stringify(v));
  check('A4b it says why (not applicable, not "healthy")', /not applicable|no harness/i.test(v.message), v.message);
}

// ---- A5. Several defects are counted, not collapsed to one line ----
{
  const v = adapterVerdict({
    harness: 'dsh',
    adapters: [
      { path: '/h/.dsh/profiles/acp/plugins/tna-veto.mjs', state: 'drift', installed: '1', shipped: '2' },
      { path: '/h/.dsh/profiles/web/plugins/tna-veto.mjs', state: 'missing' },
    ],
  });
  check('A5 the message carries the defect count', /\b2\b/.test(v.message), v.message);
  check('A5b both profiles are named', /acp/.test(v.message) && /web/.test(v.message), v.message);
}

// ---- A6. A gate that is registered but not loadable is named as such ----
// dsh needs BOTH the plugin file and the cordis patch row; a file without a row
// is a plugin that never loads, which reads as installed in a directory listing.
{
  const v = adapterVerdict({
    harness: 'dsh',
    adapters: [{ path: '/h/.dsh/profiles/acp/plugins/tna-veto.mjs', state: 'unregistered' }],
  });
  check('A6 an unregistered dsh plugin is a warn', v.level === 'warn', JSON.stringify(v));
  check('A6b the message names the patch row', /cordis\.patch\.yml/.test(v.message), v.message);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
