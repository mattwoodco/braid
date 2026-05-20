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

Inside Claude Code (these are the slash-commands you'll actually type):

```
/braid                                                  # interactive menu
/braid list                                             # show available flows
/braid create "describe what you want"                  # assistant-driven scaffold from a sentence
/braid create --template <tmpl> --name <flow>           # scaffold directly from a named template
/braid setup <flow>                                     # create env/vault/stores/agents
/braid run <flow> [brief] [session-id]                  # start (or resume) a streaming run
/braid sessions <flow> [--pick|--kill|--kill-all]       # inspect / pick / kill in-flight sessions
/braid pull <flow> [agent-key…]                         # overwrite local agent YAML from the server
/braid dream <flow> [--store K] [--sessions N]          # consolidate past runs into a memory store
/braid purge [--select|--yes]                           # tear down infra (interactive unless --yes)
```

Useful `create` flags:

- `--template <name>` — pick a starter from [`flows/_templates/`](./flows/_templates/) (e.g. `fundraiser-video-site`, `static-site-builder-deployer`, `image-series-with-memory`, `url-to-ad-set`, `viral-video-ad`).
- `--name <flow>` — the new folder name under `flows/`. Lowercase kebab-case. Prefix with `_examples/` to keep it out of the default `list`.
- `--vars k=v,k=v` — fill in template placeholders (each template's `template.yaml` lists the vars it needs).
- `--force` — overwrite an existing `flows/<name>/` directory.

### For non-technical folks

You don't have to start from a blank page. Two folders are designed exactly for this:

- **[`flows/_templates/`](./flows/_templates/)** — fill-in-the-blank starters. Pick one with `/braid create --template <name> --name my-flow --vars …` and Braid writes the whole flow folder for you. Open any template's `template.yaml` to see what variables it accepts in plain English.
- **[`flows/_examples/`](./flows/_examples/)** — fully-working reference flows you can run as-is or copy. Use `/braid run _examples/<name>` (the `_examples/` prefix keeps them organized without hiding them).

If you just want to describe what you want in a sentence, use `/braid create "make a 3-shot fundraiser site for a dog rescue"` — the assistant picks the right template, fills it in, and tells you what to run next.

## Flows

Each lives in `flows/<name>/` with a `flow.yaml` and agent YAML files. Built-in showcases (under `flows/_examples/`):

- **fundraiser** — videographer (Fal MCP) + web-builder (Vercel) + director. Ships a live one-pager with a hero video. [live](https://fundraiser-site-one.vercel.app/)
- **snapshots** — image-series flow with reflection-into-memory (lessons store grows across runs).
- **fraction-blocks** — teaching-aid generator.
- **gauntlet-ads** — multi-variant ad designer with Playwright screenshots.
- **hiking-boots** — product-kit demo.

Archived reference flows (`flows/_archive/`): `ad`, `final-inning`, `homecoming`, `quiet-rebellion`, `pop-quiz`, `solids`, `ad-render`, `comic`, `kitchensink`, etc. — runnable via `/braid run _archive/<name>`.

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
    command: bun run "$BRAID_REPO_ROOT/.claude/skills/braid/post-hooks/vercel-deploy.ts"
    env_passthrough: [VERCEL_TOKEN]      # strict scope; nothing else reaches the hook
    timeout_ms: 300000
```
