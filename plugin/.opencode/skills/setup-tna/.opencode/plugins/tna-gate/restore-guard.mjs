/**
 * restore-guard — the Claude `restore-tooling.sh` decision table as a pure
 * function, for the OpenCode SessionStart equivalent.
 *
 * Authority is git HEAD; the snapshot is only a fallback for a MISSING file.
 * "Disk differs from HEAD" is ambiguous (parallel checkout reverted it vs.
 * this session has uncommitted work) and must never be auto-overwritten —
 * measured 2026-11-16: the old restore hook deleted an uncommitted AGENTS.md
 * paragraph three times, with no conflict and no reflog entry. Hence the
 * asymmetry: refresh a stale snapshot, restore a missing file, WARN on dirty
 * disk, never guess.
 */
/** @returns {{action:'ok'|'restored'|'refreshed'|'warn'|'skip', reason:string}} */
export function restoreVerdict({ disk = null, head = null, snapshot = null } = {}) {
  if (snapshot === null || snapshot === undefined) return { action: 'skip', reason: 'no snapshot copy' };
  const same = (a, b) => a === b;
  if (disk === null || disk === undefined) return { action: 'restored', reason: 'file missing on disk' };
  if (same(disk, head)) {
    return same(disk, snapshot)
      ? { action: 'ok', reason: 'disk, HEAD and snapshot agree' }
      : { action: 'refreshed', reason: 'disk matches HEAD, snapshot is stale' };
  }
  if (same(snapshot, head)) return { action: 'warn', reason: 'disk differs from HEAD — could be uncommitted work; TIDAK disentuh' };
  return { action: 'warn', reason: 'disk differs from both HEAD and snapshot — TIDAK disentuh' };
}

/**
 * Better-than-Claude plan: Claude restore-tooling.sh copies the SNAPSHOT for a
 * missing file, which can be older than HEAD. HEAD is authoritative here; the
 * snapshot is only a fallback when git has no copy. The ambiguous "dirty disk"
 * case still produces no write at all.
 *
 * @returns {{action:string, reason:string, target:'disk'|'snapshot'|null, content:string|null}}
 */
export function restorePlan({ disk = null, head = null, snapshot = null } = {}) {
  const verdict = restoreVerdict({ disk, head, snapshot });
  if (verdict.action === 'restored') {
    return { ...verdict, target: 'disk', content: head ?? snapshot };
  }
  if (verdict.action === 'refreshed') {
    return { ...verdict, target: 'snapshot', content: disk };
  }
  return { ...verdict, target: null, content: null };
}
