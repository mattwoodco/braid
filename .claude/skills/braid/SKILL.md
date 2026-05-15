---
name: braid
description: Run multi-agent workflows defined in flows/<name>/. Use when the user wants to set up, run, list, pull, or tear down a Braid flow (e.g. "braid run ad", "list flows", "pull director agent", "purge").
---

# braid

Manages multi-agent workflows backed by the Anthropic managed-agents API.

**Prerequisites:** [`bun`](https://bun.sh) ≥ 1.0 and `ANTHROPIC_API_KEY`.

**One-time setup:**

```
cd .claude/skills/braid && bun install
```

Each workflow lives in `flows/<name>/`:

```
flows/ad/
  flow.yaml          # flow definition (env, vault, stores, agents)
  state.json         # gitignored — created IDs (env, vault, agent, store)
  rubric.md          # optional — outcome rubric (otherwise outcome.description is used)
  agents/*.yaml      # per-agent definitions
```

## Invocation

All commands run from the repo root via:

```bash
bun .claude/skills/braid/braid.ts <command> [args]
```

### No-argument invocation (`/braid`)

If the user invokes the skill with no arguments (e.g. just `/braid`):

1. Run `bun .claude/skills/braid/braid.ts list` to enumerate existing flows.
2. Use the `AskUserQuestion` tool to present each existing flow as an option, plus a final "Create a new flow" option.
3. Based on the selection:
   - Existing flow → check `flows/<flow>/state.json`:
     - Missing, empty, or `{}` → flow has not been provisioned yet. Recommend `setup` and confirm before running it.
     - Populated → flow is already provisioned. Recommend `run` (default action) and confirm before starting. Also offer `pull`, `dream`, or `sessions` as alternates.
   - Create new → ask for the flow name, then scaffold per "Adding a new flow" below.

## Commands

| Command | What it does |
|---|---|
| `list` | Show available flows |
| `setup <flow>` | Create environment, vault, memory stores, and agents in Anthropic; populate `flows/<flow>/state.json` |
| `run <flow> [brief] [sesn_id]` | Start (or resume) a session and stream events |
| `sessions <flow> [--pick\|--kill\|--kill-all]` | Inspect tracked sessions |
| `pull <flow> [key...]` | Overwrite local `agents/*.yaml` with the latest from Anthropic. Pulled YAML is safe to re-use in a fresh setup — multiagent IDs get rewritten from `coordinator:` in `flow.yaml`. |
| `dream <flow>` | Run a dream over tracked sessions (updates brand memory store) |
| `purge [--select]` | Tear down all Anthropic infra |

## Adding a new flow

1. `mkdir -p flows/<name>/agents`
2. Write `flows/<name>/flow.yaml` (copy an existing one as a starting point)
3. Drop agent YAML files into `flows/<name>/agents/`
4. `bun .claude/skills/braid/braid.ts setup <name>`

### Defaults (what you can omit from flow.yaml)

The skill fills these in if you don't set them:

| Field | Default |
|---|---|
| `env_name` | `braid-<name>` |
| `state_file` | `state.json` |
| `output_dir` | `outputs/<name>` |
| `agents[].tools` (per-agent) | `[{ type: agent_toolset_20260401, default_config: { enabled: true } }]` if absent in both `flow.yaml` and the agent YAML |
| `agents[].is_director` | `true` for the lone agent in a single-agent flow |
| `run.attach_vault` | `true` |
| `run.attach_stores` | `true` |
| `run.outcome.rubric_file` | falls back to using `outcome.description` verbatim as the rubric |

Only `name` and `agents` are truly required. A minimal flow can be a dozen lines.

### Where deliverables go

The outcome grader inspects `/mnt/session/outputs/` (the sandbox path that maps to the flow's `output_dir`), not just the agent's chat messages. If the rubric describes a deliverable, the agent must **write a file to `/mnt/session/outputs/`** for the grader to find — text in the final message alone isn't enough. Make this explicit in the agent's system prompt.

## External services: MCP vs. sandbox shell

Two ways an agent can talk to an external service. Pick based on what the service's MCP actually does.

**Full-service MCPs (e.g. Fal)** — the MCP server holds the token and does the work server-side. Agent calls `fal_run(...)` and gets back a URL. Wire it as a vault credential and attach it to the agent. Token never enters the sandbox.

**Stub MCPs (e.g. Vercel)** — the MCP exposes read-only tools (`list_projects`, `search_docs`) and instructional stubs (`deploy_to_vercel` returns the text *"run `vercel deploy`"*). The real work happens in the sandbox shell, so **the token must land in the brief**, not just in the vault.

Decide before wiring:

| Agent task | Attach the MCP? |
|---|---|
| Generate Fal image | Yes — MCP does the work |
| Build + deploy a fresh page to Vercel | No — token + CLI is enough |
| List Vercel projects, check deploy status, search Vercel docs | Yes — read tools are useful |
| Both deploy *and* inspect | Yes, but still pass the token via `{{env:...}}` for the deploy |

## Attaching an MCP (vault credentials)

Tokens come from `.env.local` (Bun loads it automatically).

Single MCP — use `vault:`:

```yaml
vault:
  display_name: fal
  credential:
    display_name: Fal MCP
    mcp_server_url: https://mcp.fal.ai/mcp
    token_env: FAL_API_KEY
```

Multiple MCPs — use `vaults:` (array). Both forms can coexist:

```yaml
vaults:
  - display_name: fal
    credential:
      display_name: Fal MCP
      mcp_server_url: https://mcp.fal.ai/mcp
      token_env: FAL_API_KEY
  - display_name: vercel
    credential:
      display_name: Vercel MCP
      mcp_server_url: https://mcp.vercel.com
      token_env: VERCEL_TOKEN
```

Then per-agent, reference each server by URL:

```yaml
agents:
  - key: deployer
    file: agents/deployer.yaml
    mcp_servers:
      - { type: url, url: https://mcp.vercel.com, name: vercel }
    tools:
      - type: mcp_toolset
        mcp_server_name: vercel
        default_config:
          enabled: true
          permission_policy: { type: always_allow }
```

## Run-time secrets in the brief

Anything in the brief or in `{{file:...}}` content is expanded at session start. Two substitutions:

- `{{file:path/to/x.md}}` → file contents
- `{{env:VAR_NAME}}` → `process.env.VAR_NAME` (throws if missing)

Use `{{env:...}}` to forward a token from your `.env.local` into the agent's first message — needed whenever the agent itself (not an MCP server) has to authenticate. The Vercel CLI flow is the canonical case:

```yaml
brief_default: |
  Build index.html and deploy to Vercel. Return the production URL.

  Vercel access token: {{env:VERCEL_TOKEN}}
```

```yaml
# agents/builder.yaml
system: |
  Use the Vercel access token from the user message:
    npm install -g vercel
    vercel deploy --prod --yes --token=<TOKEN>
```

The token is added to the session transcript at Anthropic. Fine for personal dev tokens; rotate if paranoid.
