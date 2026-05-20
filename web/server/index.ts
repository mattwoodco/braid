import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { parse as parseYaml } from "yaml";

// web/server/index.ts → braid/ is two dirs up.
const HERE = dirname(fileURLToPath(import.meta.url));
const BRAID_DIR = process.env.BRAID_DIR ?? resolve(HERE, "../..");
const PORT = Number(process.env.PORT ?? 5174);

// Best-effort: load ANTHROPIC_API_KEY from braid's .env.local if not set.
loadBraidEnv();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    `[braid-web] ANTHROPIC_API_KEY not found in env or ${BRAID_DIR}/.env.local`,
  );
  process.exit(1);
}

const anthropic = new Anthropic();

const BETAS = ["managed-agents-2026-04-01"];

type FlowState = {
  env?: string;
  vaults?: string[];
  stores?: Record<string, string>;
  agents?: Record<string, string>;
  sessions?: string[];
};

type FlowYaml = {
  name: string;
  agents: Array<{
    key: string;
    file: string;
    is_director?: boolean;
    coordinator?: string[];
  }>;
};

type AgentYaml = {
  name?: string;
  description?: string;
  model?: string | { id?: string };
};

type ApiAgent = {
  key: string;
  name: string;
  isDirector: boolean;
  model: string;
  agentId?: string;
};

type ApiFlow = {
  key: string;
  name: string;
  director: string;
  agents: ApiAgent[];
  sessionIds: string[];
};

function loadBraidEnv() {
  const envPath = resolve(BRAID_DIR, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Walk flows/ (up to 2 levels deep) for any directory containing flow.yaml.
// Skip *_archive*. Keys use ":" as a path separator so they're URL-safe.
function listFlowKeys(): string[] {
  const root = resolve(BRAID_DIR, "flows");
  if (!existsSync(root)) return [];
  const keys: string[] = [];
  const walk = (relParts: string[], depth: number) => {
    const abs = resolve(root, ...relParts);
    if (existsSync(resolve(abs, "flow.yaml"))) {
      keys.push(relParts.join(":"));
      return; // don't recurse below a flow root
    }
    if (depth >= 2) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.includes("archive")) continue;
      walk([...relParts, e.name], depth + 1);
    }
  };
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.includes("archive")) continue;
    walk([e.name], 1);
  }
  return keys.sort();
}

function flowKeyToPath(key: string): string {
  return key.split(":").join("/");
}

function readFlow(flowKey: string): ApiFlow | null {
  const flowDir = resolve(BRAID_DIR, "flows", flowKeyToPath(flowKey));
  const yamlPath = resolve(flowDir, "flow.yaml");
  if (!existsSync(yamlPath)) return null;
  const flowYaml = parseYaml(readFileSync(yamlPath, "utf8")) as FlowYaml;
  const statePath = resolve(flowDir, "state.json");
  const state: FlowState = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : {};

  const agents: ApiAgent[] = (flowYaml.agents ?? []).map((a) => {
    const agentYamlPath = resolve(flowDir, a.file);
    let agentYaml: AgentYaml = {};
    if (existsSync(agentYamlPath)) {
      try {
        agentYaml = parseYaml(readFileSync(agentYamlPath, "utf8")) as AgentYaml;
      } catch {
        /* ignore */
      }
    }
    const model =
      typeof agentYaml.model === "string"
        ? agentYaml.model
        : (agentYaml.model?.id ?? "—");
    return {
      key: a.key,
      name: agentYaml.name ?? `${flowYaml.name}-${a.key}`,
      isDirector: Boolean(a.is_director),
      model,
      agentId: state.agents?.[a.key],
    };
  });

  const director = agents.find((a) => a.isDirector)?.key ?? agents[0]?.key ?? "";

  return {
    key: flowKey,
    name: flowYaml.name ?? flowKey,
    director,
    agents,
    sessionIds: state.sessions ?? [],
  };
}

type SessionMeta = {
  id: string;
  flowKey: string;
  startedAt: string;
  status: "live" | "completed" | "failed";
  label?: string;
};

function mapStatus(raw: string | undefined): SessionMeta["status"] {
  if (!raw) return "completed";
  const s = raw.toLowerCase();
  if (s.includes("error") || s.includes("terminat") || s.includes("fail"))
    return "failed";
  if (s.includes("idle") || s.includes("complet") || s.includes("archiv"))
    return "completed";
  return "live";
}

async function describeSession(
  id: string,
  flowKey: string,
): Promise<SessionMeta> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
    const s: any = await (anthropic as any).beta.sessions.retrieve(id, {
      betas: BETAS,
    });
    return {
      id,
      flowKey,
      startedAt: s.created_at ?? s.createdAt ?? new Date().toISOString(),
      status: mapStatus(s.status?.type ?? s.status),
      label: s.metadata?.brief?.slice?.(0, 60) ?? s.name ?? undefined,
    };
  } catch (err) {
    return {
      id,
      flowKey,
      startedAt: new Date().toISOString(),
      status: "completed",
      label: (err as Error).message.slice(0, 60),
    };
  }
}

