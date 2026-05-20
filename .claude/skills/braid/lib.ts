import Anthropic from "@anthropic-ai/sdk";
import { Elysia } from "elysia";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parse, stringify } from "yaml";
import { createMemoryStore, createMemory } from "./sdk-adapter";

/**
 * Slice 40 — exported as mutable so tests can swap in a mock client.
 * Slice 80 — also swapped at module load when `BRAID_DEMO_MODE=1`, so
 * `bun run demo <flow>` runs the entire orchestrator against a deterministic
 * fake without any real Anthropic API call. The real Anthropic client is
 * never instantiated in demo mode — keys are ignored.
 *
 * Authority for the env-flag swap: Slice 80 design decision df5a6be9 and
 * security decision af93996e (refuse real API calls in demo mode).
 */
export let c: Anthropic = createInitialClient();

function createInitialClient(): Anthropic {
  if (process.env.BRAID_DEMO_MODE === "1") {
    // Dynamic require so the mock is only loaded when demo mode is active.
    // Cannot use top-level await import here because this runs synchronously
    // at module evaluation. Bun supports require() in ESM for this case.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMockAnthropic } = require("./mocks/anthropic") as typeof import("./mocks/anthropic");
    return createMockAnthropic({ demoMode: true }).client as Anthropic;
  }
  return new Anthropic();
}

/** Replace the module-level Anthropic client. For tests and demo mode. */
export function setAnthropicClient(client: Anthropic): void {
  c = client;
}
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

/**
 * NetworkingSpec mirrors the Anthropic environments `networking` block.
 * Authority: https://platform.claude.com/docs/en/managed-agents/environments
 *   "For production deployments, use `limited` networking with an explicit
 *    `allowed_hosts` list."
 */
export type NetworkingSpec =
  | { type: "unrestricted" }
  | {
      type: "limited";
      allowed_hosts: string[];
      allow_mcp_servers?: boolean;
      allow_package_managers?: boolean;
    };

/**
 * PackagesSpec mirrors the Anthropic environments `packages` block. Each
 * package manager is installed once per environment and cached across all
 * sessions that share the env (apt + npm + pip + ...). Authority:
 * https://platform.claude.com/docs/en/managed-agents/environments
 *   "Packages are installed by their respective package managers and
 *    cached across sessions that share the same environment."
 */
export type PackagesSpec = {
  apt?: string[];
  cargo?: string[];
  gem?: string[];
  go?: string[];
  npm?: string[];
  pip?: string[];
};

export type EnvironmentSpec = {
  networking?: NetworkingSpec;
  packages?: PackagesSpec;
  /**
   * When true, setup spawns a one-shot session after env creation that invokes
   * each declared package so apt/npm/pip caches materialize. Subsequent
   * sessions sharing the env reuse the cache. Defaults to true when
   * `packages` is declared; ignored otherwise. Set false to defer the install
   * cost to the first real `run`.
   */
  warm?: boolean;
};

/**
 * PostSessionHookSpec — Slice 10 §1.F2.
 *
 * A shell command executed on the host AFTER the session ends. Designed to
 * carry credentials that must never enter the agent's context (transcript,
 * brief, sandbox).
 *
 * Authoritative pattern basis:
 *   - NIST SP 800-204C "Implementation of DevSecOps for a Microservices-based
 *     Application" — build, package, and deploy are separate pipeline stages
 *     with separate credential scope.
 *   - OWASP Secrets Management Cheat Sheet — CI/CD tooling holds credentials
 *     it needs; sandboxed code does not.
 *   - CVE-2026-44479 — never pass tokens as CLI args; use env vars.
 *   - Anthropic vault docs — for in-session work, vault credentials are the
 *     only documented secret channel.
 *
 * Contract:
 *   - The hook executes on the host with a clean env. Only vars listed in
 *     `env_passthrough` are forwarded. BRAID_* context vars are always added.
 *   - The hook has `timeout_ms` to complete (default 5 minutes).
 *   - Hook stdout/stderr is captured and surfaced via the SSE event stream.
 *   - Non-zero exit code is reported but does not crash the orchestrator.
 */
export type PostSessionHookSpec = {
  /** Shell command. Use $BRAID_SESSION_ID / $BRAID_FLOW_NAME / $BRAID_OUTPUT_DIR / $BRAID_FLOW_DIR plus any env_passthrough vars. */
  command: string;
  /** Working directory. Defaults to BRAID_OUTPUT_DIR. */
  cwd?: string;
  /** Host env vars to pass through. Anything not listed is stripped. */
  env_passthrough?: string[];
  /** Hard timeout. Default 5 minutes. */
  timeout_ms?: number;
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
  environment?: EnvironmentSpec;
  run?: {
    attach_vault?: boolean;
    attach_stores?: boolean;
    stall_ms?: number;
    max_restarts?: number;
    log_runs?: boolean;
    /** Slice 20 §2.A7 — manifest-declared key from `memory_stores` used as
     * sentinel context. If unset, sentinel falls back to `projectStore`. */
    sentinel_context_store?: string;
    outcome?: {
      description: string;
      rubric_file?: string;
      max_iterations?: number;
    };
    post_session_hook?: PostSessionHookSpec;
    /** Slice 100 — automatic per-run reflection. When set, after the session
     * reaches success terminus, the named agent reads the trajectory and
     * writes pattern findings to target_store. */
    reflection?: ReflectionConfig;
  };
};

