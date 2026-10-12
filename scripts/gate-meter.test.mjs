#!/usr/bin/env node
/**
 * Fail-first test for scripts/gate-meter.mjs — the gate-effectiveness meter
 * (spec: docs/specs/hardening-general.md, ticket 06-meter-doctor-warn, AC8).
 *
 * Zero dependencies. Run: node scripts/gate-meter.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = meter drift.
 *
 * Seam: three pure functions — parseVetoLog (JSONL veto-fire log),
 * parseTriggerTable (the evals/scenarios.md self-trigger evidence log), and
 * meterVerdict (the always-warn summary doctor prints). Fixtures are
 * hand-written literals from the spec's intent (AC8: the meter names TRIGGER
 * scores, veto-fire count, fake-detect count; absent sources read as "no
 * data yet", never as zero-proof and never as failure), never from running
 * the code.
 */
import { parseVetoLog, parseTriggerTable, meterVerdict } from './gate-meter.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Veto-fire log: JSONL, corrupt lines skipped, never a crash ----
{
  const text = [
    '{"ts":"2026-10-12T00:00:01.000Z","harness":"opencode","tool":"bash","command":"git commit -m x"}',
    'not json at all',
    '{"ts":"2026-10-12T00:00:02.000Z","harness":"claude","tool":"Bash","command":"git push origin master"}',
    '{"ts":"2026-10-12T00:00:03.000Z","harness":"opencode","tool":"bash","command":"rm -rf dist"}',
    '',
  ].join('\n');
  const r = parseVetoLog(text);
  check('A1 three parseable lines count three fires', r.fires === 3, JSON.stringify(r));
  check('A2 corrupt and empty lines are skipped, not counted', r.skipped === 2, JSON.stringify(r));
}
{
  const r = parseVetoLog('');
  check('A3 empty log reads zero fires without crashing', r.fires === 0 && r.skipped === 0, JSON.stringify(r));
}

// ---- B. Trigger table: TRIGGER rows parsed, INCOMPLETE rows left out ----
{
  const md = [
    '| Harness | Date | Loaded skills in description | Result |',
    '|---|---|---|---|',
    '| OMO (opencode) | 2026-09-02 | no | TRIGGER 0/9 (0/3 per task) |',
    '| DSH | 2026-09-05 | n/a | INCOMPLETE (prior 0/9 claim stands, unscored) |',
    '| ZCode | 2026-09-06 | no | TRIGGER 8/9 (receipts 3/3, root-cause 2/3) |',
  ].join('\n');
  const rows = parseTriggerTable(md);
  check('B1 two TRIGGER rows parsed', rows.length === 2, JSON.stringify(rows));
  check('B2 harness and score read from the row',
    rows.some((r) => /OMO/.test(r.harness) && r.score === '0/9') &&
    rows.some((r) => /ZCode/.test(r.harness) && r.score === '8/9'),
    JSON.stringify(rows));
  check('B3 INCOMPLETE rows are unmeasured, not zero-scored',
    !rows.some((r) => /DSH/.test(r.harness)), JSON.stringify(rows));
}

// ---- C. Verdict: always warn, names all three numbers, honest absences ----
{
  const v = meterVerdict({
    vetoFires: 3,
    fakeDetects: 1,
    triggerRows: [{ harness: 'ZCode', score: '8/9' }],
  });
  check('C1 the verdict is warn-level', v.level === 'warn', JSON.stringify(v));
  check('C2 the message names veto fires, fake detects, and trigger scores',
    /3/.test(v.message) && /fake/i.test(v.message) && /8\/9/.test(v.message), v.message);
  check('C3 the verdict is never fail (Master decision: meter absence is WARN)',
    v.level !== 'fail', JSON.stringify(v));
}
{
  const v = meterVerdict({ vetoFires: 0, fakeDetects: 0, triggerRows: [] });
  check('C4 empty sources read as no-data-yet, still warn, still not fail',
    v.level === 'warn' && /no data yet/i.test(v.message), v.message);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
