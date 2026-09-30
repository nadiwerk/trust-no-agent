#!/usr/bin/env node
/**
 * Fail-first test for scripts/changelog-guard.mjs.
 *
 * The guard exists because a release step silently deleted a whole release
 * section TWICE (2026-09-30: `## [0.1.22]` then `## [0.1.23]`), and both were
 * noticed only because an unrelated slicing step could not find its anchor. A
 * check that merely re-asserts today's file is a rubber stamp, so every case
 * below reproduces a REAL corrupt shape — including the two incidents verbatim —
 * and the counter-direction that a sound file passes.
 *
 * Run: node scripts/changelog-guard.test.mjs   (exit 0 = all expectations hold)
 */
import { checkChangelog } from './changelog-guard.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// A minimal, structurally sound changelog: two releases, links at the tail.
const SOUND = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.1.2] - 2026-09-30',
  '',
  '### Fixed',
  '',
  '- something',
  '',
  '## [0.1.1] - 2026-09-29',
  '',
  '- earlier',
  '',
  '[Unreleased]: https://example.com/compare/v0.1.2...HEAD',
  '[0.1.2]: https://example.com/compare/v0.1.1...v0.1.2',
  '[0.1.1]: https://example.com/compare/v0.1.0...v0.1.1',
  '',
].join('\n');

// A1. The counter-direction: a sound file passes with zero errors. Without this,
// "always report" would satisfy every case below.
{
  const { errors, stats } = checkChangelog(SOUND);
  check('A1 a structurally sound changelog passes', errors.length === 0, JSON.stringify(errors));
  check('A2 it counts the releases and links it saw', stats.versions.length === 2 && stats.linkCount === 3, JSON.stringify(stats));
}

// B1. Incident #1, verbatim in shape: the `[Unreleased]:` link was replaced and
// swallowed the `## [0.1.2]` heading, leaving the link with no section.
{
  const broken = SOUND.replace('## [0.1.2] - 2026-09-30\n\n### Fixed\n\n- something\n\n', '');
  const { errors } = checkChangelog(broken);
  check('B1 a swallowed release section is reported as an orphan link',
    errors.some((e) => e.includes('compare link(s) with no release section') && e.includes('0.1.2')),
    JSON.stringify(errors));
}

// B2. The mirror case: a heading whose link was lost.
{
  const broken = SOUND.replace('[0.1.2]: https://example.com/compare/v0.1.1...v0.1.2\n', '');
  const { errors } = checkChangelog(broken);
  check('B2 a heading with no compare link is reported',
    errors.some((e) => e.includes('no compare link') && e.includes('0.1.2')),
    JSON.stringify(errors));
}

// C1. A duplicate `[Unreleased]` pair — how both incidents began.
{
  const broken = SOUND.replace('[Unreleased]: https://example.com/compare/v0.1.2...HEAD',
    '[Unreleased]: https://example.com/compare/v0.1.2...HEAD\n[Unreleased]: https://example.com/compare/v0.1.1...HEAD');
  const { errors } = checkChangelog(broken);
  check('C1 a duplicated [Unreleased] link is reported',
    errors.some((e) => e.includes('exactly one "[Unreleased]:" link')),
    JSON.stringify(errors));
}

// D1. A heading that drifts INTO the link block — the tail rule (this is the
// shape that makes an anchored edit able to swallow a section).
{
  const broken = SOUND.replace('[0.1.1]: https://example.com/compare/v0.1.0...v0.1.1',
    '## [0.1.1b]\n[0.1.1]: https://example.com/compare/v0.1.0...v0.1.1');
  const { errors } = checkChangelog(broken);
  check('D1 a heading inside the link block is reported (the block must sit at the tail)',
    errors.some((e) => e.includes('not at the tail')),
    JSON.stringify(errors));
}

// E1. Order: newest first is the writer contract; a band out of order is the
// early warning of a mis-placed insert.
{
  const broken = [
    '## [Unreleased]', '', '## [0.1.1] - 2026-09-29', '', '- a', '',
    '## [0.1.2] - 2026-09-30', '', '- b', '',
    '[Unreleased]: https://example.com/compare/v0.1.2...HEAD',
    '[0.1.2]: https://example.com/a', '[0.1.1]: https://example.com/b', '',
  ].join('\n');
  const { errors } = checkChangelog(broken);
  check('E1 out-of-order release headings are reported',
    errors.some((e) => e.includes('newest-first')),
    JSON.stringify(errors));
}

// F1. The REAL file in this repo must pass — the guard is wired to an artifact
// that exists, not to a fixture that only resembles one.
{
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, stats } = checkChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
  check('F1 the repo CHANGELOG passes the guard', errors.length === 0, JSON.stringify(errors));
  check('F2 the repo CHANGELOG has a release line to protect', stats.versions.length >= 20, 'releases=' + stats.versions.length);
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broke.` : '\nAll changelog-guard expectations hold.');
process.exit(failures ? 1 : 0);