// --- Anthropic event → braid-web event mapping (mirrors braid.ts) ---

type AppEventType =
  | "brief"
  | "agent"
  | "tool"
  | "outcome"
  | "error"
  | "sentinel";

type AppEvent = {
  id: string;
  ts: number;
  sessionId: string;
  agentKey: string;
  type: AppEventType;
  payload: string;
};

// biome-ignore lint/suspicious/noExplicitAny: content blocks vary.
function textOf(content: any): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    // biome-ignore lint/suspicious/noExplicitAny: content blocks vary.
    .map((c: any) => (c?.type === "text" ? c.text : ""))
    .join("");
}

type Mapper = (
  // biome-ignore lint/suspicious/noExplicitAny: streamed events vary.
  raw: any,
  sessionId: string,
  idx: number,
) => AppEvent | null;

function makeMapper(
  agentNameToKey: Map<string, string>,
  directorKey: string,
): Mapper {
  // threadId → agentKey, learned from session.thread_created and
  // session.thread_status_* events.
  const threadToKey = new Map<string, string>();

  const resolveAgentName = (name: string | null | undefined): string => {
    if (!name) return directorKey;
    return agentNameToKey.get(name) ?? directorKey;
  };

  // biome-ignore lint/suspicious/noExplicitAny: streamed events vary.
  return (raw: any, sessionId: string, idx: number): AppEvent | null => {
    const ts = raw.processed_at ? Date.parse(raw.processed_at) : Date.now();
    const id = raw.id ?? `${sessionId}-${idx}`;
    const t = raw.type as string | undefined;
    if (!t) return null;

    // Update threadId → agentKey map opportunistically.
    if (raw.session_thread_id && raw.agent_name) {
      threadToKey.set(raw.session_thread_id, resolveAgentName(raw.agent_name));
    }

    // Default: events with a session_thread_id we've seen belong to that
    // thread's agent; otherwise to the director.
    const threadAgentKey =
      (raw.session_thread_id && threadToKey.get(raw.session_thread_id)) ||
      directorKey;

    switch (t) {
      case "session.thread_created": {
        const key = resolveAgentName(raw.agent_name);
        return {
          id,
          ts,
          sessionId,
          agentKey: key,
          type: "sentinel",
          payload: `${raw.agent_name ?? key} thread spawned`,
        };
      }

      case "agent.thread_message_sent": {
        // Director gives instruction to a subagent. Show on the subagent's
        // timeline so its log reads "told to X → replied with Y".
        const key = resolveAgentName(raw.to_agent_name);
        if (raw.to_session_thread_id) threadToKey.set(raw.to_session_thread_id, key);
        const text = textOf(raw.content);
        return {
          id,
          ts,
          sessionId,
          agentKey: key,
          type: "agent",
          payload: text ? `← ${text}` : `← (instruction from director)`,
        };
      }

      case "agent.thread_message_received": {
        // Subagent's reply arrived. Tag to the subagent.
        const key = resolveAgentName(raw.from_agent_name);
        if (raw.from_session_thread_id) threadToKey.set(raw.from_session_thread_id, key);
        const text = textOf(raw.content);
        return {
          id,
          ts,
          sessionId,
          agentKey: key,
          type: "agent",
          payload: text ? `→ ${text}` : `→ (reply to director)`,
        };
      }

      case "agent.message": {
        const text = textOf(raw.content);
        if (!text) return null;
        return { id, ts, sessionId, agentKey: threadAgentKey, type: "agent", payload: text };
      }

      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use": {
        const name = raw.name ?? "tool";
        const input =
          typeof raw.input === "object"
            ? JSON.stringify(raw.input).slice(0, 160)
            : "";
        return {
          id,
          ts,
          sessionId,
          agentKey: threadAgentKey,
          type: "tool",
          payload: input ? `${name}(${input})` : name,
        };
      }

      case "agent.tool_result":
      case "agent.mcp_tool_result": {
        const text = textOf(raw.content);
        return {
          id,
          ts,
          sessionId,
          agentKey: threadAgentKey,
          type: "tool",
          payload: text ? `result: ${text.slice(0, 200)}` : "result",
        };
      }

      case "agent.thinking":
        return null; // noisy; skip

      case "user.message": {
        const text = textOf(raw.content);
        return text
          ? { id, ts, sessionId, agentKey: directorKey, type: "brief", payload: text }
          : null;
      }

      case "user.define_outcome": {
        const desc = String(raw.description ?? "").slice(0, 200);
        return {
          id,
          ts,
          sessionId,
          agentKey: directorKey,
          type: "sentinel",
          payload: `outcome defined: ${desc}`,
        };
      }

      case "span.outcome_evaluation_end": {
        const explanation = String(raw.explanation ?? "").slice(0, 300);
        return {
          id,
          ts,
          sessionId,
          agentKey: directorKey,
          type: "outcome",
          payload: `${raw.result ?? "?"} — ${explanation}`,
        };
      }

      case "session.error":
      case "session.status_terminated": {
        return {
          id,
          ts,
          sessionId,
          agentKey: directorKey,
          type: "error",
          payload:
            raw.error?.message ??
            `${t}${raw.reason ? `: ${raw.reason}` : ""}`,
        };
      }

      case "session.status_idle": {
        const reason = raw.stop_reason?.type;
        return {
          id,
          ts,
          sessionId,
          agentKey: directorKey,
          type: "sentinel",
          payload: `session idle (${reason ?? "ok"})`,
        };
      }

      // Noisy/uninteresting — silently drop.
      case "session.status_running":
      case "session.thread_status_running":
      case "session.thread_status_idle":
      case "span.model_request_start":
      case "span.model_request_end":
      case "span.outcome_evaluation_start":
      case "span.outcome_evaluation_ongoing":
        return null;

      default:
        return null;
    }
  };
}

