# Spec: hardening-general — enforcement mekanis di luar prose

Status: published (approved Master 2026-10-12) — awaiting fork-it
Date: 2026-10-12
Origin: keluhan Master (model melanggar gates/iron wall/receipt, pura-pura patuh) + 3 retakan struktural di foto (numpang API mati, word-gate, tanpa meter) + pola fail-closed worker Omo. Breakpoint 6 keputusan 2026-10-12.

## Problem Statement

Sebagai Master, saya kesal model bisa mengabaikan gates, iron wall, dan receipt — disiplin dan receipt tidak berjalan sesuai filosofi trust-no-agent (don't trust anyone, even themselves), dan model bisa berpura-pura iyain (tulis Loaded:, verdict yes) tapi tetap melanggar. TNA hari ini kuat sebagai checklist audit, lemah sebagai penjamin: enforcement menumpang API mati, gate menghukum kata bukan aksi, dan tidak ada yang mengukur gate-nya sendiri.

## Solution

Ubah lapisan enforcement dari advisory text menjadi mekanis di batas aksi, per-harness adapter, dengan bukti observabel dan meter efektivitas. Core tetap harness-agnostic; yang per-harness hanya adapter veto/audit. Kata ("done") hanya sinyal; yang diblokir/diaudit adalah aksi tanpa bukti (commit/push tanpa test fresh, klaim Loaded:/receipt tanpa evidence).

## User Stories

1. As an adopter on opencode V2, I want irreversible tool calls (git commit/push, publish, delete, destructive migration) blocked without sign-off + fresh evidence, so unverified work cannot reach shared systems.
2. As an adopter on Claude Code, I want the same guarantee via the Claude hook surface, so the promise holds outside opencode.
3. As an adopter on Codex, I want the same via codex.hooks.json, so the promise holds there too.
4. As an adopter on OMO, I want the delegation contract to use load_skills where it exists and the inline+veto fallback elsewhere, so enforcement never depends on one dead API.
5. As an adopter on omp/Devin (doc-first), I want the adapter documented with WARN degrade until live proof exists, so I know what I am getting.
6. As a maintainer, I want Loaded: + receipt verdicts cross-checked against observable evidence (tool log / test output / diff ref), so fake compliance becomes a countable finding.
7. As a maintainer, I want the word-gate augmented by an action-gate (tool name + args) and an evidence-gate, so saying "done" is never punished but acting without evidence is.
8. As a maintainer, I want a gate-effectiveness meter (per-harness TRIGGER S13 scores, veto-fire log, fake-detect count) surfaced in doctor, so "kuat" is measured, not asserted.
9. As a maintainer, I want eval check 6b revised from the literal load_skills string to the adapter contract, so CI enforces the new boundary instead of the dead API.
10. As an adopter, I want per-harness install docs stating veto vs audit-only per action, so the guarantee is legible before I rely on it.

## Decisions Already Made

- Scope: semua harness live (OMO, Claude Code, Codex, opencode V2) + omp + Devin doc-first WARN (breakpoint R1+R2, 2026-10-12).
- Fail-closed boundary: hanya aksi irreversible; write/edit biasa tetap fail-open.
- Anti-pura-pura-patuh: Loaded: + verdict 5-boolean wajib bukti observabel; klaim tanpa bukti = finding.
- Meter: doctor WARN saja bila meter mati; tidak pernah FAIL CI (keputusan Master).
- Eval 6b: direvisi ke kontrak adapter (bukan literal load_skills).
- Omp/Devin: doc-first, degrade WARN sampai live proof ada.

## Testing Decisions

- What counts as a good test: verdicts on observable inputs (tool-call fixtures, ledger-entry texts, hook manifests, router prose markers) — never narration, never implementation details.
- Modules (seams, minimal, tertinggi yang ada):
  - Seam A (baru): action-gate pure fn over tool calls (tool, args, state) — zero deps.
  - Seam B (ada): auditLedger() + finding baru fake-compliance — extend, bukan modul baru.
  - Seam C (ada): doctor-checks (gateVerdict/hookVerdict + verdict meter baru) — extend.
  - Seam D (baru): plugin opencode tool.execute.before/after + state file — fixture-driven.
- Prior art: mandatory-gate.test.mjs, ledger-audit.test.mjs, doctor.test.mjs, gate-hook.test.mjs (pola pure-fn + RED/GREEN + boundary-matched consistency).

## Constraints

- Core harness-agnostic; yang per-harness hanya adapter. Tidak ada logika disiplin di dalam adapter selain veto/audit wiring.
- Fail-closed hanya untuk irreversible (commit, push, publish, delete, destructive migration). Write/edit biasa fail-open.
- Setiap temuan baru (termasuk fake-compliance) warn-level; meter mati = WARN, tidak FAIL.
- Scripts: zero runtime deps, Node builtins only. Plugin: JS only, tanpa dep baru.
- Tidak ada hard requirement pada string literal load_skills di mana pun kecuali sebagai satu adapter yang tersedia.
- Omp/Devin: doc-first, degrade WARN; tidak ada klaim hostable/live sebelum bukti live.
- Security: state file lokal saja (.trust/, gitignored), tanpa secret, tanpa exfil; veto melempar Error beralasan, tidak pernah blok diam-diam.
- Prose + check (encode-twice): setiap kontrak baru di atas dikawal satu eval check HARD.

## Acceptance Criteria

1. (US1) Tool-call fixture `bash git commit` tanpa test-pass fresh di state file DITOLAK plugin opencode (throw) — automated test.
2. (US2) Manifest hooks Claude memuat guard PreToolUse-equivalent untuk aksi yang sama — automated test (parse manifest + guard present) + human verification live.
3. (US3) codex.hooks.json memuat guard yang sama — automated test + human verification live.
4. (US4) AGENTS.md §5 menamai adapter matrix dan tidak lagi mensyaratkan literal load_skills sebagai satu-satunya jalan — automated test (eval check revisi).
5. (US5) compatibility.md + installation.md menandai omp/Devin doc-first WARN dengan catatan degrade — automated test (marker check).
6. (US6) Ledger entry berisi `Loaded: receipts` + verdict all-yes TANPA referensi test output/diff menghasilkan temuan fake-compliance — automated test (RED sebelum, GREEN sesudah).
7. (US7) Prompt berisi kata "done" tanpa aksi tool menghasilkan TIDAK ada temuan; tool commit tanpa evidence menghasilkan temuan — automated test.
8. (US8) Doctor mencetak meter (skor TRIGGER, veto-fire count, fake-detect count) sebagai WARN dan exit 0 saat meter absen — automated test.
9. (US9) Eval check 6b revisi FAIL saat kontrak adapter dihapus dan PASS saat dipulihkan (RED/GREEN proof) — automated test.
10. (US10) Tabel install per-harness menyatakan veto vs audit-only per aksi — human verification (baca tabel docs).

## Out of Scope

- Varian B (model-judgment/probability classifier), network call, API key.
- Memblokir semua write/edit; fail-closed di luar irreversible.
- FAIL CI untuk meter mati (diputuskan WARN saja).
- Live proof omp/Devin (doc-first dulu).
- Git hook baru di luar yang sudah ada.

## Open Questions

- Nama pasti hook surface Devin (riset docs, fakta agen — bukan tebakan).
- Skema final state file (nama field, rotasi veto-fire log).
- Ambang bulk vs flat untuk temuan fake-compliance di doctor (ikut pola BULK_THRESHOLD atau flat).

## Adversarial self-review

- Ambiguity: "fresh evidence" → DIPERJELAS di Constraints + AC1/AC6 (test-pass di sesi/state yang sama, bukan run lama).
- Contradiction: "semua harness" vs "omp/Devin doc-first" → DIPERJELAS (semua = cakupan, doc-first = tingkat garansi; tabel install membedakan veto vs audit-only).
- Hidden assumption: state file ada sebelum veto pertama → DINYATAKAN (plugin membuat state bila absen, veto membaca absen sebagai "no evidence" = tolak untuk irreversible).
- Untestable: AC2/AC3 "human verification live" → DIPERTAHANKAN sebagai second check di samping automated manifest test (bukan satu-satunya check).
