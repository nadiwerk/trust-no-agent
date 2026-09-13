#!/usr/bin/env node
/**
 * Scheduled update-check delivery layer — pure decisions, zero dependencies.
 * Spec: docs/specs/scheduled-update-check.md. Test: scripts/update-delivery.test.mjs
 * The CLI wrapper executes the chosen backend (PowerShell toast, osascript, notify-send)
 * and writes the formatted block to the log file; this module only decides and formats.
 */

/**
 * Choose how the report reaches the user (spec AC 1, 4, 10).
 * notify=false reports (all-current, failure) are always silent — logged, never popped.
 */
export function pickBackend({ platform, report }) {
  if (!report.notify) return { mode: 'silent', reason: 'report does not warrant a notification (all-current or failure)' };
  switch (platform) {
    case 'win32': return { mode: 'toast', reason: 'PowerShell ToastNotificationManager (prototype-verified)' };
    case 'darwin': return { mode: 'native', reason: 'osascript display notification' };
    case 'linux': return { mode: 'native', reason: 'notify-send when present; wrapper degrades to log-only' };
    default: return { mode: 'log-only', reason: 'no known notification backend for this platform' };
  }
}

/** Format the report as a dated log block (every mode writes this — spec AC 10). */
export function formatLog({ ranAt, notify, lines }) {
  const body = lines.map((l) => {
    if (l.kind === 'changelog') return `changelog entries:\n${l.text}`;
    return l.text;
  }).join('\n');
  return `=== update-check ${ranAt} ===\n${body}\n=== end ${ranAt} ===`;
}
