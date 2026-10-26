# dsh fix-list — temuan khusus DeepSeek Harness

**Snapshot terukur:** 2026-10-25 19:27 (+07:00)
**Scope:** HANYA DeepSeek Harness. Temuan general (yang juga berlaku di pi/omp/Claude Code/Codex)
sengaja tidak dimasukkan — lihat `docs/audit-run-blockers-2026-10-25.md` untuk itu.

**Hash snapshot** (pakai ini untuk memastikan Anda memperbaiki versi yang sama):

| File | sha256 (12) | Bytes | mtime |
|---|---|---|---|
| `veto-hooks/dsh/tna-veto.mjs` | `797c7d6fa9f0` | 15252 | 10-25 18:18 |
| `veto-hooks/dsh/tna-discipline.mjs` | `6626c04e562e` | 10909 | 10-25 11:10 |
| `scripts/action-gate.mjs` | `328cacfba36b` | 13037 | 10-25 09:42 |
| `AGENTS.md` | `481231b14708` | 17278 | 10-25 11:14 |

> **Penting:** file dsh **sudah berubah** sejak audit pertama (recorder sekarang per-segment,
> ada `TEST_RUNNER` di L74). Semua nomor baris di bawah adalah untuk snapshot di atas. Kalau hash
> berbeda, cari ulang lewat nama fungsi yang disebut, jangan lewat nomor baris.

---

## Cara pakai file ini

Setiap entri punya: **file:baris** → **gejala** → **perbaikan**. Kerjakan berurutan; nomor 1
memblokir semua yang lain (CI merah tanpa itu).

---

## 1. `scripts/validate.mjs` — CI merah karena nama file dsh dianggap nama skill

**File:** `scripts/validate.mjs` (fungsi `checkRefs`, sekitar L120-135) ·
`skills/meta/setup-tna/SKILL.md:114,115,136,138,139` · `AGENTS.md:106,108`

**Gejala:**

```
$ node scripts/validate.mjs
ERROR AGENTS.md references unknown skill: `cordis.patch.yml`
ERROR AGENTS.md references unknown skill: `testPassFresh`
ERROR skills/meta/setup-tna references unknown skill: `cordis.patch.yml`
ERROR skills/meta/setup-tna references unknown skill: `tna-veto.mjs`
ERROR skills/meta/setup-tna references unknown skill: `tna-discipline.mjs`
FAIL: 5 structural error(s).   [exit 1]
```

**Sebab:** validator menganggap **setiap** token dalam backtick sebagai nama skill, kecuali ada di
`NON_SKILL_TERMS`. Prosa dsh menyebut nama file (`.mjs`, `.yml`) dan field state
(`testPassFresh`) di dalam backtick.

**Perbaikan:** di `checkRefs`, lewati token yang bukan berbentuk skill. Blok `docs/skills/` di file
yang sama sudah punya filternya — pakai yang sama:

```js
const SKILL_SHAPED = /^[a-z]+(?:-[a-z]+)*$/;
// di checkRefs, sebelum err(...):
if (!SKILL_SHAPED.test(ref)) continue;
```

Jangan tambah kelima nama itu ke `NON_SKILL_TERMS` — daftar itu akan terus tumbuh setiap kali
prosa menyebut nama file baru.

**Verifikasi:** `node scripts/validate.mjs` → `OK: 3 categories, 12 skills, no structural errors.`

---

## 2. `veto-hooks/dsh/tna-veto.mjs:375` — test MERAH dicatat sebagai bukti HIJAU

**File:** `veto-hooks/dsh/tna-veto.mjs:375` (recorder) · `:273-280` (`readEvidence`)

**Gejala:**

```
D1 red run -> testPassFresh = true     (seharusnya false / tidak dicatat)
D1 commit setelah red run -> {"kind":"allow"}   (seharusnya deny)
```

**Sebab:** `recordEvidence(cwd, { command, pass: result?.isError !== true })`. dsh **tidak**
menandai exit non-nol sebagai `isError` — didokumentasikan sendiri di
`@deepseek-ai/dsh-tool-bash/lib/index.js:141-143`:

