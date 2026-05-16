/**
 * Slice 20 §2.A1 — `loadManifest` is a pure loader.
 *
 * Historical defect: `loadManifest` called `process.chdir(dirname(abs))`
 * as a side effect so that subsequent relative reads (rubric, agent yaml,
 * seed files) would resolve correctly. This made the function:
 *   - non-idempotent (second call may chdir into a deeper dir)
 *   - race-prone (any concurrent code that depends on cwd misbehaves)
 *   - untestable (REPL / test reuse breaks)
 *
 * Fix: return `{ manifest, flowDir }` and require downstream callers to
 * pass `flowDir` explicitly. process.cwd is never mutated.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadManifest } from "../lib";

let workDir: string;
let originalCwd: string;
let flowPath: string;

beforeAll(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "braid-loadmanifest-"));
  const flowDir = join(workDir, "flows", "demo");
  mkdirSync(flowDir, { recursive: true });
  flowPath = join(flowDir, "flow.yaml");
  writeFileSync(
    flowPath,
    [
      "name: demo",
      "agents:",
      "  - key: only",
      "    file: agents/only.yaml",
    ].join("\n"),
  );
});

afterAll(() => {
  // Defensive: restore cwd if a regression sneaks back in.
  try {
    process.chdir(originalCwd);
  } catch {}
  rmSync(workDir, { recursive: true, force: true });
});

describe("loadManifest — purity (no chdir side effect)", () => {
  test("does not mutate process.cwd", () => {
    const before = process.cwd();
    loadManifest(flowPath);
    expect(process.cwd()).toBe(before);
  });

  test("returns { manifest, flowDir }", () => {
    const result = loadManifest(flowPath);
    expect(result.manifest.name).toBe("demo");
    expect(result.flowDir).toBe(join(workDir, "flows", "demo"));
  });

  test("calling twice is idempotent — same result, no cwd drift", () => {
    const before = process.cwd();
    const first = loadManifest(flowPath);
    const second = loadManifest(flowPath);
    expect(process.cwd()).toBe(before);
    expect(first.flowDir).toBe(second.flowDir);
    expect(first.manifest.name).toBe(second.manifest.name);
  });
});
