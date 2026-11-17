/**
 * trust-no-agent gate for opencode V2 — veto irreversible tool calls without
 * fresh test evidence (spec: docs/specs/hardening-general.md, AC1; ported to
 * the V2 API in ticket 08, storage-backed after the live FS-write finding).
 *
 * V2 directory plugin (autoloaded from `.opencode/plugins/`): export default
 * `{ id, setup }`, hook via `ctx.tool.hook("execute.before", (input) => …)`
 * receiving ONE argument `{ tool, input }` (per the official V2 migration
 * guide + the live workflow-delegation plugin on this machine). Deny is by
 * throwing — proven live on opencode v2.0.27 (probe-4/5/6 denied, 2026-10-12).
 *
 * Evidence lives in `ctx.storage` (the only durable write a V2 hook has —
 * hook FS-writes vanish live, proven by the probe that wrote directly and
 * left no file). The project's `.trust/` FS copy is READ as the preferred
 * source (doctor + audit read the FS) but NEVER written from the hook.
 *
 * Thin adapter by design: the boundary is decideBefore's core
 * (scripts/tna-gate.mjs over ticket 01's action-gate); this file only maps
 * the V2 event shape + storage seam onto it — no discipline logic here.
 * Fail-closed is irreversible-only.
 */
import { decideBeforeWith, logVeto, logVetoWith, observeAfterWith } from './tna-gate.mjs';
import { doneGateVerdict } from './done-gate.mjs';
import { buildFloorFromRouter, resolveRouterDir, FLOOR_KEY } from './reinjection.mjs';
import { delegateVerdict } from './delegation-gate.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decoratePrompt } from './prompt-gate.mjs';
import { receiptVerdict } from './receipt-check.mjs';
import { matchesAnyCommand } from './action-gate.mjs';
import { restoreVerdict } from './restore-guard.mjs';
import { compressToolResult } from './chisle-hook.mjs';
import { makeStore } from './tna-store.mjs';

const require_ = createRequire(import.meta.url);
let chisle = null;
try {
  chisle = require_('./chisle/chisle-compress.js'); // vendored adapter (openCode compressForOpencode)
} catch {
  chisle = null; // compressor absent -> no compression, never break the pipeline
}

const RESTORE_PAIRS = [
  ['AGENTS.md', 'AGENTS.md'],
  ['ship-log.SKILL.md', '.claude/skills/ship-log/SKILL.md'],
  ['jev-guardrail.md', 'docs/agents/jev-guardrail.md'],
  ['codegraph-cli.md', 'docs/agents/codegraph-cli.md'],
];

