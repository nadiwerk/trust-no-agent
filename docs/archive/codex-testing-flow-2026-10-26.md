# Testing trust-no-agent di Codex — alur langkah demi langkah

Status terukur: **2026-10-26**, Codex CLI **0.163.0** (terbaru di npm: 0.164.0).
Plugin TNA terpasang: `trust-no-agent@trust-no-agent` v0.1.52, `enabled = true`.
Payload marketplace = repo (hash identik: hooks + gate-hook + tna-gate + action-gate).

Ringkas kondisi:

| Lapisan | Status | Bukti |
|---|---|---|
| plugin terpasang & enabled | **jalan** | `codex plugin list` → `installed, enabled 0.1.52` |
| hook dimuat | **jalan, hanya bila trust disetujui** | tanpa trust: `hook:` tidak muncul sama sekali; dengan `--dangerously-bypass-hook-trust`: `hook: SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop` |
| veto (PreToolUse) | **jalan** | `Command blocked by PreToolUse hook: [trust-no-agent] irreversible action (git commit) via bash without fresh test evidence` |
| log meter | **jalan** | `.trust/tna-gate-log.jsonl` berisi `{"harness":"gate-hook","tool":"Bash","command":"git commit -m probe-deny"}` |
| recorder (PostToolUse) | **BELUM terbukti** | hook dipanggil (`hook: PostToolUse Completed`) tetapi `.trust/tna-gate-state.json` tidak tertulis |
| floor (SessionStart) | jalan (hook dipanggil) | `hook: SessionStart` muncul |

---

## 0. Prasyarat

```powershell
codex --version          # 0.163.0 (0.164.0 tersedia)
codex plugin list        # trust-no-agent@trust-no-agent  installed, enabled  0.1.52
codex features list      # hooks = stable true
```

Kalau `plugin list` tidak menampilkan TNA:

```powershell
codex plugin marketplace list          # pastikan marketplace trust-no-agent terdaftar
codex plugin add trust-no-agent@trust-no-agent
```

---

## 1. Setujui trust hook (WAJIB — ini gerbangnya)

Hook plugin TNA **tidak dijalankan** sampai Codex menyimpan trust. Tanpa langkah ini
gejala khasnya: commit mendarat tanpa veto, dan **tidak ada satu pun baris `hook:`** di output.

```powershell
cd C:\Users\Lenovo\projects\trust-no-agent
codex
```

Saat Codex menampilkan prompt trust untuk hook `trust-no-agent`, **setujui**.
Verifikasi bahwa trust tersimpan:

```powershell
Select-String -Path "$env:USERPROFILE\.codex\config.toml" -Pattern 'trust-no-agent@trust-no-agent.*hooks'
```

Harus muncul entri `[hooks.state."trust-no-agent@trust-no-agent:hooks/codex.hooks.json:pre_tool_use:0:0"]`
(sebelum disetujui: **0 entri**).

> Catatan: `trusted_hash` **bukan** sha256 file hook (dibandingkan dengan entri OMO —
> tidak cocok). Jangan menulis hash sendiri; itu harus lewat prompt trust Codex.

---

## 2. Uji DENY — commit tanpa bukti harus ditolak

Repo bersih, **tanpa** `.trust/`:

```powershell
$d = Join-Path $env:TEMP ("tna-codex-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory $d | Out-Null
Set-Location $d
git init -q; git config user.email p@e.invalid; git config user.name p
"one" | Set-Content f.txt
git add -A

codex exec "Run exactly this one shell command and then stop: git commit -m probe-deny"
```

**Harapan (dan yang sudah terbukti):**

- output memuat `Command blocked by PreToolUse hook: [trust-no-agent] irreversible action (git commit) … without fresh test evidence`
- `git rev-parse --verify HEAD` → **fatal: Needed a single revision** (tidak ada commit)
- `.trust/tna-gate-log.jsonl` ada dan berisi satu baris dengan `"harness":"gate-hook"`

Kalau commit **mendarat** dan tidak ada baris `hook:` → trust belum disetujui (kembali ke langkah 1).

---

## 3. Uji recorder — jalankan suite hijau

```powershell
"process.exit(0);" | Set-Content y.test.mjs
codex exec "Run this exact shell command with the shell tool: node y.test.mjs"
```

Cek hasilnya:

```powershell
if (Test-Path .trust\tna-gate-state.json) { Get-Content .trust\tna-gate-state.json -Raw } else { "NO STATE" }
```

