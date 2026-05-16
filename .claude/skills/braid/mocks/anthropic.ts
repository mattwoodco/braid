/**
 * Slice 80 — Anthropic SDK mock, productized.
 *
 * Originally lived under `tests/helpers/mock-anthropic.ts` for Slice 40 SDK-
 * mock orchestration tests. Slice 80 promotes it to a first-class module so
 * production code can swap in the mock via `setAnthropicClient` when
 * `BRAID_DEMO_MODE=1` is set. The same module powers:
 *   - SDK-mocked orchestration tests (deterministic)
 *   - `bun run demo <flow>` (zero-cost evaluation)
 *
 * Authority for the productization:
 *   - Slice 80 design decision df5a6be9 (graduate mock to mocks/ via env flag)
 *   - Slice 40 sdk-adapter pattern (Memento knowledge 1bc2d49b)
 *   - Hermes Agent's local sandbox backend (https://hermes-agent.nousresearch.com)
 *
 * Counters: each method records its args in `mock.calls.<method>` so tests
 * (and demo verifications) can assert on call patterns. Canned IDs make every
 * demo run produce deterministic output suitable for snapshot review.
 */

export type MockState = {
  calls: Record<string, unknown[][]>;
  canned: {
    nextEnvId: string;
    nextVaultId: string;
    nextCredentialId: string;
    nextAgentId: string;
    nextSessionId: string;
    nextMemoryStoreId: string;
    sessionStatuses: Record<string, string>;
    streamEvents: unknown[];
  };
  reset: () => void;
};

export type MockOptions = {
  /**
   * When true, pre-populates `streamEvents` with a realistic small timeline
   * (agent.message + outcome + idle) so a demo run shows meaningful output
   * instead of an immediate idle. Tests typically set this false (their own
   * canned events as needed).
   */
  demoMode?: boolean;
};

/**
 * Demo-mode canned events: a short representative timeline a viewer can
 * read and understand. Token values are the literal sentinel
 * "DEMO-NOT-A-REAL-TOKEN" wherever a token would appear, per Slice 80
 * security decision af93996e (visibility-of-fakeness).
 */
function demoStreamEvents(): unknown[] {
  return [
    {
      type: "agent.message",
      content: [
        {
          type: "text",
          text: "Demo: I would normally call an MCP tool here. In demo mode I emit this placeholder so you can see the event timeline.",
        },
      ],
    },
    {
      type: "span.outcome_evaluation_end",
      result: "pass",
      explanation: "Demo outcome — every shipped flow's rubric would be checked here.",
    },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
}

function trackCall(state: MockState, name: string, args: unknown[]): void {
  state.calls[name] ??= [];
  state.calls[name]!.push(args);
}

export function createMockAnthropic(opts: MockOptions = {}): {
  client: unknown;
  mock: MockState;
} {
  const state: MockState = {
    calls: {},
    canned: {
      nextEnvId: "env_mock_01",
      nextVaultId: "vlt_mock_01",
      nextCredentialId: "vcrd_mock_01",
      nextAgentId: "agt_mock_01",
      nextSessionId: "sesn_mock_01",
      nextMemoryStoreId: "mem_mock_01",
      sessionStatuses: {},
      streamEvents: opts.demoMode ? demoStreamEvents() : [],
    },
    reset() {
      state.calls = {};
      state.canned.sessionStatuses = {};
      state.canned.streamEvents = opts.demoMode ? demoStreamEvents() : [];
    },
  };

  const client = {
    beta: {
      environments: {
        create: async (...args: unknown[]) => {
          trackCall(state, "environments_create", args);
          return { id: state.canned.nextEnvId, name: "mock-env" };
        },
        list: async () => ({ data: [] as unknown[] }),
      },
      vaults: {
        create: async (...args: unknown[]) => {
          trackCall(state, "vaults_create", args);
          return { id: state.canned.nextVaultId };
        },
        credentials: {
          create: async (...args: unknown[]) => {
            trackCall(state, "vault_credentials_create", args);
            return { id: state.canned.nextCredentialId };
          },
          list: async () => ({ data: [] as unknown[] }),
          delete: async (...args: unknown[]) => {
            trackCall(state, "vault_credentials_delete", args);
          },
        },
        list: async () => ({ data: [] as unknown[] }),
        delete: async (...args: unknown[]) => {
          trackCall(state, "vaults_delete", args);
        },
      },
      agents: {
        create: async (...args: unknown[]) => {
          trackCall(state, "agents_create", args);
          return { id: state.canned.nextAgentId, version: 1 };
        },
        retrieve: async (id: string) => {
          trackCall(state, "agents_retrieve", [id]);
          return { id, version: 1, name: "mock-agent" } as Record<string, unknown>;
        },
        list: async () => ({ data: [] as unknown[] }),
        archive: async (id: string) => {
          trackCall(state, "agents_archive", [id]);
        },
      },
      sessions: {
        create: async (...args: unknown[]) => {
          trackCall(state, "sessions_create", args);
          const id = state.canned.nextSessionId;
          state.canned.sessionStatuses[id] = "idle";
          return { id };
        },
        retrieve: async (id: string) => {
          trackCall(state, "sessions_retrieve", [id]);
          const status = state.canned.sessionStatuses[id] ?? "idle";
          return { id, status };
        },
        list: async () => ({ data: [] as unknown[] }),
        delete: async (id: string) => {
          trackCall(state, "sessions_delete", [id]);
        },
        events: {
          send: async (id: string, payload: unknown) => {
            trackCall(state, "sessions_events_send", [id, payload]);
          },
          stream: async (id: string) => {
            trackCall(state, "sessions_events_stream", [id]);
            const events = state.canned.streamEvents.slice();
            return (async function* () {
              for (const ev of events) yield ev;
            })();
          },
        },
      },
      files: {
        list: async () => ({ data: [] as unknown[] }),
        download: async (id: string) => {
          trackCall(state, "files_download", [id]);
          return new Response(new Uint8Array(0));
        },
      },
      memoryStores: {
        create: async (args: { name: string }) => {
          trackCall(state, "memoryStores_create", [args]);
          return { id: state.canned.nextMemoryStoreId };
        },
        list: async () => ({ data: [] as unknown[] }),
        delete: async (id: string) => {
          trackCall(state, "memoryStores_delete", [id]);
        },
        memories: {
          create: async (storeId: string, args: unknown) => {
            trackCall(state, "memoryStores_memories_create", [storeId, args]);
            return { id: "memory_mock_01" };
          },
        },
      },
    },
  };

  return { client, mock: state };
}