export default {
  id: 'tna-gate',

  async setup(ctx) {
    const directory = ctx.location?.directory ?? process.cwd();
    const store = makeStore({ fsDir: directory, storage: ctx.storage });

    // Per-prompt MANDATORY routing (Claude `UserPromptSubmit` parity, 2026-11-17).
    // V2 prompt hooks receive a mutable draft before skill resolution; append
    // the flagged instruction once (the decorator is retry-safe via its marker).
    // Admission must never break because a classifier failed -> fail-open.
    let promptRegistration;
    try {
      promptRegistration = await ctx.session?.hook?.('prompt', (event) => {
        if (!event?.prompt || typeof event.prompt.text !== 'string') return;
        const decorated = decoratePrompt(event.prompt.text);
        if (decorated !== event.prompt.text) event.prompt.text = decorated;
      });
    } catch {
      /* no prompt hook on this service -> fail-open */
    }

    const registration = await ctx.tool.hook('execute.before', async (input) => {
      const tool = String(input?.tool ?? '');
      const args = input?.input && typeof input.input === 'object' ? input.input : {};

      // Receipt 4-block gate (Claude receipt-gate parity, 2026-11-17): the
      // Claude checker reads ~/.claude/projects and is blind in an OpenCode
      // session. Read the live session instead. Best-effort: an unreadable
      // session list means "not judgeable" — the evidence precondition below
      // still owns the irreversible action, so never break the tool call here.
      try {
        // Claude runs this ONLY on commands that EXECUTE an irreversible
        // action (gate-hook.mjs: matchesAnyCommand). Applying it to every tool
        // call would veto ordinary reads after a mid-turn "selesai" — a
        // regression no parity work should introduce.
        const command = String(args.command ?? args.description ?? '');
        if (matchesAnyCommand(command)) {
          const page = await ctx.session?.list?.({ directory, limit: 20 });
          const sessions = Array.isArray(page) ? page : (page?.data ?? []);
          const sessionID = sessions[0]?.id ?? sessions[0]?.sessionID;
          if (sessionID) {
            const messages = await ctx.session.context({ sessionID });
            const rv = receiptVerdict(messages ?? []);
            if (!rv.ok) {
              await logVetoWith(store, {
                harness: 'opencode-v2-receipt',
                tool,
                command,
              });
              throw new Error(`[tna-gate] receipt gate: the last turn lacks ${rv.missing.join(', ')} — close it with the 4 blocks before the next tool call`);
            }
          }
        }
      } catch (e) {
        if (String(e?.message ?? e).includes('receipt gate:')) throw e;
        /* unreadable session -> not judgeable, fail-open */
      }

      // Delegation gate (Gap 3, 2026-11-15): a delegation prompt without the
      // discipline block is a delegation without its guards — subagents never
      // read AGENTS.md, so the brief is the only path the rules reach them.
      // Deny by throwing (the proven opencode veto shape) and log it.
      const dv = delegateVerdict({ tool, args });
      if (!dv.allow) {
        await logVetoWith(store, {
          harness: 'opencode-v2-delegate',
          tool,
          command: String(args.description ?? ''),
        });
        throw new Error(`[tna-gate] ${dv.reason}`);
      }

      const v = await decideBeforeWith(store, { tool, args });
      if (!v.allow) {
        await logVetoWith(store, {
          harness: 'opencode-v2',
          tool,
          command: String(args.command ?? ''),
        });
        throw new Error(`[tna-gate] ${v.reason}`);
      }
    });

    // Evidence recorder: the after-event carries { tool, input:{command},
    // result:{output:{exit}, metadata:{exit}} } (shape proven live
    // 2026-10-12). Only an explicit exit code records — an unknown outcome
    // touches nothing, and recording never throws (it must not break the
    // session it observes).
    const afterRegistration = await ctx.tool.hook('execute.after', async (event) => {
      try {
        const tool = String(event?.tool ?? '');
        const input = event?.input && typeof event.input === 'object' ? event.input : {};
        // Chisle parity (2026-11-17): Claude cannot rewrite tool output from
        // PostToolUse; V2 execute.after CAN mutate event.result. The vendored
        // compressor already has an OpenCode adapter — this is the missing
        // call. Compression never throws and never touches Read-class tools.
        if (chisle?.compressForOpencode) {
          compressToolResult(event.result, tool, (text) => {
            try { return chisle.compressForOpencode(tool, text, {}); } catch { return null; }
          });
        }
        const exit = event?.result?.output?.exit ?? event?.result?.metadata?.exit;
        if (exit === undefined) return;
        await observeAfterWith(store, { tool, command: String(input.command ?? ''), pass: exit === 0 });
      } catch {
        /* recording/compression never breaks the session */
      }
    });

    // Done-gate layer (ported from the canonical done-receipt-gate Stop hook,
    // 2026-11-15): opencode V2 has no Stop hook, so we flag on `session.idle`
    // from the server event stream. A closing turn whose prose asserts
    // completion (same CLAIM_PATTERNS as the canonical gate) with NO evidence
    // tool call in the same turn is recorded in the veto log — the router's
    // done-gate layer is "flagged", and flagging must never break the session
    // it observes (every failure here is silent, like the recorder above).

    const controller = new AbortController();
    const idleLoop = (async () => {
      try {
        // NOTE (measured live 2026-11-15): the service ignores `types` here —
        // subscribe({types:[...]}) yields an EMPTY stream silently, while the
        // proven-working workflow-delegation plugin subscribes WITHOUT types
        // and filters client-side. Subscribe bare; the event.type guard below
        // does the filtering.
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            // Trigger surface (measured live 2026-11-15): service 2.2.6 never
            // emits `session.idle` (docs vocabulary); the observable end-of-turn
            // event is `session.execution.succeeded`. Accept both — the
            // classifier is the same either way.
            if (event?.type !== 'session.idle' && event?.type !== 'session.execution.succeeded') continue;
            const sessionID = event?.data?.sessionID ?? event?.properties?.sessionID;
            if (!sessionID) continue;
            const messages = await ctx.session.context({ sessionID });
            const v = doneGateVerdict(messages ?? []);
            if (v.claim && !v.evidence) {
              const entry = {
                harness: 'opencode-v2-donegate',
                tool: 'session.idle',
                command: `[${sessionID}] ${v.claim}`,
              };
              await logVetoWith(store, entry);
              // FS mirror, best-effort: storage is the proven durable surface,
              // but no public API reads plugin storage — the FS copy is what
              // doctor/audit/orchestrator can verify from outside. The vanish
              // finding was proven on HOOK callbacks; the event loop's FS
              // access is unmeasured, so this write is attempted and its
              // failure is silent (storage remains the source of truth).
              try {
                logVeto(directory, entry);
              } catch {
                /* mirror failure never breaks the session */
              }
            }
          } catch (e) {
            /* flagging never breaks the session */
          }
        }
      } catch (e) {
        /* event stream unavailable or aborted — fail-open */
      }
    })();

    // Re-injection layer (Gap 1, 2026-11-15): after compaction the router
    // floor (Iron Laws + MANDATORY) falls out of context and ledger
    // compensation relies on agent initiative — proven to fail silently.
    // When `session.compaction.ended` fires, rebuild the floor from the live
    // project router (never from memory) and attach it as a keyed session
    // instruction ('tna-floor') — entries render into instructions at the
    // next step boundary WITHOUT queuing a message turn. Sessions never
    // compacted pay nothing. Every failure degrades silently: no router ->
    // no entry; a half router still emits a floor that names the missing half.
    const routerDir = resolveRouterDir(directory);
    const reinjectLoop = (async () => {
      try {
        // Same bare-subscribe contract as the idle loop above (measured 2026-11-15).
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            if (event?.type !== 'session.compaction.ended') continue; // guard: a stream that ignores the types filter
            const sessionID = event?.data?.sessionID ?? event?.properties?.sessionID;
            if (!sessionID) continue;
            const floor = buildFloorFromRouter(routerDir);
            if (!floor) continue;
            await ctx.session.instructions?.entry?.put?.({ sessionID, key: FLOOR_KEY, value: floor });
            // FS mirror of the attach (measured 2026-11-15: event-loop FS
            // writes persist; no public API reads instruction entries, so
            // this is the externally verifiable audit artifact).
            try {
              logVeto(directory, {
                harness: 'opencode-v2-reinject',
                tool: 'session.instructions.entry.put',
                command: `[${sessionID}] tna-floor (${floor.length} chars)`,
              });
            } catch {
              /* mirror failure never breaks the session */
            }
          } catch (e) {
            /* re-injection never breaks the session */
          }
        }
      } catch (e) {
        /* event stream unavailable or aborted — fail-open */
      }
    })();

    // Restore-tooling guard (Claude SessionStart parity, 2026-11-17). The
    // Claude restore hook can silently overwrite an uncommitted router file;
    // its decision table is ported verbatim as restoreVerdict. OpenCode has
    // no restore hook to guard, so run the SAME decision at session start and
    // log WARN/restore-needed to the audit mirror — no auto-write from here,
    // because losing WIP is irreversible and a real revert is one git away.
    const restoreLoop = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            if (event?.type !== 'session.created') continue;
            for (const [snapshotRel, dstRel] of RESTORE_PAIRS) {
              try {
                const snapshot = readFileSync(join(directory, '.trust', 'keep', snapshotRel), 'utf8');
                let disk = null;
                try { disk = readFileSync(join(directory, dstRel), 'utf8'); } catch { /* missing */ }
                let head = null;
                try {
                  head = execFileSync('git', ['show', `HEAD:${dstRel}`], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                } catch { /* no HEAD copy -> snapshot is the only source */ }
                const v = restoreVerdict({ disk, head, snapshot });
                if (v.action === 'warn' || v.action === 'restored') {
                  logVeto(directory, {
                    harness: 'opencode-v2-restore',
                    tool: dstRel,
                    command: `${v.action}: ${v.reason}`,
                  });
                }
              } catch {
                /* one file's check never breaks the loop */
              }
            }
          } catch {
            /* per-event failure never breaks the loop */
          }
        }
      } catch {
        /* event stream unavailable — fail-open */
      }
    })();

    return () => {
      controller.abort();
      registration?.dispose?.();
      afterRegistration?.dispose?.();
      promptRegistration?.dispose?.();
      idleLoop?.catch?.(() => {});
      reinjectLoop?.catch?.(() => {});
      restoreLoop?.catch?.(() => {});
    };
  },
};
