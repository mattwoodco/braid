# Coverage policy

**Updated 2026-05-15 (Slice 45 close).** Tracked node: Memento plan ledger `ca9deec2`.

## Current

- `bun test --coverage` is the canonical command. Runs as part of `bun test`.
- 122 tests across 23 files. 220 `expect()` calls.
- **Function coverage:**
  - All files: **82.83%** ✅
  - `lib.ts`: **84.13%** ✅
  - `sdk-adapter.ts`: 100%
  - `post-hooks/vercel-deploy.ts`: 80% (main() is integration-only)
  - `mocks/anthropic.ts`: 50% (unused branches in some methods)
- **Line coverage:**
  - All files: **77.33%** ✅
  - `lib.ts`: **81.57%** ✅
  - `sdk-adapter.ts`: 100%

Both axes clear the **≥80% function / ≥70% line** floor stated by Slice 40. Slice 45 (this follow-up) is closed.

## CI gate

As of Slice 45, the CI workflow's coverage step **is gated**, no longer informational. A PR that drops coverage below the floor fails. The previous `continue-on-error: true` is removed.

## What's tested now (orchestration paths previously uncovered)

| Surface | Test file | Notes |
|---|---|---|
| `appendRunLog` | `tests/orchestration-coverage.test.ts` | Writes markdown summary to runLog via memoryStores.memories.create |
| `downloadSessionFiles` | `tests/orchestration-coverage.test.ts` | Iterates files.list + files.download |
| `pullAgents` | `tests/orchestration-coverage.test.ts` | Including dry-run and unknown-key error path |
| `runSentinel` | `tests/orchestration-coverage.test.ts` | Including no-config and exception paths |
| `ensureResources` | `tests/ensure-resources.test.ts` | From Slice 40 |
| `createOrResumeSession` | `tests/session-lifecycle.test.ts` | From Slice 40 |
| `cleanupAbandonedSession` | `tests/session-lifecycle.test.ts` | From Slice 40 |
| `runReflection` | `tests/run-reflection.test.ts` | From Slice 100 |
| `runPostSessionHook` | `tests/post-session-hook.test.ts` | From Slice 10 |

## What's still uncovered (intentional)

| Surface | Why uncovered | Status |
|---|---|---|
| `braid.ts` main `run()` loop body | Top-level CLI orchestrator with timers + streams. The pure-helper layer it depends on is covered. | Acceptable — integration-tested via the demo-mode subprocess test |
| `lib.ts` `seedStore` (event-stream consumption inside seed) | Inner `for await` loop tied to vendor stream shape | Demo-test covers the entry path; loop body is straight-through |
| `lib.ts` `dream` API path | Goes through `fetch`, not the SDK mock | Integration-tested at real-run time; behind a separate cost wall |
| `post-hooks/vercel-deploy.ts` `main()` | Spawns `npx vercel`; integration-only | Documented as integration; pure helpers covered |
| `purge.ts` top-level script body | CLI script | `shouldWipeStateFiles` pure helper covered |

These are not blocking — the test-pyramid principle: deterministic logic gets unit-level coverage; orchestration that depends on real vendor surfaces gets integration coverage or is documented as out-of-test-scope.

## Structural enforcers (additional safety beyond line coverage)

- `tests/no-silent-catch.test.ts` — fails CI if any `catch {}` block returns to production
- `tests/sdk-adapter.test.ts` — fails CI if more than one file casts `c.beta as unknown as { memoryStores }`
- `tests/schema-parity.test.ts` — every `flows/*/flow.yaml` validates against `flow.schema.json`
- `tests/demo-mode.test.ts` — `bun run demo` works zero-cost end-to-end

## When the floor moves

The floor is the **stated minimum**, not the target. Aspirationally we want 90/85 on lib.ts. New code lands with coverage at or above its surface average; ratchet up the global floor as the orchestration coverage gap closes further.
