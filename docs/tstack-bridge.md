# TNA × Pstack × Tstack — bridge PR-ops (fase-1)

Fase-1: `file-pr` + `babysit-pr` + `leaving-pr-comments` sebagai lapisan PR-ops
di bawah gate TNA. `full-send` merge otonom ditolak; `modernize` / `takeover` /
`council` penuh = fase-2 (dicatat non-aktif di sini).

## Gate → executor

| TNA gate | Tstack executor | Kunci |
|---|---|---|
| `receipts` — sebelum submit PR | `file-pr` | Deskripsi problem-then-solution + secret scan + atribusi model/harness. Bukti proof menutup tiap perubahan diff. |
| `make-it-so` / `root-cause` — temuan CI/bot | `babysit-pr` | Tiap temuan diverifikasi ke source sebelum diubah; noise ditolak tertulis. Watcher: `scripts/pr-wait.py --until any-change`. |
| `technical-writing` / `unslop` — komentar PR | `leaving-pr-comments` | Format atribusi + gaya direct. Murah, tanpa risiko. |
| `roast-my-code` — review berat (opsional) | `council` 2 lengan | Panel arena `opus xhigh` + `fable xhigh` (dua famili). Sekali jalan, tanpa loop-sampai-sepakat. Hanya untuk perubahan berisiko (auth, data-loss, concurrency) — pola sol-loop 3 ronde + ledger temuan. |
| `make-it-so` — handoff | `full-stop` | Berhenti sebelum merge. Agen menyiapkan status siap-merge; Master yang merge manual (Iron Law 4). |
| `make-it-so` lanjutan (fase-2, non-aktif) | `modernize` | Disposisi MODERNIZE/REWORK/CLOSE + rebase `--force-with-lease`. Belum diaktifkan. |

## Larangan (non-negotiable)

- Agen tidak merge, tidak force-push branch orang, tidak `--admin`/bypass.
- `full-send` mode merge otonom ditolak dari integrasi.
- Kunci model T3/Sol dibuang; tidak ada substitusi diam-diam di luar alias gateway.
- `receipts` tetap wajib di 2 titik: sebelum `file-pr` dan sebelum handoff `full-stop`. Gate merge ala tstack bukan receipt.

## Rujukan alat

- Watcher: `scripts/pr-wait.py` (adapter Windows dari tstack upstream; lock direktori atomik pengganti `fcntl.flock`; CLI/event/exit-code setia upstream).
- Panel arena: `opus xhigh` + `fable xhigh`; varian murah `haiku high` untuk nits/babysit. Mapping alias aktual: `~/.claude/rules/pstack-models.md`.
- Shim `python3`: salinan `python.exe` → `python3.exe` di direktori Python311 (decided 2026-10-27, terverifikasi `Python 3.11.9`).

## Asal

Spec: issue #2 (nadiwerk/trust-no-agent). Tiket: `.trust/tstack-fase-1/issues/`. Keputusan breakpoint 7 butir + 2 OQ decided 2026-10-27.
