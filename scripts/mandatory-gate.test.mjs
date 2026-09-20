#!/usr/bin/env node
/**
 * Fail-first test for scripts/mandatory-gate.mjs — the mechanical pre-gate
 * classifier for MANDATORY skill routing (spec: docs/specs/mandatory-gate.md,
 * ticket 01-classifier-core).
 *
 * Zero dependencies. Run: node scripts/mandatory-gate.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = classifier or consistency drift.
 *
 * Seam: classifyTask(text) — a pure function taking a task's text and
 * returning the MANDATORY skill domains it touches. No I/O, no fixtures from
 * implementation output: expected verdicts are hand-written literals derived
 * from the spec's intent (spec §AC3/§AC4), never from running the code.
 *
 * Attribution: original implementation. The pattern (mechanical pre-gate over
 * model initiative) is the framework's own (docs/design.md self-trigger
 * evals); internal evaluation origin (ledger 2026-09-20) — no external code
 * or assets are used here.
 */
import { classifyTask, MANDATORY_DOMAINS, KEYWORD_TABLES } from './mandatory-gate.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Pure-function interface (spec §AC8) ----
{
  const v = classifyTask('commit this and push');
  check('A1 returns a plain object keyed by skill domain',
    v !== null && typeof v === 'object' && !Array.isArray(v));
  check('A2 verdict values are boolean',
    Object.values(v).every((x) => typeof x === 'boolean'));
  check('A3 all three MANDATORY domains are present in the verdict',
    MANDATORY_DOMAINS.length === 3 &&
    ['expect-fail', 'root-cause', 'receipts'].every((s) => s in v),
    JSON.stringify(v));
  check('A4 verdicts are fresh objects (no shared mutable state across calls)',
    classifyTask('') !== classifyTask(''));
}

// ---- B. Done-claim / commit domain → receipts (spec §AC1 domain, EN+ID) ----
{
  const cases = [
    'commit and push this',
    'this is done, shipped',
    'log it and create a PR',
    'selesai, commit ya',
    'sudah beres, tolong dicatat',
    'merged to master',
  ];
  for (const t of cases) {
    check(`B1 receipts domain matches: "${t}"`, classifyTask(t)['receipts'] === true);
  }
}

// ---- C. Test-writing domain → expect-fail (spec §AC3) ----
{
  const cases = [
    'write a test for the parser',
    'add unit tests for ledger-audit',
    'tulis test untuk modul X',
    'buat test dulu sebelum implementasi',
    'write a spec for this behavior',
  ];
  for (const t of cases) {
    check(`C1 expect-fail domain matches: "${t}"`, classifyTask(t)['expect-fail'] === true);
  }
}

// ---- D. Bug / failure domain → root-cause (spec §AC3) ----
{
  const cases = [
    'fix this bug in the reader',
    'the test is failing, why?',
    'error 500 on the audit route',
    'perbaiki bug ini',
    'audit selalu error setelah commit',
    'this regression broke the release',
  ];
  for (const t of cases) {
    check(`D1 root-cause domain matches: "${t}"`, classifyTask(t)['root-cause'] === true);
  }
}

// ---- E. Negative cases — no domain at all (spec §AC4) ----
{
  const cases = [
    'rename the variable',
    'refactor test helper',
    'update README',
    'ganti nama variabel',
    'perbaiki ejaan di dokumen',        // 'perbaiki' alone is not a bug task
    'the test runner documentation',     // mentions test, not test-writing
    '',
  ];
  for (const t of cases) {
    const v = classifyTask(t);
    check(`E1 no domain matches: "${t}"`,
      !MANDATORY_DOMAINS.some((s) => v[s]), JSON.stringify(v));
  }
}

// ---- F. Keyword-table ↔ test consistency (spec §AC5) ----
{
  // Every keyword must be exercised by a case in THIS file; otherwise the
  // table can grow untested (prose-only trigger drift, ticket 01 notes).
  const allCaseText = [
    'commit and push this', 'this is done, shipped', 'log it and create a PR',
    'selesai, commit ya', 'sudah beres, tolong dicatat', 'merged to master',
    'write a test for the parser', 'add unit tests for ledger-audit',
    'tulis test untuk modul X', 'buat test dulu sebelum implementasi',
    'write a spec for this behavior',
    'fix this bug in the reader', 'the test is failing, why?',
    'error 500 on the audit route', 'perbaiki bug ini',
    'audit selalu error setelah commit', 'this regression broke the release',
    'rename the variable', 'refactor test helper', 'update README',
    'ganti nama variabel', 'perbaiki ejaan di dokumen',
    'the test runner documentation', '',
    // Coverage-carrying cases for keywords the primary suites above don't hit:
    'write tests first', // expect-fail: write tests
    'make it test-first', // expect-fail: test-first
    'run the unit test suite', // expect-fail: unit test
    'ship it', // receipts: ship
    'merge the branch', // receipts: merge
    'catat ke ledger', // receipts: catat
    'a failure was observed', // root-cause: failure
    'debug the parser', // root-cause: debug
    'the app can crash', // root-cause: crash
    'why does this fail', // root-cause: why does
    'deploy to staging', // receipts: deploy
  ].join(' ').toLowerCase();
  const untested = [];
  for (const [skill, words] of Object.entries(KEYWORD_TABLES)) {
    for (const w of words) {
      // A keyword is "exercised" when at least one case text containing it
      // exists in this file (positive or negative coverage). Word-boundary
      // matched — a substring check would count "parser" as covering `pr`,
      // letting a keyword grow with no real test (roast finding 2026-09-20).
      const esc = String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const covered = new RegExp(`\\b${esc}\\b`, 'i').test(allCaseText);
      if (!covered) untested.push(`${skill}:${w}`);
    }
  }
  check('F1 every keyword in the tables appears in at least one case above',
    untested.length === 0, `untested: ${untested.join(', ')}`);
  check('F2 every domain has a non-empty keyword table',
    MANDATORY_DOMAINS.every((s) => Array.isArray(KEYWORD_TABLES[s]) && KEYWORD_TABLES[s].length > 0));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
