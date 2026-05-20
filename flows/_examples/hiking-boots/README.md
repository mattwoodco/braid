# hiking-boots

Generated from `flows/_templates/viral-video-ad/`. Re-generate:

```bash
bun .claude/skills/braid/braid.ts create \
  --template viral-video-ad \
  --name hiking-boots \
  --vars flows/_templates/viral-video-ad/examples/hiking-boots.json \
  --force
```

Setup + run:

```bash
bun .claude/skills/braid/braid.ts setup hiking-boots
bun .claude/skills/braid/braid.ts run   hiking-boots
```

### Shape

```
session ── director (Opus)
            ├── producer (Sonnet) ─── checks cacheStore → Fal MCP → writes cache
            ├── critic   (Haiku)  ─── reads brandStore → pass/fail + notes
            └── sentinel (Haiku)  ─── invoked by Braid orchestrator on stalls
```

### Memory shape

- **brandStore** (read-only, seeded) — `brand/style.md`, `brand/banned-terms.md`.
  Locked at setup; never modified.
- **projectStore** (read-write) — director appends shot decisions and URLs.
- **cacheStore** (read-write) — `sha256(prompt).json` files. Producer
  always checks here first; cache hits skip Fal entirely.

The cacheStore is the cost-saver. On retries / re-runs with the same
brand guide, the producer's prompts re-hash to existing cache entries
and skip the (expensive) Fal video call.
