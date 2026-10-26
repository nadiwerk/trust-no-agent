# omp fix-list — kenapa trust-no-agent tidak berjalan baik di oh-my-pi

**Snapshot terukur:** 2026-10-25, omp `18.10.4` (`~/.bun/bin/omp.exe`).
**Scope:** adapter omp (`veto-hooks/omp/`), jalur instalasinya, dan perilaku omp
yang membuat adapter itu gagal. Temuan general yang **sudah** tercatat di
`docs/audit-run-blockers-2026-10-25.md` (bukti merah diterima hijau, TTL bukti,
wrapper/interpreter, meter buta, ledger append-only) **tidak diulang di sini**
kecuali ada angka omp yang belum ada di sana — untuk itu entri menunjuk balik.

Setiap entri punya: **file:baris** → **gejala terukur** → **sebab** → **perbaikan** →
**cara verifikasi**. Yang tidak bisa diukur ditandai *inferred*, bukan diklaim.

---

## Hash snapshot

Pakai ini untuk memastikan Anda memperbaiki versi yang sama. Kalau hash berbeda,
cari ulang lewat nama fungsi, **jangan** lewat nomor baris.

| File | sha256 (12) | Bytes | mtime |
|---|---|---|---|
| `veto-hooks/omp/tna-veto.ts` | `391535585f0b` | 15796 | 10-25 18:17 |
| `veto-hooks/omp/tna-discipline.ts` | `0791b736a705` | 15308 | 10-25 13:01 |
| `veto-hooks/omp/tna-receipts-gate.ts` | `f57ada61a577` | 6088 | 10-12 21:00 |
| `scripts/action-gate.mjs` | `328cacfba36b` | 13037 | 10-25 09:42 |
| `scripts/tna-gate.mjs` | `7ef6ecb40b48` | 6208 | — |
| `scripts/mandatory-gate.mjs` | `5f120dd6072c` | 7805 | — |
| `scripts/onboarding.mjs` | `377e664c0c4b` | 58374 | — |
| `AGENTS.md` | `481231b14708` | 17278 | — |

Instalasi yang **dipakai** sesi ini (sudah dicek byte-identik dengan repo):
`~/.omp/agent/hooks/pre/{tna-veto.ts,tna-discipline.ts}`,
`~/.omp/agent/extensions/tna-receipts-gate.ts`.