/**
 * Slice 100 — per-run reflection config.
 *
 * Authority: Slice 100 architectural decision 4dce6f31 (run.reflection block).
 * Mirrors Hermes Agent's automatic post-task reflection cycle, adapted to
 * Braid's flow.yaml + memory_stores primitives.
 */
export type ReflectionConfig = {
  /** Key into manifest.agents — which agent runs the reflection pass. */
  agent_key: string;
  /** Key into manifest.memory_stores — where pattern findings get written. */
  target_store: string;
  /** Optional override of the reflection prompt. Default invokes the agent's
   *  own system prompt (which should already be reflection-shaped). */
  instructions?: string;
};

/**
 * Slice 100 — pure decision: should reflection fire?
 *
 * Per architectural decision 4dce6f31: fire on successful session terminus
 * (session_idle without requires_action) when configured. Do not fire on
 * session_terminated (abnormal end, no useful trajectory) or watchdog
 * give-up (run failed). Failed-run reflection is a v2 concern.
 */
export type ReflectionTrigger =
  | "session_idle"
  | "session_terminated"
  | "watchdog_giveup";
export function reflectionShouldFire(
  trigger: ReflectionTrigger,
  config: ReflectionConfig | undefined,
): { fire: boolean; reason: string } {
  if (!config) return { fire: false, reason: "reflection not configured" };
  switch (trigger) {
    case "session_idle":
      return { fire: true, reason: "session ended successfully (idle)" };
    case "session_terminated":
      return { fire: false, reason: "session terminated abnormally; no useful trajectory" };
    case "watchdog_giveup":
      return { fire: false, reason: "watchdog gave up (stalled); reflection skipped" };
  }
}

export type PostSessionHookContext = {
  sessionId: string;
  flowName: string;
  flowDir: string;
  outputDir: string;
};

export type PostSessionHookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Set when the hook never ran (e.g. missing env_passthrough var). */
  error?: string;
};

/**
 * Execute a post-session hook with a strict env scope.
 *
 * Per OWASP Secrets Management ("only authorize those secrets ... required for
 * the CI/CD tooling to execute its job"), the hook receives ONLY:
 *   - `BRAID_*` context vars
 *   - vars listed in `env_passthrough`
 *   - `PATH` (so the shell can find executables)
 *
 * Notably absent: every other process.env var — including credentials for
 * other services. Least-privilege at the hook boundary.
 */
