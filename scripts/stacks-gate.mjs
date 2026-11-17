/**
 * stacks-gate — four-stack skill availability for OpenCode.
 *
 * On Claude Code the project router mandates pstack/tstack/mstack on top of
 * TNA, and `scripts/four-stacks.test.mjs` proves the seven stack skills are
 * actually installed (`~/.claude/skills` + pstack cache). OpenCode had none
 * of them installed and no equivalent check, so "load poteto-mode" would be
 * an instruction to load nothing. This is the pure checker behind the
 * OpenCode half: same seven names, one seam.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_STACK_SKILLS = [
  // pstack (HOW)
  'no-comments',
  'poteto-mode',
  'technical-writing',
  'unslop',
  // tstack (PR ops)
  'babysit-pr',
  'batch-merge',
  'council',
  'engineering-small-prs',
  'file-pr',
  'leaving-pr-comments',
  // mstack (self-audit)
  'long-command-check',
  'subagent-split-check',
];

/** @returns {{ok:boolean, required:string[], missing:string[]}} */
export function stacksVerdict(skillDir) {
  const required = [...REQUIRED_STACK_SKILLS];
  const missing = skillDir
    ? required.filter((name) => !existsSync(join(String(skillDir), name, 'SKILL.md')))
    : [...required];
  return { ok: missing.length === 0, required, missing };
}
