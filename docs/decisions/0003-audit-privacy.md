# 0003 — Audit document privacy

- **Status:** Accepted
- **Date:** 2026-05-15

## Context

The Braid audit produced a document that names file paths, line numbers, vulnerability patterns, and remediation order across the toolkit. That document is itself a vulnerability map until every Critical-severity finding has been merged and shipped.

At the same time, public documents (troubleshooting guide, this ADR, etc.) sometimes need to *refer to* findings without *quoting* them.

## Decision

1. **Audit documents live at `docs/audit-*.PRIVATE.md`, gitignored.** The patterns `docs/audit-*.md`, `docs/audit-*.PRIVATE.md`, and `*.PRIVATE.md` are all excluded by `.gitignore`. A routine `git add -A` cannot accidentally stage them.
2. **Public docs may reference an audit anchor (e.g. §1.F2) but MUST NOT quote audit content.** The troubleshooting doc routes "symptom X" → "see audit §1.F2 for full context." A reader with access to the private doc gets the deep context; a reader without it still understands the symptom and resolution from the troubleshooting prose itself.
3. **PR template warns against pasting audit content.** The template's "Reviewer note" section instructs contributors to leave audit anchors in the private doc rather than paste them into PR bodies.
4. **An anchor-parity test enforces consistency.** `tests/docs-anchor-parity.test.ts` reads the private doc (if locally present) and asserts every §X.Y referenced in `docs/troubleshooting.md` exists in the audit doc. When the audit doc is absent (typical CI environment without local-only access), the test skips with a warning. This catches anchor-rot without exposing audit content.

## Consequences

- External reviewers can follow remediation logic from commit bodies, authoritative-source citations, and the public docs — without needing the private audit.
- The anchor-parity test is local-machine-only by design. Drifted anchors in `troubleshooting.md` are caught at PR time on the maintainer's machine.
- Eventually, once all Critical fixes ship, a sanitized post-mortem (`docs/security-YYYY.md`) replaces the private audit doc as the public reference. Audit anchors in older docs continue to resolve to the post-mortem via that document.

## Alternatives considered

- **Encrypted audit doc committed to repo.** Rejected — security through obscurity; key management overhead; doesn't solve the "anyone with repo access reads it" problem.
- **No audit doc; rely on commit bodies.** Rejected — full audit context spans multiple commits and is hard to reconstruct from commit history alone.
- **Public audit doc with redactions.** Rejected — readers infer redacted content from surrounding context, defeating the purpose during the embargo window.

## References

- Coordinated Vulnerability Disclosure (CVD): <https://www.cisa.gov/coordinated-vulnerability-disclosure-process>
- This project's [`SECURITY.md`](../../SECURITY.md) and [ADR-0001](./0001-disclosure-posture.md).
