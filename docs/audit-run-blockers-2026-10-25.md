# Audit — kenapa trust-no-agent tidak berjalan dengan baik

**Tanggal:** 2026-10-25
**Target:** `C:\Users\Lenovo\projects\trust-no-agent` (working tree, 112 file belum di-commit; HEAD = `a91f455`)
**Metode:** setiap temuan dijalankan ulang di sesi ini (perintah + output ditempel). Yang tidak bisa
diukur ditandai *inferred*, bukan diklaim.

**Ringkas:** 18 temuan. **4** khas satu harness (5, 6, 7, 17 — dan hanya 17 yang khas dsh),
**sisanya general**: berlaku di pi/omp/dsh sekaligus atau di repo. Tiga temuan paling mematikan
(bukti merah diterima hijau, bukti tak kedaluwarsa, klasifier buta pada wrapper) berlaku di
**semua** harness, jadi memperbaikinya di satu adapter saja tidak menutup apa pun.

---

Label: **P0** gate mati / bisa dibuka tanpa bukti sah · **P1** layer tidak tersambung ·
**P2** klasifier menyimpang dari kanonik · **P3** higiene.

---

## Scope — mana yang khusus dsh, mana yang general

Setiap temuan diukur ke **semua** adapter yang ada (pi, omp, dsh) plus jalur kanonik yang dipakai
Claude Code & Codex (`gate-hook.mjs` → `tna-gate.mjs` → `action-gate.mjs`). Kolom "terukur di"
adalah hasil eksekusi, bukan bacaan kode.

| # | Temuan | Terukur di | Sifat |
|---|---|---|---|
| 1 | `validate.mjs` gagal (CI merah) | repo | **general** — memblokir semua harness sekaligus |
| 2 | Test merah dicatat `testPassFresh:true` | gate-hook, pi, omp, dsh (4/4) | **general** |
| 3 | Bukti test tidak pernah kedaluwarsa | gate-hook, pi, omp, dsh (4/4) | **general** |
| 4 | Veto receipt menilai entri ledger yang salah | gate-hook (Claude Code + Codex) | **general di 2 harness itu**, tidak berlaku di pi/omp/dsh |
| 5 | Plugin Claude Code terpasang 0.1.50 masih bocor | Claude Code | khusus Claude Code |
| 6 | Codex tak punya perekam bukti (gate = dinding) | Codex | khusus Codex |
| 7 | Floor tak di-re-inject setelah compaction | Claude Code (dan klaim opencode) | khusus Claude Code |
| 8 | Payload setup-tna tak bisa menjalankan langkah salinnya | instalasi lewat skill/marketplace | **general** untuk jalur instalasi itu |
| 9 | Doctor memeriksa manifest di path yang tak ada | repo | **general** — semua instalasi Claude Code |
| 10 | Adapter buta pada `sudo` / `bash -c` / `sh -c` | pi, omp, dsh (3/3) | **general** |
| 11 | Klasifier MANDATORY false positive | pi, omp, dsh (3/3) | **general** |
| 12 | Done-gate salah tipe blok | pi, omp, dsh (3/3, tapi beda-beda) | **general**, bentuknya beda per adapter |
| 13 | Ledger append-only lolos di pwsh **dan** di semua adapter | kanonik + pi + omp + dsh | **general** |
| 13b | Meter gate buta ke adapter | pi, omp, dsh (3/3) | **general** |
| 14 | `logVeto` → direktori `[object Object]` | gate-hook saja | khusus jalur kanonik |
| 15 | `skills-lock.json` basi 12/12 | repo | **general** |
| 16 | `[object Object]` tak terlihat git | repo | **general** |
| 17 | Router terduplikasi `~/.dsh` + proyek | dsh saja | khusus dsh |

**Jawaban singkat: mayoritas general.** Dari 17 temuan, hanya **4** yang benar-benar khas satu
harness (5, 6, 7, 17), dan hanya **1** yang khas dsh (17 — duplikasi router). Tiga temuan yang di
laporan awal saya sebut "dsh" (10, 11, 12) ternyata **general**: pi dan omp memakai salinan
klasifier yang sama dan punya lubang yang sama.

Yang **paling** general justru tiga yang paling mematikan: bukti merah diterima sebagai hijau (2),
bukti tidak kedaluwarsa (3), dan klasifier buta pada wrapper (10) — ketiganya berlaku di **semua**
harness sekaligus, jadi memperbaikinya di satu adapter saja tidak menutup apa pun.

