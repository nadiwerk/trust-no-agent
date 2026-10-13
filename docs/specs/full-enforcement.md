# Spec: full enforcement — block-total, fail-closed, every harness

Status: published (approved Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: Master demand — trust-no-agent must not be ignorable text; when fully
installed, discipline holds without defiance. Breakpoint 2026-10-13 (2 rounds,
frontier empty). Builds on hardening-general 01–08 (proven live on opencode
v2.0.27) and newcomer-escalation 01–03.

## Problem Statement

Sebagai pemilik framework, saya mau trust-no-agent yang terinstall penuh di
berbagai project berdisiplin 100% — bukan instruksi teks yang dibaca lalu
diabaikan model saat tertekan. Hari ini enforcement-nya menumpang API yang
bisa mati, gate menghukum kata bukan aksi, dan tiap harness punya tingkat
garansi berbeda tanpa ada yang memaksa level tertinggi.

## Solution

Naikkan semua harness ber-adapter ke veto fail-closed yang terbukti live,
tolak merge yang melanggar di CI, dan nyatakan jujur per harness mana yang
terjamin veto vs audit-only. Ragu = blokir; klaim tanpa bukti live = proposal,
bukan garansi.

## User Stories

1. As an adopter on opencode V2, I want irreversible calls blocked without
   fresh evidence on every install (not just this repo), so that the proven
   veto travels with the framework.
2. As an adopter on Claude Code, I want the PreToolUse exit-2 veto proven
   live (not assumed from docs), so that the guarantee is measured.
3. As an adopter on Codex, I want the PreToolUse forwarding proven live, so
   that the hooks file is more than a declaration.
4. As an adopter on OMO, I want a veto adapter or a written reason why
   audit-only is the ceiling, so that the gap is owned, not silent.
5. As an adopter on omp/Devin, I want adapters or dated live-proof plans, so
   that doc-first WARN has an expiry, not an eternity.
6. As a maintainer, I want CI to refuse merges that violate the boundary
   (failing gate = red build), so that main stays the proven line.
7. As a maintainer, I want fail-closed semantics pinned (doubt blocks, with
   the reason surfaced), so that no adapter quietly degrades to fail-open.
8. As a maintainer, I want the per-harness guarantee table to fail CI when a
   row claims veto without a live proof attached, so that the table cannot
   inflate itself.

## Decisions Already Made

- "100%" = block-total: veto blocks every irreversible attempt without
  evidence (breakpoint ronde 1).
- Scope: all harnesses — opencode, Claude, Codex, OMO, omp, Devin (ronde 1).
- Fail-closed on doubt, with the reason surfaced (ronde 1).
- Gates run both locally (hooks) and in CI (ronde 2).
- Blocked package: commit/push/publish/delete/destructive migration (ronde 2).
- Honest per harness: 100% claimed only where an adapter with live proof
  exists (ronde 2).

## Testing Decisions

- What counts as a good test: live denial/allow runs on the real harness
  plus fixture suites that fail when wiring is removed (mutation/strip
  dances, not presence assertions).
- Modules (seams, existing only): the per-harness hook CLIs (gate-hook,
  tna-gate plugin), eval marker checks, the CI workflow + pre-commit hooks,
  the doctor meter (veto-fire counts as the proof stream).
- Prior art: probe-4–8 live runs (deny + allow), W2 mutation probe, check
  35/36/37 strip dances, K8 call-marker pattern.

## Constraints

- Zero new runtime dependencies; Node builtins only.
- Same boundary everywhere (irreversible package); adapters differ, the line
  does not.
- No veto without a live proof attached; assumed contracts stay labeled
  assumed until a run proves them.
- Fail-closed never swallows the reason — every denial names the missing
  evidence and the way to open the gate.
- Iron Law 4: publish + landings wait for Master.

## Acceptance Criteria

1. (US1) Veto opencode terpasang dari install standar (bukan hanya repo
   ini) — automated test (instalasi bersih + live denial fixture).
2. (US2) PreToolUse Claude terbukti memblokir live — human verification
   (live run) + automated test (manifest + exit-2 suite).
3. (US3) Forwarding Codex terbukti live — human verification + automated test.
4. (US4) OMO: adapter veto ATAU alasan tertulis kenapa audit-only plafonnya
   — human verification (baca keputusan).
5. (US5) omp/Devin: adapter ATAU rencana live-proof ber-tanggal — human
   verification.
6. (US6) CI merah saat boundary dilanggar — automated test (pipeline fixture
   atau mutation: hapus wiring → build merah).
7. (US7) Ragu = blokir + alasan tampil — automated test (bentuk tak dikenal
   → deny, bukan allow-diam).
8. (US8) Tabel garansi gagal CI bila baris veto tanpa bukti live — automated
   test (eval marker: tiap baris veto menautkan bukti).

## Out of Scope

- Harness di luar enam yang diputus (ronde 1).
- Aksi di luar paket irreversible (ronde 2).
- Mengubah severity WARN/FAIL doctor yang sudah diputus.

## Open Questions

- Urutan eksekusi per harness (paralel vs satu per satu)?
- Batas waktu live-proof omp/Devin sebelum barisnya diturunkan?

## Adversarial self-review

- Ambiguity: "terinstall penuh" → DIPERJELAS: router + skills + hooks +
  doctor hijau di proyek adopter (post-install verification).
- Contradiction: "semua harness" vs "jujur per harness" → BUKAN kontradiksi:
  cakupan semua, klaim veto hanya ber-adapter-berbukti.
- Hidden assumption: harness mengizinkan hook/tool-gate → DINYATAKAN: yang
  tak mengizinkan tetap audit-only tertulis (-US4/US5 adalah hasilnya).
- Untestable: "tanpa membangkang" → DITERJEMAHKAN ke AC1–AC8 yang falsifiable;
  niat model tak diukur, perilaku terblokir/tertangkap yang diukur.
