# syntax=docker/dockerfile:1.7
#
# Slice 70 — Braid orchestrator container.
#
# Trust boundary: this container. The user trusts the container, not whatever
# flow.yaml is inside. Threat model: a malicious post-session hook should
# NOT be able to read host secrets (~/.ssh, ~/.aws, ...). Minimal mounts
# in docker-compose.yml + non-root user + no inbound ports give defense in
# depth.
#
# Authority:
#   - Slice 70 architectural decision b1d5f3d8 (minimal-mount Docker container)
#   - Slice 70 SecurityArchitecture decision 4474811d (non-root + cap-drop + no EXPOSE)
#   - Slice 70 TechnologyStack decision bfd6baa8 (oven/bun:1.3.14-slim base)
#   - NIST SP 800-204D supply-chain integrity for CI base images
#   - https://docs.docker.com/engine/security/
#
# Base image is pinned by exact version. CI should additionally pin by SHA
# digest using `docker buildx --metadata-file` once the workflow lands the
# digest-pin step.
FROM oven/bun:1.3.14-slim

# Non-root user. UID 1001 chosen to avoid clashing with typical host UIDs.
# Authority: SecurityArchitecture decision 4474811d.
ARG BRAID_UID=1001
RUN groupadd --gid ${BRAID_UID} braid \
 && useradd --uid ${BRAID_UID} --gid ${BRAID_UID} --create-home --shell /bin/bash braid

# Working directory inside the container — a mountpoint, not a baked-in copy.
# Compose mounts the repo into /workspace at run time so the orchestrator
# sees the user's flows/ and writes outputs/ to host disk.
WORKDIR /workspace

# Install the skill's deps at image-build time so `docker compose run` is
# fast. The lockfile is copied from the build context (the repo). Bun
# install uses --frozen-lockfile so any drift fails the build (matches the
# CI gate).
COPY --chown=braid:braid .claude/skills/braid/package.json .claude/skills/braid/bun.lock /workspace/.claude/skills/braid/
RUN cd /workspace/.claude/skills/braid && bun install --frozen-lockfile

# Drop to non-root for runtime.
USER braid

# Entrypoint is a thin wrapper so `docker compose run --rm braid <args>`
# Just Works.
ENTRYPOINT ["bun", "run", "/workspace/.claude/skills/braid/braid.ts"]
CMD ["list"]

# Intentionally NO `EXPOSE` directive. The SSE port is opt-in via the
# compose override file (compose.override.yml).
#
# Intentionally NO `HEALTHCHECK`. The orchestrator is short-lived per run;
# health is the exit code.