export async function runPostSessionHook(
  spec: PostSessionHookSpec,
  ctx: PostSessionHookContext,
): Promise<PostSessionHookResult> {
  const start = Date.now();
  const cwd = spec.cwd ?? ctx.outputDir;
  const timeout = spec.timeout_ms ?? 5 * 60 * 1000;

  const passthrough = spec.env_passthrough ?? [];
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    BRAID_SESSION_ID: ctx.sessionId,
    BRAID_FLOW_NAME: ctx.flowName,
    BRAID_FLOW_DIR: ctx.flowDir,
    BRAID_OUTPUT_DIR: ctx.outputDir,
    // Stable anchor for post-hooks that need to reference the skill or
    // repo files (e.g. .claude/skills/braid/post-hooks/*). Avoids brittle
    // `$BRAID_FLOW_DIR/../../...` paths that break for namespaced flows
    // like `flows/_examples/<name>/`.
    BRAID_REPO_ROOT: REPO_ROOT,
  };
  for (const key of passthrough) {
    const v = process.env[key];
    if (v === undefined) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - start,
        error: `post_session_hook env_passthrough missing on host: ${key}`,
      };
    }
    env[key] = v;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const proc = Bun.spawn(["sh", "-c", spec.command], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return {
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      error: `post_session_hook execution failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type State = {
  env?: string;
  vault?: string;
  vaults?: string[];
  agents?: Record<string, string>;
  stores?: Record<string, string>;
  sessions?: string[];
  [k: string]: unknown;
};

/**
 * Slice 20 §2.A1 — pure loader. Returns the manifest AND the resolved flow
 * directory. Callers thread `flowDir` to downstream functions explicitly.
 * `process.cwd` is never mutated.
 */
export function loadManifest(path: string): { manifest: Manifest; flowDir: string } {
  const abs = resolve(REPO_ROOT, path);
  const raw = parse(readFileSync(abs, "utf-8")) as Partial<Manifest> & { name: string };
  return { manifest: applyDefaults(raw), flowDir: dirname(abs) };
}

export function applyDefaults(m: Partial<Manifest> & { name: string }): Manifest {
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
    environment: defaultEnvironment(m.environment),
    run: m.run,
  };

  if (out.agents.length === 1 && !out.agents.some((a) => a.is_director)) {
    const first = out.agents[0];
    if (first) first.is_director = true;
  }

  out.run ??= {};
  out.run.attach_vault ??= true;
  out.run.attach_stores ??= true;
  return out;
}

/**
 * Apply safe-by-default networking config per Anthropic environments guidance.
 *
 * Default: `limited` with empty `allowed_hosts` (strictest). Flows that need
 * outbound egress MUST declare it explicitly. The default forces the author to
 * acknowledge each external surface — exactly what the principle of least
 * privilege requires.
 *
 * Authority:
 *   https://platform.claude.com/docs/en/managed-agents/environments
 *   "For production deployments, use `limited` networking with an explicit
 *    `allowed_hosts` list. Follow the principle of least privilege..."
 */
function defaultEnvironment(env: EnvironmentSpec | undefined): EnvironmentSpec {
  // Warm defaults to true when packages are declared. Authors opt out
  // explicitly with `environment.warm: false` to defer the install cost
  // to the first real run.
  const warm = env?.warm ?? (env?.packages !== undefined);
  const networking = env?.networking;
  if (!networking) {
    return {
      ...env,
      networking: {
        type: "limited",
        allowed_hosts: [],
        allow_mcp_servers: false,
        allow_package_managers: false,
      },
      warm,
    };
  }
  if (networking.type === "limited") {
    return {
      ...env,
      networking: {
        type: "limited",
        allowed_hosts: networking.allowed_hosts ?? [],
        allow_mcp_servers: networking.allow_mcp_servers ?? false,
        allow_package_managers: networking.allow_package_managers ?? false,
      },
      warm,
    };
  }
  return { ...env, networking, warm };
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

/**
 * Expand a brief by substituting `{{file:relpath}}` and `{{env:NAME}}` markers.
 *
 * `{{file:...}}` paths are sandboxed to `flowDir`:
 *   - absolute paths are rejected
 *   - `..` and any path that resolves outside `flowDir` are rejected
 * Authority: https://cwe.mitre.org/data/definitions/22.html (CWE-22), OWASP
 * Path Traversal.
 *
 * Note: `{{env:...}}` interpolation of secrets into the brief is on the F2
 * remediation list — secrets must flow through vault credentials, not the
 * brief. This function keeps `{{env:...}}` for now so non-secret env values
 * (e.g. a public URL) still resolve, but Slice 10 F2 will remove or gate it.
 */
export function expandBrief(brief: string, flowDir: string): string {
  const flowRoot = resolve(flowDir);
  return brief
    .replace(/\{\{file:([^}]+)\}\}/g, (_, rawPath: string) => {
      const requested = rawPath.trim();
      if (requested.length === 0) {
        throw new Error("brief: empty {{file:...}} path");
      }
      // Reject absolute paths (including the leading "/" form like //etc/passwd).
      if (requested.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(requested)) {
        throw new Error(
          `brief: absolute paths are not allowed in {{file:...}} — got "${requested}"`,
        );
      }
      const resolved = resolve(flowRoot, requested);
      // Prefix check + path separator boundary so `/foo` doesn't match `/foobar`.
      const rootWithSep = flowRoot.endsWith("/") ? flowRoot : flowRoot + "/";
      if (resolved !== flowRoot && !resolved.startsWith(rootWithSep)) {
        throw new Error(
          `brief: {{file:${requested}}} resolves outside flow directory (${resolved} not under ${flowRoot})`,
        );
      }
      return readFileSync(resolved, "utf-8");
    })
    .replace(/\{\{env:([^}]+)\}\}/g, (_, name: string) => {
      // F2: brief-interpolated secrets are no longer accepted. Authority:
      //   - NIST SP 800-204C: build/deploy separation; deploy credentials live
      //     in the CI/CD tooling, not in agent inputs.
      //   - OWASP Secrets Management Cheat Sheet: limit CI/CD credential scope.
      //   - CVE-2026-44479 (Vercel CLI): never pass tokens as CLI args; use env.
      //   - Anthropic vault docs + Pluto Security: any credential outside the
      //     vault is exfiltratable from the sandbox.
      // The replacement pattern is `run.post_session_hook` with an explicit
      // `env_passthrough` allowlist. The hook runs on the host after the
      // session completes — the secret never enters transcript or sandbox.
      throw new Error(
        `{{env:${name.trim()}}} is not allowed in briefs. ` +
          `Move credential-bearing work to run.post_session_hook with ` +
          `env_passthrough: ["${name.trim()}"]. ` +
          `Authority: NIST SP 800-204C, OWASP Secrets Management Cheat Sheet, ` +
          `CVE-2026-44479, https://platform.claude.com/docs/en/managed-agents/vaults`,
      );
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

/**
 * Default agent toolset injected when a flow's agent yaml declares no `tools:`.
 * Slice 10 §1.F3.
 *
 * Defaults to `permission_policy: always_ask` — Pluto Security hardening
 * guidance for Claude Managed Agents directs `always_ask` for bash/write
 * access. The platform's own default is `always_allow`, which is the pattern
 * behind OpenClaw CVE-2026-29607 / CVE-2026-28460.
 *
 * Flows that opt into `always_allow` must do so explicitly in their flow.yaml
 * with a `# rationale:` comment.
 */
export const DEFAULT_AGENT_TOOLS: ReadonlyArray<{
  type: string;
  default_config: { enabled: boolean; permission_policy: { type: string } };
}> = [
  {
    type: "agent_toolset_20260401",
    default_config: {
      enabled: true,
      permission_policy: { type: "always_ask" },
    },
  },
];

/**
 * MCP host allowlist. Slice 10 §1.F5.
 *
 * Anthropic's vault subsystem matches credentials by `mcp_server_url` at
 * session runtime but does NOT enforce a host allowlist — that responsibility
 * falls on the caller. A typo'd or compromised `flow.yaml` would otherwise
 * ship a real token to an attacker-controlled URL. The default list contains
 * the two MCP hosts the shipped flows use; extend via
 * `BRAID_MCP_ALLOWLIST=host1,host2,...`.
 *
 * Authority: https://platform.claude.com/docs/en/managed-agents/vaults
 */
const DEFAULT_MCP_ALLOWLIST: ReadonlySet<string> = new Set([
  "mcp.fal.ai",
  "mcp.vercel.com",
]);

export function validateMcpHost(rawUrl: string): void {
  // Bun-types vs node-types disagree on `URL`; bind to the constructor's
  // own instance type so the local binding matches what `new URL(...)`
  // actually returns at runtime.
  let parsed: InstanceType<typeof URL>;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`MCP URL is not a valid URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `MCP URL must use https — got "${parsed.protocol}" in "${rawUrl}"`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(
      `MCP URL must not contain userinfo (embedded credentials): "${rawUrl}"`,
    );
  }
  const override = process.env.BRAID_MCP_ALLOWLIST;
  const allow: ReadonlySet<string> = override
    ? new Set(
        override
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      )
    : DEFAULT_MCP_ALLOWLIST;
  if (!allow.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `MCP host "${parsed.hostname}" is not on the allowlist. Either add it to BRAID_MCP_ALLOWLIST or use one of: ${[...allow].join(", ")}`,
    );
  }
}

/**
 * Slice 10 §1.F7 — gate the destructive state-file wipe in `purge`.
 *
 * Pure function so it's testable without launching purge.ts. Returns a
 * decision and a human-readable reason. The caller is responsible for
 * acting on the decision (write or refuse).
 */
export function shouldWipeStateFiles(argv: readonly string[]): {
  wipe: boolean;
  reason: string;
} {
  const flags = new Set(argv);
  const interactive = flags.has("--select") || flags.has("-s");
  if (interactive) {
    return { wipe: false, reason: "interactive mode — state files left intact" };
  }
  const confirmed = flags.has("--yes") || flags.has("-y");
  if (!confirmed) {
    return {
      wipe: false,
      reason:
        "non-interactive purge refused: pass --yes to confirm wiping state files, or --select to choose interactively",
    };
  }
  return { wipe: true, reason: "non-interactive + --yes confirmed" };
}

/**
 * Tier → model mapping. Agents may declare `tier: orchestrate|reason|execute|classify`
 * in lieu of a full `model.id`; the orchestrator resolves to the current
 * pinned model id below. Explicit `model.id` always wins. Edit this map (or
 * set BRAID_MODEL_<TIER> env vars) to re-tune cost/perf globally.
 *
 * Pricing reference (Anthropic, as of plan date):
 *   opus-4-7    $5 in / $25 out per MTok — orchestrate / deep reasoning
 *   sonnet-4-6  $3 in / $15 out per MTok — reason / execute (default)
 *   haiku-4-5   $1 in / $5  out per MTok — classify / extract
 */
export const MODEL_TIER_MAP: Record<string, string> = {
  orchestrate: process.env.BRAID_MODEL_ORCHESTRATE ?? "claude-opus-4-7",
  reason:      process.env.BRAID_MODEL_REASON     ?? "claude-sonnet-4-6",
  execute:     process.env.BRAID_MODEL_EXECUTE    ?? "claude-sonnet-4-6",
  classify:    process.env.BRAID_MODEL_CLASSIFY   ?? "claude-haiku-4-5",
};

function applyTierModel(def: Record<string, unknown>): void {
  const tier = def.tier as string | undefined;
  if (!tier) return;
  delete def.tier;
  const current = def.model as { id?: string } | undefined;
  if (current?.id) return; // explicit model.id wins
  const id = MODEL_TIER_MAP[tier];
  if (!id) throw new Error(`agent.tier=${tier} not in MODEL_TIER_MAP. Known: ${Object.keys(MODEL_TIER_MAP).join(", ")}`);
  def.model = { id, speed: "standard" };
}

/**
 * Concatenate optional `system_stable` + `system_dynamic` into a single
 * `system: string` for the Managed Agents agent-create call.
 *
 * Managed Agents `/v1/agents` declares `system` as a plain string (see
 * shared/managed-agents-core.md — Agent Object). Content-block arrays with
 * `cache_control` are a Messages API construct and are rejected here with
 * `400 system: value must be a string`. Prompt caching on Managed Agents
 * is automatic: the pinned agent.system becomes the cache prefix across
 * every session that references the agent — no manual breakpoints needed.
 *
 * The split is kept in template YAML for editorial reasons (stable role +
 * rules in one block, per-instance vars in another) — we just join them
 * with a blank line before sending.
 */
function applySystemCacheSplit(def: Record<string, unknown>): void {
  const stable = def.system_stable as string | undefined;
  const dynamic = def.system_dynamic as string | undefined;
  if (!stable && !dynamic) return;
  delete def.system_stable;
  delete def.system_dynamic;
  const parts: string[] = [];
  if (stable) parts.push(stable);
  if (dynamic) parts.push(dynamic);
  def.system = parts.join("\n\n");
}

export async function ensureResources(
  manifest: Manifest,
  state: State,
  flowDir: string,
): Promise<State> {
  const fileFromFlow = (p: string) => resolve(flowDir, p);
  if (!state.env) {
    // Networking is sourced from the manifest (applyDefaults guarantees safe
    // defaults: `limited` with empty allowed_hosts). To opt into the broader
    // surface, a flow must declare `environment.networking` explicitly.
    // Authority: https://platform.claude.com/docs/en/managed-agents/environments
    const networking = manifest.environment?.networking ?? {
      type: "limited" as const,
      allowed_hosts: [],
      allow_mcp_servers: false,
      allow_package_managers: false,
    };
    const packages = manifest.environment?.packages;
    // Packages are baked into the env at create time; sessions sharing this
    // env reuse the cached install (per Anthropic environments docs).
    const config = packages
      ? { type: "cloud", networking, packages }
      : { type: "cloud", networking };
    const env = await c.beta.environments.create({
      name: manifest.env_name,
      config: config as Parameters<typeof c.beta.environments.create>[0]["config"],
    });
    state.env = env.id;
    console.log(`  env: ${env.id}`);

    // Warm the env so apt/npm/pip caches materialize at setup time rather
    // than on the first real run. Per Anthropic environments docs, packages
    // install lazily on the first session that uses the env; this spawns a
    // throwaway session that invokes each declared package so verification
    // failures surface here, not 60s into a real workload.
    if (packages && manifest.environment?.warm !== false) {
      await warmEnvironment(manifest, env.id, packages);
    }
  }

  const vaultSpecs: VaultSpec[] = [
    ...(manifest.vault ? [manifest.vault] : []),
    ...(manifest.vaults ?? []),
  ];
  state.vaults ??= [];
  if (state.vault && !state.vaults.includes(state.vault)) state.vaults.unshift(state.vault);
  const existingCount = state.vaults.length;
  for (let i = existingCount; i < vaultSpecs.length; i++) {
    const v = vaultSpecs[i]!;
    // F5: validate MCP host before issuing a token against it.
    validateMcpHost(v.credential.mcp_server_url);
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
    const store = await createMemoryStore(c, s.name);
    state.stores[s.key] = store.id;
    console.log(`  store ${s.key}: ${store.id}`);
    if (s.seed) await seedStore(manifest, state, s, store.id, flowDir);
  }

  if (manifest.run?.log_runs && !state.stores.runLog) {
    const store = await createMemoryStore(c, `${manifest.name}-runs`);
    state.stores.runLog = store.id;
    console.log(`  store runLog: ${store.id}`);
  }

  state.agents ??= {};
  for (const a of manifest.agents) {
    if (state.agents[a.key]) continue;
    const base = parse(readFileSync(fileFromFlow(a.file), "utf-8")) as Record<string, unknown>;
    const def: Record<string, unknown> = { ...base };
    applySystemCacheSplit(def);
    applyTierModel(def);
    if (a.mcp_servers) def.mcp_servers = a.mcp_servers;
    if (a.tools) def.tools = a.tools;
    if (!def.tools) def.tools = [...DEFAULT_AGENT_TOOLS];
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

  // Slice 20 §2.A1 follow-up — resolve output_dir against flowDir, not cwd.
  // The Slice 70 container surfaces this: cwd is /workspace (read-only root)
  // while flowDir/<output_dir> lands inside the mounted flows volume (rw).
  mkdirSync(resolve(flowDir, manifest.output_dir), { recursive: true });
  return state;
}

/**
 * Defense-in-depth: package names come from the flow author's flow.yaml, not
 * runtime input, but we still validate before interpolating into a shell
 * command — a malformed name in a generated/copy-pasted manifest must not
 * become a command-injection vector (CWE-78).
 *
 * Covers apt (`a-z0-9.+-`), pip (`A-Za-z0-9._-`), and npm (including scoped
 * names `@scope/name`). Names outside this set are rejected with a clear error.
 */
const PKG_NAME_RE = /^[A-Za-z0-9@][A-Za-z0-9@._+\/\-]*$/;

function assertSafePackageName(mgr: string, name: string): void {
  if (!PKG_NAME_RE.test(name)) {
    throw new Error(
      `environment.packages.${mgr}: refusing unsafe package name ${JSON.stringify(name)}. ` +
        `Allowed characters: A-Z a-z 0-9 @ . _ + / -`,
    );
  }
}

/**
 * Warm a freshly-created env by spawning a one-shot Haiku session that
 * invokes each declared package. Packages are installed lazily on first
 * session start (per Anthropic environments docs), then cached across every
 * subsequent session sharing the env. Doing this at setup time keeps the
 * first real `run` fast and surfaces install failures (wrong package name,
 * sandbox restriction) at provisioning time instead of mid-flow.
 *
 * Best-effort: a failure here logs and continues — the env still works, the
 * first real session will pay the install cost instead.
 */
async function warmEnvironment(
  manifest: Manifest,
  envId: string,
  packages: PackagesSpec,
): Promise<void> {
  const probes: string[] = [];
  for (const pkg of packages.apt ?? []) {
    assertSafePackageName("apt", pkg);
    probes.push(`dpkg -s ${pkg} >/dev/null 2>&1 && echo "apt:${pkg} OK" || { echo "apt:${pkg} MISSING"; exit 1; }`);
  }
  for (const pkg of packages.npm ?? []) {
    assertSafePackageName("npm", pkg);
    // Try normal resolution AND the pre-installed location at
    // /opt/node-tools/node_modules (where Anthropic ships Playwright et al).
    // A bare `node -e "require('${pkg}')"` from an arbitrary CWD misses the
    // pre-installed path and reports false MISSING. See SKILL.md → Browser
    // rendering with Playwright for the runtime-side counterpart.
    probes.push(
      `node -e "try{require('${pkg}')}catch(e){try{require('/opt/node-tools/node_modules/${pkg}')}catch(e2){process.exit(1)}}" 2>/dev/null && echo "npm:${pkg} OK" || { echo "npm:${pkg} MISSING"; exit 1; }`,
    );
  }
  for (const pkg of packages.pip ?? []) {
    assertSafePackageName("pip", pkg);
    probes.push(`python3 -c "import ${pkg}" >/dev/null 2>&1 && echo "pip:${pkg} OK" || { echo "pip:${pkg} MISSING"; exit 1; }`);
  }
  // gem/cargo/go have no universal "is installed" probe across all package
  // shapes (binary vs library, scoped vs unscoped). Skip explicit verification
  // for those — opening the session is enough to materialize the cache.
  if (probes.length === 0) return;

  console.log(`  warming env (${probes.length} package probe${probes.length === 1 ? "" : "s"})...`);
  const warmer = await c.beta.agents.create({
    name: `${manifest.name}-warmup`,
    model: "claude-haiku-4-5",
    system:
      "Run each bash command exactly as given and report the result. Do not improvise, edit, or skip any command.",
    tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
  } as Parameters<typeof c.beta.agents.create>[0]);

  let sessionId: string | undefined;
  try {
    const session = await c.beta.sessions.create({
      agent: warmer.id,
      environment_id: envId,
    } as Parameters<typeof c.beta.sessions.create>[0]);
    sessionId = session.id;

    const stream = await c.beta.sessions.events.stream(session.id);
    await c.beta.sessions.events.send(session.id, {
      events: [{
        type: "user.message",
        content: [{ type: "text", text: `Run these and report any failures:\n\n${probes.join("\n")}` }],
      }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
    for await (const e of stream) {
      if (e.type === "session.status_idle" || e.type === "session.status_terminated") break;
    }
    console.log(`  warmed env: ${envId}`);
  } catch (err) {
    // Best-effort — first real run will install instead.
    console.warn(`  warmup failed (env still usable, first run will install): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (sessionId) await c.beta.sessions.archive(sessionId).catch(() => {});
    await c.beta.agents.archive(warmer.id).catch(() => {});
  }
}

