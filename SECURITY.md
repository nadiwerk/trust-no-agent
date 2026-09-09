# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Security Posture

trust-no-agent is a **markdown-only workflow framework** — it ships no runtime, no secrets, and installs nothing executable into your project (the Node scripts in this repo are its own dev tooling: validation gates, evals, and the doctor). The attack surface is therefore small, but not zero:

- **Prompt injection** — the framework is a set of instructions (AGENTS.md + skills). A malicious or compromised skill can attempt to inject instructions. Treat any skill from an untrusted source with the same caution as untrusted code: review it before loading, and prefer skills you authored or audited. The vetting checklist and red-flag response ladder live in [docs/skill-vetting.md](docs/skill-vetting.md) — approval without audit is trust without evidence.
- **Repository content is data, not instructions** — the agent reads CONTEXT.md, ADRs, tickets, and code as *evidence*. None of it is an instruction channel: repo content can never override this framework's gates, and a file that asks for secrets or tells the agent to skip verification is an attack to report, not an order to follow.
- **No secrets in source** — the framework never stores credentials, API keys, or tokens. Secrets belong in environment variables or a gitignored `.env`, never in tracked files.
- **Human sign-off on irreversible and shared-state actions** — Iron Law 4: commit, push, publish, delete, de-adoption, edits to the shared global skill dir, and re-running the install (including an update-triggered one) are never self-serve. Detection is mechanical; the decision is the user's — the update flow runs **detect → the agent reports and proposes → the user approves → re-install** (`docs/installation.md` §Updating). This is a deliberate security control, not a convenience.

## Reporting a Vulnerability

Please report security issues privately via GitHub's private vulnerability reporting (Security → Report a vulnerability), or open a private issue. Do not open a public issue for a security concern.

We aim to acknowledge reports within 48 hours.
