# [Braid](https://managed-agents.mattwood.co/)

A toolkit for Claude Managed Agents.

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
export FAL_API_KEY=...          # for video / image generation
export VERCEL_TOKEN=...         # for deploys
```

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
- **fundraiser** — videographer (Fal MCP) + web-builder (Vercel) + director. Ships a live one-pager with a hero video.
