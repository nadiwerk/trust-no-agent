#!/usr/bin/env node
/**
 * Floor composer — bounded composition of canonical floor + overlay entries
 * (decision-composition ticket 02; spec AC4/AC5/AC6/AC7/AC10/AC13). Zero deps.
 *
 * The canonical session floor (Iron Laws + MANDATORY section) is emitted
 * VERBATIM and COMPLETE FIRST — overlays fill only the budget remainder. Each
 * entry is marked `user:` (second-class: may add steps, never relax a gate);
 * name collisions are namespaced, never shadowing canonical. Entries order
 * deterministically (anchor, then name). Entries that do not fit the budget
 * are returned as an omitted list — counted, never silently dropped.
 *
 * The budget guard mirrors the floor's existing bound (<4000 chars, pinned by
 * gate-hook.test E1); canonical-first means a broken or oversized registry can
 * never degrade the core discipline.
 *
 * Pure: no CLI (the roast's scope-creep finding — inspection happens through
 * the registry CLI, `node scripts/overlay-registry.mjs`).
 */
const HEADER = '## USER OVERLAYS (second-class: may add steps, never relax a gate)';

export function composeFloor({ canonicalFloor, overlays = [], budget = 4000 }) {
  // Carry {name, line} pairs: the omitted list reads the entry's own name,
  // never a regex round-trip over the line the composer itself built.
  const rows = [...overlays]
    .sort((a, b) => a.extends.localeCompare(b.extends) || a.name.localeCompare(b.name))
    .map((o) => ({
      name: o.name,
      line: [
        `- user:${o.name}`,
        o.extends ? `extends ${o.extends}${o.role ? ` (${o.role})` : ''}` : 'no anchor (explicit-only)',
        o.triggers && o.triggers.length ? `load when: ${o.triggers.join(', ')}` : null,
      ].filter(Boolean).join(' — '),
    }));

  let text = canonicalFloor;
  const omitted = [];
  if (rows.length) {
    let composed = `${canonicalFloor}\n\n${HEADER}\n`;
    for (const row of rows) {
      const candidate = `${composed}${row.line}\n`;
      if (candidate.length > budget) omitted.push(row.name);
      else composed = candidate;
    }
    // If even the header did not fit, the floor stays canonical — the core
    // discipline is never truncated to make room for an overlay.
    if (composed.length <= budget) text = composed;
    else omitted.push(...rows.map((r) => r.name));
  }
  return { text, omitted };
}
