/**
 * Slice 45 — orchestration coverage lift to 80/70 line/branch floor.
 *
 * Targets the lib.ts surfaces that the SDK-mock harness from Slice 40 makes
 * reachable but Slices 40/80/100 didn't yet exercise:
 *   - appendRunLog (memoryStores.memories.create path)
 *   - downloadSessionFiles (files.list + files.download)
 *   - pullAgents (agents.retrieve roundtrip + writeAgentSpec integration)
 *   - seedStore (sessions.create + events.send + events.stream)
 *   - runSentinel (sentinel session creation + diagnosis parsing)
 *
 * Authority: Slice 45 design decisions (Memento plan node ca9deec2).
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  appendRunLog,
  downloadSessionFiles,
  pullAgents,
  runSentinel,
  setAnthropicClient,
  c as originalClient,
  type Manifest,
  type State,
} from "../lib";
import { createMockAnthropic } from "../mocks/anthropic";

let realClient: Anthropic;
let mockCtx: ReturnType<typeof createMockAnthropic>;
let workDir: string;

beforeAll(() => {
  realClient = originalClient;
  workDir = mkdtempSync(join(tmpdir(), "braid-orch-cov-"));
});
afterAll(() => {
  setAnthropicClient(realClient);
  rmSync(workDir, { recursive: true, force: true });
});
beforeEach(() => {
  mockCtx = createMockAnthropic();
  setAnthropicClient(mockCtx.client as Anthropic);
});

const manifest: Manifest = {
  name: "cov",
  env_name: "braid-cov",
  state_file: "state.json",
  output_dir: "outputs/cov",
  agents: [{ key: "director", file: "agents/director.yaml", is_director: true }],
  environment: { networking: { type: "limited", allowed_hosts: [] } },
};

describe("appendRunLog", () => {
  test("writes a markdown summary to the runLog memory store", async () => {
    const state: State = { stores: { runLog: "mem_runlog_x" } };
    const path = await appendRunLog(
      manifest,
      state,
      "sesn_abc123",
      "the brief",
      "agent did stuff",
      { result: "pass", note: "good" },
      ["a.txt", "b.png"],
    );
    expect(path).toBeTruthy();
    expect(path).toMatch(/\/runs\/\d{4}-\d{2}-\d{2}-/);
    const memCreate = mockCtx.mock.calls.memoryStores_memories_create?.[0];
    expect(memCreate?.[0]).toBe("mem_runlog_x");
    const args = memCreate?.[1] as { path: string; content: string };
    expect(args.content).toContain("the brief");
    expect(args.content).toContain("a.txt");
    expect(args.content).toContain("agent did stuff");
  });

  test("returns null when runLog store is not provisioned", async () => {
    const state: State = { stores: {} };
    const path = await appendRunLog(manifest, state, "sesn_x", "brief", "report", null, []);
    expect(path).toBeNull();
  });
});

describe("downloadSessionFiles", () => {
  test("downloads each listed file and writes it to outDir", async () => {
    // Stub the list to return one file
    (mockCtx.client as any).beta.files.list = async () => ({
      data: [{ id: "file_x", filename: "result.json" }],
    });
    (mockCtx.client as any).beta.files.download = async (id: string) => {
      return new Response(new TextEncoder().encode(`hello from ${id}`));
    };
    const emit = (_t: string, _p: unknown) => {};
    const outDir = join(workDir, "out-download");
    mkdirSync(outDir, { recursive: true });
    const saved = await downloadSessionFiles("sesn_x", outDir, emit);
    expect(saved).toContain("result.json");
    expect(readFileSync(join(outDir, "result.json"), "utf-8")).toBe("hello from file_x");
  });

  test("returns empty array and emits info when list throws", async () => {
    (mockCtx.client as any).beta.files.list = async () => {
      throw new Error("simulated list failure");
    };
    const events: string[] = [];
    const emit = (t: string, p: unknown) => { events.push(`${t}:${p}`); };
    const outDir = join(workDir, "out-download-empty");
    mkdirSync(outDir, { recursive: true });
    const saved = await downloadSessionFiles("sesn_x", outDir, emit);
    expect(saved).toEqual([]);
    expect(events.some((e) => e.startsWith("info:"))).toBe(true);
  });
});

describe("pullAgents", () => {
  test("retrieves remote agent definition and writes it to disk", async () => {
    // Set up: state has an agent ID; a yaml file path exists in flowDir.
    const flowDir = join(workDir, "flow-pull");
    mkdirSync(join(flowDir, "agents"), { recursive: true });
    writeFileSync(join(flowDir, "agents", "director.yaml"), "name: stale\nsystem: old\n");
    const state: State = { agents: { director: "agt_pull_x" } };
    (mockCtx.client as any).beta.agents.retrieve = async (id: string) => ({
      id,
      name: "fresh",
      system: "new system prompt",
      version: 7,
      created_at: "2026-05-15", // PULL_STRIP should remove this
    });
    const results = await pullAgents(manifest, state, flowDir);
    expect(results.length).toBe(1);
    expect(results[0]?.key).toBe("director");
    expect(results[0]?.version).toBe(7);
    const wrote = readFileSync(join(flowDir, "agents", "director.yaml"), "utf-8");
    expect(wrote).toContain("fresh");
    expect(wrote).not.toContain("created_at");
  });

  test("dry-run mode does NOT write the file", async () => {
    const flowDir = join(workDir, "flow-pull-dry");
    mkdirSync(join(flowDir, "agents"), { recursive: true });
    writeFileSync(join(flowDir, "agents", "director.yaml"), "name: original\n");
    const state: State = { agents: { director: "agt_pull_y" } };
    (mockCtx.client as any).beta.agents.retrieve = async (id: string) => ({
      id, name: "would-overwrite", version: 1,
    });
    const results = await pullAgents(manifest, state, flowDir, undefined, { dryRun: true });
    expect(results[0]?.wrote).toBe(false);
    const onDisk = readFileSync(join(flowDir, "agents", "director.yaml"), "utf-8");
    expect(onDisk).toContain("original");
  });

  test("rejects unknown agent keys", async () => {
    const flowDir = join(workDir, "flow-pull-unknown");
    mkdirSync(flowDir, { recursive: true });
    const state: State = { agents: { director: "agt_x" } };
    await expect(pullAgents(manifest, state, flowDir, ["doesnotexist"])).rejects.toThrow(
      /unknown agent/i,
    );
  });
});

describe("runSentinel", () => {
  test("creates a sentinel session with projectStore as context (backwards-compat)", async () => {
    const manifestWithSentinel: Manifest = {
      ...manifest,
      sentinel_key: "sentinel",
      agents: [
        ...manifest.agents,
        { key: "sentinel", file: "agents/sentinel.yaml" },
      ],
    };
    const state: State = {
      env: "env_x",
      agents: { director: "agt_d", sentinel: "agt_sentinel_x" },
      stores: { projectStore: "mem_proj_x" },
    };
    // Sentinel reads agent.message events to parse JSON diagnosis.
    mockCtx.mock.canned.streamEvents = [
      {
        type: "agent.message",
        content: [
          {
            type: "text",
            text: '{"diagnosis":"agent stalled on Fal call","recovery_message":"retry with shorter prompt"}',
          },
        ],
      },
      { type: "session.status_idle" },
    ];
    const events: Array<{ t: string; p: unknown }> = [];
    const emit = (t: string, p: unknown) => events.push({ t, p });
    const recovery = await runSentinel(manifestWithSentinel, state, "the brief", "sesn_stalled", 200, emit);
    expect(recovery).toBe("retry with shorter prompt");
    expect(events.some((e) => e.t === "sentinel" && String(e.p).startsWith("diagnosis"))).toBe(true);
  });

  test("returns null when sentinel agent is not configured", async () => {
    const state: State = { env: "env_x", agents: { director: "agt_d" } };
    const emit = (_t: string, _p: unknown) => {};
    const recovery = await runSentinel(manifest, state, "brief", "sesn_x", 100, emit);
    expect(recovery).toBeNull();
  });

  test("returns null when sentinel session create throws", async () => {
    const manifestWithSentinel: Manifest = {
      ...manifest,
      sentinel_key: "sentinel",
      agents: [...manifest.agents, { key: "sentinel", file: "agents/sentinel.yaml" }],
    };
    const state: State = {
      env: "env_x",
      agents: { director: "agt_d", sentinel: "agt_sentinel_x" },
    };
    (mockCtx.client as any).beta.sessions.create = async () => {
      throw new Error("simulated sentinel-session creation failure");
    };
    const events: Array<{ t: string; p: unknown }> = [];
    const emit = (t: string, p: unknown) => events.push({ t, p });
    const recovery = await runSentinel(manifestWithSentinel, state, "brief", "sesn_x", 100, emit);
    expect(recovery).toBeNull();
    expect(events.some((e) => e.t === "sentinel" && String(e.p).includes("error"))).toBe(true);
  });
});