---

# P0 — mematikan

## 1. `validate.mjs` gagal: CI tidak bisa hijau di tree ini

**Gejala.** Langkah pertama job `validate` di `.github/workflows/ci.yml` exit 1.

```
$ node scripts/validate.mjs
ERROR AGENTS.md references unknown skill: `cordis.patch.yml`
ERROR AGENTS.md references unknown skill: `testPassFresh`
ERROR skills/meta/setup-tna references unknown skill: `cordis.patch.yml`
ERROR skills/meta/setup-tna references unknown skill: `tna-veto.mjs`
ERROR skills/meta/setup-tna references unknown skill: `tna-discipline.mjs`

FAIL: 5 structural error(s).
[exit=1]
```

**Akar masalah.** `scripts/validate.mjs` menganggap **setiap** token di dalam backtick di
`AGENTS.md` dan `skills/**/SKILL.md` sebagai nama skill, kecuali ada di `NON_SKILL_TERMS`.
Prosa baru menyebut nama file (`.mjs`, `.yml`) di dalam backtick, dan validator tidak bisa
membedakan "nama skill" dari "nama file".

**Bukti ini regresi dari pekerjaan yang belum di-commit**, bukan cacat lama — di HEAD bersih
validator lolos:

```
$ git worktree add --detach %TEMP%\tna-head HEAD && cd %TEMP%\tna-head
$ node scripts/validate.mjs
OK: 3 categories, 12 skills, no structural errors.   [exit=0]
```

**Dampak.** 112 file perubahan tidak bisa masuk CI. Job `windows` juga memanggil validator yang
sama, jadi dua job merah sekaligus.

**Perbaikan yang disarankan.** Jangan tambah nama file ke `NON_SKILL_TERMS` (itu daftar yang akan
terus tumbuh). Batasi pemindaian ke token yang *berbentuk* skill (`^[a-z]+(?:-[a-z]+)*$`) seperti
yang sudah dilakukan untuk `docs/skills/` di blok yang sama, atau lewati token berakhiran
`.mjs/.yml/.json/.ts`. Perbaikan kedua lebih tepat: validator tidak boleh menuntut nama file
menjadi skill.

---

## 2. Test merah dicatat sebagai bukti hijau (semua harness)

**Gejala.** `testPassFresh` menjadi `true` setelah suite **gagal** — di **semua** recorder.

```
=== F2 red run recorded as fresh evidence ===
  pi         red run -> testPassFresh = true
  omp        red run -> testPassFresh = true
  gate-hook  red run -> testPassFresh = true
  dsh        red run -> testPassFresh = true
```

**Akar masalah.** Keempat recorder menyimpulkan "lulus" dari **tidak adanya** penanda error, bukan
dari ada-tidaknya kode keluar nol:

- `scripts/gate-hook.mjs:376` → `const output = { metadata: { error: resp.error ?? null } };`
- `scripts/tna-gate.mjs:146` → `const pass = !output?.metadata?.error;`
- `veto-hooks/dsh/tna-veto.mjs` → `pass: result?.isError !== true`
- `veto-hooks/{pi,omp}/tna-veto.ts` → `pass: event?.isError !== true`

Dan dsh **secara eksplisit** mendokumentasikan bahwa exit non-nol bukan error
(`dsh-tool-bash/lib/index.js:141-143`):

> "Non-zero exits are reported, not errored — the model decides how to react; only
> infrastructure failures (spawn errors, aborts) surface as isError results."

Jadi pada dsh, suite merah **selalu** `isError: false` → selalu dicatat lulus. Di harness lain
jalur kodenya sama; kegagalan hanya terbaca kalau payload kebetulan membawa penanda error
(*inferred* untuk bentuk payload Claude Code/pi/omp; terukur untuk jalur kode hook-nya).

**Dampak.** Satu-satunya cara gate terbuka adalah bukti test — dan bukti itu menerima suite merah.
"Fresh test evidence" berhenti berarti "test hijau". Ini melemahkan tepat janji inti framework
(Iron Law 3/4), dan berlaku di **semua** harness sekaligus.

**Kenapa test tidak menangkapnya.** Fixture merah yang ada memakai bentuk sintetis
`isError: true` (`scripts/dsh-veto.test.mjs` R5, `scripts/veto-adapter.test.mjs` M5), bukan bentuk
yang harness benar-benar kirim. Test hijau (`gate-hook.test.mjs` L1) hanya menutup satu sisi.

