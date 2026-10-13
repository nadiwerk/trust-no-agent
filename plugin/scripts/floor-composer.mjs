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
 * Run:  node scripts/floor-composer.mjs   (prints a demo composition)
 */
const HEADER = '## USER OVERLAYS (second-class: may add steps, never relax a gate)';

export function composeFloor({ canonicalFloor, overlays = [], budget = 4000 }) {
  const lines = [...overlays]
    .sort((a, b) => a.extends.localeCompare(b.extends) || a.name.localeCompare(b.name))
    .map((o) => `- user:${o.name} — extends ${o.extends} (${o.role}) — ${o.triggers && o.triggers.length ? `load when: ${o.triggers.join(', ')}` : 'explicit invocation only'}`);

  let text = canonicalFloor;
  const omitted = [];
  if (lines.length) {
    let composed = `${canonicalFloor}\n\n${HEADER}\n`;
    for (const line of lines) {
      const candidate = `${composed}${line}\n`;
      if (candidate.length > budget) omitted.push(line.match(/^- user:([^ ]+)/)[1]);
      else composed = candidate;
    }
    // If even the header did not fit, the floor stays canonical — the core
    // discipline is never truncated to make room for an overlay.
    if (composed.length <= budget) text = composed;
    else omitted.push(...lines.map((l) => l.match(/^- user:([^ ]+)/)[1]));
  }
  return { text, omitted };
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('floor-composer.mjs')) {
  const demo = composeFloor({
    canonicalFloor: 'RE-INJECTED ROUTER CORE: (demo canonical floor)',
    overlays: [
      { name: 'error-forensics', extends: 'root-cause/Phase-1', role: 'insert-after', triggers: ['error', 'crash'], dir: 'error-forensics' },
      { name: 'manual-only', extends: 'root-cause/Phase-1', role: 'wrap', triggers: [], dir: 'manual-only' },
    ],
  });
  console.log(demo.text);
  if (demo.omitted.length) console.log(`\nomitted by budget: ${demo.omitted.join(', ')}`);
}
