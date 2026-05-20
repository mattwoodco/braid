# 0004 — Optional container sandbox layer

- **Status:** Accepted
- **Date:** 2026-05-15

## Context

Anthropic Managed Agents already provide a sandbox for the *agent code*. The orchestrator, however, runs on the contributor's host: it reads `.env.local`, writes `flows/<flow>/state.json` and `flows/<flow>/outputs/<sid>/`, and shells out to host-side post-session hooks (e.g. `vercel deploy`).

Running an untrusted flow definition on a developer laptop therefore exposes the host shell. The threat model is not "a malicious flow exfiltrates from inside the sandbox" — Anthropic's sandbox handles that — but "a malicious flow definition (`flow.yaml`, `agents/*.yaml`) gets the orchestrator to do something dangerous before the sandbox is even involved": path traversal in briefs, unbounded process spawning in post-session hooks, etc.

## Decision

Ship an optional containerization layer for the orchestrator itself:

- **`Dockerfile`** based on `oven/bun:1.3.14-slim` (pinned). USER `braid` (uid 1001), non-root. No EXPOSE.
- **`docker-compose.yml`** with:
  - `read_only: true` rootfs
  - `tmpfs: /tmp:size=64m`
  - `cap_drop: ALL`
  - `security_opt: no-new-privileges:true`
  - Bind mounts: `flows/`, `outputs/`, `.claude/skills/braid/` read-write; `.env.local` read-only
  - No host home mount
- **`.devcontainer/devcontainer.json`** for VS Code / Cursor / similar IDE integration.
- **`docker-compose.override.yml.example`** for operator-specific overrides; the actual `docker-compose.override.yml` is gitignored.
- **`tests/container-config.test.ts`** is a property test that parses the Dockerfile + compose file and asserts the required directives are present. Runs in any environment (no docker daemon needed); the CI workflow also builds the image as a smoke gate.

Container usage is **opt-in**, not mandatory. A contributor who trusts the flow (e.g. their own first-party flows) runs on host directly. A contributor evaluating an unknown flow uses the container.

## Consequences

- Orchestrator blast radius narrows: even if a flow definition can manipulate the orchestrator, the attacker cannot reach host SSH keys, browser cookies, or shell history.
- `read_only: true` + `tmpfs /tmp` defeats the class of attack where a process writes a payload to disk then re-execs.
- No EXPOSE means the SSE event-stream server cannot accidentally serve to the host network from inside the container.
- macOS 26 Tahoe has Docker Desktop compatibility issues. Recommended path on macOS is Colima + docker CLI: `brew install colima docker docker-compose && colima start --arch aarch64 --cpu 2 --memory 2`. Tested with `colima start --arch aarch64`.
- The image first-build is ~30 seconds; subsequent runs hit the build cache. BDD tests auto-build on first run when needed.

## Alternatives considered

- **Mandatory containerization for all runs.** Rejected — too heavy for the iterative development loop; first-party flows don't need the layer.
- **Full VM (UTM, Multipass).** Rejected — too slow to launch for daily use; Colima's lightweight VM is already sufficient.
- **Rely on macOS sandbox-exec or Linux unshare.** Rejected — platform-specific, fragile, harder to reproduce across contributor environments.

## References

- CIS Docker Benchmark: <https://www.cisecurity.org/benchmark/docker>
- NIST SP 800-190 — Application Container Security Guide: <https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-190.pdf>
- OCI runtime-spec Linux capabilities: <https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#capabilities>
- Pluto Security — Inside Claude Managed Agents: <https://pluto.security/blog/inside-claude-managed-agents/>
