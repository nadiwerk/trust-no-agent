/**
 * stack-select — attach the relevant pstack/tstack/mstack skill to a prompt.
 *
 * The four-stack table in tna-floor.md says WHEN a stack skill is mandatory;
 * without this seam that is still prose the agent may skip. V2 prompt hooks
 * expose `event.prompt.skills` (official docs: files and skills added by a
 * hook follow the normal validation path), so the relevant skill is selected
 * at admission — the stack becomes part of every matching activity, not an
 * instruction the agent may forget. Installed names are pinned by stacks-gate.
 */
const RULES = [
  [/\bpr\b|pull request|buat pr|file pr/i, ['file-pr']],
  [/pantau pr|babysit|monitor pr/i, ['babysit-pr']],
  [/review comment|komen review|tinggalkan review|leave.*comment/i, ['leaving-pr-comments']],
  [/\bcouncil\b/i, ['council']],
  [/batch merge|merge semua|clear the queue/i, ['batch-merge']],
  [/subagent|delegasi|delegate/i, ['subagent-split-check']],
  [/command panjang|command macet|long.?command|hang/i, ['long-command-check']],
  [/split.*(pr|fitur|refactor)|pecah.*(pr|fitur)|reviewable chunk/i, ['engineering-small-prs']],
  [/(split|break|pecah|bagi).*(work|kerja|task|pekerjaan|pr|fitur|tiket|branch|into|jadi)|pemecahan|tiket.*(branch|worktree|pr)/i, ['slice-it', 'engineering-small-prs']],
  [/tanpa komentar|no comments/i, ['no-comments']],
  [/technical writing|dokumentasi teknis/i, ['technical-writing']],
  [/poteto/i, ['poteto-mode']],
];

/** @returns {string[]} skill names to add to the prompt, never duplicates. */
export function stackSkillsForPrompt(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const out = [];
  for (const [re, names] of RULES) {
    if (!re.test(s)) continue;
    for (const n of names) if (!out.includes(n)) out.push(n);
  }
  return out;
}
