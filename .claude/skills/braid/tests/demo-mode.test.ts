/**
 * Slice 80 — demo mode integration test.
 *
 * Asserts that `bun run braid.ts demo <flow>` with BRAID_DEMO_MODE=1 produces
 * the expected event timeline without any real Anthropic API call. This is
 * the "executable demo" gate: if the demo regresses, this test fails.
 *
 * Authority: Slice 80 design decisions df5a6be9 (graduate mock), af93996e
 * (refuse real API calls in demo mode), 971dfc2a (TddStrategy — assert on
 * event timeline).
 */

import { test, expect, describe } from "bun:test";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const BRAID = join(REPO_ROOT, ".claude", "skills", "braid", "braid.ts");

describe("demo mode — bun run braid.ts demo <flow>", () => {
  test("runs end-to-end with no real keys, emits expected event timeline", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", BRAID, "demo", "_archive/ad"],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BRAID_DEMO_MODE: "1",
        BRAID_SSE_PORT: "0",
        // Intentionally NO ANTHROPIC_API_KEY / FAL_API_KEY / VERCEL_TOKEN —
        // demo mode must inject sentinel values itself.
        ANTHROPIC_API_KEY: "",
        FAL_API_KEY: "",
        VERCEL_TOKEN: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
    const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
    if (proc.exitCode !== 0) {
      throw new Error(`demo exited ${proc.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }

    // The provisioning lines confirm the mock client served every call.
    expect(stdout).toContain("env: env_mock_01");
    expect(stdout).toContain("vault fal: vlt_mock_01");

    // The SSE event timeline must show the demo agent.message canned event.
    expect(stdout).toContain("[agent]");
    expect(stdout).toContain("Demo: I would normally call an MCP tool here");

    // Outcome evaluation must fire so reviewers see the success-criteria path.
    expect(stdout).toContain("[outcome]");

    // [done] marks the orchestrator's successful end.
    expect(stdout).toContain("[done]");

    // Mark of completion from demoFlow itself.
    expect(stdout).toContain("[demo] complete");
  }, 30_000);

  test("emits the demo banner so users know they are not making real API calls", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", BRAID, "demo", "_archive/ad"],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BRAID_DEMO_MODE: "1",
        BRAID_SSE_PORT: "0",
        ANTHROPIC_API_KEY: "",
        FAL_API_KEY: "",
        VERCEL_TOKEN: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
    expect(stdout).toContain("[demo] zero-cost evaluation");
    expect(stdout).toContain("no real API calls");
  }, 30_000);

  test("refuses to run demoFlow if BRAID_DEMO_MODE is not set", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", BRAID, "demo", "_archive/ad"],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // BRAID_DEMO_MODE intentionally NOT set
        BRAID_DEMO_MODE: "",
        BRAID_SSE_PORT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
    const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
    expect(proc.exitCode).not.toBe(0);
    expect(stdout + stderr).toMatch(/BRAID_DEMO_MODE=1 must be set/i);
  }, 15_000);
});
