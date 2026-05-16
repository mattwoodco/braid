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
   - Create new → ask for the flow name, then scaffold per "Adding a new flow" below.

## Commands

| Command | What it does |
|---|---|
| `list` | Show available flows |
| `setup <flow>` | Create environment, vault, memory stores, and agents in Anthropic; populate `flows/<flow>/state.json` |
| `run <flow> [brief] [sesn_id]` | Start (or resume) a session and stream events |
| `sessions <flow> [--pick\|--kill\|--kill-all]` | Inspect tracked sessions |
| `pull <flow> [key...]` | Overwrite local `agents/*.yaml` with the latest from Anthropic. Pulled YAML is safe to re-use in a fresh setup — multiagent IDs get rewritten from `coordinator:` in `flow.yaml`. |
| `dream <flow> [--store K] [--instructions "..."] [--sessions N] [--model M]` | Run a dream over tracked sessions and consolidate into store `K`. If `--store` is omitted and the flow has multiple stores, you'll be prompted. Per-store defaults can be set via `dream_instructions:` in `flow.yaml`. |
| `purge [--select]` | Tear down all Anthropic infra |

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

Only `name` and `agents` are truly required. A minimal flow can be a dozen lines.

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