Instalasi yang **basi**: `~/.agents/skills/setup-tna/` dan
`~/.omp/agent/skills/setup-tna/` (lihat #3).

---

## Ringkas

| # | Temuan | Level | Terukur di |
|---|---|---|---|
| 1 | Arming delegasi tidak pernah sampai ke tool call | **P0** | omp (probe kontrak) |
| 2 | Veto delegasi buta pada bentuk `tasks[]` — bentuk wire omp sendiri | **P0** | omp (probe) |
| 3 | Payload stale di `~/.agents/skills/setup-tna` = dinding, bukan gate | **P0** | jalur instalasi skill |
| 4 | Veto lolos `sudo` / `bash -c` / `sh -c` / `env X=1` | P1 | omp vs kanonik |
| 5 | Recorder mencatat run MERAH sebagai hijau saat `isError` absen | P1 | omp |
| 6 | Bukti test tidak pernah kedaluwarsa | P1 | omp |
| 7 | Denial tidak menulis `tna-gate-log.jsonl` → meter buta | P1 | omp (live) |
| 8 | Done-gate menghitung `read`/`write`/`edit` sebagai verifikasi | P1 | omp |
| 9 | Floor resolve dari `process.cwd()` → jatuh ke router basi 33 baris | P1 | omp (probe) |
| 10 | `detectHarness` menangkap `.opencode` lebih dulu → omp tak terpasang | P1 | repo ini (stamp) |
| 11 | Klasifier mandatory menyimpang + teramplifikasi teks sistem | P2 | omp vs kanonik |
| 12 | Tidak ada satu test pun untuk adapter discipline omp | P3 | repo |

**Jawaban singkat:** tiga temuan mematikan. Satu (#1) membuat seluruh lapisan
arming delegasi omp **inert tanpa error** — ia terlihat terpasang dan dilaporkan
"PASS" oleh doctor. Satu (#2) membuat veto delegasi tidak pernah memeriksa bentuk
yang benar-benar dikirim omp. Satu (#3) membuat adopter yang mengikuti instruksi
skill resmi mendapat **dinding** (veto yang tidak bisa dibuka), bukan gate.

---

# P0 — mematikan

## 1. Arming delegasi tidak pernah sampai ke tool call

**File:** `veto-hooks/omp/tna-discipline.ts:370-372`

```js
return batch && batch.length
  ? { ...input, tasks: next }
  : { ...input, task: next[0].task };
```

**Gejala terukur.** Handler `tool_call` mengembalikan objek dengan kunci
`context`/`tasks` di top level, **tanpa** kunci `input`:

```
$ node .tmp/probe-arming2.mjs
handler returned a top-level `input` key : false
handler returned other keys             : context,tasks
=> harness replaces the tool input      : NO — arming silently discarded
```

**Sebab.** Kedua jalur dispatch omp memakai helper merge yang sama
(`dist/cli.js`, `function Tdt`): ia hanya mengganti input kalau hasil handler
punya kunci `input`.

```js
// HookRunner.emitToolCall — dist/cli.js
let { additionalContext, input, ...rest } = a; ydt(s, a), n = rest
// Tdt: return { ...rest, ...(input !== undefined ? { input } : {}) }
```

`ExtensionRunner.emitToolCall` memakai destructure yang identik. Jadi objek
`{context, tasks}` dianggap "tidak ada input baru", arming dibuang, dan kontrak
`Trust No Agent — delegated-execution contract` tidak pernah masuk ke prompt
subagent. Tidak ada error, tidak ada warning — kegagalannya **senyap**.

**Perbaikan.** Bungkus di kunci `input` (bentuk yang dibaca harness):

```js
const revised = batch && batch.length
  ? { ...input, tasks: next }
  : { ...input, task: next[0].task };
return { input: revised };
```

**Verifikasi.**

```bash
node -e "
const m = await import('file:///C:/Users/Lenovo/.omp/agent/hooks/pre/tna-discipline.ts');
const h = new Map(); m.default({ on: (e,f) => { if(!h.has(e)) h.set(e,[]); h.get(e).push(f); } });
const r = await h.get('tool_call')[0]({ type:'tool_call', toolName:'task', toolCallId:'t1',
  input:{ context:'c', tasks:[{ task:'fix the parser bug' }] } }, { cwd: process.cwd() });
console.log('has .input:', r?.input !== undefined, '| armed:', JSON.stringify(r).includes('delegated-execution contract'));
"
# harus: has .input: true | armed: true
```

---

## 2. Veto delegasi buta pada `tasks[]` — bentuk wire omp sendiri

**File:** `veto-hooks/omp/tna-veto.ts:185` (`DELEGATION_TOOLS`),
`:188-193` (`payloadText`), `:304-310` (`classifyPayload`)

```js
const DELEGATION_TOOLS = new Set(['task', 'subagent', 'workflow', 'ralph']);
function payloadText(input) {
  for (const key of ['code', 'script', 'objective', 'prompt', 'task', 'instructions']) {
    if (typeof input?.[key] === 'string') return input[key];
  }
  return '';
}
if (DELEGATION_TOOLS.has(toolName)) return classifyAnywhere(payloadText(input));
```

**Gejala terukur.** Bentuk batch — satu-satunya bentuk yang membawa `context`
bersama — lolos sepenuhnya:

```
$ node .tmp/probe-batch.mjs
single task              -> {"block":true, ...}
batched (tasks[])        -> "ALLOWED"
batched + context        -> "ALLOWED"
batched w/ name only     -> "ALLOWED"
```

Begitu juga `context` pada bentuk flat — field yang **memang** masuk ke system
prompt subagent (`src/task/executor.ts:412`, `SubagentPromptInputs.context`):

```
$ node .tmp/probe-batch2.mjs
single task, action in task    -> BLOCKED
single task, action in name    -> "ALLOWED"
single task, action in context -> "ALLOWED"
```

`name` sengaja **tidak** dihitung sebagai lubang: ia hanya label UI
(`src/task/index.ts:316,804` — `allocate(spawn.name)`), tidak pernah sampai ke
prompt anak, jadi mengklasifikasinya hanya menambah false positive.

**Sebab.** omp mendeklarasikan **dua** bentuk wire untuk `task`
(`src/task/index.ts:228`): `{ context, tasks[] }` saat `task.batch` aktif, dan
`{ task }` flat. `payloadText` hanya membaca kunci skalar, jadi `tasks[]`
(sebuah array) tidak pernah cocok dan `payloadText` mengembalikan `''` —
`classifyAnywhere('')` tidak pernah menghitung apa pun. `context` juga tidak ada
di daftar kunci, padahal `context` adalah tempat instruksi bersama biasanya
ditulis.

**Perbaikan.** Ratakan semua teks payload sebelum klasifikasi:

```js
function payloadText(input) {
  const out = [];
  for (const key of ['code', 'script', 'objective', 'prompt', 'task', 'instructions', 'context']) {
    if (typeof input?.[key] === 'string') out.push(input[key]);
  }
  if (Array.isArray(input?.tasks)) {
    for (const item of input.tasks) out.push(payloadText(item));
  }
  return out.join('\n');
}
```

**Verifikasi.** Ulangi `probe-batch.mjs`; keempat bentuk harus `block: true`.
`probe-batch2.mjs` harus memblokir bentuk `context`, dan **tetap** meloloskan
`name`-only (itu label, bukan instruksi).

---

## 3. Payload stale di `~/.agents/skills/setup-tna` — dinding, bukan gate

**File:** `~/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts` (3382 B,
sha256 `9e143c540210`) vs `veto-hooks/omp/tna-veto.ts` (15796 B).

**Gejala terukur.**

```
$ ls ~/.agents/skills/setup-tna/veto-hooks/omp
tna-veto.ts                       # hanya ini; discipline + receipts-gate tidak ada
$ ls ~/.omp/agent/skills/setup-tna/veto-hooks/omp
tna-veto.ts                       # root kedua, sama-sama basi
$ grep -c "tool_result\|recordEvidence\|isError" ~/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts
0 0 0
$ grep -n "toolName !==" ~/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts
60:    if (event.toolName !== "bash") return;
```

Payload itu adalah versi pra-2026-10-25: hanya `toolName === "bash"`, substring
`git commit`, tanpa recorder. Tiga lubang yang **sudah ditutup** di repo masih
hidup di sana. Selain itu installer payload-nya juga basi:

```
repo      scripts/onboarding.mjs        58374 B  sha256 377e664c0c4b   (punya --refresh, adaptersFor, 3 adapter omp)
installed .../setup-tna/scripts/onboarding.mjs  32102 B  sha256 e8fa1841b230   (grep -c --refresh = 0)
```

**Sebab.** `SKILL.md` (baris ~148) menyuruh adopter menjalankan
`scripts/onboarding.mjs` **dari dalam folder skill**. Folder itu tidak pernah
disinkronkan ulang sejak 10-17/10-18. `scripts/sync-payloads.mjs` menyinkronkan
**repo → payload repo** (`skills/meta/`, `plugin/`), bukan **repo → `~/.agents/`**,
dan doctor tidak punya cek untuk itu.

**Akibat konkret.** Adopter omp yang mengikuti instruksi resmi mendapat veto
yang **tidak bisa dibuka**: tidak ada `tool_result` recorder, jadi
`testPassFresh` tidak pernah ditulis harness, dan setiap `git commit` ditolak
selamanya dengan `Project state: (missing)`. Ditambah guard
`toolName !== "bash"` — di Windows (omp mendeklarasikan `powershell`) gate-nya
bahkan tidak pernah melihat command-nya.

**Perbaikan.** Dua langkah:
1. Salin ulang seluruh `veto-hooks/omp/` + `scripts/onboarding.mjs` ke
   `~/.agents/skills/setup-tna/` (dan `~/.omp/agent/skills/setup-tna/`) dari
   checkout, lalu jalankan `node scripts/sync-payloads.mjs` untuk memastikan
   tidak ada root lain yang tertinggal.
2. Tambah cek doctor: bandingkan hash `~/.agents/skills/setup-tna/**` terhadap
   `skills/meta/setup-tna/**` dan WARN kalau berbeda — hari ini doctor PASS
   pada adapter yang terpasang sambil diam soal payload yang akan dipakai
   instalasi berikutnya.

**Verifikasi.**

```bash
node -e "
const fs=require('fs'),c=require('crypto');
const h=p=>c.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0,12);
console.log(h('veto-hooks/omp/tna-veto.ts'), h(process.env.USERPROFILE+'/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts'));
"
# dua hash harus sama
```

---

# P1 — lapisan tersambung tapi bocor

## 4. Veto lolos `sudo` / `bash -c` / `sh -c` / `env X=1`

**File:** `veto-hooks/omp/tna-veto.ts:249` (`classifyCommand`)

```
$ node .tmp/probe-wrappers.mjs
git commit -m x              omp: BLOCKED  canonical: BLOCKED
sudo git commit -m x         omp: ALLOWED  canonical: BLOCKED
bash -c "git commit -m x"    omp: ALLOWED  canonical: BLOCKED
sh -c "git commit -m x"      omp: ALLOWED  canonical: BLOCKED
env FOO=1 git commit -m x    omp: ALLOWED  canonical: BLOCKED
```

Sudah tercatat sebagai temuan #10 di `audit-run-blockers-2026-10-25.md` untuk
pi/omp/dsh. Angka di atas adalah bukti omp yang bisa dipakai sebagai test case
regresi.

**Perbaikan.** Ambil `EXEC_WRAPPERS`/`INTERPRETERS` dari
`scripts/action-gate.mjs` dan pakai di `classifyCommand` sebelum memeriksa head
segmen — atau lebih baik: panggil klasifier kanonik, jangan salin grammarnya.

---

## 5. Recorder mencatat run MERAH sebagai hijau saat `isError` absen

**File:** `veto-hooks/omp/tna-veto.ts:367`

```js
recordEvidence(resolveCwd(event, ctx), { command, pass: event?.isError !== true });
```

**Gejala terukur.**

```
$ node .tmp/probe-evidence3.mjs
red run, isError absent  -> recorded testPassFresh: true
   then git commit       -> "ALLOWED"
```

**Sebab.** `isError !== true` benar untuk **tiga** keadaan: `false`, `undefined`,
dan kunci yang tidak ada. Kontrak kanonik menuntut eksplisit
(`scripts/tna-gate.mjs:112-116`):

> `pass` must be an explicit boolean — an unknown outcome records nothing
> (a guessed pass is the forgery hole again).

**Perbaikan.**

```js
if (typeof event?.isError !== 'boolean') return;   // outcome tak diketahui: jangan catat apa pun
recordEvidence(resolveCwd(event, ctx), { command, pass: !event.isError });
```

**Verifikasi.** `probe-evidence3.mjs` harus mencetak `(nothing recorded)` lalu
`BLOCKED`.

---

## 6. Bukti test tidak pernah kedaluwarsa

**File:** `veto-hooks/omp/tna-veto.ts:270-278` (`readEvidence` tidak membaca
`updatedAt`).

**Gejala terukur.** State repo ini sendiri (ditulis **2026-10-23**) masih
membuka gate hari ini:

```
$ cat .trust/tna-gate-state.json
{ "testPassFresh": true, "command": "node scripts/gate-hook.test.mjs …",
  "updatedAt": "2026-10-23T07:08:24.594Z" }
$ (probe tool_call)  git commit -m stale  -> "ALLOWED"
```

**Perbaikan.** Baca `updatedAt` dan perlakukan bukti lebih tua dari jendela
sesi sebagai `false`. Pilih jendela yang sama untuk keempat adapter supaya
tidak lahir definisi "fresh" yang berbeda-beda.

---

## 7. Denial tidak menulis `tna-gate-log.jsonl` → meter buta

**File:** `veto-hooks/omp/tna-veto.ts` — tidak ada `logVeto`/`appendFileSync`
sama sekali (grep: 0 kecocokan), padahal `scripts/gate-meter.mjs:6` menyatakan
sumbernya:

> `parseVetoLog` (the JSONL veto-fire log **hooks append on every denial**)

**Gejala terukur (live).** Satu denial nyata di repo bersih:

```
$ cd .tmp/tna-live && omp -p "… git -C . commit --allow-empty -m probe" --auto-approve
tna-gate veto: "git commit" is irreversible … Project state: (missing)
$ ls .tmp/tna-live/.trust
tna-gate-state.json          # hanya state; TIDAK ada tna-gate-log.jsonl
```

Jadi denial berhasil (veto bekerja) tetapi tidak pernah tercatat. Doctor
melaporkan `5 veto fire(s)` — semuanya dari `gate-hook` (Claude Code/Codex),
nol dari omp.

**Perbaikan.** Tambahkan `logVeto` (bentuk sama dengan `scripts/tna-gate.mjs:58`)
di kedua cabang `block` pada handler `tool_call`.

---

## 8. Done-gate menghitung `read`/`write`/`edit` sebagai verifikasi

**File:** `veto-hooks/omp/tna-receipts-gate.ts:46`

```js
const EVIDENCE_TOOLS = new Set(['bash', 'eval', 'read', 'write', 'edit']);
```

**Gejala terukur.**

```
$ node .tmp/probe-evidence2.mjs
evidence via grep       -> BLOCKED (not counted as evidence)
evidence via glob       -> BLOCKED
evidence via lsp        -> BLOCKED
evidence via read       -> passed
evidence via write      -> passed
evidence via bash       -> passed
```

Kombinasi "menulis file lalu bilang Done" lolos gate:

```
$ node .tmp/probe-done2.mjs
omp  write-only + "Shipped." -> passed
```

**Sebab.** `receipts` menuntut **verifikasi**, bukan "turn ini menyentuh
sesuatu". `read`/`write`/`edit` adalah kerja, bukan bukti kerja — memasukkannya
membuat gate bisa dipuaskan tanpa satu pun command yang membuktikan klaim.
Sebaliknya `grep`/`glob`/`lsp` (yang justru bisa membuktikan sesuatu) diblokir.

**Perbaikan.** Sempitkan ke tool yang benar-benar menjalankan verifikasi
(`bash`, `eval`), dan biarkan `warn`-mode untuk sisanya. Kalau `read` tetap
dipertahankan, ia harus disertai syarat bahwa teks klaim mengutip output —
bukan sekadar "ada tool call".

---

## 9. Floor resolve dari `process.cwd()` → jatuh ke router basi 33 baris

**File:** `veto-hooks/omp/tna-discipline.ts:315`

```js
const resolved = resolveFloor(process.cwd());
```

**Gejala terukur.**

```
$ node .tmp/probe-floor.mjs
resolveFloor('…/trust-no-agent')          -> C:/Users/Lenovo/projects/trust-no-agent
resolveFloor('…/trust-no-agent/scripts')  -> C:\Users\Lenovo\.omo\agent\hooks\router
```

Fallback `~/.omo/agent/hooks/router/AGENTS.md` **33 baris di belakang** router
hidup — termasuk tiga aturan yang lahir 2026-10-25:

- "Enforcement is an adapter matrix, not one API"
- "A veto proof is two-sided"
- "A veto is one of four layers"

Artinya: sesi omp yang dijalankan dari subdirektori memuat floor yang
**mengklaim** aturan yang sudah tidak berlaku, dan tidak memuat aturan yang
berlaku. Fail-open-nya menyembunyikan ini — floor tetap terinjeksi, hanya isinya
yang salah.

**Perbaikan.** Pakai `ctx.cwd` (ada di `HookContext`), bukan `process.cwd()`;
dan jangan pernah jatuh ke salinan router yang tidak berasal dari checkout/router
proyek — lebih baik floor kosong (fail-open yang jujur) daripada floor basi.

---

## 10. `detectHarness` menangkap `.opencode` lebih dulu → omp tak terpasang

**File:** `scripts/onboarding.mjs:141-149`

```js
if (existsSync(join(cwd, '.opencode'))) return 'opencode';
if (existsSync(join(cwd, '.omp'))) return 'omp';
```

**Gejala terukur.** Repo ini punya **keduanya**:

```
$ ls -d .opencode .omp .pi
.opencode
.pi
$ node -e "console.log(require('./.trust/onboarding.json').harness)"
opencode
$ node -e "console.log(require('./.trust/onboarding.json').did.copiedAdapters)"
[ '.pi/extensions/tna-veto.ts', '.pi/extensions/tna-discipline.ts' ]
```

Stamp bilang `opencode` dan `copiedAdapters` hanya berisi jalur pi.
`refreshedAdapters` mencatat **satu** jalur omp
(`~/.omp/agent/hooks/pre/tna-veto.ts`) dari sapuan `--refresh`;
`tna-discipline.ts` dan `tna-receipts-gate.ts` ada di disk, byte-identik dengan
repo, tetapi **tidak** tercatat di `copiedAdapters` maupun `refreshedAdapters` —
provenance-nya tidak terekam, hanya hash-nya di `adapterHashes`. Artinya jalur
instalasi proyek tidak pernah memasang ketiga adapter omp; yang ada datang dari
`--refresh` dan/atau sesi lain.

**Sebab.** `detectHarness` mengembalikan **satu** harness, dan urutan proyeknya
menang mutlak. Satu direktori sisa (`.opencode/` dari tooling lain, atau `.pi/`
dari percobaan sebelumnya) membuat instalasi omp **nol adapter** tanpa satu pun
pesan.

**Perbaikan.** Deteksi harus **multi-harness** untuk lapisan hooks (seperti yang
sudah dilakukan `--refresh`), atau minimal: kalau `$OMP_*`/binary omp terdeteksi
dan `.omp` ada, pasang adapter omp **juga**, bukan menggantikan.

---

# P2 — klasifier menyimpang dari kanonik

## 11. Klasifier mandatory menyimpang + teramplifikasi teks sistem

**File:** `veto-hooks/omp/tna-discipline.ts:165` (`PATTERNS`),
`:203` (`buildPromptNotice`)

**Gejala terukur (7 prompt realistis, omp vs `scripts/mandatory-gate.mjs`).**

```
"sudah saya baca file itu, lanjut saja"        omp=receipts        canonical=-
"jangan push dulu ya"                          omp=receipts        canonical=-
"tidak perlu commit sekarang"                  omp=receipts        canonical=-
"test the login flow"                          omp=expect-fail     canonical=-
"no need to write a test for this"             omp=expect-fail     canonical=-
"tolong periksa apakah error-nya dari config"  omp=root-cause      canonical=root-cause
"pr ini isinya apa?"                           omp=receipts        canonical=receipts
```

**Sebab.** Dua hal terpisah.

(a) **Tidak ada penanganan negasi.** `mandatory-gate.mjs` punya
`NEGATION_MARKERS` (`:67`) + jendela 6 kata (`:80`) + batas klausa (`:88`)
khusus untuk ini; salinan omp hanya `regex.some(...)`. "jangan push" adalah
**penolakan**, bukan permintaan push.

(b) **Amplifikasi teks sistem.** `before_agent_start` menerima `event.prompt`,
dan di sesi bb nilai itu sudah membawa blok instruksi host-wide. Blok itu
menyebut `expect-fail` dan `commit` secara literal, jadi klasifikasi menyalak
tanpa ada permintaan user:

```
user text alone      : root-cause
user text + bb block : expect-fail, root-cause, receipts
bb block alone       : expect-fail, root-cause, receipts
```

Prompt asli user sesi ini ("Tolong temukan error … di omp") sebenarnya hanya
`root-cause`; notice yang muncul di sesi menandai ketiganya.

**Perbaikan.** (a) Panggil `scripts/mandatory-gate.mjs` (`classifyTask`) alih-alih
memelihara tabel kedua — file itu sudah jadi kanonik dan sudah punya test.
(b) Kalau tidak bisa, minimal strip blok instruksi host sebelum klasifikasi, dan
jangan pernah mengklasifikasi teks yang diinjeksi hook sendiri.

---

# P3 — higiene

## 12. Tidak ada satu test pun untuk adapter discipline omp

**File:** `scripts/*.test.mjs`

`scripts/veto-adapter.test.mjs` menguji `tna-veto.ts` untuk pi **dan** omp
(K/L/M/N series). Tidak ada test yang meng-import
`veto-hooks/omp/tna-discipline.ts` atau `tna-receipts-gate.ts` — grep
`veto-hooks/omp/tna-discipline` di `scripts/` hanya menemukan `onboarding.mjs`
dan `sync-payloads.mjs` (jalur salin), bukan test.

Itulah sebabnya #1 bertahan: bug-nya hanya terlihat kalau hasil handler
dilewatkan melalui helper merge harness, dan tidak ada test yang melakukannya.

**Perbaikan.** Port `scripts/pi-discipline.test.mjs` ke omp dan tambahkan satu
kasus yang mensimulasikan `Tdt`/`ydt` (destructure `input`), bukan hanya
memeriksa isi `result.tasks`. Test yang hanya membaca `result.tasks` akan
**hijau** pada kode yang salah hari ini.

---

## Yang **tidak** ditemukan rusak (supaya laporan ini jujur)

- **Floor benar-benar terinjeksi.** Live: `~/.omp/agent/hooks/tna-trace.log`
  mencatat `before_agent_start {floor:true}` di setiap sesi, dan probe
  `before_agent_start` mengembalikan `message.content` 3214 karakter berisi
  Iron Laws + MANDATORY. Re-inject setelah compact juga jalan di level adapter
  (`post-compact re-injects: true`).
- **Recorder dua sisi jalan (live).** `node x.test.mjs` hijau →
  `testPassFresh: true` → `git -C . commit --allow-empty` **landed** (`b956db2`);
  run merah → `testPassFresh: false` → commit tetap tertutup.
- **Veto shell dasar jalan (live).** `git -C . commit` di repo bersih ditolak
  dengan alasan yang bisa ditindaklanjuti; `git -C . status` lolos. Ini juga
  membuktikan perbaikan git-global-options (`stripGitGlobalOptions`) bekerja.
- **Ledger guard pada tool `write`/`edit` jalan.** `write .trust/progress.txt`
  → `block: true` dengan alasan append-only.
- **Done-gate memblokir klaim tanpa tool apa pun.** `"Done."` tanpa tool call
  → `decision: "block"` (terbukti dua kali: probe dan live).
- **Adapter terpasang = byte-identik dengan repo.** Doctor PASS 3/3 untuk omp.
  (Catatan: PASS ini hanya membuktikan **tidak drift**, bukan **benar** —
  #1 dan #2 hidup di byte yang "PASS" itu.)

---

## Urutan perbaikan

1. **#3** dulu — tanpa itu, siapa pun yang install lewat skill mendapat dinding,
   dan setiap perbaikan di bawahnya tidak pernah sampai ke adopter.
2. **#1 + #2** — satu paket, satu test baru (#12) yang mensimulasikan merge
   harness. Setelah ini lapisan delegasi omp benar-benar menyala untuk pertama
   kalinya.
3. **#5 + #6** — integritas bukti. Keduanya general; perbaiki di keempat adapter
   sekaligus, jangan hanya omp.
4. **#4**, lalu **#7**, lalu **#8**.
5. **#9 + #10 + #11** — korektnes floor dan klasifikasi.

---

## Cara mereproduksi

Semua probe ada di `.tmp/` (gitignored) dan dibuat di sesi ini:

```bash
node .tmp/probe-arming2.mjs     # #1  arming no-op
node .tmp/probe-batch.mjs       # #2  tasks[] bypass
node .tmp/probe-batch2.mjs      # #2  context/name bypass
node .tmp/probe-wrappers.mjs    # #4  sudo / bash -c / env
node .tmp/probe-evidence3.mjs   # #5  red run recorded as pass
node .tmp/probe-evidence2.mjs   # #8  done-gate evidence set
node .tmp/probe-done2.mjs       # #8  write-only + "Shipped." passes
node .tmp/probe-floor.mjs       # #9  stale fallback router
node .tmp/probe-classify.mjs    # #11 omp vs canonical classifier
node .tmp/probe-amplify.mjs     # #11 prompt amplification
```

Live (butuh model + approval):

```bash
cd .tmp/tna-live && omp -p "Run: git -C . commit --allow-empty -m probe" --auto-approve
# -> tna-gate veto … Project state: (missing)   (#7: tidak ada tna-gate-log.jsonl)
```

Snapshot omp yang diukur: `omp --version` → `18.10.4`;
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent` (v18.10.4).