async function seedStore(
  manifest: Manifest,
  state: State,
  spec: MemoryStoreSpec,
  storeId: string,
  flowDir: string,
) {
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
    `=== ${spec.seed!.mount}/${f.split("/").pop()} ===\n${readFileSync(resolve(flowDir, f), "utf-8")}`,
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

/**
 * Slice 20 §2.A8 — non-destructive write for `pull`.
 *
 * - `dryRun: true` returns the would-be content without writing.
 * - Normal write makes a `.bak` of the existing file before overwriting so
 *   the operator can recover if the remote drift was unintended.
 * - No-op when the content is byte-identical (no spurious backup).
 */
export type WriteAgentSpecResult = {
  wrote: boolean;
  reason?: string;
  backup?: string;
  would_write?: string;
};

export function writeAgentSpec(
  filePath: string,
  content: string,
  opts: { dryRun?: boolean } = {},
): WriteAgentSpecResult {
  if (opts.dryRun) {
    return { wrote: false, would_write: content };
  }
  if (existsSync(filePath)) {
    const current = readFileSync(filePath, "utf-8");
    if (current === content) {
      return { wrote: false, reason: "content identical — unchanged" };
    }
    const backup = `${filePath}.bak`;
    writeFileSync(backup, current);
    writeFileSync(filePath, content);
    return { wrote: true, backup };
  }
  writeFileSync(filePath, content);
  return { wrote: true };
}

export async function pullAgents(
  manifest: Manifest,
  state: State,
  flowDir: string,
  keys?: string[],
  opts: { dryRun?: boolean } = {},
): Promise<{ key: string; file: string; version: number; wrote: boolean; backup?: string }[]> {
  if (!state.agents) throw new Error("no agents in state — run setup first");
  const targets = manifest.agents.filter((a) =>
    keys && keys.length > 0 ? keys.includes(a.key) : true,
  );
  if (keys && keys.length > 0) {
    const unknown = keys.filter((k) => !manifest.agents.find((a) => a.key === k));
    if (unknown.length) throw new Error(`unknown agent key(s): ${unknown.join(", ")}`);
  }

  const results: { key: string; file: string; version: number; wrote: boolean; backup?: string }[] = [];
  for (const a of targets) {
    const id = state.agents[a.key];
    if (!id) {
      console.log(`  skip ${a.key}: no id in state`);
      continue;
    }
    const remote = (await c.beta.agents.retrieve(id)) as unknown as Record<string, unknown>;
    const spec: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(remote)) {
      if (PULL_STRIP.has(k)) continue;
      if (v === null || v === undefined) continue;
      spec[k] = v;
    }
    const filePath = resolve(flowDir, a.file);
    const content = stringify(spec, { lineWidth: 0 });
    const write = writeAgentSpec(filePath, content, opts);
    const version = (remote.version as number) ?? 0;
    results.push({
      key: a.key,
      file: a.file,
      version,
      wrote: write.wrote,
      ...(write.backup ? { backup: write.backup } : {}),
    });
    if (opts.dryRun) {
      console.log(`  [dry-run] ${a.key} -> ${a.file}  (v${version}) — would write ${content.length} bytes`);
    } else if (write.wrote) {
      const bak = write.backup ? ` (backup: ${a.file}.bak)` : "";
      console.log(`  ✓ ${a.key} -> ${a.file}  (v${version})${bak}`);
    } else {
      console.log(`  · ${a.key} -> ${a.file}  (v${version}) ${write.reason ?? "no change"}`);
    }
  }
  return results;
}

