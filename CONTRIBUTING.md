# Contributing to Braid

Braid is a published reference for Anthropic Managed Agents — patterns here get copied into other people's projects, and AI collaborators read `SKILL.md` as canonical context. The bar reflects that.

## TL;DR

1. **One PR per plan-ledger slice.** Stacked in dependency order.
2. **PR titles use neutral refactor-style language** during the security fix window. The mapping to private audit anchors lives in `docs/audit-*.PRIVATE.md` (gitignored).
3. **TDD Red-Green-Refactor is mandatory** for any code change.
4. **Anti-examples never live in the production-mode tree.** They live in `examples/anti-patterns/` with `BAD-DO-NOT-COPY-` filename prefix, or not at all.
5. **Authoritative-source citations** in every commit body. No blog-only sources; primary docs, standards, or recorded Memento decisions.

## Why these rules

| Rule | Authority |
|---|---|
| Private vulnerability details until fix ships | [GitHub Security Advisories guidance](https://docs.github.com/en/code-security/security-advisories), [ISO/IEC 29147](https://www.iso.org/standard/72311.html) |
| Neutral PR titles during fix window | OpenClaw 2026 Q1 retrospective: 4-day window from disclosure to mass exploitation in agentic-AI toolkits |
| Anti-examples physically isolated, never labeled-inline | Empirical copy-pattern studies (Stack Overflow, Copilot) + AI context contamination risk — labels don't prevent copying |
| Small, focused PRs (200–400 LOC) | [Google Engineering Practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) |
| TDD RGR | Project CLAUDE.md (`~/.claude/CLAUDE.md`) |

## Disclosure posture (read this first if working on security)

- Audit findings naming file:line or exploitable patterns are private. They live in `docs/audit-YYYY-MM-DD.PRIVATE.md` (gitignored). Never reference these anchors in public PR titles, public commit subjects, public issue threads, or `SKILL.md` examples.
- During the security fix window (until all Critical-severity findings are merged), use **neutral refactor-style language** in PR titles and commit subjects: "refactor environment configuration", "tighten brief expansion", "consolidate vault credential issuance". The mapping to private anchors lives in the private audit doc.
- After Critical fixes ship, publish a sanitized post-mortem at `docs/security-YYYY.md` that credits the work without enumerating un-fixed vectors. That post-mortem is the ecosystem teaching artifact.
- See `SECURITY.md` for the responsible-disclosure channel.

## Workflow

### 1. Open the plan-ledger slice

Every change starts from a Memento plan node. Find the relevant slice or capture an idea first.

### 2. Branch from the prerequisite

```bash
# For a root slice with no prereqs:
git checkout -b refactor-env-config main

# For a stacked slice:
git checkout -b tighten-brief-expansion refactor-env-config
```

Branch names use neutral refactor-style language. Do not name a branch after a vulnerability class.

### 3. RGR per change

For each discrete change in this slice:

1. **Red** — write a failing test first. Commit:
   ```
   test: red — expandBrief should reject paths outside flow dir
   ```
2. **Green** — minimum code change. Commit body must cite a primary source:
   ```
   refactor(brief): sandbox file interpolation to flow directory

   Per CWE-22 and OWASP Path Traversal guidance, file-path inputs
   from untrusted sources must be resolved against a known root and
   validated to not escape it.

   Source: https://cwe.mitre.org/data/definitions/22.html
   Source: https://owasp.org/www-community/attacks/Path_Traversal

   Changes:
   - lib.ts:125-133 — paths resolved via path.resolve against
     the flow directory; absolute paths and `..` rejected.
   - tests/expand-brief.test.ts — RGR coverage for traversal patterns.

   Plan-node: 2a1c1e90 (private audit anchor in docs/audit-2026-05-15.PRIVATE.md).
   ```
3. **Refactor** — optional cleanup, separate commit if used.

### 4. PR

Use the template in `.github/PULL_REQUEST_TEMPLATE.md`. Stacked PRs declare their base.

## Commit message format

```
<type>(<scope>): <neutral subject>

<rationale — one paragraph>

Source: <primary-source URL>
Source: <additional source if applicable>

Changes:
- <file>:<line> — <what changed>

Plan-node: <GUID> (anchor in docs/audit-*.PRIVATE.md).
```

**Type:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.

**Scope:** area of the codebase, neutral — `env`, `brief`, `vault`, `schema`, `docs`, etc. Do NOT use `security` as a scope during the fix window; it signals exploitability.

**Subject:** imperative, ≤72 chars, neutral. Examples:
- ✅ `refactor(env): read networking config from manifest`
- ✅ `refactor(brief): consolidate substitution helpers`
- ❌ `fix(security): prevent token exfiltration via brief`
- ❌ `feat(security): close path traversal in expandBrief`

## What "authoritative source" means

In order of preference:

1. **Primary vendor docs** — `platform.claude.com/docs/...`, `nodejs.org/docs`, `bun.sh/docs`. Quote the passage that justifies your change.
2. **Standards bodies** — CWE, CVE, NVD, OWASP, IETF RFC, ISO/IEC, JSON Schema. Cite the specific number.
3. **Vendor-published security analyses** — e.g. Pluto Security architecture analyses for Managed Agents. Acceptable when no primary doc covers the topic.
4. **Memento decisions** captured in this project — for process choices without an external authority.

Not acceptable: random blog posts, Stack Overflow answers without primary backing, author's unsourced opinion.

## File-by-file expectations

- **`docs/audit-*.PRIVATE.md`** — gitignored. Never commit. Never reference anchors in public surfaces.
- **`docs/security-YYYY.md`** — sanitized public post-mortem, published only after Critical fixes ship.
- **`SKILL.md`** — every example must follow safe defaults. Do not include opt-out examples inline; if an opt-out is necessary, link to `examples/anti-patterns/`.
- **`flows/*/flow.yaml`** — safe-default posture only. Any `unrestricted` networking or `always_allow` permission policy requires a `# rationale:` YAML comment on the line above explaining why this flow is an intentional exception.
- **`examples/anti-patterns/BAD-*.yaml`** — anti-examples live here, with a header explaining what is wrong and what the safe pattern looks like instead. Files MUST be prefixed `BAD-` so casual `cp` operations show the warning in shell completion.
- **`.claude/skills/braid/lib.ts`** — every `c.beta.*` call goes through the SDK adapter module.

## When TDD doesn't apply

Documentation-only changes (this file, `docs/`, `SKILL.md`, README, `SECURITY.md`) don't need tests. Every other change does.

## When you can't find an authority

Stop. Either:
- The change isn't necessary — drop it.
- The change is novel — capture a Memento decision first (`mcp__memento__decision_create`) with rationale, alternatives, and why no external authority covers this. The decision becomes the authority for the commit.

---

*Last updated 2026-05-15. Policy decisions in Memento: `17f98e5d` (PR strategy), `e6984cc3` (disclosure posture).*
