# snapshots

Generated from `flows/_templates/image-series-with-memory/`. Re-generate:

```bash
bun .claude/skills/braid/braid.ts create \
  --template image-series-with-memory \
  --name snapshots \
  --vars flows/_templates/image-series-with-memory/examples/snapshots.json \
  --force
```

Setup, run, then optionally consolidate learning via `dream`:

```bash
bun .claude/skills/braid/braid.ts setup snapshots
bun .claude/skills/braid/braid.ts run   snapshots
bun .claude/skills/braid/braid.ts dream snapshots --store styleStore
```

### Memory shape

- **styleStore** (`/mnt/memory/snapshots-style/style.md`) — seeded with
  the locked Visual Bible. `dream` consolidates it over time.
- **lessonsStore** (`/mnt/memory/snapshots-lessons/patterns.md`) — the
  reflector appends grader-passing patterns after each successful run.

Both mounts are readable by the photographer on the next run; the prompt
cache reuses the photographer's stable prefix across all N shots in a run.