**Perbaikan.** Baca sinyal yang benar per harness: `exitCode`/`exit` bila ada, dan untuk dsh
parse penanda `[exit code: N]` yang tool-nya sendiri tulis ke teks hasil; bila sinyal tidak ada,
**jangan catat apa pun** (unknown ≠ pass). Tambahkan test merah yang memakai bentuk asli tiap
harness — itu test yang seharusnya merah hari ini.

---

## 3. Bukti test tidak pernah kedaluwarsa (semua harness)

**Gejala.** State bertanggal 2020 masih membuka gate — di keempat jalur.

```
  pi         2020 evidence -> ALLOWED
  omp        2020 evidence -> ALLOWED
  dsh        2020 evidence -> ALLOWED
  gate-hook  2020 evidence -> ALLOWED
```

**Akar masalah.** `updatedAt` **ditulis** di empat tempat (`tna-gate.mjs`, `tna-store.mjs`,
`veto-hooks/{dsh,pi,omp}/tna-veto.*`) dan **tidak pernah dibaca** oleh satu pun gate. Nama fieldnya
`testPassFresh`, tapi tidak ada perhitungan kesegaran.

**Dampak.** Sekali ada test hijau di sebuah repo, gate commit di repo itu terbuka **selamanya** —
lintas sesi, lintas hari, lintas perubahan. Di repo ini sendiri state 2026-10-23 masih dipakai
2026-10-25.

**Perbaikan.** Tentukan jendela (mis. 30 menit / sampai file berubah), dan perlakukan state lebih
tua dari jendela sebagai tidak ada bukti. Gate harus **fail-closed** ke "tidak ada bukti", bukan
fail-open.

---

## 4. Veto receipt menilai entri ledger yang salah

**Gejala.** Veto menilai entri lama, bukan entri terbaru. Arah akibatnya tergantung isi entri lama
itu — dan keduanya salah:

```
# ledger sintetis: entri lama punya receipt valid, entri terbaru tidak punya receipt
anchor date with a newer receiptless entry: 2026-10-24
veto verdict: {"allow":true}          ← 12 entri lebih baru tidak pernah dinilai

# ledger asli repo ini: entri lama kebetulan mengutip command yang tidak ada di allowlist
live vetoVerdict: {"allow":false,
  "reason":"the newest ledger entry (2026-10-24) has no valid receipt: cited command
            \"node x.test.mjs\" is not in the repo-gate allowlist …"}
```

Ledger asli repo ini:

```
live ledger last partition: 2026-10-25
live ledger newestEntry:    2026-10-24
partitions after the last receipt block:
  2026-10-24 ×5, 2026-10-25 ×7   (12 partisi)
```

Jadi di repo ini veto **menolak** — tapi dengan alasan dari entri 2026-10-24, bukan dari 12 entri
yang lebih baru. Penolakan yang kebetulan benar tetap bukan gate yang bekerja: begitu entri lama
diperbaiki, gate-nya terbuka lagi tanpa pernah melihat entri terbaru.

**Akar masalah.** `scripts/receipt-enforcement.mjs` → `newestEntry()` memilih blok
`#### Receipt` **terakhir** kalau ada minimal satu, bukan partisi `## <tanggal>` terakhir:

```js
const receipts = [...src.matchAll(/^####\s+Receipt\b/gm)];
if (receipts.length) { const start = receipts[receipts.length - 1].index; ... }
```

**Dampak.** Aturan "setiap unit kerja ditutup receipt" hanya ditegakkan untuk entri yang
**kebetulan** memakai heading `#### Receipt`. Entri berbentuk ringkasan sesi — bentuk yang dipakai
12 partisi terakhir di repo ini — tidak pernah dinilai. Veto commit memeriksa entri 2026-10-24
saat ada 12 entri yang lebih baru.

**Perbaikan.** Anchor = partisi `## <tanggal>` terakhir; blok `#### Receipt` di dalamnya adalah
isi yang dinilai. Kalau partisi terakhir tidak punya receipt, itu temuan (`no valid receipt`),
bukan alasan mundur ke entri sebelumnya.

---

## 5. Plugin Claude Code yang terpasang (0.1.50) masih bocor

**Gejala.** Di harness yang benar-benar terpasang di mesin ini, dua bentuk commit lolos.

