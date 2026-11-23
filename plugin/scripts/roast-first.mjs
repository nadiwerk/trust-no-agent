#!/usr/bin/env node
/**
 * roast-first — PreToolUse hook that makes review-before-commit mechanical on
 * measured churn sources.
 *
 * Origin: the adopter's `roast-gate` hook (ads-tracker), written after an audit
 * measured 5/7 non-fix commits followed by a fix within 72h — the dominant
 * cause was review running AFTER the commit. Ported harness-neutrally: the
 * churn-source list is opt-in config, not hardcoded, because which paths
 * churn is a measured fact of each project, not a framework constant.
 *
 * Contract (same anti-loop guards as done-enforce):
 *   - A `git commit` whose staged files touch a churn source is denied ONCE
 *     per staged-fileset fingerprint, with the instruction to run the review
 *     skill first. An identical retry passes — whether the agent actually
 *     reviewed is its accountability, auditable via the state file.
 *   - FAIL-OPEN on every error (no config, git absent, nothing staged,
 *     malformed payload): a guard that wedges the commit is worse than one
 *     that misses a check.
 *
 * Config:  <project>/.trust/roast-first.json   { "churnSources": ["src/sync/**", "drizzle/**"] }
 * State:   <project>/.trust/roast-first-state.json   { "fingerprints": ["<sha1>"] }
 * Absent config = inert (opt-in by measurement, not blanket).
 *
 * Hook wiring (Claude .claude/settings.json, PreToolUse on Bash|exec):
 *   node "${CLAUDE_PROJECT_DIR}/scripts/roast-first.mjs"
 * Reads the PreToolUse JSON payload from stdin; emits the documented deny
 * shape (`permissionDecision: "deny"`). Exit code always 0 — the verdict
 * lives in the JSON, never in a wedged hook.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const STATE_MAX_FINGERPRINTS = 50;

/** dir/**-style matcher: 'x/**' = prefix 'x/'; others are exact path. */
export function matchesChurn(path, pattern) {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3) + '/') : path === pattern;
}

/** sha1 of the sorted staged fileset — one correction per identical attempt. */
export function fingerprint(files) {
  return createHash('sha1').update([...files].sort().join('\n')).digest('hex');
}

/**
 * Pure verdict: should this staged fileset be denied once for review-first?
 * @returns {{block: boolean, matched: string[], fingerprint: string}}
 */
export function roastFirstVerdict({ stagedFiles, churnSources, seenFingerprints }) {
  const matched = stagedFiles.filter((f) => churnSources.some((p) => matchesChurn(f, p)));
  const fp = fingerprint(stagedFiles);
  return { block: matched.length > 0 && !seenFingerprints.includes(fp), matched, fingerprint: fp };
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const command = String(payload?.tool_input?.command ?? payload?.args?.command ?? '');
    if (!/\bgit\s+(?:-[a-zA-Z]\S*\s+)*commit\b/.test(command)) return;

    const cwd = payload.cwd || process.cwd();
    const config = readJson(join(cwd, '.trust', 'roast-first.json'), null);
    const churnSources = Array.isArray(config?.churnSources) ? config.churnSources : [];
    if (!churnSources.length) return;

    const staged = spawnSync('git', ['-C', cwd, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    if (staged.status !== 0) return; // fail-open: not a repo, no staging, git absent
    const stagedFiles = staged.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!stagedFiles.length) return;

    const statePath = join(cwd, '.trust', 'roast-first-state.json');
    const state = readJson(statePath, { fingerprints: [] });
    const { block, matched, fingerprint: fp } = roastFirstVerdict({
      stagedFiles, churnSources, seenFingerprints: state.fingerprints || [],
    });
    if (!block) return;

    state.fingerprints = [fp, ...(state.fingerprints || [])].slice(0, STATE_MAX_FINGERPRINTS);
    mkdirSync(join(cwd, '.trust'), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `roast-first: this commit touches measured churn sources (${matched.slice(0, 3).join(', ')}` +
          `${matched.length > 3 ? ` +${matched.length - 3} more` : ''}) — run the review skill ` +
          '(`roast-my-code`) BEFORE committing, not after. Audit-measured: 5/7 non-fix commits ' +
          'were followed by a fix within 72h because review ran post-commit. An identical retry ' +
          'is allowed — whether you reviewed is your accountability.',
      },
    }));
  } catch {
    // fail-open: malformed payload, fs errors — never wedge the commit
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
