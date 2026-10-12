#!/usr/bin/env node
/**
 * gate-meter — the gate-effectiveness meter (ticket 06, spec AC8).
 *
 * "Kuat" is measured, not asserted. Three pure functions over three honest
 * sources: parseVetoLog (the JSONL veto-fire log hooks append on every
 * denial), parseTriggerTable (the evals/scenarios.md self-trigger evidence
 * log — TRIGGER rows only; INCOMPLETE rows are unmeasured, never
 * zero-scored), and meterVerdict (the summary doctor prints). The verdict is
 * ALWAYS warn-level: a meter that fails the install when its own data is
 * absent would punish honesty about not knowing (Master decision 2026-10-12).
 * Absent sources read as "no data yet" in the message, never as proof of
 * zero and never as failure.
 *
 * Zero dependencies. Consumers: scripts/doctor.mjs (reads the three sources
 * beside the ledger and warns the verdict). Tested fail-first by
 * gate-meter.test.mjs.
 *
 * Attribution: original implementation. No external code or assets used.
 */

/**
 * @param {string} text raw JSONL log text (one denial per line)
 * @returns {{fires: number, skipped: number}} corrupt/empty lines skipped
 */
export function parseVetoLog(text) {
  let fires = 0;
  let skipped = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) { skipped++; continue; }
    try {
      const o = JSON.parse(line);
      if (o && typeof o === 'object' && typeof o.tool === 'string' && typeof o.command === 'string') fires++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  // An empty file holds zero lines of content: report zero, not one skip.
  if (String(text ?? '').trim() === '') return { fires: 0, skipped: 0 };
  return { fires, skipped };
}

/**
 * @param {string} md markdown text of the evidence log
 * @returns {Array<{harness: string, score: string}>} TRIGGER rows only
 */
export function parseTriggerTable(md) {
  const rows = [];
  for (const line of String(md ?? '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const m = /TRIGGER\s+(\d+\/\d+)/.exec(line);
    if (!m) continue; // INCOMPLETE and header rows carry no score
    const cells = line.split('|').map((c) => c.trim());
    rows.push({ harness: cells[1] || 'unknown harness', score: m[1] });
  }
  return rows;
}

/**
 * @param {{vetoFires?: number, fakeDetects?: number, triggerRows?: Array}} input
 * @returns {{level: 'warn', message: string}} always warn, never fail
 */
export function meterVerdict({ vetoFires = 0, fakeDetects = 0, triggerRows = [] } = {}) {
  const triggers =
    triggerRows.length
      ? triggerRows.map((r) => `${r.harness} ${r.score}`).join(', ')
      : 'TRIGGER scores: no data yet (no parsed battery rows)';
  const veto = vetoFires > 0 ? `${vetoFires} veto fire(s)` : 'veto fires: no data yet (no denials logged)';
  const fake = fakeDetects > 0 ? `${fakeDetects} fake-compliance finding(s)` : 'fake-compliance: none in window';
  return {
    level: 'warn',
    message:
      `gate meter — ${veto}; ${fake}; ${triggers} — ` +
      `a veto without a proof count and a "kuat" without a number are both assertions; ` +
      `this line is WARN-only by decision (a missing meter is a gap in knowledge, never an install defect)`,
  };
}
