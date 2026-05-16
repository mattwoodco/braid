# Braid troubleshooting

> Symptom → cause → resolution. Each entry references the audit anchor (§X.Y) where the underlying behavior is documented (private audit; the anchors exist for traceability when reviewing PRs).

## Setup / install

### `command not found: bun`

**Cause.** Bun isn't installed or isn't on your PATH.
**Resolution.** `curl -fsSL https://bun.sh/install | bash`. Add `~/.bun/bin` to your shell PATH.

### `bun install --frozen-lockfile` fails

**Cause.** Either the lockfile is out of date relative to package.json, or a dependency was bumped without updating the lock.
**Resolution.** Run `bun install` (no flag) to update the lockfile, commit the result, and retry. If you don't own the change, the upstream PR should be fixed.

## Provisioning

### `Missing env var: ANTHROPIC_API_KEY`

**Cause.** Bun didn't find `.env.local` or the key isn't in it.
**Resolution.** Verify `.env.local` exists at the repo root, has the key, and you're invoking `braid` from the repo root (not the skill directory).

### `Missing env var: FAL_API_KEY`

**Cause.** The flow declares a Fal vault credential but the env doesn't have the key.
**Resolution.** Set `FAL_API_KEY` in `.env.local` (free Fal account suffices for evaluation runs). For demo mode you don't need a real key — demo injects a sentinel.

### `MCP host '<host>' is not on the allowlist`

**Cause.** A flow.yaml declares `mcp_server_url` pointing at a host that's not in the default allowlist (`mcp.fal.ai`, `mcp.vercel.com`).
**Resolution.** Either correct the typo OR set `BRAID_MCP_ALLOWLIST=mcp.fal.ai,mcp.vercel.com,your.host.com` before `braid setup`.
Audit reference: §1.F5.

### `MCP URL must use https`

**Cause.** A flow.yaml uses `http://...` for an MCP server.
**Resolution.** Use https. The platform requires it; the lint enforces it. Audit reference: §1.F5.

### Schema validation fails for a flow.yaml

**Cause.** flow.yaml has a field the schema doesn't accept (a typo, or a field added in code without schema parity).
**Resolution.** Run `bun run --cwd .claude/skills/braid schema:check` to see exact location. The error path (e.g. `/run` or `/agents/0`) shows where. If the field is legitimate, update `flow.schema.json` (Slice 30 keeps it in lockstep). Audit reference: §3.S1.

## Run-time

### `brief references missing env var: <NAME>`

**Cause.** Your brief contains `{{env:NAME}}` — this is rejected outright in Slice 10 §1.F2.
**Resolution.** Move that secret to `run.post_session_hook.env_passthrough` and consume it from your hook, not the brief. See SKILL.md "Host-side post-session hooks". Audit reference: §1.F2.

### `brief: absolute paths are not allowed in {{file:...}}`

**Cause.** A `{{file:...}}` placeholder uses an absolute path (`/etc/...`) or escapes the flow dir with `..`.
**Resolution.** Use a relative path inside the flow directory. Audit reference: §1.F4 (CWE-22).

### `[reconnect.gaveup]` after 5 attempts

**Cause.** The Anthropic event stream dropped and didn't recover after the bounded backoff (1s → 16s × 5).
**Resolution.** Network or upstream issue. Retry the run. If persistent, check status.anthropic.com. Audit reference: §2.A2 + Slice 50.

### `[sentinel] max restarts reached, giving up`

**Cause.** Session was silent for >2× `stall_ms`, sentinel couldn't diagnose, restart count exhausted.
**Resolution.** Check the agent yaml's system prompt — usually the agent is in a tool-use loop. Tighten the prompt or raise `max_restarts` if the workload genuinely needs more attempts. Audit reference: §2.A3.

### Outputs land in wrong directory

**Cause.** You invoked `braid` from a directory that isn't the repo root.
**Resolution.** Always invoke from repo root: `bun .claude/skills/braid/braid.ts run <flow>`. `cd` to repo root if your shell drifted.

## Cleanup

