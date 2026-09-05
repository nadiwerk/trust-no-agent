---
name: roast-my-code
description: Review changes since a fixed point (commit, branch, tag, or merge-base) along three axes — Standards (does the code follow the repo's documented standards?), Spec (does the code match the originating spec/ticket?), and Security (does the change introduce a vulnerability?). Runs all three reviews as parallel subagents. Use when the user wants to review a branch, a PR, work-in-progress changes, or says "review since X".
---

# Roast My Code

Take the diff between `HEAD` and a fixed point the user names, and interrogate it along three independent axes:

- **Standards** — does the code live up to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating spec/ticket?
- **Security** — does the change open a vulnerability (injection, auth bypass, data exposure, unsafe deserialization, secrets, etc.)?

The three interrogations run as **parallel subagents** so no axis contaminates another's context; this skill then aggregates their findings.

Every finding gets a **severity** from this closed set: `Critical` (broken/security) → `Required` (must fix before merge) → `Nit` (cosmetic) → `Optional` (nice but not required) → `FYI` (informational). Closed set = the severity IS the categorical feature; tallying verdicts across subagents stays deterministic. No free-form severity prose.

## Process

### 1. Fix the comparison point

Whatever the user said — a commit SHA, branch name, tag, `main`, `HEAD~5`. If they didn't specify one, ask.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, against the merge-base). Also note the commit list via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside two parallel subagents.

### 2. Locate the spec

Find the originating spec, in order:

1. Issue references in commit messages (`#123`, `Closes #45`, etc.).
2. A path handed over as an argument by the user.
3. A spec file under `docs/`, `specs/`, or `.trust/` matching the branch name or feature.
4. If nothing is found, ask the user. If there isn't one, the Spec subagent is skipped and reported as "no spec available".

### 3. Locate the standards sources

Anything in the repo documenting how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

Beyond whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo wins.** Where a documented standard endorses something the baseline would flag, the baseline stays silent.
- **A smell is a suspicion, not a verdict.** Each entry is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Every smell reads *what it is* → *the fix*; match each against the diff:

- **Mysterious Name** — a name that doesn't reveal what it does or holds. → rename; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape in more than one hunk or file. → extract the shared shape, call it from both.
- **Feature Envy** — a method reaching into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields/params always travelling together (a type wanting to be born). → bundle them into one type.
- **Primitive Obsession** — a primitive standing in for a domain concept deserving its own type. → give the concept its own small type.
- **Repeated Switches** — the same switch/if-cascade on the same type recurring. → polymorphism, or one shared map.
- **Shotgun Surgery** — one logical change forcing scattered edits across many files. → gather what changes together into one module.
- **Divergent Change** — one module edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction/parameters/hooks for needs the spec doesn't have. → delete; inline until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation. → hide the walk behind one method on the first object.
- **Middle Man** — a class/function that mostly delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass ignoring/overriding most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn all three subagents in parallel

Send a single message with three parallel subagent calls.

**Standards subagent prompt** — include:

- The diff command and the commit list, complete.
- The list of standards-source files from step 3, **plus the smell baseline from step 3 pasted in full** — the subagent has no other access to it.
- The brief: "Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Assign a severity to each finding. Under 400 words."

**Spec subagent prompt** — include:

- The diff command, plus the commit list.
- The spec itself: its path, or the fetched contents.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Assign a severity. Under 400 words."
- **Test-strategy check (part of this axis, no extra subagent):** tests in the diff are the instruments that verify the spec, so examine them for two verified failure classes — (i) *tautological assertions* (`assert.ok(true)` placeholders, expectations recomputed from the code's own output like `=== (2+3)` instead of intent-derived literals like `=== 5`, tests that cannot fail by construction); (ii) *test/impl contract mismatch* (the test reads path A while the implementation writes path B, different function/flag/shape names — a suite that passes while testing nothing real). Both are at minimum `Required`: a green suite either way is a certificate with no exam. Live exhibits: C1 rounds on DSH/Codex (`assert.ok(true)` ×2 plus `ledger.test.jsonl` vs `ledger.jsonl`).

If the spec is missing, skip the Spec subagent and note this in the final report.

**Serial fallback** — if the harness cannot spawn parallel subagents (no delegation tool, or single-threaded delegation), run the same three prompts **sequentially**, treating each axis as its own fresh context: finish one axis's report before starting the next, and carry nothing but the axis briefs between them. The isolation goal — no axis contaminating another's context — matters more than the parallelism; aggregation (step 5) is unchanged.

**Security subagent prompt** — include:

- The diff command plus the commit list.
- The brief: "Report — per file/hunk where relevant — every place the diff introduces or widens a security vulnerability: injection (SQL, command, XSS), auth/authz bypass, sensitive data exposure, unsafe deserialization, hardcoded secrets, missing input validation at a trust boundary, insecure defaults. Distinguish hard vulnerabilities from hardening opportunities. Skip anything tooling already enforces (e.g. a secrets scanner). Assign a severity to each finding. Under 400 words."

### 5. Aggregate

Present the three reports under `## Standards`, `## Spec`, and `## Security` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes.

## Why three axes

A single-axis review gives every change one way to look acceptable, which means every change has a way to hide its failure:

- Code that meets every documented standard yet builds the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the ticket asked but breaks the project's conventions → **Spec pass, Standards fail.**
- Code that is correct and well-styled but introduces a vulnerability → **Standards + Spec pass, Security fail.**

Reporting the axes separately is what keeps one axis's pass from laundering another axis's fail.