```
installed Claude plugin / repo plugin version: 0.1.50 / 0.1.52
installed 0.1.50 classifier: git -C . commit -m x=PASS  git --no-pager push=PASS
installed 0.1.50 has GIT_GLOBAL_VALUE_FLAGS: false
```

**Akar masalah.** Perbaikan "git global options" (yang justru jadi headline CHANGELOG 0.1.52)
belum ada di salinan terpasang. `~/.claude/plugins/installed_plugins.json` menunjuk
`…\cache\trust-no-agent\trust-no-agent\0.1.50`.

**Dampak.** `git -C . commit`, `git -c k=v commit`, `git --no-pager push` — commit/push nyata —
melewati gate di Claude Code, padahal repo menyatakan kelas ini sudah ditutup.

**Kenapa tidak terdeteksi.** Doctor tidak melihat instalasi ini (lihat temuan 9). Tidak ada
mekanisme yang membandingkan payload terpasang dengan payload repo untuk Claude Code.

**Perbaikan.** Update instalasi (butuh sign-off — ini menulis ke direktori plugin bersama), lalu
tutup temuan 9 supaya kebasian berikutnya terlihat.

---

# P1 — layer terlihat terpasang, tapi tidak tersambung

## 6. Codex tidak punya perekam bukti → gate tidak bisa dibuka

```
codex hook events: SessionStart,PostCompact,UserPromptSubmit,PreToolUse
codex PostToolUse present: false
```

Codex hanya memasang `PreToolUse`. Tidak ada `PostToolUse`, jadi tidak ada yang menulis
`tna-gate-state.json`. Gate Codex karena itu **dinding permanen**: setiap commit ditolak dan tidak
ada jalur sah untuk membukanya — persis kegagalan yang docs/compatibility.md sebut
*"a gate that cannot open is a wall, not a gate"*.

Harness-nya mendukung event itu: omo di `~/.codex/config.toml` mendaftarkan `post_tool_use` lima
kali. `scripts/codex-plugin.test.mjs` tidak menyebut `PostToolUse` sama sekali, jadi tidak ada test
yang menangkapnya.

**Perbaikan.** Tambahkan `PostToolUse` di `plugin/hooks/codex.hooks.json`, lalu pin di
`codex-plugin.test.mjs`.

## 7. Floor tidak di-re-inject setelah compaction di Claude Code

```
claude hook events: SessionStart,UserPromptSubmit,PreToolUse,PostToolUse
claude PostCompact present: false
```

`plugin/hooks/hooks.json` tidak punya `PostCompact`, padahal `gate-hook.mjs` sudah menangani event
itu dan `docs/compatibility.md` (matriks full-function) menulis **`SessionStart` + `PostCompact`**
untuk Claude Code. Setelah compaction, Iron Laws + MANDATORY hilang dari konteks dan tidak kembali —
tepat kegagalan yang `scripts/reinject.mjs` ada untuk mencegah.

Catatan terkait: matriks yang sama menulis floor opencode sebagai "`ctx` injection", tapi
`.opencode/plugins/tna-gate/index.js` tidak menyuntik apa pun (tidak ada `floor`, `AGENTS`, atau
`additionalContext` di file itu). Floor opencode sebenarnya bergantung pada AGENTS.md native.

## 8. Payload `setup-tna` tidak bisa menjalankan langkah salinnya sendiri

```
payload ROOT/skills exists:                    ~/.agents/skills/setup-tna=false | ~/.dsh/skills/setup-tna=false
payload ROOT/.opencode/plugins/tna-gate exists: false | false
repo plugin/ ships .opencode/plugins:           false
```

`scripts/onboarding.mjs` menghitung `ROOT` sebagai `dirname(script)/..`. Ketika skill dipasang
sebagai payload (`~/.agents/skills/setup-tna/…` atau `~/.dsh/skills/setup-tna/…`), `ROOT` menunjuk
folder skill itu — di sana **tidak ada** `skills/` (sumber `installSkills`) dan **tidak ada**
`.opencode/plugins/tna-gate` (sumber veto opencode). Kedua langkah itu jadi no-op senyap, padahal
`SKILL.md` menyuruh agen menjalankan CLI "from this skill's payload".

Selain itu `plugin/` — payload marketplace — sama sekali tidak mengirim `.opencode/plugins`, jadi
jalur plugin pun tidak bisa memasang veto opencode.

**Dampak.** Instalasi lewat skill/marketplace mengklaim "hooks: consented" tanpa veto opencode dan
tanpa skill yang tersalin.

