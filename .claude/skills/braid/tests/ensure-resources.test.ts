/**
 * Slice 40 — orchestration coverage for `ensureResources` using the mock
 * Anthropic SDK from tests/helpers/mock-anthropic.ts.
 *
 * `ensureResources` is the main provisioning path: environment, vaults,
 * memory stores, agents. It calls c.beta.* heavily and was previously
 * untested because the SDK lookup hid in module-level singleton.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type Anthropic from "@anthropic-ai/sdk";
import { ensureResources, setAnthropicClient, c as originalClient, type Manifest, type State } from "../lib";
import { createMockAnthropic } from "./helpers/mock-anthropic";

let workDir: string;
let agentYamlPath: string;
let mockCtx: ReturnType<typeof createMockAnthropic>;
let realClient: Anthropic;

beforeAll(() => {
  realClient = originalClient;
  workDir = mkdtempSync(join(tmpdir(), "braid-ensure-"));
  agentYamlPath = join(workDir, "agents", "director.yaml");
  mkdirSync(join(workDir, "agents"), { recursive: true });
  writeFileSync(
    agentYamlPath,
    [
      "name: mock-director",
      "model: claude-opus-4-7",
      "system: |",
      "  You are the director.",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  setAnthropicClient(realClient);
});

beforeEach(() => {
  process.env.MOCK_TOKEN = "mock-token-value";
  mockCtx = createMockAnthropic();
  setAnthropicClient(mockCtx.client as Anthropic);
});

const baseManifest: Manifest = {
  name: "demo",
  env_name: "braid-demo",
  state_file: "state.json",
  output_dir: "outputs/demo",
  agents: [{ key: "director", file: "agents/director.yaml", is_director: true }],
  environment: {
    networking: {
      type: "limited",
      allowed_hosts: [],
      allow_mcp_servers: false,
      allow_package_managers: false,
    },
  },
};

describe("ensureResources orchestration", () => {
  test("creates environment with manifest-declared networking", async () => {
    const state: State = {};
    await ensureResources(baseManifest, state, workDir);
    expect(state.env).toBe("env_mock_01");
    const envCall = mockCtx.mock.calls.environments_create?.[0]?.[0] as {
      name: string;
      config: { networking: { type: string } };
    };
    expect(envCall.name).toBe("braid-demo");
    expect(envCall.config.networking.type).toBe("limited");
  });

  test("creates agents from yaml on disk (flowDir threaded correctly)", async () => {
    const state: State = {};
    await ensureResources(baseManifest, state, workDir);
    expect(state.agents?.director).toBe("agt_mock_01");
    expect(mockCtx.mock.calls.agents_create?.length ?? 0).toBe(1);
  });

  test("creates vault and credential for declared vault", async () => {
    const manifest: Manifest = {
      ...baseManifest,
      vault: {
        display_name: "test",
        credential: {
          display_name: "Test MCP",
          mcp_server_url: "https://mcp.fal.ai/mcp",
          token_env: "MOCK_TOKEN",
        },
      },
    };
    const state: State = {};
    await ensureResources(manifest, state, workDir);
    expect(state.vault).toBe("vlt_mock_01");
    expect(state.vaults).toEqual(["vlt_mock_01"]);
    expect(mockCtx.mock.calls.vault_credentials_create?.length ?? 0).toBe(1);
  });

  test("rejects credential creation against an unlisted MCP host (F5 integration)", async () => {
    const manifest: Manifest = {
      ...baseManifest,
      vault: {
        display_name: "bad",
        credential: {
          display_name: "Bad MCP",
          mcp_server_url: "https://attacker.example.com/mcp",
          token_env: "MOCK_TOKEN",
        },
      },
    };
    const state: State = {};
    await expect(ensureResources(manifest, state, workDir)).rejects.toThrow(
      /allowlist/i,
    );
    // Critically, no vault should have been created since validation happens first.
    expect(mockCtx.mock.calls.vaults_create).toBeUndefined();
  });

  test("creates memory stores when declared", async () => {
    const manifest: Manifest = {
      ...baseManifest,
      memory_stores: [{ key: "ks", name: "knowledge", access: "read_write" }],
    };
    const state: State = {};
    await ensureResources(manifest, state, workDir);
    expect(state.stores?.ks).toBe("mem_mock_01");
    expect(mockCtx.mock.calls.memoryStores_create?.length ?? 0).toBe(1);
  });

  test("auto-provisions runLog store when run.log_runs is true", async () => {
    const manifest: Manifest = {
      ...baseManifest,
      run: { log_runs: true },
    };
    const state: State = {};
    await ensureResources(manifest, state, workDir);
    expect(state.stores?.runLog).toBe("mem_mock_01");
  });

  test("idempotent — re-running with existing state doesn't recreate", async () => {
    const state: State = {
      env: "env_existing",
      agents: { director: "agt_existing" },
    };
    await ensureResources(baseManifest, state, workDir);
    // env was already set → no new environments.create call
    expect(mockCtx.mock.calls.environments_create).toBeUndefined();
    // director was in state.agents → no new agents.create call
    expect(mockCtx.mock.calls.agents_create).toBeUndefined();
  });
});
