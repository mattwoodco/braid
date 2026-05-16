/**
 * Slice 20 §2.A4 — structural test: the `c.beta as unknown` cast against
 * `memoryStores` may only appear inside `sdk-adapter.ts`. Every other
 * production file must import the adapter rather than spelling out its own
 * cast.
 *
 * Rationale: when the SDK adds first-class `memoryStores` types, only one
 * file in the codebase needs to change.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SKILL_DIR = join(import.meta.dir, "..");

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "tests") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, acc);
    else if (entry.name.endsWith(".ts")) acc.push(path);
  }
  return acc;
}

describe("sdk-adapter centralization", () => {
  test("only sdk-adapter.ts contains `c.beta as unknown` for memoryStores", () => {
    const offenders: string[] = [];
    for (const file of collect(SKILL_DIR)) {
      if (file.endsWith("/sdk-adapter.ts") || file.endsWith("\\sdk-adapter.ts")) continue;
      const src = readFileSync(file, "utf-8");
      if (/c\.beta\s+as\s+unknown\s+as\s+\{\s*memoryStores/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("adapter exports the two memory-store functions", async () => {
    const mod = await import("../sdk-adapter");
    expect(typeof mod.createMemoryStore).toBe("function");
    expect(typeof mod.createMemory).toBe("function");
  });
});