/**
 * Slice 50 — pure exponential backoff sequence.
 *
 * Returns `attempts` delays, doubling each time, capped at `capMs`. Used by
 * the reconnect loop in braid.ts so a flaky stream doesn't get hammered nor
 * silently abandoned after one retry.
 */
export function backoffDelays(attempts: number, baseMs: number, capMs: number): number[] {
  if (attempts < 0) throw new Error("backoffDelays: attempts must be non-negative");
  const out: number[] = [];
  let d = baseMs;
  for (let i = 0; i < attempts; i++) {
    out.push(Math.min(d, capMs));
    d *= 2;
  }
  return out;
}

/**
 * Slice 50 — structured JSON-line logger.
 *
 * One line per call: `{"ts":"…","level":"info|warn|error","event":"…","payload":…}`.
 * Lines are terminated with `\n` so log streams stay line-delimited.
 *
 * The caller supplies a writer so tests can capture without touching
 * `process.stdout`. In production, the writer is typically a wrapper around
 * `process.stdout.write`.
 */
export type LogLevel = "info" | "warn" | "error";
export type Logger = {
  info: (event: string, payload?: unknown) => void;
  warn: (event: string, payload?: unknown) => void;
  error: (event: string, payload?: unknown) => void;
};
export function createLogger(writer: (line: string) => void): Logger {
  const emit = (level: LogLevel, event: string, payload?: unknown) => {
    const entry: { ts: string; level: LogLevel; event: string; payload?: unknown } = {
      ts: new Date().toISOString(),
      level,
      event,
    };
    if (payload !== undefined) entry.payload = payload;
    writer(JSON.stringify(entry) + "\n");
  };
  return {
    info: (event, payload) => emit("info", event, payload),
    warn: (event, payload) => emit("warn", event, payload),
    error: (event, payload) => emit("error", event, payload),
  };
}

