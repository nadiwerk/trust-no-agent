# Design notes — how the framework behaves on real harnesses

Technical knowledge that shapes how trust-no-agent works in practice. Written for anyone integrating the framework into their own agent setup. These are hard-won observations about harness behavior, not opinions — each one changed how the framework is built.

## Harness behavior (things that break silently)

### 1. A line starting with a slash token can be swallowed as a slash command

Some harnesses parse assistant output as both prose and a stream of slash commands. A line that begins with `/` in a position the parser treats as command-start can be swallowed — the rest of the message never reaches the user, and the harness may route it to a nonexistent tool.

**Rule:** never start a line with a `/`-leading token unless it is an intentional slash command. Keep paths mid-line inside code fences, surrounded by text. If a response was swallowed, resend with the path rewritten.

### 2. Skills installed mid-session are invisible to the skill registry

The skill registry loads at session start. A skill copied into the skills directory during a running session is not discoverable by `load_skills` until the next session.

**Rule:** when a skill is needed mid-session, read it from the repo path directly. Verify installed copies match the repo before claiming they do.

### 3. Non-recursive skill discovery breaks nested install paths

Some harnesses discover skills non-recursively: they only look at `skills/<name>/SKILL.md`, not `skills/<category>/<name>/SKILL.md`. A nested layout silently fails to load.

**Rule:** install and document the flattened layout — each skill directory sits directly under the skills root. The install commands in `docs/installation.md` already use `skills/*/*`.

### 4. Re-running a failing command against an unchanged workspace cannot pass

Same input, same output. Retrying without a real change is a guess.

**Rule:** prove progress first — make a real change that alters the tested input/output, then retry. See the repair contract in `make-it-so`.

## Orchestration behavior

### 5. Subagent working directory is not guaranteed to be the repo

A consultant subagent may review the wrong project, an explore agent may grep the wrong tree, if the working directory is not pinned.

**Rule:** state the absolute target path in every delegated prompt; never rely on subagent cwd.

### 6. Parallel writers need isolation; parallel readers do not

Tickets that write files in parallel must each get their own git worktree, merged at the end. Read-only parallel work runs without worktrees — don't tax every run.

### 7. Deduplicate against everything seen, not just accepted findings

Iterative research stops after two consecutive rounds with no new findings, and dedupes against the full ledger of what was seen — not just what was accepted. A synthesis that ignores an input is a fake dependency.

## Quality-gate behavior

### 8. Deterministic pickers, not free-form verdicts

Quality gates commit to categorical features, never free-form verdicts. A gate that returns "looks good" is not a gate — it is an opinion. The `receipts` skill's categorical gate is the pattern.

### 9. Live skill names must not sit in a validator denylist

A denylist that contains real skill names blinds the check to rename drift — a renamed skill stops resolving and nothing errors. Keep real names out of denylists; let the resolver report them.

### 10. Skill descriptions drift from triggers into summaries

A description that says what a skill *does* instead of *when to load it* teaches agents to skip it. Descriptions must be trigger-pure: "Use when..." aligned with the router's trigger matrix. The eval script re-checks this.

## Why these matter

Each observation above changed the framework's design — the flattened install layout, the trigger-pure description rule, the repair contract, the delegation discipline. They are the difference between a framework that works on paper and one that works on real harnesses. If you hit a silent failure while integrating, check this list first.
