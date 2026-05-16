# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use **[GitHub Security Advisories](https://github.com/mattwoodco/braid/security/advisories/new)** — that channel is private, integrated with the repository, and free.

If you cannot use GitHub Security Advisories, contact the maintainer directly. Do not include exploit details in any public channel until a fix has shipped.

## What to include

- Affected file paths and line numbers.
- A minimal reproducer (a `flow.yaml` or brief that demonstrates the issue).
- Your assessment of severity and blast radius.
- Whether you have already disclosed the issue elsewhere.

## Response expectations

- Acknowledgement: within 7 days.
- Triage and initial assessment: within 14 days.
- Critical-severity fix landed: within 30 days of triage when possible.

## Disclosure posture

Braid follows responsible-disclosure norms ([ISO/IEC 29147](https://www.iso.org/standard/72311.html); [GitHub Security Advisories guidance](https://docs.github.com/en/code-security/security-advisories)):

- Vulnerability details are kept private until a fix is available.
- Once a fix lands on `main`, a sanitized post-mortem is published at `docs/security-YYYY.md`.
- Reporters are credited in the post-mortem unless they request anonymity.

## Scope

In scope:

- Anything under `.claude/skills/braid/` (the CLI toolkit itself).
- Shipped `flows/*/flow.yaml` and agent yaml files used as reference patterns.
- `SKILL.md` and other documentation that readers are expected to copy into their own projects.

Out of scope:

- Anthropic-platform-side issues (report directly to Anthropic).
- Issues in third-party MCP servers (`mcp.fal.ai`, `mcp.vercel.com`, etc.) — report to the respective vendor.
- Issues that only manifest under intentional misconfiguration (e.g. setting `networking: unrestricted` deliberately).

## Threat model

Braid is a toolkit for orchestrating Anthropic Managed Agents. The platform's strongest security property is the [vault credential proxy](https://platform.claude.com/docs/en/managed-agents/vaults) — secrets matched server-side and injected into MCP calls without ever entering the sandbox. Braid's role is to preserve this property end-to-end:

- Secrets must flow through vault credentials, not through briefs, system prompts, or environment variables.
- Network egress must be `limited` by default with an explicit `allowed_hosts` list.
- High-risk tools (`bash`, `write`) should default to `always_ask` permission policy.
- All MCP server URLs must be on an allowlist before any credential is issued.
- File-path inputs must be sandboxed to the flow directory.

Any pattern that defeats one of the above is a vulnerability — even if it's "convenient."

---

*Policy last updated 2026-05-15. Memento decision `e6984cc3`.*