/**
 * Slice 20 §2.A5 — pure truncation. Returns the new kept list (newest first)
 * AND the dropped ids so the caller can clean them up at the remote side.
 */
export function truncateSessionHistory(
  newId: string,
  prior: readonly string[],
  maxKeep: number,
): { kept: string[]; dropped: string[] } {
  const merged = [newId, ...prior.filter((id) => id !== newId)];
  return {
    kept: merged.slice(0, maxKeep),
    dropped: merged.slice(maxKeep),
  };
}

/**
 * Slice 20 §2.A7 — resolve the sentinel's context-store id.
 *
 * Precedence:
 *   1. `manifest.run.sentinel_context_store` (explicit, manifest-declared).
 *      If the manifest names a key that isn't in state, return undefined
 *      (do NOT fall back) so a misconfigured flow surfaces as missing-context
 *      rather than silently attaching the wrong store.
 *   2. `state.stores.projectStore` (backwards compat with the `ad` flow).
 *   3. undefined — sentinel runs without context.
 */
export function sentinelStoreId(
  manifest: Manifest,
  state: State,
): string | undefined {
  const declared = manifest.run?.sentinel_context_store;
  if (declared !== undefined) {
    return state.stores?.[declared];
  }
  return state.stores?.projectStore;
}

/**
 * Slice 20 §2.A3 — watchdog decision logic, extracted as a pure function so
 * the callback's behavior is testable without setInterval orchestration.
 *
 * The integration in braid.ts adds a `cancelled` closure flag that the async
 * callback checks at each await boundary; passing `cancelled: true` short-
 * circuits the decision to `none`. This closes the cancel-race window where
 * `clearInterval` doesn't cancel an already-in-flight async callback.
 */