**Perbaikan.** Bawa `.opencode/plugins/tna-gate/**` dan `skills/**` ke dalam payload skill, atau
buat CLI menolak (exit ≠ 0) dengan pesan jelas ketika `ROOT` tidak punya sumber yang dibutuhkan —
no-op senyap adalah bentuk terburuknya.

## 9. Doctor memeriksa manifest di path yang tidak ada → instalasi basi tak terlihat

```
doctor C9 candidate paths exist:
  ~/.claude/plugins/trust-no-agent/.claude-plugin/plugin.json = false
  ~/.claude/plugins/cache/trust-no-agent/trust-no-agent/0.1.50/plugin.json = true
```

`scripts/doctor.mjs` memeriksa `~/.claude/plugins/<name>/.claude-plugin/plugin.json`; Claude Code
menyimpan instalasi di `~/.claude/plugins/cache/<marketplace>/<plugin>/<versi>/`. Karena path
pertama tidak ada, pengecekan C9 tidak pernah berjalan untuk instalasi nyata — inilah sebabnya
temuan 5 (0.1.50 vs 0.1.52) tidak pernah dilaporkan, sementara doctor mencetak
"skills version current (v0.1.52)" (itu stamp proyek, bukan versi plugin terpasang).

**Perbaikan.** Baca `~/.claude/plugins/installed_plugins.json` (sumber kebenaran versi + installPath)
dan bandingkan `installPath`-nya dengan versi repo.

---

# P2 — klasifier menyimpang dari kanonik

> **Koreksi scope (lihat §Scope di bawah).** Tiga temuan di bagian ini semula saya tulis sebagai
> "khusus dsh". Setelah diukur ke semua adapter, **10 dan 11 general (pi/omp/dsh sama persis)**;
> hanya **12** yang khusus dsh.

## 10. Semua adapter buta pada bentuk wrapper/interpreter yang kanonik blokir

```
corpus: 7 commands the canonical gate blocks
  pi    missed 3/7: ["bash -c \"git commit -m x\"","sh -c \"git push\"","sudo git commit -m x"]
  omp   missed 3/7: ["bash -c \"git commit -m x\"","sh -c \"git push\"","sudo git commit -m x"]
  dsh   missed 3/7: ["bash -c \"git commit -m x\"","sh -c \"git push\"","sudo git commit -m x"]
  canonical missed 0/7
```

`scripts/action-gate.mjs` sudah menangani wrapper (`sudo`), interpreter (`bash -c`), dan subshell.
Ketiga salinan adapter hanya memotong per separator lalu memeriksa kata pertama — jadi `sudo`
menjadi kata pertama, dan payload di dalam tanda kutip tidak pernah dilihat.

Test paritas `S1` (`scripts/dsh-veto.test.mjs`) mengklaim "adapter grammar matches the canonical
gate", tapi korpusnya tidak memuat satu pun bentuk di atas. Klaim paritasnya benar untuk korpus itu
saja — dan korpus yang sama tidak ada di test pi/omp.

## 11. Klasifier MANDATORY ketiga adapter memicu domain yang salah

```
  pi    3/4    omp   3/4    dsh   3/4
      fix the typo in the heading      -> root-cause
      what does the test runner print  -> expect-fail
      perbaiki ejaan di docs           -> root-cause
```

Ketiga adapter (`veto-hooks/{pi,omp,dsh}/tna-discipline.*`) mengklaim "in lockstep with …
scripts/mandatory-gate.mjs", tapi tabelnya jauh lebih longgar: `/\btest(s|ing)?\b/`,
`/\bfix(es|ed|ing)?\b/`, `/\bsalah\b/`. Klasifier kanonik sengaja tidak memakai kata telanjang itu
(ada tabel negasi + aturan klausa) karena memicu pada invers dari sinyalnya sendiri.

**Dampak.** Notifikasi MANDATORY muncul di prompt yang tidak menyentuh domainnya. Sesuai desain
notifikasi itu sendiri ("if a flag does not apply, say so and proceed"), ini bukan pelanggaran —
tapi ia melatih model (dan user) untuk mengabaikan flag, yang justru melemahkan gate.

## 12. Done-gate: ketiga adapter memakai tipe blok yang salah — dan berbeda satu sama lain

Tiap harness punya event done-gate berbeda, dan tiap adapter mencari tipe blok yang berbeda:

