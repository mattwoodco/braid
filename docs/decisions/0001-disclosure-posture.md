# 0001 — Disclosure posture

- **Status:** Accepted
- **Date:** 2026-05-15

## Context

Braid will receive security-sensitive contributions. An audit document that names file paths, line numbers, or vulnerability classes is itself a *map* to those weaknesses until fixes are merged and released. A public GitHub Issue titled "fix path traversal in expandBrief" announces the bug to anyone watching the repository before the fix is in operators' hands.

The project also wants contributors to be able to file legitimate vulnerability reports without exposing details in public channels.

## Decision

1. **Private reporting channel.** Vulnerabilities are reported via [GitHub Security Advisories](https://github.com/mattwoodco/braid/security/advisories/new). See [`SECURITY.md`](../../SECURITY.md) for the full policy.
2. **Audit notes stay private until fixes ship.** Working audit docs live in `docs/audit-*.PRIVATE.md`, gitignored by patterns in `.gitignore`. The patterns `docs/audit-*.md`, `docs/audit-*.PRIVATE.md`, and `*.PRIVATE.md` are all excluded.
3. **Neutral PR titles during fix windows.** Until every Critical-severity finding referenced in a private audit doc has merged, PR titles and commit subjects use neutral refactor-style language ("refactor: …", "build: …", "docs: …") rather than vulnerability-class names ("fix path traversal in X"). The mapping from neutral subject to private audit anchor lives only in the private doc.
4. **Sanitized post-mortem after fixes merge.** Once Critical fixes are on `main`, publish `docs/security-YYYY.md` with reporter credit, scope, and remediation summary — but no exploit detail.

## Consequences

- The maintainer must check the GitHub Security Advisories inbox.
- External reviewers without the private audit document can still follow each fix's logic from the commit body + authoritative-source citations; full audit context requires direct access (granted on request to reviewers under embargo).
- Some explicit information is necessarily abstracted in commit subjects, but every commit body preserves the full *what* and *why* — just not "this fixes CVE-XYZ" until the embargo lifts.
- Contributors get clear guidance up front: don't paste audit content into PR descriptions; the PR template enforces this.

## Alternatives considered

- **Public GitHub Issues for all security findings.** Rejected — exposes the vulnerability map before fixes land. Defeats the point of coordinated disclosure (ISO/IEC 29147).
- **Private email to maintainer only.** Rejected — not reproducible, not integrated with the issue tracker, no audit trail of triage time.
- **No audit document at all; rely on commit bodies.** Rejected — institutional memory loss. Audit findings often span multiple fixes; a single document is the only place the full picture lives.

## References

- ISO/IEC 29147 — Vulnerability disclosure: <https://www.iso.org/standard/72311.html>
- GitHub Security Advisories: <https://docs.github.com/en/code-security/security-advisories>
- The original audit document is `docs/audit-2026-05-15.PRIVATE.md` (gitignored).
