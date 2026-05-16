# Tests

Run from the skill directory:

```bash
cd .claude/skills/braid
bun install
bun test
bun run typecheck
```

Tests follow Red-Green-Refactor (RGR) per CLAUDE.md. Each test file should be readable in isolation; if a test needs a flow.yaml fixture, the fixture lives under `tests/fixtures/`.

File naming: `tests/<topic>.test.ts` mirroring `lib.ts` and `braid.ts` surfaces.
