#!/usr/bin/env node
/**
 * Scheduled update-check core — pure functions, zero dependencies.
 * Spec: docs/specs/scheduled-update-check.md. Test: scripts/update-check.test.mjs
 * Detection and reporting only: nothing here installs, copies, or stamps.
 * The CLI wrapper (ticket 02) owns fetch, notification, and log writing.
 */

/** Resolve check configuration: defaults per spec AC 11, overridable by the installer. */
export function resolveConfig({ projectsRoot, upstreamUrl } = {}) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return {
    projectsRoot: projectsRoot || `${home.replace(/[\\/]+$/, '')}/projects`,
    upstreamUrl: upstreamUrl || 'https://raw.githubusercontent.com/nadiwerk/trust-no-agent/master/CHANGELOG.md',
  };
}

/** Highest `## [x.y.z]` heading in a CHANGELOG text, or null. */
export function upstreamFromChangelog(changelogText) {
  const m = (changelogText || '').match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}

/**
 * Build the report from already-resolved inputs (spec AC 2–5).
 * Returns { upstreamVersion, notify, lines: [{ kind, project?, text }] }.
 * notify=false ⇒ the delivery layer stays silent (no toast/banner).
 */
export function buildReport({ stamps = [], upstreamVersion, changelogText, fetchError, extractUpstream = false } = {}) {
  const lines = [];
  let version = upstreamVersion;

  if (fetchError) {
    // AC 5: report the failure, claim no version, compare nothing.
    lines.push({ kind: 'failure', text: `upstream check failed: ${fetchError} — no version claimed, do not guess` });
    return { upstreamVersion: null, notify: false, lines };
  }

  if (extractUpstream && !version) version = upstreamFromChangelog(changelogText);

  if (!version) {
    lines.push({ kind: 'failure', text: 'upstream latest: NOT FOUND (CHANGELOG heading missing) — no version claimed' });
    return { upstreamVersion: null, notify: false, lines };
  }

  const stale = stamps.filter((s) => (s.version || '') !== version);
  if (stale.length === 0) {
    // AC 4: one honest line, silence at the OS delivery layer.
    return { upstreamVersion: version, notify: false, lines: [{ kind: 'current', text: `all installs current (upstream ${version})` }] };
  }

  for (const s of stale) {
    // AC 2: every stale project named with stamped → upstream delta.
    lines.push({ kind: 'stale', project: s.project, text: `${s.project}: ${s.version || '(unstamped)'} → ${version}` });
  }

  // AC 3: CHANGELOG entries between the stamped version and upstream.
  const oldest = stale.map((s) => s.version).sort(compareVersions)[0];
  lines.push({ kind: 'changelog', project: stale[0].project, ...changelogEntries(changelogText, version, oldest) });

  return { upstreamVersion: version, notify: true, lines };
}

/** Entries from the top heading down to (excluding) the given version. */
function changelogEntries(changelogText, upToVersion, fromVersion) {
  if (!changelogText) return { text: 'CHANGELOG unreadable — entries not available' };
  const sections = changelogText.split(/^## \[/m).slice(1);
  if (sections.length === 0) return { text: 'CHANGELOG entries unreadable between versions — showing delta only' };
  let out = '';
  for (const section of sections) {
    const ver = section.match(/^(\d+\.\d+\.\d+)\]/)?.[1];
    if (!ver) continue;
    if (compareVersions(ver, upToVersion) > 0) continue;
    if (fromVersion && compareVersions(ver, fromVersion) <= 0) break;
    out += `## [${section.split('\n').slice(0, 200).join('\n').trim()}\n`;
  }
  if (!out.trim()) return { text: `CHANGELOG entries unreadable between ${fromVersion} and ${upToVersion} — showing delta only` };
  return { text: out.trim() };
}

/** Compare dotted versions numerically; non-semver strings sort by string. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
