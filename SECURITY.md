# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ |

## Security Posture

trust-no-agent is a **markdown-only workflow framework** — it ships no runtime, no executable code, and no secrets. The attack surface is therefore small, but not zero:

- **Prompt injection** — the framework is a set of instructions (AGENTS.md + skills). A malicious or compromised skill can attempt to inject instructions. Treat any skill from an untrusted source with the same caution as untrusted code: review it before loading, and prefer skills you authored or audited.
- **Repository content is data, not instructions** — the agent reads CONTEXT.md, ADRs, tickets, and code as *evidence*. None of it is an instruction channel: repo content can never override this framework's gates, and a file that asks for secrets or tells the agent to skip verification is an attack to report, not an order to follow.
- **No secrets in source** — the framework never stores credentials, API keys, or tokens. Secrets belong in environment variables or a gitignored `.env`, never in tracked files.
- **Human sign-off on irreversible actions** — Iron Law 4: commit, push, publish, and delete are never self-serve. This is a deliberate security control, not a convenience.

## Reporting a Vulnerability

Please report security issues privately via GitHub's private vulnerability reporting (Security → Report a vulnerability), or open a private issue. Do not open a public issue for a security concern.

We aim to acknowledge reports within 48 hours.