> "Non-zero exits are reported, not errored — the model decides how to react; only
> infrastructure failures (spawn errors, aborts) surface as isError results."

dsh menulis exit code ke **teks** hasil sebagai `[exit code: N]`
(`dsh-tool-bash/lib/index.js:167`). Jadi suite merah selalu `isError: false` → selalu lulus.

**Perbaikan:** baca sinyal keluar dari hasil, bukan dari `isError`:

```js
function runPassed(result) {
  if (result?.isError === true) return false;
  // dsh menulis penanda ini ke teks hasil; tidak ada penanda = exit 0.
  const text = Array.isArray(result?.content)
    ? result.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    : '';
  const m = /\[exit code: (-?\d+)\]/.exec(text);
  if (m) return Number(m[1]) === 0;
  // Penanda hilang + isError false: JANGAN tebak lulus.
  return null; // null = tidak mencatat apa pun (unknown ≠ pass)
}
```

lalu di L375: `const pass = runPassed(result); if (pass === null) return; recordEvidence(...)`.

**Verifikasi:** test baru dengan bentuk dsh asli —
`{ isError: false, content: [{ type:'text', text:'FAIL\n[exit code: 1]' }] }` → **tidak** boleh
menulis `testPassFresh: true`, dan `git commit` setelahnya harus **deny**.

---

## 3. `veto-hooks/dsh/tna-veto.mjs:273-280` — bukti test tidak pernah kedaluwarsa

**File:** `veto-hooks/dsh/tna-veto.mjs:273-280` (`readEvidence`)

**Gejala:**

```
D2 2020 evidence -> ALLOWED    (seharusnya BLOCKED)
D8 readEvidence reads updatedAt: false
```

**Sebab:** `recordEvidence` menulis `updatedAt` (`:288`), `readEvidence` tidak pernah membacanya.
Sekali ada test hijau di sebuah repo, gate commit di repo itu terbuka **selamanya**.

**Perbaikan:** di `readEvidence`, tolak state yang lebih tua dari jendela:

```js
const MAX_AGE_MS = 30 * 60 * 1000; // 30 menit; pilih satu nilai dan dokumentasikan
const age = Date.now() - Date.parse(state.updatedAt ?? '');
if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return { testPassFresh: false, ... };
```

**Verifikasi:** state `updatedAt: 2020-01-01` → `git commit` harus **deny**.

---

## 4. `veto-hooks/dsh/tna-veto.mjs:252` (`classifyCommand`) — buta pada `sudo` / `bash -c` / `sh -c`

**File:** `veto-hooks/dsh/tna-veto.mjs:252-267` (`classifyCommand`) · `:114-136` (`segments`)

**Gejala:**

```
D3 classifier missed 3/9: ["bash -c \"git commit -m x\"", "sh -c \"git push\"", "sudo git commit -m x"]
```

`classifyCommand` hanya memeriksa kata pertama tiap segment. `sudo` menjadi kata pertama, dan
payload di dalam tanda kutip tidak pernah dilihat. **Tidak ada** `EXEC_WRAPPERS` / `INTERPRETERS`
di file ini (dikonfirmasi grep: kosong).

**Perbaikan:** port dua mekanisme dari `scripts/action-gate.mjs`:

- `EXEC_WRAPPERS = ['sudo','env','command','nohup','time','exec','doas','builtin']` — lewati wrapper
  + flag + assignment sebelum menentukan head (lihat `matchAtExecution`, `action-gate.mjs`).
- `INTERPRETERS = ['bash','sh','zsh','dash','ksh','pwsh','powershell','cmd','eval']` — kalau head
  adalah interpreter, ambil isi tanda kutip dan rekursi `classifyCommand` ke dalamnya.

**Verifikasi:** ketiga bentuk di atas harus **deny**, dan `git status` tetap allow.

---

## 5. `veto-hooks/dsh/tna-veto.mjs:332,339` — ledger append-only lolos di jalur shell

**File:** `veto-hooks/dsh/tna-veto.mjs:332` (cabang `WRITE_TOOLS`) · `:339` (cabang `SHELL_TOOLS`)