```
=== pi (agent_before_settle) ===        === omp (session_stop) ===        === dsh (agent/pre-step) ===
tool-call  -> flagged: true             tool-call  -> flagged: true       tool-call  -> flagged: true
tool_use   -> flagged: false            tool_use   -> flagged: true       tool_use   -> flagged: false
toolCall   -> flagged: false            toolCall   -> flagged: false      toolCall   -> flagged: false
```

- **pi** mencari `tool_use` / `toolCall` (`tna-discipline.ts:234`).
- **dsh** mencari `tool_use` / `toolCall` (`tna-discipline.mjs:188`), padahal dsh mengirim
  `block.type === "tool-call"` (`dsh-agent-loop/lib/index.js:1164`).
- **omp** mencari `toolCall` saja (`tna-receipts-gate.ts`), yang juga bukan bentuk aslinya.

Bentuk asli per harness (dari dokumentasi/type package-nya):
pi → `type: "toolCall"` (`pi docs/message-types.md:56`); dsh → `type: "tool-call"`.

**Akibat.** Di dsh, bukti tidak pernah terlihat → klaim "done" yang **sudah** menjalankan test tetap
kena notice. Di pi dan omp, bentuk `toolCall` (yang asli) juga tidak dikenali → false positive yang
sama. Yang "hijau" di test hanyalah bentuk yang kebetulan dipakai fixture.

**Perbaikan.** Kenali ketiga ejaan (`tool-call`, `tool_use`, `toolCall`) di ketiga adapter, dan
ganti fixture ke bentuk asli harness masing-masing.

## 13. Aturan ledger append-only tidak berlaku di PowerShell — dan tidak di adapter mana pun

```
canonical  BLOCKED  bash: > .trust/progress.txt
canonical  BLOCKED  bash: Set-Content .trust/progress.txt "x"
canonical  PASSED   pwsh: Set-Content .trust/progress.txt "x"
canonical  PASSED   PowerShell: Out-File .trust/progress.txt
pi         PASSED   bash: > .trust/progress.txt
pi         PASSED   bash: Set-Content .trust/progress.txt "x"
omp        PASSED   bash: > .trust/progress.txt
dsh        PASSED   bash: > .trust/progress.txt
```

Dua lapis lubang:

1. **Kanonik.** `SHELL_TOOLS` di `scripts/action-gate.mjs` hanya `bash, shell, exec_command`.
   Pemeriksaan overwrite ledger (`LEDGER_OVERWRITE_PATTERNS`, yang sudah memuat `set-content`)
   dijaga oleh `if (SHELL_TOOLS.has(name) && …)`, jadi tool `pwsh`/`PowerShell` tidak pernah masuk
   ke blok itu.
2. **Adapter pi/omp/dsh.** Ketiganya hanya memeriksa ledger untuk `WRITE_TOOLS` (write/edit) dan
   **tidak** untuk tool shell — jadi `> .trust/progress.txt` lewat bash pun lolos di ketiganya,
   sementara kanonik memblokirnya.

Ini satu-satunya aturan yang **tidak** bisa dibuka oleh bukti test (fresh evidence pun tidak
memulihkan history), jadi lubangnya paling mahal.

## 13b. Meter gate buta terhadap tiga dari empat adapter

```
pi     denied=true  log written=false  meter fires=0
omp    denied=true  log written=false  meter fires=0
dsh    denied=true  log written=false  meter fires=0
```

`scripts/gate-meter.mjs` membaca `.trust/tna-gate-log.jsonl`, dan **hanya `gate-hook.mjs`** yang
menulis file itu. Adapter pi/omp/dsh memblokir tanpa mencatat apa pun, jadi doctor melaporkan
"veto fires: no data yet" walaupun veto benar-benar bekerja — dan sebaliknya, aktivitas denial di
ketiga harness itu tidak pernah masuk hitungan.


## 14. `logVeto` mengubah cwd non-string menjadi direktori literal `[object Object]`

```
$ node -e "logVeto({path:'/tmp/x'}, {harness:'probe',tool:'bash',command:'git commit'})"
logVeto(object cwd) -> true  ->  entries: ["[object Object]"]
```

`scripts/tna-gate.mjs` → `logVeto(dir)` melakukan `join(String(dir), '.trust', LOG_FILE)`. Kalau
payload hook membawa `cwd` sebagai objek (bukan string), `String()` menghasilkan
`"[object Object]"` dan **direktori itu benar-benar dibuat** di cwd proses.

