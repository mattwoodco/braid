/**
 * Slice 20 §2.A7 — sentinel's context store is manifest-declared, not
 * hardcoded to `state.stores?.projectStore`.
 *
 * Defect: `runSentinel` reads `state.stores?.projectStore` literally. Only
 * the `ad` flow defines that key — every other flow's sentinel silently
 * attached no context store, defeating the diagnostic value.
 *
 * Fix: read `manifest.run?.sentinel_context_store` (a key into memory_stores).
 * If unset, fall back to `projectStore` for backwards-compat with the `ad`
 * flow until it migrates.
 */

import { test, expect, describe } from "bun:test";
import { sentinelStoreId, type Manifest, type State } from "../lib";

const baseManifest: Manifest = {
  name: "demo",
  env_name: "braid-demo",
  state_file: "state.json",
  output_dir: "outputs/demo",
  agents: [],
  environment: { networking: { type: "limited", allowed_hosts: [] } },
};

describe("sentinelStoreId", () => {
  test("returns manifest-declared store id when set", () => {
    const manifest: Manifest = {
      ...baseManifest,
      run: { sentinel_context_store: "myStore" },
    };
    const state: State = { stores: { myStore: "mem_abc123" } };
    expect(sentinelStoreId(manifest, state)).toBe("mem_abc123");
  });

  test("falls back to projectStore for backwards compatibility", () => {
    const state: State = { stores: { projectStore: "mem_legacy" } };
    expect(sentinelStoreId(baseManifest, state)).toBe("mem_legacy");
  });

  test("returns undefined when neither is set", () => {
    expect(sentinelStoreId(baseManifest, {})).toBeUndefined();
  });

  test("returns undefined when manifest declares a key that isn't in state", () => {
    const manifest: Manifest = {
      ...baseManifest,
      run: { sentinel_context_store: "missing" },
    };
    const state: State = { stores: { projectStore: "mem_fallback" } };
    // When the manifest is explicit but the store isn't provisioned yet,
    // do NOT silently fall back — that would mask a setup error.
    expect(sentinelStoreId(manifest, state)).toBeUndefined();
  });
});
