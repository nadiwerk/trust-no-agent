#!/usr/bin/env node
/**
 * Fail-first test for scripts/tickets.mjs (audit finding 3.1).
 * Zero dependencies. Run: node scripts/tickets.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = validator behavior drift.
 *
 * Seam: validateDir(dir) over .trust/<slug>/issues/<NN>-<slug>.md files
 * written in the fork-it <local-ticket-template> shape.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateDir } from './tickets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tickets.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const ticket = (nn, title, blockedBy) =>
`# ${nn} — ${title}

**What to build:** behavior for ${title}.

**Blocked by:** ${blockedBy}

**Status:** ready-for-agent

- [ ] criterion one
`;

const fixture = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'tickets-test-'));
  const dir = join(root, 'issues');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return { root, dir };
};
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

{ // 1. valid linear graph passes
  const { root, dir } = fixture({
    '01-first.md': ticket('01', 'first', 'None — can start immediately'),
    '02-second.md': ticket('02', 'second', '01'),
  });
  const res = validateDir(dir);
  check('valid graph has no errors', res.errors.length === 0, JSON.stringify(res.errors));
  cleanup(root);
}

{ // 2. dangling blocker fails
  const { root, dir } = fixture({
    '01-first.md': ticket('01', 'first', 'None — can start immediately'),
    '02-second.md': ticket('02', 'second', '09'),
  });
  const res = validateDir(dir);
  check('dangling blocker is an error', res.errors.some((e) => /09/.test(e) && /unknown|dangling|resolve/i.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 3. cycle fails
  const { root, dir } = fixture({
    '01-first.md': ticket('01', 'first', '02'),
    '02-second.md': ticket('02', 'second', '01'),
  });
  const res = validateDir(dir);
  check('cycle is an error', res.errors.some((e) => /cycle/i.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 4. self-dependency fails
  const { root, dir } = fixture({
    '01-first.md': ticket('01', 'first', '01'),
  });
  const res = validateDir(dir);
  check('self-dependency is an error', res.errors.some((e) => /self/i.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 5. dependency-order publication: blockers must come first (NN order)
  const { root, dir } = fixture({
    '01-second.md': ticket('01', 'second', '02'),
    '02-first.md': ticket('02', 'first', 'None — can start immediately'),
  });
  const res = validateDir(dir);
  check('blocker numbered after dependent is an error', res.errors.some((e) => /order/i.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 6. a ticket with NO acceptance criterion fails
  // Origin: 2026-09-27 cross-harness audit. fork-it's spec gate argues "a spec
  // that cannot be tested cannot be decomposed", and the ticket template makes
  // the criteria the ticket's body — but the validator only ever checked the
  // blocking graph. A ticket with zero criteria validated green, so a breakdown
  // could pass the one mechanical gate at the acceptance-criteria boundary with
  // the acceptance criteria missing entirely.
  const { root, dir } = fixture({
    '01-first.md':
`# 01 — first

**What to build:** behavior for first.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent
`,
  });
  const res = validateDir(dir);
  check('ticket with no acceptance criterion is an error',
    res.errors.some((e) => /criteri/i.test(e) && /01/.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 7. an unchecked placeholder checkbox does not count as a criterion
  // The template ships `- [ ] <criterion 1 — cited from the spec>`. A ticket
  // that was never filled in still parses as a list item, so the check must
  // reject the angle-bracket placeholder explicitly rather than counting
  // bullets.
  const { root, dir } = fixture({
    '01-first.md':
`# 01 — first

**What to build:** behavior for first.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] <criterion 1 — cited from the spec>
`,
  });
  const res = validateDir(dir);
  check('unfilled angle-bracket placeholder is not a criterion',
    res.errors.some((e) => /criteri/i.test(e)), JSON.stringify(res.errors));
  cleanup(root);
}

{ // 8. a real criterion passes, and so does a checked one
  const { root, dir } = fixture({
    '01-first.md':
`# 01 — first

**What to build:** behavior for first.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] AC1 — invalid input is rejected with 400 (spec §Acceptance Criteria 1)
- [x] AC2 — valid input returns 200
`,
  });
  const res = validateDir(dir);
  check('ticket with real criteria has no errors', res.errors.length === 0, JSON.stringify(res.errors));
  cleanup(root);
}

// --- CLI seam -------------------------------------------------------------
// Everything above exercises validateDir, which is why 35 suites stayed green
// while CI went red: the CLI's exit code was never under test. These blocks
// spawn the real CLI, because the CI gate runs the CLI, not the function.
const runCli = (cwd, args = []) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60000 });

const tree = (layout) => {
  const root = mkdtempSync(join(tmpdir(), 'tickets-cli-'));
  for (const rel of layout) mkdirSync(join(root, rel), { recursive: true });
  return root;
};

{ // 9. no .trust/ at all: exit 1, and say what to do about it
  const root = tree([]);
  const res = runCli(root);
  check('CLI exits 1 when the project has no ticket graphs',
    res.status === 1, `status=${res.status} out=${res.stdout} err=${res.stderr}`);
  check('CLI names the directory it looked in',
    res.stderr.includes(root), `err=${res.stderr}`);
  cleanup(root);
}

{ // 10. .trust/<slug>/issues/ exists but holds no tickets
  // The F2 fix replaced "no .trust -> silent OK" with "no .trust -> exit 1",
  // but the exit code was still driven by DIRECTORY existence, not by tickets
  // validated. An empty issues/ dir therefore printed
  // "OK: ticket graph valid in 1 directory." and exited 0 — a green receipt
  // for a graph that was never written. Intent, per F2: a check that validated
  // zero tickets must never report success.
  const root = tree([join('.trust', 'demo', 'issues')]);
  const res = runCli(root);
  check('CLI does not report OK when zero tickets were validated',
    res.status !== 0, `status=${res.status} out=${res.stdout} err=${res.stderr}`);
  check('CLI does not print a green OK line for an empty graph dir',
    !/^OK:/m.test(res.stdout), `out=${res.stdout}`);
  cleanup(root);
}

{ // 11. an explicitly named directory that does not exist
  // `dirs` was built from argv without an existence check on that path, so
  // `node scripts/tickets.mjs /nowhere` validated a phantom dir, found no
  // errors in it, and exited 0.
  const root = tree([]);
  const res = runCli(root, [join(root, 'nowhere')]);
  check('CLI exits 1 when an explicit issue dir does not exist',
    res.status === 1, `status=${res.status} out=${res.stdout} err=${res.stderr}`);
  cleanup(root);
}

{ // 12. a real graph found through .trust/<slug>/issues/ still exits 0
  // Guards against "make everything fail" as the fix: the happy path must stay
  // green through the same seam the failing cases use.
  const root = tree([join('.trust', 'demo', 'issues')]);
  writeFileSync(join(root, '.trust', 'demo', 'issues', '01-first.md'),
    ticket('01', 'first', 'None — can start immediately'));
  const res = runCli(root);
  check('CLI exits 0 for a valid graph discovered under .trust/',
    res.status === 0, `status=${res.status} out=${res.stdout} err=${res.stderr}`);
  check('CLI reports OK for a valid graph discovered under .trust/',
    /^OK:/m.test(res.stdout), `out=${res.stdout}`);
  cleanup(root);
}

if (failures) { console.error(`\nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: ticket-graph validator behaves as specified.');