Bukti di repo ini: `[object Object]\.trust\tna-gate-log.jsonl` ada, dan isinya tujuh denial
`gate-hook` dari 2026-10-24 — jejak nyata dari bug ini, bukan artefak teoretis.

**Dampak ganda.** (a) direktori sampah di repo; (b) `logVeto` mengembalikan `true`, jadi meter
gate mengira denial tercatat padahal masuk ke folder palsu.

---

# P3 — higiene

## 15. `skills-lock.json` basi 12/12

```
skills-lock stale hashes: 12/12
```

Diukur dengan sha256 byte mentah, dan tetap 12/12 setelah normalisasi CRLF — jadi bukan artefak
EOL. Di HEAD bersih pun 12/12. Test `J1` hanya memeriksa **keberadaan** file, bukan hash, jadi lock
bisa basi tanpa satu pun gate merah. Dampaknya kecil (tool installer meregenerasi lock per mesin),
tapi artinya file itu tidak lagi menjadi bukti apa pun.

## 16. Direktori sampah `[object Object]` tidak terlihat oleh git

`.gitignore` memuat `.trust/` tanpa slash di depan, jadi pola itu cocok di **kedalaman mana pun** —
termasuk `[object Object]/.trust/`. Akibatnya artefak temuan 14 tidak pernah muncul di
`git status` dan bisa ikut terbawa commit kalau ada yang memakai `git add -A` dengan ignore
dimatikan.

## 17. Router terduplikasi: `~/.dsh/AGENTS.md` + `AGENTS.md` proyek

```
~/.dsh/AGENTS.md bytes: 15597      project AGENTS.md bytes: 17109
project AGENTS.md lines already present verbatim in ~/.dsh/AGENTS.md: 97/100
WORKFLOW.md identical: true
```

`dsh-agent-instructions` memuat rantai user-global **lalu** proyek. Dedup hanya terjadi kalau isi
cocok setelah trim; karena file proyek punya 3 baris tambahan, tidak ada yang di-dedup → ~97%
isi router dikirim dua kali setiap sesi, dan `WORKFLOW.md` identik byte-per-byte. Dua salinan juga
sudah mulai menyimpang (file host tertinggal 3 baris dari proyek).

**Perbaikan.** Salah satu: jadikan `~/.dsh/AGENTS.md` pointer satu baris ke router proyek, atau
biarkan hanya versi proyek dan hapus salinan host. Pilih satu — dua salinan adalah dua sumber
kebenaran.

---

## Yang **tidak** ditemukan rusak (supaya laporan ini jujur)

- **43/43 `scripts/*.test.mjs` exit 0**, termasuk `eval.mjs`, `trigger-eval.mjs`, `ci-guard.mjs`,
  `changelog-guard.mjs`, `file-budget.mjs`, `sync-payloads.mjs` (zero drift), `autonomy-ladder.mjs`.
- `node scripts/doctor.mjs` exit 0, "installation healthy" (5 warning).
- Klasifier kanonik `scripts/action-gate.mjs` menangani `git -C . commit`, `git --no-pager push`,
  `bash -c "…"`, `sudo`, `$(…)`, dan `cmd /c` dengan benar — kebocoran ada di **salinan** adapter,
  bukan di sumber.
- Perbaikan `$schema`/`hooks` manifest Codex (0.1.52) memang ada di payload yang dikirim dan di
  cache Codex 0.1.52.

---

## Urutan perbaikan yang disarankan

Urutannya sengaja mendahulukan yang **general**, karena satu perbaikan di sana menutup banyak
harness sekaligus.

1. **Temuan 1** dulu (validator) — tanpa ini tidak ada perubahan yang bisa masuk CI, termasuk
   perbaikan temuan lain.
2. **Temuan 2 + 3** — general (4/4 harness). Perekat bukti harus membaca sinyal keluar yang benar
   **dan** punya jendela kesegaran. Keduanya menyentuh file yang sama (`tna-gate.mjs`,
   `gate-hook.mjs`, `veto-hooks/*/tna-veto.*`); pisahkan jadi dua unit kerja karena masing-masing
   butuh test merah sendiri (harness asli, bukan fixture sintetis).
3. **Temuan 10 + 13** — general (3/3 adapter). Satukan klasifier ke satu sumber, atau perluas
   korpus paritas supaya penyimpangan tidak bisa hijau. Temuan 13 (ledger append-only) satu
   keluarga dengan ini: `SHELL_TOOLS` harus memuat `pwsh`/`PowerShell`, dan ketiga adapter harus
   memeriksa ledger di jalur shell, bukan hanya di write/edit.
