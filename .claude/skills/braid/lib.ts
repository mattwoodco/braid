import Anthropic from "@anthropic-ai/sdk";
import { Elysia } from "elysia";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parse, stringify } from "yaml";

export const c = new Anthropic();
const enc = new TextEncoder();
export const REPO_ROOT = process.cwd();

export type AgentSpec = {
  key: string;
  file: string;
  coordinator?: string[];
  is_director?: boolean;
  mcp_servers?: unknown[];
  tools?: unknown[];
};

export type VaultSpec = {
  display_name: string;
  credential: {
    display_name: string;
    mcp_server_url: string;
    token_env: string;
  };
};

export type MemoryStoreSpec = {
  key: string;
  name: string;
  access?: "read_only" | "read_write";
  instructions?: string;
  seed?: { mount: string; files: string[] };
  dream_instructions?: string;
};

export type Manifest = {
  name: string;
  env_name: string;
  state_file: string;
  output_dir: string;
  brief_default?: string;
  vault?: VaultSpec;
  vaults?: VaultSpec[];
  memory_stores?: MemoryStoreSpec[];
  agents: AgentSpec[];
  sentinel_key?: string;
  run?: {
    attach_vault?: boolean;
    attach_stores?: boolean;
    stall_ms?: number;
    max_restarts?: number;
    log_runs?: boolean;
    outcome?: {
      description: string;
      rubric_file?: string;
      max_iterations?: number;
    };
  };
};

export type State = {
  env?: string;
  vault?: string;
  vaults?: string[];
  agents?: Record<string, string>;
  stores?: Record<string, string>;
  sessions?: string[];
  [k: string]: unknown;
};

export function loadManifest(path: string): Manifest {
  const abs = resolve(REPO_ROOT, path);
  const raw = parse(readFileSync(abs, "utf-8")) as Partial<Manifest> & { name: string };
  process.chdir(dirname(abs));
  return applyDefaults(raw);
}

function applyDefaults(m: Partial<Manifest> & { name: string }): Manifest {
  if (!m.name) throw new Error("flow.yaml: `name` is required");
  const name = m.name;
  const out: Manifest = {
    name,
    env_name: m.env_name ?? `braid-${name}`,
    state_file: m.state_file ?? "state.json",
    output_dir: m.output_dir ?? `outputs/${name}`,
    brief_default: m.brief_default,
    vault: m.vault,
    vaults: m.vaults,
    memory_stores: m.memory_stores,
    agents: m.agents ?? [],
    sentinel_key: m.sentinel_key,
    run: m.run,
  };

  if (out.agents.length === 1 && !out.agents.some((a) => a.is_director)) {
    out.agents[0].is_director = true;
  }

  out.run ??= {};
  out.run.attach_vault ??= true;
  out.run.attach_stores ??= true;
  return out;
}

export function listFlows(): string[] {
  const dir = resolve(REPO_ROOT, "flows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, "flow.yaml")))
    .map((e) => e.name)
    .sort();
}

export function loadState(file: string): State {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf-8")) as State;
}

export function saveState(file: string, state: State) {
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function expandBrief(brief: string): string {
  return brief
    .replace(/\{\{file:([^}]+)\}\}/g, (_, p) => readFileSync(p.trim(), "utf-8"))
    .replace(/\{\{env:([^}]+)\}\}/g, (_, name) => {
      const v = process.env[name.trim()];
      if (!v) throw new Error(`brief references missing env var: ${name.trim()}`);
      return v;
    });
}