**Gejala:**

```
D4 PASSED   bash: > .trust/progress.txt              (seharusnya BLOCKED)
D4 PASSED   bash: Set-Content .trust/progress.txt "x" (seharusnya BLOCKED)
D4 PASSED   pwsh: Set-Content .trust/progress.txt "x" (seharusnya BLOCKED)
D4 BLOCKED  write: .trust/progress.txt                (sudah benar)
```

**Sebab:** pemeriksaan ledger (`isLedgerPath`) hanya ada di cabang `WRITE_TOOLS`. Cabang
`SHELL_TOOLS` langsung ke `classifyCommand` tanpa memeriksa path ledger, jadi redirect/truncate
lewat shell tidak pernah tertangkap.

**Perbaikan:** di dalam cabang `SHELL_TOOLS`, sebelum `classifyCommand`, jalankan pemeriksaan
overwrite yang sama seperti `scripts/action-gate.mjs` (`LEDGER_OVERWRITE_PATTERNS` sudah memuat
`set-content`, `out-file`, `>` truncate, `tee`) dengan pengecualian append `>>`.

**Verifikasi:** tiga bentuk di atas **deny**; `echo x >> .trust/progress.txt` tetap **allow**.

---

## 6. `veto-hooks/dsh/tna-discipline.mjs:188` — done-gate salah tipe blok

**File:** `veto-hooks/dsh/tna-discipline.mjs:188` (di `toolNamesIn`)

**Gejala:**

```
D6 block "tool-call" (bentuk ASLI dsh) -> flagged: true    (seharusnya false)
D6 block "tool_use"  (bukan dsh)       -> flagged: false
```

**Sebab:** adapter mencari `block.type === 'tool_use' || 'toolCall'`. dsh mengirim
`block.type === "tool-call"` (`dsh-agent-loop/lib/index.js:1164`). Jadi bukti tidak pernah
terlihat → klaim "done" yang **sudah** menjalankan test tetap kena notice receipts.

**Perbaikan:**

```js
const TOOL_BLOCK_TYPES = new Set(['tool-call', 'tool_use', 'toolCall']);
if (typeof block.name === 'string' && TOOL_BLOCK_TYPES.has(block.type)) names.add(...)
```

**Verifikasi:** turn dengan `{ type: 'tool-call', name: 'bash' }` + klaim "Done" → **tidak**
di-flag. Turn tanpa tool call → tetap di-flag.

---

## 7. `veto-hooks/dsh/tna-discipline.mjs:77-95` — klasifier MANDATORY false positive

**File:** `veto-hooks/dsh/tna-discipline.mjs:76-95` (tabel `PATTERNS`)

**Gejala:**

```
D5 mandatory false positives: 3/4
   fix the typo in the heading      -> root-cause
   what does the test runner print  -> expect-fail
   perbaiki ejaan di docs           -> root-cause
```

**Sebab:** komentar di file mengklaim "in lockstep with … scripts/mandatory-gate.mjs", tapi
tabelnya jauh lebih longgar: `/\btest(s|ing)?\b/`, `/\bfix(es|ed|ing)?\b/`, `/\bsalah\b/`.
Klasifier kanonik sengaja tidak memakai kata telanjang itu (ada tabel negasi + aturan klausa).

**Perbaikan:** jangan salin-tempel tabel; impor klasifier kanonik. Karena plugin dimuat by path
dari profil dan tidak bisa resolve paket framework, **tanpa duplikasi** caranya: tanam ulang
`KEYWORD_TABLES` + `NEGATION_MARKERS` + logika klausa dari `scripts/mandatory-gate.mjs` apa adanya
(sama seperti `TEST_RUN` di tna-veto yang sudah diduplikasi), lalu **pin dengan test paritas**
yang memuat kalimat-kalimat di atas sebagai korpus.

**Verifikasi:** ketiga kalimat di atas → **tidak** memicu domain. `fix the bug` → tetap root-cause.

---

## 8. `veto-hooks/dsh/tna-veto.mjs:371-377` — denial tidak menulis log meter

