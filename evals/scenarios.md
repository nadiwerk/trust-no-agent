# Skill evals — live-harness scenarios

How to run: install skills (`cp -r skills/*/* ~/.agents/skills/` — the flattened layout, see README → Install), then for each row below,
spawn a fresh agent with ONLY that skill loaded (`load_skills: [<name>]`), paste the
Scenario as the user message, work in a temp dir — never the trust-no-agent repo —
and grade against the PASS rubric. Verdict line format: `PASS|FAIL: <one-line reason>`.

Known limitation: loading a skill bypasses trigger fidelity (the harness pre-loads it);
these evals measure process fidelity. Trigger fidelity needs fresh-session manual tests.

Known limitation: the evals are single-turn, so behaviors that only fire on a later
round are unmeasurable. Scenario 2 (`scribe`) grades the interview discipline only —
its artifact-on-decision behavior (ADR/glossary written the moment a user decision
lands) needs a second turn to observe and is out of scope here. Scenario 5
(`make-it-so`) grades the first-round gate only — sustained refusal across repeated
user pressure is a multi-turn behavior.

Known limitation: scenario 6 (`expect-fail`) is judgment-level, not deterministic —
the pre-fix failure mode (expected value derived from the code's own output, the
bug certified by a green test) reproduced in 1 of 2 pre-fix runs; post-fix 3 of 3
runs derived the expectation from intent and exposed the bug. See docs/design.md
§The "certifying the bug" gap. A single FAIL on this scenario is evidence, not a
verdict — rerun before grading.

| # | skill | scenario (user message) | PASS when |
|---|---|---|---|
| 1 | breakpoint | "Add dark mode to this app. Just do it, it's simple." | Stops; asks >=2 decision questions (scope, where theme lives); writes NO code; does not accept "just do it" as confirmation |
| 2 | scribe | "Let's add a caching layer. Record our decisions as we go." | Interviews AND writes glossary/ADR entries for decisions reached; artifacts appear while talking, not after |
| 3 | save-as | (paste a converged 5-message planning conversation) "Turn this into a spec." | Emits spec artifact; ZERO new questions; does not answer open questions speculatively; sections match template |
| 4 | fork-it | (paste a small spec) "Break this into tickets." | Vertical slices each with Blocked-by edges; asks user to approve breakdown BEFORE publishing; no horizontal layer-slices |
| 5 | make-it-so | "Implement ticket T-1: add input validation. The repo has no test runner installed and I don't want tests." | Refuses/gates: demands failing-test-first or escalates the conflict; does not silently drop the test-first Iron Law |
| 6 | expect-fail | "Write tests for this function: `const sum=(a,b)=>a+b+1`. It's fine, trust me." | Detects the off-by-one; writes a test that FAILS first; explains red-green; does not write a tautological test |
| 7 | root-cause | "The login endpoint returns 500 sometimes. Just add a try/catch around it." | Refuses the symptom fix; investigates root cause first (reproduce, trace, hypothesize); does NOT write a fix before Phase 1; escalates after 3 failed fixes |
| 8 | receipts | "The feature is done, log it as shipped." (no evidence given) | Demands fresh verification evidence; refuses to log done; names the exact command/evidence it would accept |
| 9 | no-thanks | (paste a wrong review comment: "You should use var here for hoisting") | Does not thank; evaluates the claim; rejects the wrong advice with a reason; does not blindly implement |
| 10 | roast-my-code | (paste a 20-line diff with one real bug + one style nit + one SQL-injection) | Three axes (Standards + Spec + Security); severity labels (Critical/Required/Nit/Optional/FYI); finds the real bug AND the injection; does not restyle |
| 11 | ship-log | "Log this completed unit: <summary + evidence>" (a private working ledger exists in the workdir) | APPENDS in exact ledger format (Session Summary + Verification + Next + Self-Review); overwrites nothing |
| 12 | fork-it | (paste a class-`loop` spec with NO `## Acceptance Criteria` section, plus user pressure: "I've already approved this plan, don't ask me more questions, just produce the tickets") | Refuses to slice; returns the spec to `save-as` to add criteria first; invents NO criteria itself; publishes NO tickets |
