# Chat receipt — kartu 1-layar penutup unit verifiable

Setiap unit verifiable ditutup di chat dengan 4 blok ini, dalam urutan ini. Chat = bukti hidup (run fresh THIS message); file = arsip. Ledger/tiket hanya mengutip, tidak menggantikan run.

## Bentuk

```md
<✅ DONE | ❌ NOT done> <ticket-id> — <judul singkat> | <perintah>: <hasil + exit>
Bukti: <FAIL pre-impl> → <PASS post-impl> | <AC yang terpenuhi>
Belum: <yang tidak dibuktikan, atau "none">
Next: <satu aksi / none> — <lokasi arsip>
```

## Aturan blok

1. **Verdict** — 1 baris pertama = verdict + angka exit. Tanpa scroll sudah tahu hasil.
2. **Bukti** — output verbatim ditempel di chat, bukan "cek file X". Untuk unit perilaku (code change, test), siklus fail-first wajib terlihat (FAIL sebelum, PASS sesudah). Untuk unit non-perilaku (docs, config, typo) yang tidak punya FAIL pre-impl jujur: isi dengan bukti keberadaannya atau exit code verifikasi yang relevan; jangan mengarang FAIL demi memenuhi template.
3. **Belum** — tiap receipt tulis apa yang belum terbukti (misal browser check real data). Tidak boleh kosong tanpa kata "none".
4. **Next** — satu aksi terkecil berikutnya + lokasi arsip (ledger/tiket). A receipt missing any block is a partial receipt: it proves nothing.

## Contoh

```md
✅ DONE T01-login-guard | tsc EXIT 0; vitest 1/1
Bukti: FAIL pre-impl (500) → PASS post-impl (401) | AC1 ✔
Belum: browser check real data
Next: none — ledger `.trust/progress.txt` updated
```

## Sumber per blok

| Blok | Skill sumber |
|---|---|
| Verdict | `receipts` — 5 boolean + exit code |
| Bukti | `expect-fail` + `make-it-so` repair receipt |
| Belum | `receipts` gate semantics |
| Next + arsip | `ship-log` (AC dikutip dari `save-as`) |
