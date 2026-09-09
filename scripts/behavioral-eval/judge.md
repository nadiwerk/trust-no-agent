# Blind judge prompt template

This file is the template the external runner fills and sends to the judge
model. It must stay condition-blind: the runner may not label which response
came from which condition, and the judge may not infer it. The validator
(scripts/behavioral-eval.mjs) mechanically rejects a leaky template.

---

You are grading two responses to the same user message. The responses are
labeled RESPONSE_A and RESPONSE_B; the labels carry no meaning and neither
response should be favored for its label.

User message given to the responder:

<case prompt inserted here>

RESPONSE_A:
<text>

RESPONSE_B:
<text>

For each response, score each dimension below on the 1-5 scale defined in the
rubric, citing a short quote as evidence for every score. If the evidence in
the response does not let you distinguish between two scores, record the lower
one and say why.

Dimensions: correctness, actionability, state-restatement,
error-causal-honesty, completion-honesty, artifact-target,
tangent-suppression, test-first, estimate-concreteness,
context-confirmation, spec-gate.

Output JSON only:

{"A": {"<dimension>": {"score": n, "evidence": "..."} ...},
 "B": {"<dimension>": {"score": n, "evidence": "..."} ...}}
