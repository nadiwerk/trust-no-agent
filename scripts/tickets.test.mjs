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
import { join } from 'node:path';
import { validateDir } from './tickets.mjs';

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

if (failures) { console.error(`\nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: ticket-graph validator behaves as specified.');
