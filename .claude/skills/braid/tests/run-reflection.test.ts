/**
 * Slice 100 — `runReflection` async orchestration test.
 *
 * Verifies that the reflection runner: (1) creates a session against the
 * configured reflector agent, (2) attaches the target_store as a read_write
 * resource, (3) sends the trajectory + outcome as the user.message, (4)
 * persists the reflection output to the target_store via memoryStores
 * memories.create.
 *
 * Authority: Slice 100 architectural decision 4dce6f31, security decision
 * 50381fee (patterns only, never raw data).
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  runReflection,
  setAnthropicClient,
  c as originalClient,
  type Manifest,
  type State,
} from "../lib";
import { createMockAnthropic } from "../mocks/anthropic";

let realClient: Anthropic;
let mockCtx: ReturnType<typeof createMockAnthropic>;

beforeAll(() => {
  realClient = originalClient;
});
afterAll(() => {
  setAnthropicClient(realClient);
});
beforeEach(() => {
  mockCtx = createMockAnthropic();
  setAnthropicClient(mockCtx.client as Anthropic);
  // Demo-mode mock primes streamEvents; reflection wants its own canned text.
  mockCtx.mock.canned.streamEvents = [
    {
      type: "agent.message",
      content: [
        { type: "text", text: "Pattern: Fal video URLs that pass rubric tend to be 8-12s warm-lit and dolly-in." },
      ],
    },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
});

const manifest: Manifest = {
  name: "snapshots",
  env_name: "braid-snapshots",
  state_file: "state.json",
  output_dir: "outputs/snapshots",
  agents: [
    { key: "photographer", file: "agents/photographer.yaml", is_director: true },
    { key: "reflector", file: "agents/reflector.yaml" },
  ],
  environment: { networking: { type: "limited", allowed_hosts: [] } },
  memory_stores: [
    { key: "lessonsStore", name: "snapshots-lessons", access: "read_write" },
  ],
  run: {
    reflection: { agent_key: "reflector", target_store: "lessonsStore" },
  },
};

const state: State = {
  env: "env_x",
  agents: { photographer: "agt_photo_x", reflector: "agt_reflector_x" },
  stores: { lessonsStore: "mem_lessons_x" },
};

describe("runReflection", () => {
  test("creates a session against the configured reflector agent", async () => {
    const result = await runReflection(manifest, state, "sesn_demo_x", "agent report text", { result: "pass" });
    expect(result.ok).toBe(true);
    const sessionCreate = mockCtx.mock.calls.sessions_create?.[0]?.[0] as {
      agent: string;
      resources?: Array<{ memory_store_id: string; access: string }>;
    };
    expect(sessionCreate.agent).toBe("agt_reflector_x");
    expect(sessionCreate.resources).toBeDefined();
    expect(sessionCreate.resources?.[0]?.memory_store_id).toBe("mem_lessons_x");
    expect(sessionCreate.resources?.[0]?.access).toBe("read_write");
  });

  test("sends agentReport + outcome as the user message", async () => {
    await runReflection(manifest, state, "sesn_demo_x", "the trajectory body", { result: "pass" });
    const send = mockCtx.mock.calls.sessions_events_send?.[0]?.[1] as {
      events: Array<{ type: string; content: Array<{ type: string; text: string }> }>;
    };
    const text = send.events[0]?.content[0]?.text ?? "";
    expect(text).toContain("the trajectory body");
    expect(text).toContain("pass");
  });

  test("writes a memory entry to the target_store after streaming", async () => {
    await runReflection(manifest, state, "sesn_demo_x", "report", { result: "pass" });
    const memCreate = mockCtx.mock.calls.memoryStores_memories_create?.[0];
    expect(memCreate).toBeDefined();
    expect(memCreate?.[0]).toBe("mem_lessons_x");
    const args = memCreate?.[1] as { path: string; content: string };
    expect(args.content).toContain("Pattern:");
    expect(args.path).toMatch(/reflections\//);
  });

  test("returns error when reflection config is missing", async () => {
    const noReflection: Manifest = { ...manifest, run: {} };
    const result = await runReflection(noReflection, state, "sesn_demo_x", "report", null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  test("returns error when target_store is not provisioned in state", async () => {
    const stateNoStore: State = { ...state, stores: {} };
    const result = await runReflection(manifest, stateNoStore, "sesn_demo_x", "report", { result: "pass" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/lessonsStore|not provisioned/i);
  });

  test("returns error when reflector agent is not provisioned", async () => {
    const stateNoAgent: State = { ...state, agents: { photographer: "agt_x" } };
    const result = await runReflection(manifest, stateNoAgent, "sesn_demo_x", "report", { result: "pass" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reflector|not provisioned/i);
  });
});
