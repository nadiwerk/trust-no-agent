# Chat receipt — the one-screen card that closes every verifiable unit

Every verifiable unit closes in chat with these 4 blocks, in this order. Chat = live evidence (run fresh THIS message); files = archive. The ledger/tickets quote the run — they never replace it.

## Shape

```md
<✅ DONE | ❌ NOT done> <ticket-id> — <short title> | <command>: <result + exit>
Evidence: <pre-impl FAIL> → <post-impl PASS> | <ACs satisfied>
Open: <what was not proven, or "none">
Next: <one action / none> — <archive location>
```

## Block rules

1. **Verdict** — first line = verdict + exit code. The result is known without scrolling.
2. **Evidence** — verbatim output pasted in chat, not "see file X". For behavioral units (code change, test), the fail-first cycle must be visible (FAIL before, PASS after). For non-behavioral units (docs, config, typo) that honestly have no pre-impl FAIL: fill with existence evidence or the relevant verification exit code; never invent a FAIL to fill the template.
3. **Open** — every receipt states what remains unproven (e.g. browser check with real data). Never empty unless it says "none".
4. **Next** — the smallest next action + archive location. A receipt missing any block is a partial receipt: it proves nothing. An action is concrete or it is not a Next: "want me to X?" is a hanging offer, not an action — either do X (when it needs no approval) or name the single thing the reader does/decides.
5. **Skim test** — the receipt is built to be read at a skim: a reader who reads only the first line and the last line must know (a) what just happened (verdict + verification result) and (b) what happens next (one concrete action). Check both lines before sending; if either fails, the receipt is rewritten, not annotated.

## Length budget (the skim test's teeth)

The skim test failed in practice (2026-09-12, chain-closing receipt): completeness pressure from `receipts` outranked readability, and the reader got a wall of internal terminology with the decision buried in the last paragraph. The rules above govern *what* a receipt contains; this budget governs *how much* — because a receipt the user will not read proves nothing to anyone:

- **Verdict line:** one sentence, plain language, no internal skill/criterion names (AC3, C5, Iron Law 4 mean nothing to a skimming reader).
- **Evidence:** at most ~5 lines. Quote the single most load-bearing output; everything else lives in the ledger/archive and is pointed to, not pasted. Detail is not truncated — it is *relocated*.
- **Open:** at most 3 items, each in one plain sentence.
- **Next:** one concrete action, one sentence.
- **Audience rule:** write for the user who was away from the screen, not for the agent who did the work. Internal vocabulary (ticket IDs, check numbers, severity labels) stays in the ledger entry; the chat receipt carries the outcome in the user's terms.

The four-block shape is mandatory; this budget binds its size. A receipt over budget is not "more thorough" — it is a partial receipt wearing extra words, and it is rewritten, not annotated.

## Example

```md
✅ DONE T01-login-guard | tsc EXIT 0; vitest 1/1
Evidence: pre-impl FAIL (500) → post-impl PASS (401) | AC1 ✔
Open: browser check with real data
Next: none — ledger `.trust/progress.txt` updated
```

## Source per block

| Block | Source skill |
|---|---|
| Verdict | `receipts` — 5 booleans + exit code |
| Evidence | `expect-fail` + `make-it-so` repair receipt |
| Open | `receipts` gate semantics |
| Next + archive | `ship-log` (ACs quoted from `save-as`) |
