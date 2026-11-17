#!/usr/bin/env node
/**
 * Fail-first: the done-gate must ENFORCE, not merely flag (Master 2026-11-17).
 *
 * Claude Code has a Stop hook that can block an unverified completion claim.
 * OpenCode V2 has no completion veto, but `session.execution.succeeded` fires
 * with the turn's messages available, and `ctx.session.prompt({delivery:'steer'})`
 * can re-enter the agent. A claim without an evidence tool therefore triggers
 * a correction turn — the agent cannot just stop on an unverified "done".
 *
 * Seams: doneEnforcementVerdict (pure) + plugin.setup(fake ctx) integration.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plug = (n) => new URL(`../.opencode/plugins/tna-gate/${n}`, import.meta.url);
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const mod = await import(plug('done-enforce.mjs')).catch(() => null);
check('E0 done-enforce module exists', !!mod && typeof mod.doneEnforcementVerdict === 'function');
if (mod && typeof mod.doneEnforcementVerdict === 'function') {
  const v1 = mod.doneEnforcementVerdict({ claim: 'selesai', evidence: false, correctionCount: 0, corrected: [] });
  check('E1 unverified claim triggers enforcement', v1.enforce === true, JSON.stringify(v1));
  const v2 = mod.doneEnforcementVerdict({ claim: 'selesai', evidence: true, correctionCount: 0, corrected: [] });
  check('E2 verified claim passes', v2.enforce === false, JSON.stringify(v2));
  const v3 = mod.doneEnforcementVerdict({ claim: 'selesai', evidence: false, correctionCount: 0, corrected: ['fp1'], fingerprint: 'fp1' });
  check('E3 same claim is not corrected twice', v3.enforce === false, JSON.stringify(v3));
  const v4 = mod.doneEnforcementVerdict({ claim: 'tuntas', evidence: false, correctionCount: 3, corrected: [] });
  check('E4 correction cap prevents a runaway loop', v4.enforce === false, JSON.stringify(v4));
  check('E5 correction prompt demands fresh verification', /verifikasi|verification/i.test(mod.CORRECTION_PROMPT ?? ''), mod.CORRECTION_PROMPT);

  const l1 = mod.doneEnforcementVerdict({ claim: 'selesai', evidence: true, modifiedFiles: true, ledgerTouched: false });
  check('E10 verified claim after file edits still needs ledger', l1.enforce === true && l1.kind === 'ledger', JSON.stringify(l1));
  const l2 = mod.doneEnforcementVerdict({ claim: 'selesai', evidence: true, modifiedFiles: true, ledgerTouched: true });
  check('E11 updated ledger releases the claim', l2.enforce === false, JSON.stringify(l2));
  check('E12 ledger correction names progress.txt', /progress\.txt/.test(mod.LEDGER_CORRECTION_PROMPT ?? ''), mod.LEDGER_CORRECTION_PROMPT);
}

// Integration: one unverified claim -> re-prompt + keyed instruction + audit.
{
  const proj = mkdtempSync(join(tmpdir(), 'tna-done-enforce-'));
  const { default: plugin } = await import(plug('index.js'));
  let prompts = [];
  let entries = [];
  const claimTurn = [
    { type: 'user', text: 'perbaiki bug' },
    { type: 'assistant', content: [{ type: 'text', text: 'Sudah selesai, beres.' }] },
  ];
  const verifiedTurn = [
    { type: 'user', text: 'perbaiki bug' },
    { type: 'assistant', content: [{ type: 'tool', name: 'shell', state: { status: 'completed' } }, { type: 'text', text: 'Selesai, terverifikasi.' }] },
  ];
  let messages = claimTurn;
  const events = [{ type: 'session.execution.succeeded', data: { sessionID: 'ses_enforce' } }];
  const store = new Map();
  await plugin.setup({
    location: { directory: proj },
    storage: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: { subscribe: () => (async function* () { for (const e of events) yield e; })() },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      list: async () => ({ data: [{ id: 'ses_enforce' }] }),
      context: async () => messages,
      prompt: async (p) => { prompts.push(p); },
      instructions: { entry: { put: async (p) => { entries.push(p); } } },
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  check('E6 unverified claim re-enters the agent loop', prompts.length === 1 && /verifik/i.test(prompts[0]?.text ?? ''), JSON.stringify(prompts.map((p) => p.text?.slice(0, 90))));
  check('E7 a keyed instruction is attached', entries.some((e) => e.key === 'tna-donegate'), JSON.stringify(entries));
  const logPath = join(proj, '.trust', 'tna-gate-log.jsonl');
  let log = '';
  try { log = readFileSync(logPath, 'utf8'); } catch {}
  check('E8 enforcement is audited separately from the flag', /opencode-v2-donegate-enforced/.test(log), log.slice(-200));

  // Second completion in the same session, now with evidence -> no new re-prompt.
  messages = verifiedTurn;
  events.push({ type: 'session.execution.succeeded', data: { sessionID: 'ses_enforce' } });
  await new Promise((r) => setTimeout(r, 500));
  check('E9 verified completion does not re-prompt', prompts.length === 1, `${prompts.length} prompts`);

  // A file-changing turn that claims done without touching progress.txt is
  // corrected too — ship-log discipline is now enforced, not just advised.
  // Separate setup: a fresh event stream for the file-editing turn.
  const store2 = new Map();
  const ledgerPrompts = [];
  await plugin.setup({
    location: { directory: proj },
    storage: { get: async (k) => store2.get(k), set: async (k, v) => store2.set(k, v) },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: { subscribe: () => (async function* () { yield { type: 'session.execution.succeeded', data: { sessionID: 'ses_ledger' } }; })() },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      list: async () => ({ data: [{ id: 'ses_ledger' }] }),
      context: async () => [
        { type: 'user', text: 'ubah file' },
        { type: 'assistant', content: [
          { type: 'tool', name: 'edit', state: { input: { file_path: 'src/x.ts' }, status: 'completed' } },
          { type: 'text', text: 'Sudah selesai diubah.' },
        ] },
      ],
      prompt: async (p) => { ledgerPrompts.push(p); },
      instructions: { entry: { put: async () => {} } },
    },
  });
  await new Promise((r) => setTimeout(r, 1500));
  check('E13 file edits + claim force a ledger correction', ledgerPrompts.length === 1 && /progress\.txt/.test(ledgerPrompts[0]?.text ?? ''), `${ledgerPrompts.length} prompts: ${JSON.stringify(ledgerPrompts.map((p) => p.text?.slice(0, 80)))}`);
}

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
