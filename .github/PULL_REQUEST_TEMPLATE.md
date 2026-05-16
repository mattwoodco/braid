<!--
  Braid PR template.
  Read CONTRIBUTING.md for the full policy, especially the disclosure posture.
  During the security fix window, PR titles and bodies use NEUTRAL refactor language.
  The mapping to private audit anchors lives only in docs/audit-*.PRIVATE.md (gitignored).
-->

## What this PR does

<!-- One paragraph. Plain prose, no headers. Neutral language — "refactor X", "consolidate Y" — not vulnerability-class names. -->

## Authoritative sources

<!-- Every change of substance must cite a primary source. -->

- [Source title](https://example.com/...)
- ...

## Acceptance gates (verified)

- [ ] `bun test` — all tests passing, including new tests for the changed paths
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `bun run schema:check` — all `flows/*/flow.yaml` validate (once Slice 30 lands)
- [ ] Manual smoke: at least one shipped flow still runs end-to-end

## Plan-ledger reference

<!-- Private audit anchors live in docs/audit-*.PRIVATE.md. Do NOT list them here. -->

Closes plan-node `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`.

## Dependency

<!-- "Based on `main`" or "Based on #N". Stacked PRs MUST declare their base. -->

Based on `main`.

## Reviewer note

<!-- If this PR is part of the active security fix window, add: "See docs/audit-2026-05-15.PRIVATE.md anchor §X.Y for full context." Reviewers with repo access have the private doc locally. -->