### `non-interactive purge refused: pass --yes`

**Cause.** Slice 10 §1.F7 — destructive defaults removed.
**Resolution.** `braid purge --yes` to confirm, OR `braid purge --select` to choose interactively per resource.

### `purge` left cloud resources behind

**Cause.** A session in `running` state can't be deleted; purge interrupts then waits for it.
**Resolution.** Either wait for the session to finish, or `braid sessions <flow> --kill` to interrupt then delete.

## Agent authoring (Slice 90)

### `agent-prompt-safety lint` flags my new agent

**Cause.** Your `system:` block contains one of the forbidden patterns: `{{env:...}}`, `--token=`, hard-coded Bearer header, http:// URL, or an MCP host not on the allowlist.
**Resolution.** Read the lint output — it includes line number, rule, and the why. Refactor to either remove the secret reference (use post-session hook), pass the value via env to a host command, or add the MCP host to the allowlist explicitly.

### `target already exists` from `new-agent`

**Cause.** An agent yaml with that key already lives in the flow.
**Resolution.** Pick a different key, or delete the existing file first. The scaffolder refuses to overwrite to protect your work.

### `unknown template`

**Cause.** Typo in `--template=...`.
**Resolution.** Available templates: `director`, `web-builder`, `sentinel`, `reflector`. Listed in scaffolder's error output.

## Reflection (Slice 100)

### `[reflection.error] reflection agent 'reflector' not provisioned in state`

**Cause.** flow.yaml has `run.reflection.agent_key: reflector` but the reflector agent isn't listed in the flow's `agents:` array (or `braid setup` wasn't re-run after adding it).
**Resolution.** Add the reflector agent to `agents:` and re-run `braid setup <flow>`.

### `[reflection.error] reflection target_store '...' not provisioned`

**Cause.** Same shape: target_store key isn't declared in `memory_stores:` or setup hasn't been re-run.
**Resolution.** Add the store to `memory_stores:` and re-run setup.

### `[reflection.gate] {"fire":false,"reason":"session terminated abnormally"}`

**Cause.** The session ended on `session_terminated` (not `session_idle`). Reflection only fires on successful idle (decision 4dce6f31 — no useful trajectory on abnormal ends).
**Resolution.** Diagnose why the session terminated. The reflection skip is correct behavior.

## Container (Slice 70)

### `docker compose run` fails with "permission denied" inside the container

**Cause.** Container runs as non-root `braid` user (uid 1001). A bind-mounted directory may have ownership the container can't write to.
**Resolution.** `chown -R 1001:1001 outputs/` on the host, or run `docker compose run --user $(id -u)` to map your host UID.

### Demo mode inside the container is much slower than on the host

**Cause.** Docker Desktop on macOS uses a VM; bind mounts pay a per-syscall cost.
**Resolution.** For demo mode, prefer running on the host (`bun run --cwd .claude/skills/braid demo ad`). The container is for hardened isolation, not raw speed.

## Audit anchor index

For each §X.Y reference above, the underlying behavior + remediation lives in the private audit:

```
§1.F1 — networking: unrestricted default removed     (Slice 10)
§1.F2 — {{env:...}} brief interpolation removed       (Slice 10)
§1.F3 — permission_policy: always_ask default         (Slice 10)
§1.F4 — {{file:...}} flow-dir sandbox                 (Slice 10)
§1.F5 — MCP host allowlist                            (Slice 10)
§1.F6 — composite recipe filename validation          (Slice 10)
§1.F7 — purge --yes confirmation                      (Slice 10)
§2.A2 — silent catch{} replaced with structured log   (Slice 20)
§2.A3 — watchdog cancel race + sentinel               (Slice 20)
§3.S1 — flow.schema.json kept in lockstep             (Slice 30)
```

Anchors land in `docs/audit-YYYY-MM-DD.PRIVATE.md` (gitignored). The mapping above is the bridge between operator-facing symptoms and the private remediation record.

---

*Troubleshooting last updated 2026-05-15. New symptoms reported via SECURITY.md should add an entry here once their fix lands.*
