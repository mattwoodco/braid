# [Braid](https://managed-agents.mattwood.co/)

A toolkit for Claude Managed Agents.

> [!WARNING]
> **Experimental — not for production use.**
> Braid is an early-stage research project. APIs, flows, and outputs are unstable and may change or break without notice. It is provided as-is, without warranty of any kind, for experimentation and demonstration only. Do not rely on it for production workloads, sensitive data, or anything you cannot afford to lose.

## Six tools

- **Agent** — the job description.
- **Environment** — the private office.
- **Session** — the workday that survives sleep.
- **Skills** — table of contents, not textbook.
- **Vaults** — agent knows the lock; session brings the key.
- **Outcomes** — the grader.

## Setup

Requires [Claude Code](https://claude.com/claude-code) and [`bun`](https://bun.sh).

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export FAL_API_KEY=...          # for video / image generation (vault-injected)
export VERCEL_TOKEN=...         # consumed host-side by post-session hooks; never enters agent session
```

Secrets handling follows [NIST SP 800-204C](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-204C.pdf) build/deploy separation and Anthropic's [vault docs](https://platform.claude.com/docs/en/managed-agents/vaults). `FAL_API_KEY` is injected by the Fal MCP proxy and never enters the sandbox. `VERCEL_TOKEN` stays on the host and is consumed by the post-session hook after the agent's session ends. See [`SECURITY.md`](./SECURITY.md) for the threat model and disclosure policy.

## Use

Inside Claude Code:

```
/braid                  # interactive
/braid list
/braid setup <flow>
/braid run <flow>
/braid pull <flow>
/braid purge
```

## Flows

Each lives in `flows/<name>/` with a `flow.yaml` and agent YAML files.

- **ad** — director + producer + critic + sentinel.
- **fundraiser** — videographer (Fal MCP) + web-builder (Vercel) + director. Ships a live one-pager with a hero video. [live](https://fundraiser-site-one.vercel.app/)
- **final-inning** — 3-shot fundraiser, little-league field. [live](https://final-inning-site.vercel.app/)
- **homecoming** — 3-shot fundraiser, veteran service dogs. [live](https://homecoming-site.vercel.app/)
- **quiet-rebellion** — 3-shot fundraiser, scrubland conservation. [live](https://quiet-rebellion-site.vercel.app/)
- **pop-quiz** — 3-shot deadpan storyboard (goose substitute teacher) with a mediabunny-composited `final.mp4`.

## Reading order

- [`SKILL.md`](./.claude/skills/braid/SKILL.md) — design + canonical patterns (brief substitution sandbox, host-side post-session hooks, MCP host allowlist, composite recipes).
- [`SECURITY.md`](./SECURITY.md) — disclosure policy and threat model.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — TDD workflow, PR strategy, authoritative-source citation requirement.
- [`flow.schema.json`](./.claude/skills/braid/flow.schema.json) — the canonical shape of `flows/<name>/flow.yaml`.

## Configuration highlights

Each `flows/<name>/flow.yaml` can declare:

```yaml
environment:
  networking:                 # defaults to limited with empty allowed_hosts
    type: limited
    allowed_hosts: [api.example.com]
    allow_mcp_servers: true

run:
  sentinel_context_store: projectStore   # store key for the sentinel diagnostic agent
  post_session_hook:                     # host-side hook for credentialed work
    command: bun run "$BRAID_FLOW_DIR/../../.claude/skills/braid/post-hooks/vercel-deploy.ts"
    env_passthrough: [VERCEL_TOKEN]      # strict scope; nothing else reaches the hook
    timeout_ms: 300000
```
