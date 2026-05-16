/**
 * Slice 40 — orchestration coverage for session lifecycle:
 *   - createOrResumeSession (new vs resume)
 *   - truncateSessionHistory + remote cleanup of dropped ids (§2.A5)
 *   - cleanupAbandonedSession (§2.A6)
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createOrResumeSession,
  cleanupAbandonedSession,
  setAnthropicClient,
  c as originalClient,
  type Manifest,
  type State,
} from "../lib";
import { createMockAnthropic } from "./helpers/mock-anthropic";

let mockCtx: ReturnType<typeof createMockAnthropic>;
let realClient: Anthropic;

beforeAll(() => {
  realClient = originalClient;
});

afterAll(() => {
  setAnthropicClient(realClient);
});

beforeEach(() => {
  mockCtx = createMockAnthropic();
  setAnthropicClient(mockCtx.client as Anthropic);
});

const manifest: Manifest = {
  name: "demo",
  env_name: "braid-demo",
  state_file: "state.json",
  output_dir: "outputs/demo",
  agents: [{ key: "director", file: "agents/director.yaml", is_director: true }],
  environment: {
    networking: { type: "limited", allowed_hosts: [] },
  },
};

describe("createOrResumeSession — new session", () => {
  test("creates a new session and tracks it", async () => {
    const state: State = { env: "env_x", agents: { director: "agt_x" } };
    const result = await createOrResumeSession(manifest, state);
    expect(result.resumed).toBe(false);
    expect(result.session.id).toBe("sesn_mock_01");
    expect(state.sessions).toEqual(["sesn_mock_01"]);
  });

  test("truncates session history past 20 entries AND deletes dropped sessions (A5)", async () => {
    const prior = Array.from({ length: 22 }, (_, i) => `sesn_old_${i}`);
    const state: State = {
      env: "env_x",
      agents: { director: "agt_x" },
      sessions: prior,
    };
    await createOrResumeSession(manifest, state);
    expect(state.sessions?.length).toBe(20);
    expect(state.sessions?.[0]).toBe("sesn_mock_01");
    // Allow fire-and-forget deletes to settle.
    await new Promise((r) => setTimeout(r, 10));
    const deleteCalls = mockCtx.mock.calls.sessions_delete ?? [];
    // 3 dropped: sesn_old_19, sesn_old_20, sesn_old_21
    expect(deleteCalls.length).toBe(3);
  });
});

describe("createOrResumeSession — resume", () => {
  test("resumes when the requested session is still running", async () => {
    mockCtx.mock.canned.sessionStatuses["sesn_existing"] = "running";
    const state: State = { env: "env_x", agents: { director: "agt_x" } };
    const result = await createOrResumeSession(manifest, state, "sesn_existing");
    expect(result.resumed).toBe(true);
    expect(result.session.id).toBe("sesn_existing");
  });

  test("falls back to a new session when the requested resume id is not running", async () => {
    mockCtx.mock.canned.sessionStatuses["sesn_existing"] = "idle";
    const state: State = { env: "env_x", agents: { director: "agt_x" } };
    const result = await createOrResumeSession(manifest, state, "sesn_existing");
    expect(result.resumed).toBe(false);
    expect(result.session.id).toBe("sesn_mock_01");
  });
});

describe("cleanupAbandonedSession (A6)", () => {
  test("sends an interrupt and then deletes", async () => {
    await cleanupAbandonedSession("sesn_abandon");
    const sends = mockCtx.mock.calls.sessions_events_send ?? [];
    const deletes = mockCtx.mock.calls.sessions_delete ?? [];
    expect(sends.length).toBe(1);
    expect(deletes.length).toBe(1);
    expect((deletes[0] as unknown[])[0]).toBe("sesn_abandon");
  });
});