4. **Temuan 12 + 11** — general, tapi akibatnya false positive (bukan gate terbuka). Kenali ketiga
   ejaan blok dan samakan tabel MANDATORY dengan kanonik.
5. **Temuan 4** (anchor ledger) — murni fungsi, satu test merah, tidak menyentuh adapter. Hanya
   menyentuh Claude Code + Codex, tapi itu dua harness terbesar.
6. **Temuan 6 + 7** (manifest Codex/Claude) — perubahan JSON + pin test, risiko rendah.
7. **Temuan 5 + 9** — perbaikan deteksi dulu, lalu update instalasi (butuh sign-off: menulis ke
   direktori plugin bersama).
8. **Temuan 8, 13b, 14–17** — payload, meter, sanitasi path, higiene.

---

## Catatan: repo ini ditulis bersama thread lain

Saat audit ini berjalan, `veto-hooks/{pi,omp}/tna-veto.ts` dan `veto-hooks/dsh/tna-veto.mjs`
**berubah di tengah sesi** (pi/omp: 11.9 KB → 15.8 KB, 6:16–6:18 PM; dsh: 11.4 KB → 15.2 KB).
Saya tidak mengedit file itu. `bb thread list` menunjukkan `thr_w9kymze8qu` ("Debug trust no agent
di omp") berstatus **active** di project yang sama.

Akibatnya dua probe saya sempat saling bertentangan pada satu kasus (`echo $(git commit -m x)`):
probe pertama mengukur salinan lama, probe kedua salinan baru. Angka di laporan ini adalah hasil
**pengukuran ulang terakhir** terhadap snapshot yang hash-nya dicetak di awal probe
(`.tmp/probe-scope-final.mjs`), dan hanya itu yang saya klaim.

Pelajaran untuk siapa pun yang mengulang audit ini: **catat hash file sebelum mengukur.** Repo ini
punya lebih dari satu penulis aktif, dan kesimpulan "adapter X buta pada Y" bisa berubah di tengah
jalan.

---

## Cara mereproduksi

Semua angka di atas berasal dari perintah yang dijalankan di sesi ini. Yang paling padat:

```powershell
node scripts/validate.mjs                       # temuan 1
node scripts/gate-hook.test.mjs                 # baseline hijau (43/43 suite)
node .tmp/probe-scope-final.mjs                 # scope 2,3,10,11,12,13 + hash snapshot
node .tmp/probe-scope-ttl.mjs                   # scope 3,14
node .tmp/probe-donegates2.mjs                  # temuan 12 per event harness
node .tmp/probe-meter-blind.mjs                 # temuan 13b
node .tmp/probe-report-evidence.mjs             # temuan 4,5,9,15,16
node .tmp/probe-logveto.mjs                     # temuan 14
node .tmp/probe-payload-root.mjs                # temuan 8
```

Temuan 4 bisa direproduksi tanpa skrip apa pun:

```powershell
node --input-type=module -e @'
import { newestEntry, vetoVerdict } from "file:///C:/Users/Lenovo/projects/trust-no-agent/scripts/receipt-enforcement.mjs";
const D = "\u2014";
const ledger = [
  "## 2026-10-24", "", "#### Receipt", "**Verdict** " + D + " old",
  "constraints satisfied " + D + " x",
  "evidence fresh " + D + " `node scripts/validate.mjs` \u2192 OK",
  "scope held " + D + " x", "subject verified " + D + " x", "fail-first proven " + D + " x",
  "**Evidence** " + D + " x", "**Open** " + D + " x", "**Next** " + D + " x", "",
  "## 2026-10-25", "", "### newest entry, closed without a #### Receipt heading", "",
].join("\n");
console.log("anchor:", newestEntry(ledger).date);              // 2026-10-24, bukan 2026-10-25
console.log(JSON.stringify(vetoVerdict({ ledgerText: ledger, today: new Date("2026-10-25T12:00:00Z"), root: "C:/Users/Lenovo/projects/trust-no-agent" })));
'@                                                             # {"allow":true}
```

`.tmp/` gitignored; probe itu skrip ad-hoc, bukan bagian dari suite. Setiap temuan di atas sudah
memuat perintah minimalnya sendiri, jadi skrip itu tidak wajib ada untuk verifikasi ulang.