**File:** `veto-hooks/dsh/tna-veto.mjs:371-377` (recorder `tools/result`) · tidak ada penulisan log

**Gejala:**

```
D7 denied=true  tna-gate-log written=false
```

**Sebab:** hanya `scripts/gate-hook.mjs` yang menulis `.trust/tna-gate-log.jsonl`
(`logVeto` di `scripts/tna-gate.mjs:58`). Adapter dsh memblokir tanpa jejak, jadi
`scripts/gate-meter.mjs` melaporkan "veto fires: no data yet" walaupun veto bekerja.

**Perbaikan:** tambahkan `appendFileSync` ke `.trust/tna-gate-log.jsonl` di setiap cabang deny,
dengan bentuk baris yang sama seperti `logVeto` (`{ts, harness:'dsh', tool, command}`). Jangan
impor `scripts/tna-gate.mjs` — plugin dimuat by path dan tidak boleh bergantung pada tree framework.

**Verifikasi:** setelah satu denial, `.trust/tna-gate-log.jsonl` ada dan `parseVetoLog` menghitung 1.

---

## 9. `veto-hooks/dsh/tna-veto.mjs:47` — surface shell yang belum tercakup

**File:** `veto-hooks/dsh/tna-veto.mjs:47` (`SHELL_TOOLS`) · `:169` (`WRITE_TOOLS`)

**Status:** terukur sebagai *kemungkinan*, bukan kebocoran terbukti — `terminal_*` dan `job_*`
tidak di-mount lewat `cordis.patch.yml` profil `acp` (grep kosong), tapi bisa datang dari bundle.

**Tool dsh yang menjalankan/mengubah state tanpa field `command`:**

| Paket | Tool | Field | Tercakup? |
|---|---|---|---|
| `dsh-tool-terminal` | `terminal_open/send/read/signal/close/list` | `text` | **tidak** |
| `dsh-tool-jobs` | `job_kill` | `jobId` | **tidak** (bisa mematikan proses) |
| `dsh-tool-bash-persistent` | `bash` | `command` | ya |
| `dsh-tool-str-replace-editor` | `str_replace_editor` | `path` | ya (`WRITE_TOOLS`) |

**Perbaikan:** tambahkan `terminal_send` ke pemeriksaan payload (field `text`), dan perlakukan
`terminal_open` + `terminal_send` sebagai shell untuk tujuan klasifikasi. `job_kill` tidak
irreversible — cukup didokumentasikan.

**Verifikasi:** `terminal_send` dengan `text: 'git commit -m x'` → deny tanpa bukti.

---

## 10. `skills/meta/setup-tna/scripts/onboarding.mjs` — payload dsh tidak bisa memasang dirinya

**File:** `skills/meta/setup-tna/scripts/onboarding.mjs` (`const ROOT = join(dirname(...), '..')`,
sekitar L200) · `:244` (`installSkills`) · `:990` (sumber plugin opencode)

**Gejala:**

```
C:/Users/Lenovo/.dsh/skills/setup-tna/scripts/onboarding.mjs
  ROOT                    -> C:\Users\Lenovo\.dsh\skills\setup-tna
  ROOT/skills             -> false      ← installSkills tidak menemukan sumber
  ROOT/veto-hooks         -> true       ← hanya adapter yang ikut
```

**Sebab:** `ROOT` dihitung sebagai `dirname(script)/..`. Ketika skill dipasang sebagai payload
(`~/.dsh/skills/setup-tna/`), `ROOT` menunjuk folder skill itu — di sana tidak ada `skills/`.

**Perbaikan:** bawa `skills/**` ke dalam payload skill (sudah ada mekanisme `copyTree`), **atau**
buat CLI menolak dengan exit ≠ 0 dan pesan jelas ketika `ROOT/skills` tidak ada. No-op senyap
adalah bentuk terburuknya.

**Catatan:** 12 skill dsh di `~/.dsh/skills/` **sudah ada** dan isinya sama dengan repo — jadi
dampak nyata saat ini rendah. Yang rusak adalah jalur instalasi untuk pengguna baru.