**Status jujur:** pada 0.163.0 langkah ini **belum menghasilkan state** meski
`hook: PostToolUse Completed` muncul. Jadi gate Codex saat ini **bisa menolak tapi belum
bisa dibuka** — dinding, bukan gate. Ini open yang harus diperbaiki sebelum Codex
dinyatakan "veto-proven" untuk versi ini.

Kontras yang berguna saat mendiagnosis: replay payload langsung ke hook **berhasil**
menulis state bila payload memuat `tool_response.exitCode`:

```powershell
node -e "const{spawnSync}=require('node:child_process');const os=require('node:os'),fs=require('node:fs'),p=require('node:path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'tna-replay-'));const payload={hook_event_name:'PostToolUse',tool_name:'Bash',tool_input:{command:'node y.test.mjs'},tool_response:{stdout:'',exitCode:0},cwd:d};const r=spawnSync(process.execPath,['C:/Users/Lenovo/.codex/.tmp/marketplaces/trust-no-agent/plugin/scripts/gate-hook.mjs'],{input:JSON.stringify(payload),encoding:'utf8'});console.log('exit',r.status);console.log(fs.existsSync(p.join(d,'.trust','tna-gate-state.json'))?'STATE WRITTEN':'no state');"
```

Kalau perintah itu menulis `STATE WRITTEN` sementara langkah 3 tidak, artinya
**bentuk payload Codex berbeda** dari `tool_response.exitCode` — itu yang harus
dicocokkan di `gate-hook.mjs`.

---

## 4. Uji ALLOW — commit setelah bukti hijau

Hanya bermakna kalau langkah 3 menulis `testPassFresh: true`:

```powershell
codex exec "Run exactly this one shell command and then stop: git commit -m probe-allow"
git log --oneline
```

**Harapan:** commit mendarat. **Sekarang:** tetap tertahan, karena langkah 3 belum menulis state.

---

## 5. Uji floor (SessionStart)

```powershell
codex exec "Sebutkan empat Iron Laws dari router yang aktif di sesi ini, lalu berhenti."
```

Kalau jawabannya memuat empat Iron Laws, floor terinjeksi. Baris `hook: SessionStart`
di output adalah sinyal pendukung, bukan bukti isi.

---

## 6. Tanpa menyentuh trust (untuk diagnosis saja)

```powershell
codex exec --skip-git-repo-check --dangerously-bypass-hook-trust "Run exactly this one shell command: git commit -m probe"
```

Flag ini menjalankan hook tanpa trust tersimpan. **Jangan dipakai sebagai alur normal** —
hanya untuk membedakan "hook tidak dimuat" dari "hook dimuat tapi salah perilaku".
Codex sendiri mencetak peringatan bahwa hook berjalan tanpa review.

---

## 7. Kalau hook perlu di-refresh setelah update repo

Sumber yang benar-benar dimuat Codex adalah marketplace checkout, **bukan** `plugins/cache`:

```
C:\Users\Lenovo\.codex\.tmp\marketplaces\trust-no-agent\plugin
```

Setelah mengubah `plugin/**` di repo:

```powershell
Copy-Item C:\Users\Lenovo\projects\trust-no-agent\plugin\* `
          C:\Users\Lenovo\.codex\.tmp\marketplaces\trust-no-agent\plugin -Recurse -Force
codex plugin list    # tetap harus 0.1.52 / enabled
```

Lalu ulangi langkah 1 (trust) bila `hooks/codex.hooks.json` berubah — hash lama tidak
akan cocok lagi dan Codex berhenti memuat hook sampai disetujui ulang.

---

## Ringkasan cepat

```powershell
# 1. trust (sekali, interaktif)
codex    # setujui prompt trust hook trust-no-agent

# 2. deny harus menolak
codex exec "…git commit -m probe-deny"      # → Command blocked by PreToolUse hook

# 3. recorder (OPEN — belum menulis state di 0.163.0)
codex exec "…node y.test.mjs"

# 4. allow (menunggu #3)
codex exec "…git commit -m probe-allow"
```

Dua hal yang **bukan** penyebab kegagalan, supaya tidak salah diagnosis:

- **Bukan** karena Codex menghapus hook. `hooks = stable true`; OMO (plugin lain) hook-nya
  jalan di mesin yang sama. `plugin_hooks` yang berstatus `removed` adalah flag fitur lain.
- **Bukan** karena payload marketplace basi. Hash `hooks/codex.hooks.json`,
  `gate-hook.mjs`, `tna-gate.mjs`, `action-gate.mjs`, dan `.codex-plugin/plugin.json`
  semuanya identik dengan repo.