// --- HTTP routes ---

const app = new Elysia()
  .use(cors())
  .get("/api/flows", () => {
    const keys = listFlowKeys();
    const flows: ApiFlow[] = [];
    for (const k of keys) {
      const f = readFlow(k);
      if (f) flows.push(f);
    }
    return flows;
  })
  .get("/api/flows/:flowKey/sessions", async ({ params }) => {
    const flow = readFlow(params.flowKey);
    if (!flow) return new Response("flow not found", { status: 404 });

    // Union state.json's session ids with every session Anthropic knows about
    // for this flow's agents. State.json lags during a live run (it's only
    // appended at session creation and may not have been flushed yet), so the
    // API gives us the freshest view.
    const ids = new Set<string>(flow.sessionIds);
    await Promise.all(
      flow.agents
        .filter((a) => a.agentId)
        .map(async (a) => {
          try {
            // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
            const page: any = await (anthropic as any).beta.sessions.list(
              { agent_id: a.agentId, limit: 20 },
              { betas: BETAS },
            );
            for await (const s of page) {
              if (s?.id) ids.add(s.id);
            }
          } catch {
            /* ignore — agent may not exist or auth issue */
          }
        }),
    );

    const sessions = await Promise.all(
      Array.from(ids).map((id) => describeSession(id, flow.key)),
    );
    sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return sessions;
  })
  .get("/api/sessions/:id/stream", async ({ params, query, set }) => {
    const sessionId = params.id;
    const flowKey = typeof query.flowKey === "string" ? query.flowKey : undefined;
    set.headers["content-type"] = "text/event-stream";
    set.headers["cache-control"] = "no-cache";
    set.headers["connection"] = "keep-alive";

    // Resolve agent names → keys from the flow definition.
    const agentNameToKey = new Map<string, string>();
    let directorKey = "director";
    if (flowKey) {
      const flow = readFlow(flowKey);
      if (flow) {
        directorKey = flow.director || directorKey;
        for (const a of flow.agents) {
          agentNameToKey.set(a.name, a.key);
          agentNameToKey.set(a.key, a.key);
        }
      }
    }
    const mapEvent = makeMapper(agentNameToKey, directorKey);

    // Probe session status so we know whether to also subscribe to live events.
    let isLive = false;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      const s: any = await (anthropic as any).beta.sessions.retrieve(sessionId, {
        betas: BETAS,
      });
      isLive = mapStatus(s.status?.type ?? s.status) === "live";
    } catch {
      /* ignore — treat as historical */
    }

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        let idx = 0;
        const send = (data: unknown) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 1. Historical replay
          // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
          const page: any = await (anthropic as any).beta.sessions.events.list(
            sessionId,
            { betas: BETAS },
          );
          for await (const ev of page) {
            const mapped = mapEvent(ev, sessionId, idx++);
            if (mapped) send(mapped);
          }

          // 2. Live tail
          if (isLive) {
            // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
            const live: any = await (anthropic as any).beta.sessions.events.stream(
              sessionId,
              { betas: BETAS },
            );
            for await (const ev of live) {
              const mapped = mapEvent(ev, sessionId, idx++);
              if (mapped) send(mapped);
            }
          }

          send({ type: "__end__" });
        } catch (err) {
          send({ type: "__error__", message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: set.headers as HeadersInit });
  })
  // List files attached to a session (Anthropic Files API, scope_id = session).
  .get("/api/sessions/:id/files", async ({ params }) => {
    const sessionId = params.id;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      const page: any = await (anthropic as any).beta.files.list({
        scope_id: sessionId,
        betas: BETAS,
      });
      const out: Array<{
        id: string;
        filename: string;
        mime_type: string;
        size_bytes?: number;
        created_at: string;
      }> = [];
      for await (const f of page) {
        out.push({
          id: f.id,
          filename: f.filename ?? f.id,
          mime_type: f.mime_type ?? "application/octet-stream",
          size_bytes: f.size_bytes,
          created_at: f.created_at,
        });
      }
      return out;
    } catch (err) {
      return new Response((err as Error).message, { status: 500 });
    }
  })
  // Download a file's raw bytes (streamed back to the client).
  .get("/api/files/:id/raw", async ({ params, set }) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      const res: Response = await (anthropic as any).beta.files.download(params.id, {
        betas: BETAS,
      });
      const mime = res.headers.get("content-type") ?? "application/octet-stream";
      set.headers["content-type"] = mime;
      set.headers["cache-control"] = "private, max-age=60";
      const buf = new Uint8Array(await res.arrayBuffer());
      return new Response(buf, { headers: set.headers as HeadersInit });
    } catch (err) {
      return new Response((err as Error).message, { status: 500 });
    }
  })
  // Start a new braid run. Spawns the CLI in the background; the new
  // session id will appear via the /api/flows/:key/sessions poll within seconds.
  .post("/api/sessions", async ({ body }) => {
    const { flowKey, brief } = (body ?? {}) as {
      flowKey?: string;
      brief?: string;
    };
    if (!flowKey) return new Response("flowKey required", { status: 400 });
    if (!brief || !brief.trim())
      return new Response("brief required", { status: 400 });

    const flowName = flowKeyToPath(flowKey);
    const skillDir = resolve(BRAID_DIR, ".claude/skills/braid");
    const braidTs = resolve(skillDir, "braid.ts");
    if (!existsSync(braidTs))
      return new Response("braid.ts not found", { status: 500 });

    // Fire-and-forget. stdout/stderr piped to braid-web's stdout for visibility.
    const proc = Bun.spawn(["bun", "run", braidTs, "run", flowName, brief], {
      cwd: BRAID_DIR,
      env: { ...process.env },
      stdout: "inherit",
      stderr: "inherit",
    });
    return { ok: true, flowKey, pid: proc.pid };
  })
  // Purge a flow: archive/delete its managed-agents resources and wipe state.json.
  .post("/api/flows/:flowKey/purge", async ({ params }) => {
    const flow = readFlow(params.flowKey);
    if (!flow) return new Response("flow not found", { status: 404 });
    const statePath = resolve(
      BRAID_DIR,
      "flows",
      flowKeyToPath(params.flowKey),
      "state.json",
    );
    const state: FlowState = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : {};

    const results = { sessions: 0, agents: 0, env: 0, vaults: 0, stores: 0, errors: [] as string[] };
    const tryOp = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (err) {
        results.errors.push(`${label}: ${(err as Error).message}`);
        return false;
      }
    };

    for (const id of state.sessions ?? []) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      if (await tryOp(`session ${id}`, () => (anthropic as any).beta.sessions.delete(id, { betas: BETAS })))
        results.sessions++;
    }
    for (const id of Object.values(state.agents ?? {})) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      if (await tryOp(`agent ${id}`, () => (anthropic as any).beta.agents.archive(id, { betas: BETAS })))
        results.agents++;
    }
    for (const id of Object.values(state.stores ?? {})) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      if (await tryOp(`store ${id}`, () => (anthropic as any).beta.memoryStores.delete(id, { betas: BETAS })))
        results.stores++;
    }
    for (const id of state.vaults ?? []) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      if (await tryOp(`vault ${id}`, () => (anthropic as any).beta.vaults.delete(id, { betas: BETAS })))
        results.vaults++;
    }
    if (state.env) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK beta types are partial.
      if (await tryOp(`env ${state.env}`, () => (anthropic as any).beta.environments.delete(state.env, { betas: BETAS })))
        results.env = 1;
    }

    // Wipe state.json so a fresh `braid setup` can re-provision.
    try {
      Bun.write(statePath, "{}\n");
    } catch (err) {
      results.errors.push(`wipe state.json: ${(err as Error).message}`);
    }

    return { ok: true, flowKey: params.flowKey, results };
  })
  .listen(PORT);

console.log(`[braid-web] api ready on http://localhost:${PORT}`);
console.log(`[braid-web] BRAID_DIR=${BRAID_DIR}`);
console.log(`[braid-web] flows: ${listFlowKeys().join(", ") || "(none)"}`);
