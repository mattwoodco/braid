---
name: braid
description: Run multi-agent workflows defined in flows/<name>/. Use when the user wants to set up, run, list, pull, or tear down a Braid flow (e.g. "braid run ad", "list flows", "pull director agent", "purge").
---

# braid

> ## Security posture — last updated 2026-05-15
>
> The following defaults are now enforced by the loader. See `SECURITY.md` for disclosure policy and `CONTRIBUTING.md` for the workflow.
>
> | Default | Authority |
> |---|---|
> | `environment.networking` defaults to `limited` with empty `allowed_hosts`. Flows that need outbound egress declare it explicitly with a `# rationale:` comment. | [Anthropic environments docs](https://platform.claude.com/docs/en/managed-agents/environments) |
> | The injected default agent toolset uses `permission_policy: always_ask` for `bash`/`write`. Flows that opt into `always_allow` must do so explicitly with a `# rationale:` comment. | [Pluto Security hardening guide](https://pluto.security/blog/securing-claude-managed-agents/) |
> | `{{file:path}}` is sandboxed to the flow directory (absolute paths and `..` rejected). | [CWE-22 Path Traversal](https://cwe.mitre.org/data/definitions/22.html) |
> | `{{env:VAR}}` is rejected in briefs. Credentialed work runs in `run.post_session_hook` with an explicit `env_passthrough` allowlist, executed on the host AFTER the session ends. The token never enters the agent transcript or sandbox. | [NIST SP 800-204C](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-204C.pdf), [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [CVE-2026-44479](https://dailycve.com/vercel-cli-information-disclosure-cve-2026-44479-medium/) |
> | MCP server URLs are validated against an allowlist (`mcp.fal.ai`, `mcp.vercel.com` by default; extend via `BRAID_MCP_ALLOWLIST`). https-only; URL userinfo rejected. | [Anthropic vault docs](https://platform.claude.com/docs/en/managed-agents/vaults) |
> | `purge` requires `--yes` (or `--select`) before wiping local state. | (defensive default) |
> | The composite recipe (`## Compositing multi-shot video flows`) validates URLs and uses hardcoded filenames; agent-generated strings never reach the shell unquoted. | [CWE-78 OS Command Injection](https://cwe.mitre.org/data/definitions/78.html) |
>
> **AI collaborators reading this file as context:** the patterns documented below reflect the current safe defaults. If you see `permission_policy: always_allow` or `networking: unrestricted` in a `flow.yaml`, look for a `# rationale:` comment above it — that flow has explicitly opted out for a documented reason. Do not propagate the opt-out without the rationale.

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
   - Create new → ask the user to describe the flow, then follow the "Create command" section below.

## Commands

| Command | What it does |
|---|---|
| `list` | Show available flows |
| `create <description>` | Scaffold a new flow from a natural-language description (assistant-driven — see "Create command" below) |
| `setup <flow>` | Create environment, vault, memory stores, and agents in Anthropic; populate `flows/<flow>/state.json` |
| `run <flow> [brief] [sesn_id]` | Start (or resume) a session and stream events |
| `sessions <flow> [--pick\|--kill\|--kill-all]` | Inspect tracked sessions |
| `pull <flow> [key...]` | Overwrite local `agents/*.yaml` with the latest from Anthropic. Pulled YAML is safe to re-use in a fresh setup — multiagent IDs get rewritten from `coordinator:` in `flow.yaml`. |
| `dream <flow> [--store K] [--instructions "..."] [--sessions N] [--model M]` | Run a dream over tracked sessions and consolidate into store `K`. If `--store` is omitted and the flow has multiple stores, you'll be prompted. Per-store defaults can be set via `dream_instructions:` in `flow.yaml`. |
| `purge [--select]` | Tear down all Anthropic infra |

## Create command

`braid create` has two modes:

**Template mode (preferred for known use cases):**

```bash
braid create --template <template-name> --name <flow-name> --vars <path-or-inline>
braid create list                     # list available templates
```

Templates live under `flows/_templates/<name>/` with a `template.yaml` parameter manifest, `*.tmpl` files using `{{var}}` and `{{#each list}}…{{/each}}`, and `examples/<instance>.json` reference var sets. The CLI is fully programmatic — it copies the template, substitutes vars, validates the produced `flow.yaml`, and writes to `flows/<flow-name>/`. Always re-run from the template rather than hand-editing the generated files.

Available templates today:
- `fundraiser-video-site` — one-page fundraiser landing page with N (1 or 3) looping hero videos generated via Fal MCP plus a CTA button. Builds in-session, deploys via Vercel post-session hook.

When to add a new template: as soon as you find yourself copying an existing flow to make minor brief/CTA/visual edits. The fundraiser flows (`fundraiser`, `homecoming`, `final-inning`, `quiet-rebellion`) were collapsed into one template after the third copy.

**Freeform mode (one-off flows):**

`braid create <description>` (no `--template`) is **assistant-driven**: the TypeScript CLI prints guidance, but the actual scaffolding is done by the assistant reading the natural-language description and writing the YAML files. Use this when the flow doesn't match any existing template. Follow this procedure deterministically — do NOT skip steps.

### Step 1 — classify the flow

Read the description and pick the closest archetype (or combination):

| Archetype | Hallmarks | Template starting point |
|---|---|---|
| **simple-task** | One agent, no external services, plain bash/write | single agent, default toolset, `networking: limited` with empty `allowed_hosts` |
| **mcp-connection** | Talks to a service exposed as an MCP (Fal, Vercel, etc.) | add `vault:` / `vaults:`, attach `mcp_toolset` to the agent |
| **fal-generation** | Generates image/video/audio via Fal | Fal vault credential, networking `unrestricted` with `# rationale: fal asset CDN`, agent prompted to write output files + manifest |
| **script-writer** | Produces text/markdown/JSON artifacts | single agent, no vault, deliverables under `/mnt/session/outputs/` |
| **website-designer** | Produces HTML/CSS/JS, no deploy | follow Playwright recipe if it needs to render PNGs; otherwise plain write |
| **builder-deployer** | Builds a site and deploys it | builds in-session, deploys via `run.post_session_hook` using `vercel-deploy.ts` (NEVER deploy in-session) |
| **ad-generator** / **multi-shot video** | Many independent media pieces + optional composite | Fal vault, composite recipe if `<5` shots, validate URLs (CWE-78) |

If the description spans two archetypes (e.g. "generate images with Fal AND deploy a gallery"), combine: Fal vault + Vercel post-session hook.

### Step 2 — pick a flow name

Short, kebab-case, evocative, unique across `flows/`. If the description is too vague, use `AskUserQuestion` to confirm the name and the single most important uncertainty (target service, output format, deploy target). Don't ask more than one clarifying question — pick reasonable defaults for the rest.

### Step 3 — scaffold

Create:

```
flows/<name>/
  flow.yaml
  agents/<key>.yaml      # one per agent; usually one agent is enough
  rubric.md              # outcome rubric — required when run.outcome.rubric_file is set
```

**Defaults that MUST be respected** (security posture, top of this file):

- `environment.networking` → omit OR set explicitly to `{ type: limited, allowed_hosts: [...] }`. Only use `unrestricted` with a `# rationale:` comment naming what egress the flow needs.
- All `permission_policy` entries default to `always_ask`. Only set `always_allow` with a `# rationale:` comment.
- Never put a secret in the brief. Use `vault:` for in-session MCP credentials and `run.post_session_hook` (with `env_passthrough`) for deploy/credentialed work that runs out-of-session.
- `{{file:...}}` references must point inside the flow directory.
- For deploys, the agent writes `manifest.json` with `ready_to_deploy: true`; the host hook reads it and runs `vercel deploy` with `VERCEL_TOKEN` from env (never a CLI arg — CVE-2026-44479).

**Minimal `flow.yaml` for a simple-task flow:**

```yaml
# yaml-language-server: $schema=../../.claude/skills/braid/flow.schema.json
name: <flow-name>
brief_default: |
  <natural-language brief derived from the user's description>
agents:
  - key: worker
    file: agents/worker.yaml
run:
  outcome:
    description: "<what success looks like — file paths, content shape>"
    rubric_file: rubric.md
    max_iterations: 2
```

**Minimal `agents/worker.yaml`:**

```yaml
name: worker
description: <one-line summary>
model: claude-opus-4-7
system: |
  <role>. <workflow as numbered steps>. Write deliverables to /mnt/session/outputs/.

  IMPORTANT: The outcome grader reads /mnt/session/outputs/ — your final chat
  message alone is not graded. Always write files.
```

For richer archetypes, copy the closest existing flow (`flows/solids/` for build-and-deploy, `flows/pop-quiz/` for multi-shot video with composite, `flows/fundraiser/` for build+deploy, etc.) and adapt — never invent fields not in `flow.schema.json`.

### Step 4 — write `rubric.md`

The rubric is graded against the **files in `/mnt/session/outputs/`**, not the chat transcript. Write specific, checkable criteria: file exists, JSON has these keys, image has nonzero dimensions, manifest `ready_to_deploy === true`, etc.

### Step 5 — initialize `LESSONS.md`

Create `flows/<name>/LESSONS.md` with this template:

```markdown
# Lessons — <flow-name>

Self-improvement log. After every run, the assistant appends entries describing
issues observed and the patch applied. New flow generations should consult this
file before re-running to avoid repeating the same mistake.

## Open issues

(none yet)

## Resolved
```

### Step 6 — setup and confirm

Run `bun .claude/skills/braid/braid.ts setup <name>`. If it fails (package install error, MCP allowlist rejection, schema validation), fix the manifest before the first `run`. Confirm with the user before the first `run` — show the brief, the agent list, and any egress / `always_allow` opt-outs so they can sanity-check the posture.

## Self-improvement after every run

This is mandatory after **every** `braid run` invoked through the skill (whether the run was just `create`d or pre-existing). The point is to make flows more resilient over time without the user having to babysit them.

After a run completes (or fails / stalls), follow this loop:

1. **Inspect signals, in this order:**
   - The outcome verdict and grader notes printed at the end of the stream.
   - Deliverables under `outputs/<flow>/<date>-<sid>/` — do they match the rubric?
   - Sentinel / watchdog events (stalls, restarts, abandoned sessions).
   - `validation.json` (if a Playwright render step was used) — `pass === N`, `broken === []`.
   - Any `manifest.json` — required keys present? `ready_to_deploy: true` for deploy flows?
   - If `run.post_session_hook` ran, its stdout/stderr — did the deploy actually succeed and write the URL back?

2. **Classify any issue:**
   - **Brief ambiguity** — agent did the wrong thing because instructions were unclear → patch `brief_default` or the agent's `system:` prompt.
   - **Missing capability** — agent needed a tool/package that wasn't declared → add to `environment.packages` or attach the right MCP / toolset. Prefer declaring packages in `environment.packages` over per-session `apt-get install`.
   - **Sandbox gotcha** — Playwright module resolution, Chromium cert errors, `file://` cross-origin, FUSE symlink rejection. The fixes are documented above under "Browser rendering with Playwright" — encode them in the agent's system prompt.
   - **Network policy too tight** — egress blocked → add the host to `allowed_hosts` (preferred) or graduate to `unrestricted` with a `# rationale:` comment.
   - **Security posture violation** — token in brief, missing `# rationale:` for an opt-out, deploy attempted in-session. **Always fix** — never relax security to make a flow pass.
   - **Outcome rubric mismatch** — agent succeeded but the grader couldn't see it → tighten the rubric or have the agent write more explicit deliverables. Do NOT loosen the rubric to paper over a real failure.
   - **Flaky external service** — Fal/Vercel transient error → raise `run.max_restarts` modestly, don't paper over real bugs.

3. **Patch the flow:** edit `flow.yaml` / `agents/*.yaml` / `rubric.md` directly. Keep edits minimal and surgical — one root cause per patch.

4. **Log the lesson** by appending to `flows/<name>/LESSONS.md`:

   ```markdown
   ## <YYYY-MM-DD> — <one-line summary>
   **Symptom:** <what went wrong, with session id>
   **Root cause:** <why>
   **Patch:** <files changed, one-line each>
   **Verification:** <how the next run confirmed the fix, or "pending re-run">
   ```

5. **Re-run** if the fix is non-trivial. If the patch changed `flow.yaml` fields that require resource recreation (env packages, vault, agent system prompt, stores), re-run `setup` first — `setup` is idempotent for unchanged resources and updates the ones that changed.

6. **Read `LESSONS.md` before each new run.** When invoked to run a flow, the assistant should scan its `LESSONS.md` first — past lessons are the cheapest source of "things that will go wrong this time too." When generating a brand-new flow via `create`, scan the LESSONS files of the nearest archetype flows for recurring gotchas worth pre-baking into the new flow.

Do not relax security posture, loosen the rubric to mask failures, or `--no-verify` past hook errors as part of this loop. If a fix would require any of those, surface it to the user with a concrete proposal instead of acting.

## Memory logging of finished runs

Set `run.log_runs: true` in `flow.yaml` and `setup` will provision a memory store
keyed `runLog` (named `<flow>-runs`). After every `run`, a markdown summary is
written to `/runs/<date>-<sessionId>.md` inside that store containing the brief,
outcome verdict, deliverable filenames, and the agent's final text. The runLog
store is reading material for `dream` — point a dream at it to mine patterns
across many runs, or attach it read-only to an agent that needs prior context.

## Adding a new flow

1. `mkdir -p flows/<name>/agents`
2. Write `flows/<name>/flow.yaml` (copy an existing one as a starting point)
3. Drop agent YAML files into `flows/<name>/agents/`
4. `bun .claude/skills/braid/braid.ts setup <name>`

### Cost/perf conventions for agent YAML

Two optional fields on `agents/<key>.yaml` let the orchestrator choose models and cache system prompts. Both are stripped before the create-agent call, so they don't leak to the Anthropic API.

**`tier:`** — declares the job class instead of pinning a model. Resolves via `MODEL_TIER_MAP` in `lib.ts`:

| Tier | Default model | Use for |
|---|---|---|
| `orchestrate` | `claude-opus-4-7` | Director/coordinator, deep reasoning |
| `reason`      | `claude-sonnet-4-6` | Synthesis, code review, creative writing |
| `execute`     | `claude-sonnet-4-6` | File ops, builds, well-specified tasks (default) |
| `classify`    | `claude-haiku-4-5` | Routing, extraction, lightweight parsing |

Override globally by setting `BRAID_MODEL_<TIER>` env vars before `setup`. An explicit `model: { id: ... }` on the agent always wins over `tier:`.

**`system_stable:` + `system_dynamic:`** — split the system prompt into a cacheable prefix and a per-instance suffix. The orchestrator emits the stable block with `cache_control: { type: ephemeral, ttl: 1h }` so subsequent invocations in the same flow run hit the cache at ~0.1× input cost. Put role definition, hard rules, output contracts, and per-shot procedures in `system_stable`; put per-instance facts (cause name, CTA text, visual style for this run) in `system_dynamic`.

Legacy `system: "<string>"` still works unchanged — only opt in when you have enough stable content to make caching worthwhile (Sonnet floor: 1024 tok; Opus/Haiku floor: 4096 tok).

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
| `run.log_runs` | `false` — set to `true` to auto-provision a `runLog` store and write a summary after each run |
| `run.outcome.rubric_file` | falls back to using `outcome.description` verbatim as the rubric |
| `environment.warm` | `true` when `environment.packages` is declared, otherwise unused |

Only `name` and `agents` are truly required. A minimal flow can be a dozen lines.

### Environment packages and warming

Declare apt / npm / pip / cargo / gem / go packages in `flow.yaml` and Anthropic bakes them into the env at create time, cached across every session sharing the env. Authority: [Anthropic environments docs](https://platform.claude.com/docs/en/managed-agents/environments) — *"Packages are installed by their respective package managers and cached across sessions that share the same environment."*

```yaml
environment:
  networking: { type: unrestricted }  # rationale: pdfminer fetches PDFs by URL
  packages:
    apt: [poppler-utils, imagemagick]
    pip: [pdfminer.six]
  # warm: true   # implicit — defaults to true whenever `packages` is set
```

Packages install **lazily on the first session that uses the env**. Without warming, that cost lands on the first real `run`. Setup auto-warms by spawning a Haiku one-shot session that invokes each declared apt/npm/pip package — install failures (typoed name, sandbox restriction) surface at `setup` time instead of mid-flow. gem/cargo/go packages are cached by opening the session but not individually probed.

**Don't redeclare packages that are already in the base image.** Known pre-installed: `playwright` + Chromium (see "Browser rendering with Playwright" below), `ffmpeg`, Node.js 22, Python 3.11, `curl`, `jq`. Re-declaring is harmless but wastes setup time and obscures what your flow actually needs. When generating a new flow that requires system binaries or libraries, prefer `environment.packages` over per-session `apt-get install`. Set `environment.warm: false` only when you have a specific reason to defer the install cost.

### Where deliverables go

The outcome grader inspects `/mnt/session/outputs/` (the sandbox path that maps to the flow's `output_dir`), not just the agent's chat messages. If the rubric describes a deliverable, the agent must **write a file to `/mnt/session/outputs/`** for the grader to find — text in the final message alone isn't enough. Make this explicit in the agent's system prompt.

## External services: MCP vs. sandbox shell

Two ways an agent can talk to an external service. Pick based on what the service's MCP actually does.

**Full-service MCPs (e.g. Fal)** — the MCP server holds the token and does the work server-side. Agent calls `fal_run(...)` and gets back a URL. Wire it as a vault credential and attach it to the agent. Token never enters the sandbox.

**Stub MCPs (e.g. Vercel)** — the MCP exposes read-only tools (`list_projects`, `search_docs`) and instructional stubs (`deploy_to_vercel` returns the text *"run `vercel deploy`"*). The real work that needs a token (a deploy) does **NOT** belong in the session. Use a **host-side post-session hook** instead — the token stays on the host and never enters the agent's transcript or sandbox. See `## Host-side post-session hooks` below.

Decide before wiring:

| Agent task | Where it runs |
|---|---|
| Generate Fal image | In-session via Fal MCP (server-side; vault credential) |
| Build a fresh page (HTML/CSS, no deploy) | In-session via `bash`/`write` tools |
| Deploy the built page to Vercel | **Out-of-session, in the post-session hook on the host** |
| List Vercel projects, check deploy status, search Vercel docs | In-session via Vercel MCP (read-only) |
| Both deploy *and* inspect | MCP for inspect, post-session hook for deploy |

### Why secrets never travel in the brief

Authoritative basis:

- [Anthropic vault docs](https://platform.claude.com/docs/en/managed-agents/vaults) — vault credentials are the only documented secret channel.
- [NIST SP 800-204C](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-204C.pdf) — build and deploy are separate pipeline stages with separate credential scope.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — limit CI/CD credential scope to what the deploy step needs.
- [CVE-2026-44479](https://dailycve.com/vercel-cli-information-disclosure-cve-2026-44479-medium/) (Vercel CLI Information Disclosure) — tokens as CLI args leak via process listings and shell history. Use env vars.
- [Pluto Security hardening guide](https://pluto.security/blog/securing-claude-managed-agents/) — "Any credential that's not in the vault is visible to the agent and vulnerable to exfiltration."

The default `agent_toolset_20260401` enables `bash` and `web_fetch`; the default networking is `unrestricted` unless overridden. Any token in the agent's context can be exfiltrated. Keep tokens out.

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

## Brief substitutions

Two substitutions are expanded at session start:

- `{{file:path/to/x.md}}` → file contents, **sandboxed to the flow directory** (absolute paths and `..` are rejected — CWE-22 protection).
- `{{env:VAR_NAME}}` → **rejected with an error**. Briefs do not carry secrets. Use a host-side post-session hook for credentialed work (see below).

## Host-side post-session hooks

The enterprise-proper pattern for credentialed work (deploys, signed uploads, etc.) is **build/deploy separation**: the agent builds an artifact and writes a manifest describing the deploy intent; the host runs the actual deploy AFTER the session ends, with credentials sourced from `.env.local`. The secret never enters the session transcript or the sandbox.

Add `run.post_session_hook` to your `flow.yaml`:

```yaml
run:
  outcome:
    description: "Built artifact and manifest.json under /mnt/session/outputs/"
  post_session_hook:
    command: bun run "$BRAID_FLOW_DIR/../../.claude/skills/braid/post-hooks/vercel-deploy.ts"
    env_passthrough: [VERCEL_TOKEN]  # only listed vars reach the hook
    timeout_ms: 300000
```

The hook receives a **strict env scope** (PATH + BRAID_* context vars + `env_passthrough` allowlist only). No other host env vars are forwarded — least-privilege per OWASP Secrets Management Cheat Sheet.

Context vars always provided:

| Variable | Value |
|---|---|
| `BRAID_SESSION_ID` | The Anthropic session ID that just completed |
| `BRAID_FLOW_NAME` | The flow name (e.g. `fundraiser`) |
| `BRAID_FLOW_DIR` | Absolute path to `flows/<name>/` |
| `BRAID_OUTPUT_DIR` | Absolute path to the session's `outputs/<flow>/<date>-<sid>/` |

### Canonical pattern: agent writes a manifest, host deploys

**Agent's job:** build to `/mnt/session/outputs/site/` and write `manifest.json` with `ready_to_deploy: true`. **Do NOT install or run any deploy CLI.** Do NOT request or accept any deploy token in the brief.

```jsonc
// /mnt/session/outputs/manifest.json — written by the agent
{
  "site_dir": "site",
  "project_name": "my-flow-site",
  "ready_to_deploy": true,
  // … any other fields your flow uses (urls, image_urls, etc.)
}
```

**Host's job (`vercel-deploy.ts`):** read the manifest, run `vercel deploy` with `VERCEL_TOKEN` from env (not as a CLI arg — CVE-2026-44479), write the production URL back into the manifest.

```bash
# Per Vercel CLI docs: VERCEL_TOKEN is read natively from env.
# Never pass --token=$VERCEL_TOKEN — that leaks via process listings.
npx --yes vercel@latest deploy --prod --yes --name "$PROJECT" "$SITE_DIR"
```

See `flows/fundraiser/`, `flows/homecoming/`, `flows/quiet-rebellion/`, `flows/final-inning/`, and `flows/solids/` for working examples. The shared deploy helper lives at `.claude/skills/braid/post-hooks/vercel-deploy.ts`.

## Browser rendering with Playwright in the sandbox

Anthropic's base env ships with Playwright + Chromium pre-installed. **Do NOT declare them in `environment.packages`** — the install is already done, and adding `npm: [playwright]` / `apt: [chromium]` only delays setup. Confirmed locations (as of 2026-05):

| Asset | Path |
|---|---|
| Playwright module | `/opt/node-tools/node_modules/playwright` (v1.56+) |
| Chromium binary | `/opt/pw-browsers/chromium-*/chrome-linux/chrome` (v141+) |

Three gotchas cost a real session to discover. Encode them in the rendering agent's system prompt so it does not have to rediscover them:

### 1. Module resolution — `ERR_MODULE_NOT_FOUND: playwright`

`node /tmp/render.mjs` or `node /mnt/session/outputs/render.mjs` fails: Node resolves `node_modules` from the **script's** directory upward, not from CWD. The pre-installed module lives at `/opt/node-tools/node_modules/playwright`, which the script path can't reach.

**`NODE_PATH` does NOT fix this for ESM `import`.** `NODE_PATH` is only consulted by Node's CommonJS resolver (`require()`); ESM's resolver ignores it. A `.mjs` file with `import { chromium } from 'playwright'` will still throw `ERR_MODULE_NOT_FOUND` even with `NODE_PATH=/opt/node-tools/node_modules` set. Verified in Node 22.22 (Anthropic base image, 2026-05).

The one reliable fix: **copy the render script into `/opt/node-tools/` and run it from there** so Node's normal walk-up finds the pre-installed `playwright`.

```bash
# Copy the script next to the pre-installed module, then run.
cp /mnt/session/outputs/_render.mjs /opt/node-tools/_render.mjs
cd /opt/node-tools && node _render.mjs
```

(If you're stuck with a CommonJS `require('playwright')` script — rare — `NODE_PATH=/opt/node-tools/node_modules` works for that.)

Don't try `ln -s` into `/mnt/session/outputs/node_modules/` — the session sandbox mount is FUSE-backed and rejects symlink creation (`ln: failed to create symbolic link: Function not implemented`).

### 2. External HTTPS → `net::ERR_CERT_AUTHORITY_INVALID`

Chromium ships with its own CA bundle and rejects external HTTPS certs in the sandbox — gstatic, CDN-hosted images, font CDNs all fail with cert errors. `curl` to the same URL returns 200 (it uses the OS trust store), so the canonical workaround is: **pre-download assets with `curl`, then use Playwright's [`page.route()`](https://playwright.dev/docs/network) to fulfil requests from local disk**. Route interception keeps the HTML unchanged (no need to rewrite `<img src>` to local paths) and gives offline reproducibility.

(`ignoreHTTPSErrors: true` on `browser.newContext` also unblocks loads, but route interception is preferable: it doesn't depend on network at screenshot time, and validation results are deterministic.)

### 3. `file://` blocks cross-file CSS and external asset loads

Same-origin policy on `file://` blocks `<link rel="stylesheet">` to sibling CSS files and any external image fetch. Either serve via `python3 -m http.server` in the background, or fold every asset through `page.route()`.

### Canonical render-and-validate recipe

When generating a flow that screenshots HTML to PNG (ad creative, slide decks, charts, dashboards), embed this shape in the agent's system prompt:

```bash
# Step 1 — pre-download every external image with curl (validates URLs too)
set -euo pipefail
mkdir -p /mnt/session/outputs/img
curl -fsSL --max-time 60 -o /mnt/session/outputs/img/hero.webp -- "$HERO_URL"
curl -fsSL --max-time 60 -o /mnt/session/outputs/img/logo.webp -- "$LOGO_URL"

# Step 2 — boot a local HTTP server so file:// gotchas don't bite
cd /mnt/session/outputs && python3 -m http.server 8765 >/tmp/http.log 2>&1 &
sleep 1

# Step 3 — write the render script (see below), copy it into the
# pre-installed module dir, then run from there. NODE_PATH does NOT
# work for ESM imports — see gotcha #1 above.
cp /mnt/session/outputs/_render.mjs /opt/node-tools/_render.mjs
cd /opt/node-tools && node _render.mjs
```

```js
// /mnt/session/outputs/_render.mjs — write via the `write` tool
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/mnt/session/outputs';

// Map every external URL referenced in the HTML to a local file pre-downloaded
// in Step 1. Chromium can't reach external HTTPS in the sandbox (cert error);
// route interception serves the bytes from disk instead.
const ASSET_MAP = {
  'https://cdn.example.com/hero.webp': path.join(OUT, 'img/hero.webp'),
  'https://cdn.example.com/logo.webp': path.join(OUT, 'img/logo.webp'),
};

const ADS = [
  { html: 'ad-1.html', w: 1080, h: 1080 },
  { html: 'ad-2.html', w: 1080, h: 1350 },
];

const browser = await chromium.launch();
const results = [];
for (const a of ADS) {
  const ctx = await browser.newContext({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const local = ASSET_MAP[route.request().url()];
    if (local) await route.fulfill({ body: fs.readFileSync(local) });
    else await route.continue();
  });
  await page.goto(`http://localhost:8765/${a.html}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);  // let webfonts settle

  // Validate before screenshotting
  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter(i => i.naturalWidth === 0)
      .map(i => i.src));

  const png = a.html.replace(/\.html$/, '.png');
  await page.screenshot({ path: path.join(OUT, png), fullPage: false });
  results.push({ file: a.html, png, pass: broken.length === 0, broken });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'validation.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length }));
```

**Networking caveat.** This still requires `networking: { type: unrestricted }` (or `limited` with the asset hosts in `allowed_hosts`) so the **`curl` pre-download** succeeds. The screenshot step itself is offline. Document the egress rationale (`# rationale: curl pre-downloads CDN assets for offline render`) per the security posture above.

**Validation in the rubric.** Have the outcome rubric require `validation.json` to show `pass === ADS.length` and `broken === []`. Without that, an agent can "succeed" while emitting PNGs full of broken-image placeholders.

## Compositing multi-shot video flows

If your flow produces N independent video clips that should also exist as one combined deliverable, add a **composite step** to the producing agent. The rule is simple and lives in the agent's system prompt:

> **Composite rule:** If the storyboard has FEWER THAN 5 shots, the agent MUST composite the clips into a single `final.mp4` in `/mnt/session/outputs/` after generation. If 5 or more shots, SKIP composite — the run is long enough that each shot stands on its own.

Use ffmpeg's concat demuxer to join (kling/Fal mp4s share codec, so `-c copy` works), then [`mediabunny`](https://mediabunny.dev/guide/extensions/server) for the optimize pass (web-friendly H.264 + faststart). Mediabunny's `Conversion` API takes a single input/output, so it's the optimizer, not the concatenator.

### Filename and URL safety (CWE-78 / OS Command Injection)

The composite recipe runs shell commands with strings the agent generates. **All input URLs and filenames must be validated** before they're interpolated into a shell command. Without validation, a single `"` or `$(...)` in an agent-produced string is a command-injection vector.

Required validations:
- URLs must match `^https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$` and be confirmed via `curl --max-time 15 -fsI` before use.
- Filenames are **never** agent-generated. The recipe uses **hardcoded** names (`shot_01.mp4`, `shot_02.mp4`, …).
- Pass URLs through `printf "%s"` into variables, then use `"$VAR"` with quotes everywhere they're referenced. Use `--` to terminate option parsing.

```bash
# In the agent's bash step, after manifest assembly:
set -euo pipefail
cd /mnt/session/outputs

# URLs come from the agent. Validate FIRST.
URL_0="<video_url_0>"
URL_1="<video_url_1>"
URL_2="<video_url_2>"
for u in "$URL_0" "$URL_1" "$URL_2"; do
  printf '%s' "$u" | grep -qE '^https://[A-Za-z0-9._~:/?#@!$&'\''()*+,;=%-]+$' \
    || { echo "[composite] rejected non-https or unsafe URL: $u" >&2; exit 1; }
done

# Hardcoded output filenames — never agent-generated.
curl -fsSL --max-time 60 -o shot_01.mp4 -- "$URL_0"
curl -fsSL --max-time 60 -o shot_02.mp4 -- "$URL_1"
curl -fsSL --max-time 60 -o shot_03.mp4 -- "$URL_2"

# concat.txt uses the hardcoded names. No interpolation of agent strings.
printf "file 'shot_01.mp4'\nfile 'shot_02.mp4'\nfile 'shot_03.mp4'\n" > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy concat.mp4

# Heredoc uses 'EOF' (single-quoted) so no shell expansion happens inside.
bun add mediabunny @mediabunny/server >/dev/null 2>&1
bun run - <<'EOF' || cp concat.mp4 final.mp4
import { registerMediabunnyServer } from "@mediabunny/server";
import { Conversion, FilePathSource, Input, Mp4OutputFormat, Output, BufferTarget } from "mediabunny";
import fs from "node:fs";
registerMediabunnyServer();
const input = new Input({ source: new FilePathSource("concat.mp4") });
const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
const conv = await Conversion.init({ input, output, video: { codec: "avc", bitrate: 5_000_000 } });
await conv.execute();
fs.writeFileSync("final.mp4", Buffer.from(output.target.buffer));
EOF
```

Authority for the validation requirements: [CWE-78 (OS Command Injection)](https://cwe.mitre.org/data/definitions/78.html).

Include `final_video_path: "/mnt/session/outputs/final.mp4"` in the manifest and require it in the rubric. The mediabunny step is best-effort — if it errors, fall back to the raw concat (`cp concat.mp4 final.mp4`) so the flow is never blocked. See `flows/pop-quiz/agents/storyboarder.yaml` for a working example.