export type WatchdogAction = "none" | "fire_sentinel" | "restart" | "give_up";
export function watchdogDecide(input: {
  cancelled: boolean;
  sentinelFired: boolean;
  silenceMs: number;
  stallMs: number;
  restartCount: number;
  maxRestarts: number;
}): { action: WatchdogAction; silenceSec: number } {
  const silenceSec = Math.round(input.silenceMs / 1000);
  if (input.cancelled) return { action: "none", silenceSec };
  if (input.silenceMs < input.stallMs) return { action: "none", silenceSec };
  if (!input.sentinelFired) return { action: "fire_sentinel", silenceSec };
  if (input.silenceMs > input.stallMs * 2) {
    return input.restartCount < input.maxRestarts
      ? { action: "restart", silenceSec }
      : { action: "give_up", silenceSec };
  }
  return { action: "none", silenceSec };
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
    } catch (err) {
      // Slice 20 §2.A2 — log the failure so the user sees WHY resume fell
      // back to creating a new session. Common causes: session deleted,
      // 404 from Anthropic, network error.
      console.log(
        `[resume] could not resume ${resumeId} (${(err as Error).message}); creating new session`,
      );
    }
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
  // Slice 20 §2.A5 — truncate locally AND clean up dropped sessions
  // remotely so they don't orphan-accrue cost.
  const { kept, dropped } = truncateSessionHistory(session.id, state.sessions ?? [], 20);
  state.sessions = kept;
  for (const droppedId of dropped) {
    // Fire-and-forget; we don't block session creation on cleanup. Errors
    // are logged so failures (already-deleted, network) are diagnosable.
    c.beta.sessions.delete(droppedId).catch((err: unknown) => {
      console.log(`[truncate] failed to delete dropped session ${droppedId}: ${(err as Error).message}`);
    });
  }
  return { session, resumed: false };
}

/**
 * Slice 20 §2.A6 — interrupt + delete the predecessor session when the
 * orchestrator restarts. Without this, the abandoned session times out
 * eventually but remains chargeable until then.
 *
 * Fire-and-forget; the restart proceeds regardless of cleanup success.
 */
export async function cleanupAbandonedSession(sessionId: string): Promise<void> {
  try {
    await c.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.interrupt" }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
  } catch (err) {
    console.log(`[cleanup] interrupt failed for ${sessionId}: ${(err as Error).message}`);
  }
  try {
    await c.beta.sessions.delete(sessionId);
  } catch (err) {
    console.log(`[cleanup] delete failed for ${sessionId}: ${(err as Error).message}`);
  }
}

