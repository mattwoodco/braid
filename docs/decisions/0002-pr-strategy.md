# 0002 — PR strategy

- **Status:** Accepted
- **Date:** 2026-05-15

## Context

Audit-driven fixes often span many small changes across different surfaces (schemas, libraries, tests, CI, docs). The maintainer is solo. Single omnibus PRs are unreviewable. Truly atomic PRs that don't compile in isolation are also unreviewable.

## Decision

1. **One small, end-to-end change per PR.** Each PR is independently reviewable in one sitting. In vertical-slicing methodology this unit is called a "slice"; the term doesn't matter — the discipline does.
2. **Stack in dependency order.** If change B depends on change A, A merges first. The PR body for B declares its base: "Based on `main`" or "Based on #N".
3. **Authoritative-source citations required in every commit body.** No blog-only sources. Cite primary docs (e.g. NIST SP, OWASP cheat sheets, vendor SDK docs), formal standards (IETF RFCs, ISO, W3C), or — when the choice is purely internal — a decision record (ADR) in `docs/decisions/`.
4. **TDD Red-Green-Refactor (RGR).** Failing test first, minimum code to pass, optional cleanup. Each phase is a separate commit when practical.
5. **Neutral PR titles during a security fix window.** Per ADR-0001.

## Consequences

- PR count goes up but each PR is reviewable. The maintainer never faces a 4,000-line diff.
- Citations travel with the code in commit messages, not in chat or tribal knowledge. New contributors can audit the decision trail later.
- Stacked PRs require explicit dependency declaration, which surfaces ordering bugs early.
- When code from multiple "small changes" ends up entangled in one file (e.g. an orchestration anchor file touched by every layer), the *anchor* PR carries the entangled diff and subsequent PRs reference it. This is acknowledged in the anchor's commit body.

## Alternatives considered

- **Omnibus single PR.** Rejected — unreviewable for a solo maintainer.
- **Squash-merge of branch dumps.** Rejected — loses per-change citation context that is the entire point of the discipline.
- **Cherry-pick fully atomic per-change PRs.** Rejected — entanglement makes some changes uncompilable in isolation.

## References

- Vertical slicing: <https://en.wikipedia.org/wiki/Vertical_slice>
- Conventional Commits: <https://www.conventionalcommits.org/>
- Kent Beck — *Test-Driven Development: By Example*
- Martin Fowler — "TestDrivenDevelopment": <https://martinfowler.com/bliki/TestDrivenDevelopment.html>
