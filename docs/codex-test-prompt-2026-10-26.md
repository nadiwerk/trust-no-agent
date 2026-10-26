# Prompt untuk sesi Codex — uji TNA + tangkap bentuk payload hook

Tempel **satu** prompt di bawah ke sesi Codex (interaktif `codex` di
`C:\Users\Lenovo\projects\trust-no-agent`, atau `codex exec`). Pilih sesuai tujuan.

---

## Prompt A — diagnosa lengkap (rekomendasi)

> Kamu menjalankan uji untuk framework trust-no-agent (TNA) di harness Codex. Jangan
> mengubah file apa pun di repo. Tugasnya **mengukur**, bukan memperbaiki.
>
> Konteks yang sudah terbukti di mesin ini (jangan diulang dari nol):
> - Plugin TNA terpasang: `trust-no-agent@trust-no-agent` v0.1.52, enabled.
> - Hook veto berjalan: commit tanpa bukti ditolak dengan
>   `Command blocked by PreToolUse hook: [trust-no-agent] irreversible action (git commit) ... without fresh test evidence`.
> - Yang **belum** bekerja: recorder `PostToolUse` tidak menulis `.trust/tna-gate-state.json`,
>   padahal `hook: PostToolUse Completed` muncul.
>
> Lakukan berurutan, dan laporkan output apa adanya:
>
> 1. Cetak `codex --version` dan `codex features list | Select-String "hooks|plugin_hooks"`.
> 2. Buat repo uji baru di `$env:TEMP\tna-codex-agent-<acak>`: `git init`, set user, buat
>    `f.txt`, `git add -A`. **Jangan commit.**
> 3. Jalankan `codex exec --skip-git-repo-check "Run exactly this one shell command and then stop: git commit -m probe-deny"`
>    di repo itu. Catat: apakah ada teks `tna-gate veto` / `Command blocked by PreToolUse hook`,
>    apakah `git rev-parse --verify HEAD` gagal, dan isi `.trust/tna-gate-log.jsonl`.
> 4. Buat `y.test.mjs` berisi `process.exit(0);`, lalu jalankan
>    `codex exec --skip-git-repo-check "Run this exact shell command with the shell tool: node y.test.mjs"`.
>    Catat apakah `.trust/tna-gate-state.json` ada dan isinya.
> 5. **Bagian inti** — cari bentuk payload PostToolUse yang sebenarnya:
>    - Cadangkan `%USERPROFILE%\.codex\.tmp\marketplaces\trust-no-agent\plugin\hooks\codex.hooks.json`
>      ke `codex.hooks.json.bak`.
>    - Ganti **hanya** perintah pada entri `PostToolUse` menjadi skrip penangkap yang
>      menulis seluruh stdin ke `%TEMP%\tna-capture.jsonl`, lalu tetap mengembalikan
>      stdout kosong dan exit 0. Skrip penangkap harus memakai `process.stdin` sampai `end`.
>    - Jalankan ulang langkah 4.
>    - Tampilkan isi `%TEMP%\tna-capture.jsonl` (kalau kosong, katakan kosong).
>    - **Pulihkan** `codex.hooks.json` dari backup dan verifikasi hash-nya kembali sama dengan
>      `C:\Users\Lenovo\projects\trust-no-agent\plugin\hooks\codex.hooks.json`.
> 6. Bandingkan payload tangkapan dengan yang diharapkan `gate-hook.mjs`: field apa yang
>    membawa exit code (`tool_response.exitCode`? `tool_response.metadata.exit_code`?
>    `stdout` saja? tidak ada?), dan apakah `tool_input.command` terisi.
> 7. Laporkan dalam bentuk tabel: langkah → hasil terukur → kesimpulan. Akhiri dengan
>    satu kalimat: "recorder Codex butuh perubahan X" atau "payload tidak terkirim ke hook".
>
> Aturan: setiap klaim harus punya output yang kamu tempel. Kalau sebuah perintah gagal,
> tulis pesan errornya, jangan menyimpulkan "tidak didukung". Di Windows, `codex` adalah
> shim `.ps1`/`.cmd` — panggil lewat shell, jangan `spawn` langsung dari Node.

---

## Prompt B — hanya uji cepat (tanpa menyentuh hook)

> Uji cepat trust-no-agent di Codex, tanpa mengubah file apa pun.
>
> 1. Buat repo baru di `$env:TEMP\tna-quick-<acak>`, `git init`, buat `f.txt`, `git add -A`.
> 2. `codex exec "Run exactly this one shell command and then stop: git commit -m probe-deny"`.
> 3. Laporkan: (a) apakah muncul `Command blocked by PreToolUse hook: [trust-no-agent]`, (b)
>    apakah `git rev-parse --verify HEAD` gagal, (c) apakah `.trust/tna-gate-log.jsonl` ada.
> 4. Kalau **tidak** ada baris `hook:` sama sekali, simpulkan: trust hook belum disetujui —
>    jangan menyimpulkan hook tidak didukung.
>
> Tempel output tiap perintah. Tanpa perubahan file.

---

## Prompt C — setujui trust lalu uji ulang

> Saya akan menyetujui prompt trust hook TNA di sesi interaktif ini. Setelah itu:
>
> 1. Verifikasi trust tersimpan: tampilkan baris `hooks.state` yang menyebut
>    `trust-no-agent@trust-no-agent` dari `%USERPROFILE%\.codex\config.toml`.
>    Sebelum disetujui jumlahnya 0.
> 2. Buat repo uji, jalankan `codex exec "…git commit -m probe-deny"` seperti biasa
>    (**tanpa** `--dangerously-bypass-hook-trust`), dan buktikan commit ditolak.
> 3. Jalankan `node y.test.mjs` lewat `codex exec`, lalu cek `.trust/tna-gate-state.json`.
> 4. Laporkan dua baris: "deny: bekerja / tidak" dan "recorder: menulis / tidak".

---

## Yang **tidak** perlu ditanyakan lagi ke Codex

Sudah terukur 2026-10-26, jangan memakan waktu sesi:

- Codex 0.163.0 **punya** hook (`hooks = stable true`). `plugin_hooks = removed` adalah flag lain.
- OMO (plugin lain) hook-nya jalan → mekanisme hook plugin hidup.
- Payload marketplace identik dengan repo (hooks, gate-hook, tna-gate, action-gate, manifest).
- Veto bekerja; log meter bekerja.
- Men-spawn `codex` langsung dari Node gagal (`status: null`) — harus lewat PowerShell.
