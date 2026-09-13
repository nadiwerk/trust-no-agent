#!/usr/bin/env node
/**
 * Fail-first test for the scheduled update-check core (spec: docs/specs/scheduled-update-check.md).
 * Zero dependencies. Run: node scripts/update-check.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = behavior drift.
 *
 * Seam: pure functions exported from update-check.mjs —
 *   resolveConfig({ projectsRoot, upstreamSource })          → config with defaults (spec AC 11)
 *   buildReport({ stamps, upstreamVersion, changelogText })  → report object/lines (spec AC 2,3,4,5)
 * The module never fetches; the caller supplies the changelog text —
 * the CLI wrapper (ticket 02) owns fetch + notification + log.
 */
import { buildReport, resolveConfig } from './update-check.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const CHANGELOG = `# Changelog

## [0.2.0] - 2026-09-10

### Added
- scheduled update-check reminder (issue spec: toast only when stale)

### Fixed
- audit ledger writer/reader date-header mismatch

## [0.1.13] - 2026-09-01

### Fixed
- site favicon from supplied logo

## [0.1.12] - 2026-08-20

### Fixed
- breakpoint interactive-first delivery
`;

// AC 2 — stale detection: every stale project named with stamped → upstream
{
  const r = buildReport({
    stamps: [
      { project: 'ads-tracker', version: '0.1.12' },
      { project: 'other-proj', version: '0.2.0' },
    ],
    upstreamVersion: '0.2.0',
    changelogText: CHANGELOG,
  });
  check('stale report has one stale line', r.lines.filter((l) => l.kind === 'stale').length === 1, JSON.stringify(r.lines));
  const s = r.lines.find((l) => l.kind === 'stale');
  check('stale line names project', s?.project === 'ads-tracker', JSON.stringify(s));
  check('stale line shows stamped → upstream', s?.text.includes('0.1.12 → 0.2.0'), s?.text);
}

// AC 3 — changelog entries between versions included; degrade when missing
{
  const r = buildReport({
    stamps: [{ project: 'ads-tracker', version: '0.1.12' }],
    upstreamVersion: '0.2.0',
    changelogText: CHANGELOG,
  });
  const entries = r.lines.find((l) => l.kind === 'changelog');
  check('changelog entries present', entries && entries.text.includes('scheduled update-check reminder'), JSON.stringify(entries));
  check('entries include only versions ABOVE the stamp', entries && !entries.text.includes('breakpoint interactive-first delivery'), JSON.stringify(entries));

  const r2 = buildReport({
    stamps: [{ project: 'ads-tracker', version: '0.1.12' }],
    upstreamVersion: '0.2.0',
    changelogText: '# Changelog\n\n(no release headings here)\n',
  });
  const deg = r2.lines.find((l) => l.kind === 'changelog');
  check('missing entries degrade honestly', deg && deg.text.includes('unreadable') && !deg.text.includes('0.1.12 →'), JSON.stringify(deg));
}

// AC 4 — all current: single line, no stale lines
{
  const r = buildReport({
    stamps: [{ project: 'trust-no-agent', version: '0.2.0' }],
    upstreamVersion: '0.2.0',
    changelogText: CHANGELOG,
  });
  check('all-current report is single current line', r.lines.length === 1 && r.lines[0].kind === 'current', JSON.stringify(r.lines));
  check('all-current marks silence for dispatch', r.notify === false, String(r.notify));
}

// AC 5 — fetch failure: failure line, no version claimed
{
  const r = buildReport({
    stamps: [{ project: 'ads-tracker', version: '0.1.12' }],
    upstreamVersion: null,
    fetchError: 'network unreachable',
    changelogText: null,
  });
  const f = r.lines.find((l) => l.kind === 'failure');
  check('failure line exists', !!f, JSON.stringify(r.lines));
  check('failure names the error', f?.text.includes('network unreachable'), f?.text);
  check('no stale lines on failure', !r.lines.some((l) => l.kind === 'stale'), JSON.stringify(r.lines));
  check('no version claimed', !r.lines.some((l) => /\d+\.\d+\.\d+/.test(l.text)), JSON.stringify(r.lines));
}

// AC 11 — config: defaults + overrides
{
  const def = resolveConfig({});
  check('default projectsRoot is home/projects', /[\\/]projects$/.test(def.projectsRoot), def.projectsRoot);
  check('default upstream is nadiwerk trust-no-agent changelog', def.upstreamUrl.includes('nadiwerk/trust-no-agent') && def.upstreamUrl.endsWith('CHANGELOG.md'), def.upstreamUrl);

  const over = resolveConfig({ projectsRoot: 'D:/code', upstreamUrl: 'https://example.com/CHANGELOG.md' });
  check('projectsRoot override accepted', over.projectsRoot === 'D:/code', over.projectsRoot);
  check('upstreamUrl override accepted', over.upstreamUrl === 'https://example.com/CHANGELOG.md', over.upstreamUrl);
}

// Upstream version extraction (feeds AC 2 — highest ## [x.y.z] heading)
{
  const r = buildReport({
    stamps: [],
    upstreamVersion: null,
    changelogText: CHANGELOG,
    extractUpstream: true,
  });
  check('upstream extracted from highest heading', r.upstreamVersion === '0.2.0', r.upstreamVersion);
}

console.log(failures === 0 ? '\nOK: all expectations hold' : `\nFAIL: ${failures} expectation(s) failed`);
process.exit(failures === 0 ? 0 : 1);