export function startSseServer(portArg?: number) {
  const logs: string[] = [];
  let done = false;

  const emit = (type: string, payload: unknown) => {
    const line = JSON.stringify({ type, payload });
    logs.push(line);
    const preview =
      typeof payload === "string" ? payload.slice(0, 120) : JSON.stringify(payload).slice(0, 120);
    process.stdout.write(`[${type}] ${preview}\n`);
  };

  // Pick port. Priority: explicit arg → $BRAID_SSE_PORT → 0 (let OS pick a free one).
  // Falling back to 0 prevents EADDRINUSE silent failures when multiple `braid run`
  // processes are concurrent (e.g. parallel worktrees).
  const requested = portArg ?? (process.env.BRAID_SSE_PORT ? Number(process.env.BRAID_SSE_PORT) : 0);

  const app = new Elysia()
    .get("/stream", () =>
      new Response(
        new ReadableStream({
          async start(ctrl) {
            let i = 0;
            while (true) {
              while (i < logs.length) ctrl.enqueue(enc.encode(`data: ${logs[i++]}\n\n`));
              if (done) { ctrl.close(); break; }
              await Bun.sleep(100);
            }
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      ),
    )
    .listen(requested);

  const boundPort = (app.server?.port as number | undefined) ?? requested;
  emit("ready", `http://localhost:${boundPort}/stream`);
  return { emit, stop: () => { done = true; setTimeout(() => app.stop(), 500); } };
}

export async function ensureResources(manifest: Manifest, state: State): Promise<State> {
  if (!state.env) {
    const env = await c.beta.environments.create({
      name: manifest.env_name,
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    state.env = env.id;
    console.log(`  env: ${env.id}`);
  }

  const vaultSpecs: VaultSpec[] = [
    ...(manifest.vault ? [manifest.vault] : []),
    ...(manifest.vaults ?? []),
  ];
  state.vaults ??= [];
  if (state.vault && !state.vaults.includes(state.vault)) state.vaults.unshift(state.vault);
  const existingCount = state.vaults.length;
  for (let i = existingCount; i < vaultSpecs.length; i++) {
    const v = vaultSpecs[i];
    const token = process.env[v.credential.token_env];
    if (!token) throw new Error(`Missing env var: ${v.credential.token_env}`);
    const vault = await c.beta.vaults.create({ display_name: v.display_name });
    await c.beta.vaults.credentials.create(vault.id, {
      display_name: v.credential.display_name,
      auth: {
        type: "static_bearer",
        mcp_server_url: v.credential.mcp_server_url,
        token,
      },
    } as Parameters<typeof c.beta.vaults.credentials.create>[1]);
    state.vaults.push(vault.id);
    if (!state.vault) state.vault = vault.id;
    console.log(`  vault ${v.display_name}: ${vault.id}`);
  }

  state.stores ??= {};
  for (const s of manifest.memory_stores ?? []) {
    if (state.stores[s.key]) continue;
    const store = await (c.beta as unknown as {
      memoryStores: { create: (args: { name: string }) => Promise<{ id: string }> };
    }).memoryStores.create({ name: s.name });
    state.stores[s.key] = store.id;
    console.log(`  store ${s.key}: ${store.id}`);
    if (s.seed) await seedStore(manifest, state, s, store.id);
  }

  if (manifest.run?.log_runs && !state.stores.runLog) {
    const store = await (c.beta as unknown as {
      memoryStores: { create: (args: { name: string }) => Promise<{ id: string }> };
    }).memoryStores.create({ name: `${manifest.name}-runs` });
    state.stores.runLog = store.id;
    console.log(`  store runLog: ${store.id}`);
  }

  state.agents ??= {};
  for (const a of manifest.agents) {
    if (state.agents[a.key]) continue;
    const base = parse(readFileSync(a.file, "utf-8")) as Record<string, unknown>;
    const def: Record<string, unknown> = { ...base };
    if (a.mcp_servers) def.mcp_servers = a.mcp_servers;
    if (a.tools) def.tools = a.tools;
    if (!def.tools) def.tools = [{ type: "agent_toolset_20260401", default_config: { enabled: true } }];
    if (a.coordinator) {
      def.multiagent = {
        type: "coordinator",
        agents: a.coordinator.map((k) => {
          const id = state.agents![k];
          if (!id) throw new Error(`Coordinator references unknown agent: ${k}`);
          return { type: "agent", id };
        }),
      };
    }
    const agent = await c.beta.agents.create(def as unknown as Parameters<typeof c.beta.agents.create>[0]);
    state.agents[a.key] = agent.id;
    console.log(`  agent ${a.key}: ${agent.id}`);
  }

  mkdirSync(manifest.output_dir, { recursive: true });
  return state;
}

async function seedStore(manifest: Manifest, state: State, spec: MemoryStoreSpec, storeId: string) {
  if (!spec.seed) return;
  const seeder = await c.beta.agents.create({
    name: `${manifest.name}-seeder`,
    model: "claude-haiku-4-5",
    system: "Write files to the memory store exactly as instructed. No commentary.",
    tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
  } as Parameters<typeof c.beta.agents.create>[0]);

  const session = await c.beta.sessions.create({
    agent: seeder.id,
    environment_id: state.env!,
    resources: [{
      type: "memory_store",
      memory_store_id: storeId,
      access: "read_write",
      instructions: "Write the seed files here.",
    }],
  } as Parameters<typeof c.beta.sessions.create>[0]);

  const blocks = spec.seed.files.map((f) =>
    `=== ${spec.seed!.mount}/${f.split("/").pop()} ===\n${readFileSync(f, "utf-8")}`,
  ).join("\n\n");

  const stream = await c.beta.sessions.events.stream(session.id);
  await c.beta.sessions.events.send(session.id, {
    events: [{
      type: "user.message",
      content: [{ type: "text", text: `Write these files to ${spec.seed.mount}/:\n\n${blocks}` }],
    }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
  });
  for await (const e of stream) {
    if (e.type === "session.status_idle" || e.type === "session.status_terminated") break;
  }
  console.log(`    seeded ${spec.key}`);
}

const PULL_STRIP = new Set([
  "id",
  "version",
  "created_at",
  "updated_at",
  "archived_at",
  "type",
  "object",
]);

export async function pullAgents(
  manifest: Manifest,
  state: State,
  keys?: string[],
): Promise<{ key: string; file: string; version: number }[]> {
  if (!state.agents) throw new Error("no agents in state — run setup first");
  const targets = manifest.agents.filter((a) =>
    keys && keys.length > 0 ? keys.includes(a.key) : true,
  );
  if (keys && keys.length > 0) {
    const unknown = keys.filter((k) => !manifest.agents.find((a) => a.key === k));
    if (unknown.length) throw new Error(`unknown agent key(s): ${unknown.join(", ")}`);
  }

  const results: { key: string; file: string; version: number }[] = [];
  for (const a of targets) {
    const id = state.agents[a.key];
    if (!id) {
      console.log(`  skip ${a.key}: no id in state`);
      continue;
    }
    const remote = (await c.beta.agents.retrieve(id)) as Record<string, unknown>;
    const spec: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(remote)) {
      if (PULL_STRIP.has(k)) continue;
      if (v === null || v === undefined) continue;
      spec[k] = v;
    }
    writeFileSync(a.file, stringify(spec, { lineWidth: 0 }));
    const version = (remote.version as number) ?? 0;
    results.push({ key: a.key, file: a.file, version });
    console.log(`  ✓ ${a.key} -> ${a.file}  (v${version})`);
  }
  return results;
}

export function directorOf(manifest: Manifest): AgentSpec {
  const d = manifest.agents.find((a) => a.is_director);
  if (!d) throw new Error("manifest has no agent with is_director: true");
  return d;
}

export function buildResources(manifest: Manifest, state: State) {
  return (manifest.memory_stores ?? [])
    .filter((s) => state.stores?.[s.key])
    .map((s) => ({
      type: "memory_store" as const,
      memory_store_id: state.stores![s.key],
      access: s.access ?? "read_write",
      instructions: s.instructions ?? "",
    }));
}

export async function createOrResumeSession(
  manifest: Manifest,
  state: State,
  resumeId?: string,
): Promise<{ session: { id: string }; resumed: boolean }> {
  if (resumeId) {
    try {
      const existing = await c.beta.sessions.retrieve(resumeId) as { id: string; status: string };
      if (existing.status === "running") return { session: existing, resumed: true };
    } catch {}
  }
  const director = directorOf(manifest);
  const directorId = state.agents?.[director.key];
  if (!directorId) throw new Error("director agent not in state — run setup first");
  const session = await c.beta.sessions.create({
    agent: directorId,
    environment_id: state.env!,
    ...(manifest.run?.attach_vault && (state.vaults?.length || state.vault)
      ? { vault_ids: state.vaults?.length ? state.vaults : [state.vault!] }
      : {}),
    ...(manifest.run?.attach_stores !== false && manifest.memory_stores
      ? { resources: buildResources(manifest, state) }
      : {}),
  } as Parameters<typeof c.beta.sessions.create>[0]);
  state.sessions = [session.id, ...(state.sessions ?? []).filter((id) => id !== session.id)].slice(0, 20);
  return { session, resumed: false };
}

export function buildInitialEvents(manifest: Manifest, brief: string) {
  const events: unknown[] = [
    { type: "user.message", content: [{ type: "text", text: brief }] },
  ];
  if (manifest.run?.outcome) {
    const o = manifest.run.outcome;
    const rubric = o.rubric_file ? readFileSync(o.rubric_file, "utf-8") : o.description;
    events.push({
      type: "user.define_outcome",
      description: o.description,
      rubric: { type: "text", content: rubric },
      max_iterations: o.max_iterations ?? 3,
    });
  }
  return events;
}

export async function downloadSessionFiles(sessionId: string, outDir: string, emit: (t: string, p: unknown) => void): Promise<string[]> {
  const saved: string[] = [];
  try {
    const files = await c.beta.files.list({
      scope_id: sessionId,
      betas: ["managed-agents-2026-04-01"],
    } as Parameters<typeof c.beta.files.list>[0]);
    for (const f of files.data) {
      const fname = (f as { filename?: string }).filename ?? f.id;
      const buf = Buffer.from(await (await c.beta.files.download(f.id)).arrayBuffer());
      writeFileSync(`${outDir}/${fname}`, buf);
      emit("saved", `${outDir}/${fname}`);
      saved.push(fname);
    }
  } catch {
    emit("info", "no session files to download");
  }
  return saved;
}

export async function appendRunLog(
  manifest: Manifest,
  state: State,
  sessionId: string,
  brief: string,
  agentReport: string,
  outcome: { result?: unknown; note?: string } | null,
  savedFiles: string[],
): Promise<string | null> {
  const storeId = state.stores?.runLog;
  if (!storeId) return null;
  const date = new Date().toISOString();
  const path = `/runs/${date.slice(0, 10)}-${sessionId.slice(-8)}.md`;
  const content = `# ${manifest.name} run ${sessionId}
date: ${date}

## Brief
${brief}

## Outcome
${outcome ? `result: ${JSON.stringify(outcome.result)}\nnote: ${outcome.note ?? ""}` : "(none)"}

## Deliverables
${savedFiles.length ? savedFiles.map((f) => `- ${f}`).join("\n") : "(none)"}

## Agent report
${agentReport.slice(0, 8000)}
`;
  try {
    await (c.beta as unknown as {
      memoryStores: { memories: { create: (storeId: string, args: { path: string; content: string }) => Promise<{ id: string }> } };
    }).memoryStores.memories.create(storeId, { path, content });
    return path;
  } catch (err) {
    console.error(`[runLog] write failed: ${(err as Error).message}`);
    return null;
  }
}

export async function runSentinel(
  manifest: Manifest,
  state: State,
  brief: string,
  directorSessionId: string,
  silenceSec: number,
  emit: (t: string, p: unknown) => void,
): Promise<string | null> {
  const sentinelId = manifest.sentinel_key ? state.agents?.[manifest.sentinel_key] : undefined;
  if (!sentinelId) return null;
  try {
    const projectStoreId = state.stores?.projectStore;
    const sess = await c.beta.sessions.create({
      agent: sentinelId,
      environment_id: state.env!,
      ...(projectStoreId
        ? {
            resources: [{
              type: "memory_store",
              memory_store_id: projectStoreId,
              access: "read_only",
              instructions: "Director's project state. Read decisions.md to assess progress.",
            }],
          }
        : {}),
    } as Parameters<typeof c.beta.sessions.create>[0]);
    const stream = await c.beta.sessions.events.stream(sess.id);
    await c.beta.sessions.events.send(sess.id, {
      events: [{
        type: "user.message",
        content: [{
          type: "text",
          text: `Director session ${directorSessionId} has been silent for ${silenceSec}s.\nBrief: "${brief}"\nDiagnose what's stuck and return JSON.`,
        }],
      }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
    let raw = "";
    for await (const e of stream) {
      if (e.type === "agent.message") {
        raw += (e as { content: Array<{ type: string; text?: string }> }).content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      }
      if (e.type === "session.status_idle" || e.type === "session.status_terminated") break;
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return raw.trim() || null;
    const parsed = JSON.parse(match[0]) as { recovery_message?: string; diagnosis?: string };
    if (parsed.diagnosis) emit("sentinel", `diagnosis: ${parsed.diagnosis}`);
    return parsed.recovery_message ?? null;
  } catch (err) {
    emit("sentinel", `error: ${(err as Error).message}`);
    return null;
  }
}