export function buildInitialEvents(manifest: Manifest, brief: string, flowDir: string) {
  const events: unknown[] = [
    { type: "user.message", content: [{ type: "text", text: brief }] },
  ];
  if (manifest.run?.outcome) {
    const o = manifest.run.outcome;
    const rubric = o.rubric_file ? readFileSync(resolve(flowDir, o.rubric_file), "utf-8") : o.description;
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
      // Use Uint8Array directly so Bun's stricter writeFileSync types accept
      // the buffer without a Node-vs-Bun ArrayBufferView mismatch.
      const buf = new Uint8Array(await (await c.beta.files.download(f.id)).arrayBuffer());
      const outPath = `${outDir}/${fname}`;
      // Files API filenames may include subdirectories (e.g. "site/index.html"
      // when the agent wrote to /mnt/session/outputs/site/). Create the
      // parent dir before writing so subdir structure is preserved.
      if (fname.includes("/")) {
        const parent = outPath.slice(0, outPath.lastIndexOf("/"));
        mkdirSync(parent, { recursive: true });
      }
      writeFileSync(outPath, buf);
      emit("saved", outPath);
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
    await createMemory(c, storeId, { path, content });
    return path;
  } catch (err) {
    console.error(`[runLog] write failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Slice 100 — per-run reflection orchestrator.
 *
 * Runs after a successful session terminus. Spawns a brief Anthropic session
 * against the reflector agent with read_write access to the target_store,
 * sends the trajectory + outcome (NEVER the saved-file contents per security
 * decision 50381fee — patterns only), captures the reflector's pattern
 * output, and persists it to the target_store via memoryStores.memories.create.
 *
 * Returns { ok, storedPath?, error?, durationMs } so the caller can emit
 * structured events without trying to throw.
 *
 * Authority:
 *   - Slice 100 architectural decision 4dce6f31
 *   - Slice 100 security decision 50381fee (patterns only)
 *   - Hermes Agent reflection cycle (https://hermes-agent.nousresearch.com)
 */
export type RunReflectionResult = {
  ok: boolean;
  storedPath?: string;
  patternText?: string;
  error?: string;
  durationMs: number;
};

export async function runReflection(
  manifest: Manifest,
  state: State,
  sessionId: string,
  agentReport: string,
  outcome: { result?: unknown; note?: string } | null,
  savedFiles: string[] = [],
): Promise<RunReflectionResult> {
  const start = Date.now();
  const cfg = manifest.run?.reflection;
  if (!cfg) {
    return { ok: false, error: "reflection not configured", durationMs: 0 };
  }
  const agentId = state.agents?.[cfg.agent_key];
  if (!agentId) {
    return {
      ok: false,
      error: `reflection agent '${cfg.agent_key}' not provisioned in state`,
      durationMs: Date.now() - start,
    };
  }
  const storeId = state.stores?.[cfg.target_store];
  if (!storeId) {
    return {
      ok: false,
      error: `reflection target_store '${cfg.target_store}' not provisioned in state`,
      durationMs: Date.now() - start,
    };
  }

  try {
    const sess = await c.beta.sessions.create({
      agent: agentId,
      environment_id: state.env!,
      resources: [
        {
          type: "memory_store",
          memory_store_id: storeId,
          access: "read_write",
          instructions: cfg.instructions ?? "Write reusable patterns from this run as a short markdown note. Do NOT quote file contents or the brief verbatim — summarize only.",
        },
      ],
    } as Parameters<typeof c.beta.sessions.create>[0]);

    // Security decision 50381fee: send agentReport + outcome + file LIST
    // (filenames only). Truncate agentReport to keep token budget bounded.
    const trajectory = [
      `Session: ${sessionId}`,
      `Outcome: ${JSON.stringify(outcome ?? { result: "unknown" })}`,
      `Saved deliverables (filenames only, contents not included): ${savedFiles.length ? savedFiles.join(", ") : "(none)"}`,
      "",
      "Agent report (truncated):",
      agentReport.slice(0, 6000),
    ].join("\n");

    const stream = await c.beta.sessions.events.stream(sess.id);
    await c.beta.sessions.events.send(sess.id, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: trajectory }],
        },
      ] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });

    let patternText = "";
    for await (const e of stream) {
      if (e.type === "agent.message") {
        patternText += (e as { content: Array<{ type: string; text?: string }> }).content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      }
      if (e.type === "session.status_idle" || e.type === "session.status_terminated") break;
    }

    if (!patternText.trim()) {
      return {
        ok: false,
        error: "reflection produced no pattern text",
        durationMs: Date.now() - start,
      };
    }

    // Memory paths MUST start with `/` per the Managed Agents memory API
    // (`memories.create` returns 400 "path: value does not match" otherwise).
    const path = `/reflections/${new Date().toISOString().slice(0, 10)}-${sessionId.slice(-8)}.md`;
    await createMemory(c, storeId, { path, content: patternText });

    return {
      ok: true,
      storedPath: path,
      patternText,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      error: `reflection failed: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
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
    // Slice 20 §2.A7 — context store is manifest-declared (falls back to
    // `projectStore` for backwards-compat with the `ad` flow).
    const contextStoreId = sentinelStoreId(manifest, state);
    const sess = await c.beta.sessions.create({
      agent: sentinelId,
      environment_id: state.env!,
      ...(contextStoreId
        ? {
            resources: [{
              type: "memory_store",
              memory_store_id: contextStoreId,
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