**Verifikasi:** dari `~/.dsh/skills/setup-tna/`, `installSkills` mengembalikan `copied` tidak kosong
(atau CLI exit ≠ 0 dengan pesan).

---

## 11. `AGENTS.md:106,108` — `testPassFresh`/`cordis.patch.yml` di backtick (bagian dari #1)

Sudah tercakup di #1. Disebut terpisah karena baris ini yang **paling sering** memicu error
validator saat prosa dsh diedit.

---

## 12. `docs/compatibility.md` — baris dsh mengklaim lebih dari yang terukur

**File:** `docs/compatibility.md` (tabel "Full-function matrix", baris `dsh`; dan baris "veto
guarantee" untuk dsh)

**Klaim saat ini:** "veto (**proven live 2026-10-25 on dsh `--profile headless`**) … Covers both
dsh shell tools (`bash`, `pwsh`)."

**Yang terukur sekarang:** deny memang bekerja untuk `git commit` polos, tapi **lolos** untuk
`sudo git commit`, `bash -c "git commit"`, `sh -c "git push"` (temuan #4), dan recorder menerima
suite merah (#2).

**Perbaikan:** setelah #2 dan #4 diperbaiki, tambahkan bukti dua sisi untuk bentuk-bentuk itu;
sebelum itu, turunkan klaimnya jadi WARN/doc-first untuk bentuk wrapper. Jangan biarkan baris
"proven" menutupi bentuk yang belum diuji.

---

## Urutan eksekusi yang disarankan

1. **#1** validator — tanpa ini tidak ada perubahan yang bisa masuk CI.
2. **#2 + #3** — satu unit (keduanya di `readEvidence`/`recordEvidence`, butuh test merah dengan
   bentuk dsh asli).
3. **#4 + #5** — satu unit (`classifyCommand` + cabang shell ledger); keduanya soal "apa yang
   dianggap perintah".
4. **#6 + #7** — satu unit (`tna-discipline.mjs`), keduanya soal "apa yang dianggap bukti".
5. **#8** — meter.
6. **#9** — surface tambahan (butuh keputusan: apakah `terminal_*` di-mount di profil yang dipakai).
7. **#10** — payload.
8. **#12** — dokumentasi, terakhir (setelah bukti ada).

---

## Test yang harus ada (dan sekarang belum ada)

Setiap perbaikan butuh test merah dulu. Yang paling penting, dan semuanya memakai **bentuk dsh
asli**, bukan fixture sintetis:

| Untuk | Test | Bentuk yang harus dipakai |
|---|---|---|
| #2 | recorder menolak suite merah | `{ isError: false, content:[{type:'text',text:'FAIL\n[exit code: 1]'}] }` |
| #2 | recorder menerima suite hijau | `{ isError: false, content:[{type:'text',text:'ALL PASS'}] }` |
| #3 | state basi menutup gate | `updatedAt: '2020-01-01'` |
| #4 | wrapper/interpreter | `sudo git commit`, `bash -c "git commit"` |
| #5 | ledger lewat shell | `> .trust/progress.txt`, `Set-Content` |
| #6 | done-gate tidak false-positive | `{ type: 'tool-call', name: 'bash' }` |
| #7 | mandatory tidak false-positive | `fix the typo in the heading` |
| #8 | denial tercatat | `.trust/tna-gate-log.jsonl` ada setelah deny |

Test yang ada sekarang hijau karena memakai bentuk yang salah — itu sebabnya delapan temuan di
atas tidak pernah ketahuan. Mengganti fixture-nya adalah bagian dari perbaikan, bukan tambahan.

---

## Cara mengukur ulang

```powershell
# snapshot + semua temuan dsh dalam satu jalan
node .tmp/probe-dsh-scope-now.mjs

# CI (temuan #1)
node scripts/validate.mjs

# suite yang ada (harus tetap hijau)
node scripts/dsh-veto.test.mjs
node scripts/dsh-discipline.test.mjs
```

`.tmp/probe-dsh-scope-now.mjs` mencetak hash file di awal — kalau hash berbeda dari tabel di atas,
ukur ulang dulu sebelum memperbaiki.
