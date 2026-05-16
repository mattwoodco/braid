/**
 * Slice 20 §2.A8 — `pull` must not destructively overwrite agents/*.yaml.
 *
 * Historical defect: `pullAgents` called `writeFileSync(a.file, ...)`
 * directly, blowing away local edits on first sync with the remote.
 *
 * Fix:
 *   - `dryRun: true` previews changes without writing; returns the would-be
 *     diff/payload per agent.
 *   - Normal write creates a `.bak` of the existing file before overwriting,
 *     so the operator can recover if the remote drift was unintended.
 *
 * This test exercises a pure helper `pullAgentSpec` that performs the local
 * write decision. The remote `c.beta.agents.retrieve` call is integration-
 * tested via `pullAgents`.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeAgentSpec } from "../lib";

let workDir: string;
let target: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "braid-pull-"));
  target = join(workDir, "agent.yaml");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("writeAgentSpec", () => {
  test("dry-run returns the payload without writing the file", () => {
    rmSync(target, { force: true });
    rmSync(`${target}.bak`, { force: true });
    writeFileSync(target, "original-content\n");

    const result = writeAgentSpec(target, "new-content\n", { dryRun: true });

    expect(result.wrote).toBe(false);
    expect(result.would_write).toBe("new-content\n");
    expect(readFileSync(target, "utf-8")).toBe("original-content\n");
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  test("normal write creates a .bak of existing file before overwriting", () => {
    rmSync(target, { force: true });
    rmSync(`${target}.bak`, { force: true });
    writeFileSync(target, "original-content\n");

    const result = writeAgentSpec(target, "new-content\n", { dryRun: false });

    expect(result.wrote).toBe(true);
    expect(result.backup).toBe(`${target}.bak`);
    expect(readFileSync(target, "utf-8")).toBe("new-content\n");
    expect(readFileSync(`${target}.bak`, "utf-8")).toBe("original-content\n");
  });

  test("normal write with no existing file does not create a .bak", () => {
    rmSync(target, { force: true });
    rmSync(`${target}.bak`, { force: true });

    const result = writeAgentSpec(target, "new-content\n", { dryRun: false });

    expect(result.wrote).toBe(true);
    expect(result.backup).toBeUndefined();
    expect(readFileSync(target, "utf-8")).toBe("new-content\n");
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  test("no-op when new content is byte-identical to existing", () => {
    rmSync(target, { force: true });
    rmSync(`${target}.bak`, { force: true });
    writeFileSync(target, "same-content\n");

    const result = writeAgentSpec(target, "same-content\n", { dryRun: false });

    expect(result.wrote).toBe(false);
    expect(result.reason).toMatch(/unchanged|identical/i);
    expect(existsSync(`${target}.bak`)).toBe(false);
  });
});
