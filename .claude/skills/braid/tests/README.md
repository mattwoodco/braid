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

## BDD end-to-end layer

`tests/bdd-e2e.test.ts` is the cross-slice integration layer. Top-level `describe` = Feature, nested `describe` = Scenario, `test` name = Given/When/Then. 23 scenarios are unconditional; 2 are container scenarios gated on `test.skipIf(!CONTAINER_READY)`.

Container readiness resolves once at module load:

| State | Meaning | Container tests |
|---|---|---|
| `ready` | docker daemon reachable + `braid:dev` image present (auto-built if missing) | run |
| `no-cli` | `docker` not on PATH | skipped |
| `no-daemon` | CLI on PATH but daemon unreachable (start Colima: `colima start`) | skipped |
| `build-failed` | daemon up, image missing, auto-build failed | skipped (warning printed) |

To force container scenarios on macOS without Docker Desktop: `brew install colima docker docker-compose && colima start --arch aarch64 --cpu 2 --memory 2`. The image auto-builds on first run.
