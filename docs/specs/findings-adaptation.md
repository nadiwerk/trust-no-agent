# Spec: findings adaptation — eval contract, brief execution window, autonomy decay, stale-probe, local judgment

Status: published (approved Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: external agent-discipline corpus research (6 synthesis files in
`.trust/coworker-research/`, 4 parallel digests) + breakpoint 2026-10-13
(adopted: eval-contract, J2, ladder, stale-probe, K6/K9; no-Jev-API article
not found, K6/K9 pattern approved instead).

## Problem Statement

Sebagai pemilik trust-no-agent, saya mau pelajaran teruji dari korpus riset
eksternal (344 temuan, evals, memory, Jev, harness) masuk ke framework —
bukan sebagai kutipan, melainkan sebagai mekanisme dengan gigi: kontrak eval
yang memisahkan tuning dari pelaporan, brief delegasi yang membawa perintah
verifikasi eksak, tangga otonomi yang meluruh, probe memori basi, dan
judgment murah-tanpa-API.

## Solution

Adopsi lima transfer, masing-masing dengan batas mekanisnya: kontrak eval
(dev/test split, negatives, failure tags), brief delegasi 9-field J2,
tangga otonomi per harness dengan decay, probe re-verifikasi memori basi,
dan pola judgment K6/K9 (deterministik dulu, model-judge terakhir, tanpa API key).

## User Stories

1. As a maintainer tuning evals, I want dev/test fixtures physically split,
   so that reported numbers are never tuned numbers (K2).
2. As a maintainer reading a failure, I want every run tagged infra vs agent
   fault, so that harness outages never masquerade as model failures
   (K12–K14 pattern).
3. As a maintainer guarding quality, I want must-not-fire negatives at ~half
   the suite, so that a gate that cannot stay silent is caught (K3–K5).
4. As an orchestrator delegating, I want VERIFY-exact-command + TIMEBOX +
   partial-return in every brief (J2), so that delegates return checkable
   work, not narration.
5. As an adopter on any harness, I want staged autonomy (audit-only →
   veto-proven → trusted) with decay, so that old proofs never grant
   permanent trust (M1/M2, L9).
6. As a maintainer, I want stale lessons re-verified against current
   behavior (D11 as a real check), so that dead memory cannot gate live work.
7. As a maintainer needing cheap judgment, I want deterministic/code-first
   verdicts with a model judge only as last resort and no API key (K6/K9),
   so that bounded decisions stay fast and free.
8. As a maintainer, I want pass@k + reliability reporting on repeated runs,
   so that capability and flakiness are never conflated (K12–K14).

## Decisions Already Made

- Adopted (breakpoint ronde 1): eval-contract, J2 brief, autonomy ladder,
  stale-memory probe — plus K6/K9 local-judgment pattern (ronde 2).
- Not adopted: Jev model-slot usage, auto-downgrade paths, uncalibrated
  scores, Likert verdicts, agent self-grading, second graph system.
- Evidence base: `.trust/coworker-research/*.md` (jev harness loop graph
  memory evals); the alleged no-API Jev article was not found — proceeded
  on K6/K9 instead, honestly recorded.
- Shape: five vertical slices, one per transfer; shared research already
  done (this spec's Origin), not repeated per ticket.

## Testing Decisions

- What counts as a good test: exit codes + marker presence + strip/mutation
  dances on real files — presence assertions alone are theater (repo
  doctrine, proven across tickets 01–08).
- Modules (seams, existing only): eval marker checks, doctor verdicts, the
  delegation prompt shape, lessons tier, verdict composition fns. New seams
  only where no existing seam reaches (stale-probe runner, ladder state).
- Prior art: checks 35–38 + pins, K8 call-marker, W-suffix wiring suites,
  G-suffix strip loops, live CLI derivations.

## Constraints

- Zero new runtime dependencies; Node builtins only.
- No model-judgment API keys anywhere in the framework (K6/K9 decision).
- No second graph/memory/eval system beside the existing ledger, ticket
  DAG, and eval tiers — extend, never duplicate.
- Every transfer ships its RED proof (strip/mutation/live) in-session.
- Iron Law 4: publish + landings wait for Master.

## Acceptance Criteria

1. (US1) Fixture dev/test terpisah fisik + check menolak tuning di angka
   lapor — automated test (marker + layout).
2. (US2) Setiap run eval bertag infra vs agent fault — automated test
   (bentuk verdict + counter both directions).
3. (US3) Suite negatives ~separuh + gate yang tak bisa diam tertangkap —
   automated test (rasio + must-not-fire case merah).
4. (US4) Brief delegasi membawa VERIFY-exact-cmd + TIMEBOX + partial —
   automated test (marker template + satu contoh terisi).
5. (US5) Tangga otonomi per harness + decay berlaku — automated test
   (status basi → turun tingkat, bukan bertahan).
6. (US6) Probe memori-basi berjalan + pelajaran mati tak bisa gate —
   automated test (pelajaran basi vs perilaku kini).
7. (US7) Judgment bounded tanpa API key + model-judge terakhir —
   automated test (zero-dep + urutan deterministic-dulu).
8. (US8) Laporan pass@k + reliabilitas + flakiness — automated test
   (bentuk laporan + run berulang deterministik).

## Out of Scope

- Jev API / model-slot judgment / kalibrasi model (ditolak eksplisit).
- Retrieval semantik ledger (ditunda sampai skala nyata).
- Adapter harness baru (track 07/08).
- Ubah severity WARN/FAIL yang sudah diputus.

## Open Questions

- Ambang "separuh" negatives: tepat 50% atau rentang?
- Batas peluruhan tangga (berapa hari tanpa bukti)?
- Format verdict probe stale-memory: finding baru atau reuse lesson-gap?

## Adversarial self-review

- Ambiguity: "terpisah fisik" → DIPERJELAS: direktori dev/ vs test/ berbeda,
  bukan flag.
- Contradiction: US7 (tanpa API) vs judge-terakhir → BUKAN kontradiksi:
  judge-terakhir = model sesi yang sama, bukan API luar; tanpa itu pun
  deterministic harus cukup untuk gate.
- Hidden assumption: harness mendukung run berulang murah → DINYATAKAN di
  Constraints? Belum — PINDAH ke Open Questions bila implementasi butuh.
  (Dicatat di sini agar tak hilang.)
- Untestable: "defense in depth" → Dihindari; tiap AC di atas gagal-tuntas
  (marker hilang / rasio turun / status basi bertahan).
