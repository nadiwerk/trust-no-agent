# Spec: newcomer escalation — first-run onboarding gate + docs hardening

Status: published (approved Master 2026-10-13) — awaiting fork-it
Date: 2026-10-13
Origin: Master question on first-time-user "defiance"; breakpoint 2026-10-13
(2 rounds, frontier empty). Scribe attempt cancelled by Master; this spec is
the breakpoint's output. Evidence: session findings (self-trigger 0/3,
dual-router arbitration, zombie skills, stale registries, API-harness
audit-only decision A).

## Problem Statement

Sebagai pengguna baru trust-no-agent, saya mengikuti instalasi tapi agent
tetap bertingkah "membangkang": skill tak di-load, receipt dilewati, perilaku
lama bertahan. Saya tidak tahu apakah instalasi saya rusak atau frameworknya
yang lemah — tak ada cek yang memberi tahu di sesi pertama.

## Solution

Eskalasi dua lapis, docs dulu lalu gate: (1) keraskan alur onboarding di docs
agar tiap langkah bisa diverifikasi — bukan sekadar dibaca; (2) tambah
first-run gate mekanis yang memeriksa doctor hijau + skills reachable DAN
Iron Laws recitable dari router proyek, sebelum disiplin diklaim berjalan.

## User Stories

1. As a first-time adopter, I want install steps I can verify one by one, so
   that I know which step failed instead of guessing.
2. As a first-time adopter, I want a single mechanical verdict after install
   (not five manual checks), so that "is it working?" has one answer.
3. As a first-time adopter with an existing router, I want the adoption
   interview to prevent dual-router setups, so that the model never
   arbitrates by forgetting one router.
4. As a first-time adopter, I want stale/zombie skills purged during install,
   so that pre-adoption behavior cannot resurrect weeks later.
5. As a maintainer answering "it disobeys" reports, I want the doctor output
   as the mandatory first artifact, so that support starts from evidence.
6. As a maintainer, I want the first-run gate to check doctor AND recital
   (per breakpoint decision), so that neither wiring-only nor prose-only
   installs pass silently.
7. As a maintainer, I want every new onboarding rule pinned by an eval check,
   so that docs drift fails CI instead of rotting quietly.

## Decisions Already Made

- Target: keduanya — docs dulu, gate menyusul (breakpoint ronde 1).
- Bukti: temuan sesi ini, tanpa pengumpulan bukti baru (breakpoint ronde 1).
- Keluaran: spec + tiket (breakpoint ronde 1), bukan catatan saja.
- Gate memeriksa doctor+skills DAN recite Iron Laws (breakpoint ronde 2).
- Diagnosis tetap: apparent defiance = unwired enforcement + stale memory,
  bukan disobedience (temuan sesi; ADR dibatalkan, tidak diterbitkan).

## Testing Decisions

- What counts as a good test: exit codes + marker presence on real files —
  a gate test that passes with the wiring removed is theater.
- Modules (seams, existing only): the doctor CLI (first-run verdict),
  eval marker checks (docs invariance), the post-install verification section
  (human half). No new modules proposed.
- Prior art: eval checks 31/36 (docs-marker guards with RED/GREEN proofs),
  doctor C-checks (mode-aware verdicts), gate-meter.test.mjs (fixture style).

## Constraints

- Zero new runtime dependencies; Node builtins only for any script touched.
- No sterner-prose-only fixes — every onboarding rule ships with its
  mechanical check (encode-twice doctrine).
- Existing install paths keep working; hardening is additive (merge, not
  copy-over), per the adoption doctrine.
- Iron Law 4: publishing the spec and landing tickets both wait for Master.

## Acceptance Criteria

1. (US1) Tiap langkah install yang baru/berubah membawa cara verifikasi
   satu-barisnya — automated test (eval marker ada).
2. (US2) Satu verdict first-run ada (doctor hijau + skills reachable +
   recite) — automated test (suite hijau + RED/GREEN proof saat wiring
   dilepas).
3. (US3) Alur adopsi menolak setup dual-router (interview + merge, tanpa
   copy-over) — human verification (baca alur) + automated test (marker).
4. (US4) Alur install/turun (install + de-adoption) terdokumentasi penuh —
   automated test (marker purge + sweep ada di docs).
5. (US5) Panduan support "minta output doctor dulu" tertulis — human
   verification (baca docs).
6. (US6) Gate memeriksa KEDUA sisi (doctor dan recite), bukan salah satu —
   automated test (suite gagal bila satu sisi dilepas).
7. (US7) Tiap aturan onboarding baru dikawal eval check — automated test
   (eval hijau + RED proof per check).

## Out of Scope

- Adapter harness baru (tiket 07/08 track-nya sendiri).
- Mengubah severity WARN/FAIL yang sudah ada di doctor.
- Menulis ulang docs instalasi dari nol — hardening aditif saja.

## Open Questions

- Gate first-run WARN atau FAIL saat tak terpenuhi? (Tak dibahas di
  breakpoint — jangan diasumsi; default usulan: WARN, ikut doktrin doctor
  untuk instalasi.)
- Di mana gate hidup: bagian dari doctor, skrip baru, atau keduanya?

## Adversarial self-review

- Ambiguity: "recitable" → DIPERJELAS: model mengutip 4 Iron Laws dari router
  proyek (bukan dari checkout framework) saat ditanya, sesi pertama.
- Contradiction: US2 (satu verdict) vs US6 (dua sisi) → BUKAN kontradiksi:
  satu verdict TERSUSUN dari dua sisi; keduanya harus hijau.
- Hidden assumption: harness punya skill system → DINYATAKAN: fallback
  no-skill-system ikut alur yang sama (router recital + doctor tanpa C3).
- Untestable: "tahu langkah mana yang gagal" (US1) → DIPERTAHANKAN dengan
  check method marker: tiap langkah menamai perintah verifikasinya.
