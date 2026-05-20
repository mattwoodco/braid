import { mkdirSync, existsSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { dirname as _d } from "path";
import { fileURLToPath as _f } from "url";
const _SKILL = _d(_f(import.meta.url));
if (!existsSync(`${_SKILL}/node_modules`)) {
  console.error(
    "[braid] Missing deps. Run: cd .claude/skills/braid && bun install",
  );
  process.exit(1);
}
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import {
  c,
  REPO_ROOT,
  listFlows,
  loadManifest,
  loadState,
  saveState,
  ensureResources,
  pullAgents,
  createOrResumeSession,
  buildInitialEvents,
  downloadSessionFiles,
  expandBrief,
  runSentinel,
  startSseServer,
  appendRunLog,
  runPostSessionHook,
  watchdogDecide,
  cleanupAbandonedSession,
  backoffDelays,
  reflectionShouldFire,
  runReflection,
  type ReflectionTrigger,
} from "./lib";
import { instantiateTemplate, listTemplates, loadTemplate, parseVarsArg } from "./lib-template";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const [, , cmd, ...rest] = process.argv;

function flowPath(name: string) {
  if (name.endsWith(".yaml")) return name;
  // A name containing `/` is a namespaced path under flows/, e.g.
  // `_examples/foo` -> `flows/_examples/foo/flow.yaml`. This lets us hide
  // reference flows from the default `braid list` while keeping them
  // setup-able and run-able via the namespaced id.
  return `flows/${name}/flow.yaml`;
}

async function setup(flowName: string) {
  const { manifest, flowDir } = loadManifest(flowPath(flowName));
  const state = loadState(resolve(flowDir, manifest.state_file));
  console.log(`setting up ${manifest.name}...`);
  await ensureResources(manifest, state, flowDir);
  saveState(resolve(flowDir, manifest.state_file), state);
  console.log(`\nstate -> ${manifest.state_file}`);
}

async function run(flowName: string, briefArg?: string, resumeId?: string) {
  const { manifest, flowDir } = loadManifest(flowPath(flowName));
  const state = loadState(resolve(flowDir, manifest.state_file));
  if (!state.env) throw new Error(`No state in ${manifest.state_file} — run: braid setup ${flowName}`);

  const brief = expandBrief(briefArg ?? manifest.brief_default ?? "", flowDir);
  if (!brief) throw new Error("no brief provided and no brief_default in manifest");

  const { emit, stop } = startSseServer();
  emit("brief", brief.slice(0, 200));

  const { session, resumed } = await createOrResumeSession(manifest, state, resumeId);
  saveState(resolve(flowDir, manifest.state_file), state);
  emit(resumed ? "resumed" : "session", session.id);

  let stream = await c.beta.sessions.events.stream(session.id);
  if (!resumed) {
    await c.beta.sessions.events.send(session.id, {
      events: buildInitialEvents(manifest, brief, flowDir) as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
  }

  const STALL_MS = manifest.run?.stall_ms ?? 180_000;
  const MAX_RESTARTS = manifest.run?.max_restarts ?? 0;
  let restartCount = 0;
  let finalSessionId = session.id;
  let agentReport = "";
  let lastOutcome: { result?: unknown; note?: string } | null = null;
  // Slice 100 — track which terminal event ended the run so reflection
  // fires only on success (session_idle), not on abnormal termination or
  // watchdog give-up. Authority: reflectionShouldFire (decision 4dce6f31).
  let terminalTrigger: ReflectionTrigger | null = null;

  while (true) {
    let finished = false;
    let needsRestart = false;
    let sentinelFired = false;
    let lastEventAt = Date.now();

    // Slice 20 §2.A3 — watchdog with cancel flag. `clearInterval` only
    // stops *future* firings; an in-flight async callback can still mutate
    // loop state. The `cancelled` flag short-circuits the callback at each
    // await boundary so cleanup is race-free.
    let watchdogCancelled = false;
    const watchdog = manifest.sentinel_key
      ? setInterval(async () => {
          const decision = watchdogDecide({
            cancelled: watchdogCancelled,
            sentinelFired,
            silenceMs: Date.now() - lastEventAt,
            stallMs: STALL_MS,
            restartCount,
            maxRestarts: MAX_RESTARTS,
          });
          if (decision.action === "none") return;
          if (decision.action === "fire_sentinel") {
            sentinelFired = true;
            emit("sentinel", `${decision.silenceSec}s silence — diagnosing...`);
            const recovery = await runSentinel(manifest, state, brief, session.id, decision.silenceSec, emit);
            if (watchdogCancelled) return;
            if (recovery) {
              try {
                await c.beta.sessions.events.send(session.id, {
                  events: [{ type: "user.message", content: [{ type: "text", text: recovery }] }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
                });
                if (watchdogCancelled) return;
                lastEventAt = Date.now();
                emit("sentinel", `nudged: ${recovery.slice(0, 120)}`);
              } catch (err) {
                if (watchdogCancelled) return;
                emit("sentinel", `nudge failed: ${(err as Error).message}`);
              }
            }
          } else if (decision.action === "restart") {
            emit("sentinel", `still stalled — restart ${restartCount + 1}/${MAX_RESTARTS}`);
            needsRestart = true;
            finished = true;
          } else if (decision.action === "give_up") {
            emit("sentinel", "max restarts reached, giving up");
            terminalTrigger = "watchdog_giveup";
            finished = true;
          }
        }, 30_000)
      : null;

    try {
      for await (const e of stream) {
        lastEventAt = Date.now();
        if (sentinelFired) {
          emit("sentinel", "recovery detected — re-armed");
          sentinelFired = false;
        }
        if (e.type === "agent.message") {
          const text = (e as { content: Array<{ type: string; text?: string }> }).content
            .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
          if (text) { emit("agent", text); agentReport += text + "\n"; }
        }
        if ((e.type as string) === "span.outcome_evaluation_end") {
          const ev = e as { result?: unknown; explanation?: string };
          lastOutcome = { result: ev.result, note: ev.explanation?.slice(0, 200) };
          emit("outcome", lastOutcome);
        }
        if (e.type === "session.error") emit("error", e);
        if (e.type === "session.status_terminated") {
          terminalTrigger = "session_terminated";
          finished = true;
          break;
        }
        if (e.type === "session.status_idle" && (e as { stop_reason?: { type: string } }).stop_reason?.type !== "requires_action") {
          terminalTrigger = "session_idle";
          finished = true;
          break;
        }
        if (needsRestart) { finished = true; break; }
      }
    } catch (streamErr) {
      if (!needsRestart) {
        // Slice 50 — capped exponential backoff. Previously a flat 2s,
        // single-attempt. Now: 5 attempts, 1s → 16s (capped at 16s).
        emit("reconnect", `stream dropped: ${(streamErr as Error).message ?? "unknown"}`);
        const delays = backoffDelays(5, 1000, 16_000);
        let reconnected = false;
        for (let attempt = 0; attempt < delays.length; attempt++) {
          await Bun.sleep(delays[attempt]!);
          emit("reconnect.attempt", `${attempt + 1}/${delays.length} after ${delays[attempt]}ms`);
          try {
            const s = await c.beta.sessions.retrieve(session.id) as { status: string };
            if (s.status === "running") {
              stream = await c.beta.sessions.events.stream(session.id);
              reconnected = true;
              emit("reconnect.ok", `attempt ${attempt + 1}`);
              break;
            }
            emit("reconnect", `session not running (status=${s.status}); giving up`);
            break;
          } catch (retrieveErr) {
            emit("reconnect.error", `attempt ${attempt + 1}: ${(retrieveErr as Error).message}`);
            if (attempt === delays.length - 1) {
              emit("reconnect.gaveup", `after ${delays.length} attempts`);
            }
          }
        }
        if (reconnected) continue;
        finished = true;
      }
    }

    // Slice 20 §2.A3 — set the cancel flag BEFORE clearInterval so any
    // in-flight callback short-circuits at its next await boundary.
    watchdogCancelled = true;
    if (watchdog) clearInterval(watchdog);
    if (!needsRestart) break;
    restartCount++;
    // Slice 20 §2.A6 — interrupt + delete the predecessor session so it
    // doesn't orphan-accrue at Anthropic while the restart runs.
    emit("restart", `cleaning up ${finalSessionId}`);
    cleanupAbandonedSession(finalSessionId).catch((err: unknown) => {
      emit("restart", `cleanup error: ${(err as Error).message}`);
    });
    const next = await createOrResumeSession(manifest, state);
    finalSessionId = next.session.id;
    saveState(resolve(flowDir, manifest.state_file), state);
    emit("session", next.session.id);
    stream = await c.beta.sessions.events.stream(next.session.id);
    await c.beta.sessions.events.send(next.session.id, {
      events: buildInitialEvents(manifest, brief, flowDir) as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
  }

  const date = new Date().toISOString().split("T")[0];
  const outDir = resolve(flowDir, `${manifest.output_dir}/${date}-${finalSessionId.slice(-6)}`);
  mkdirSync(outDir, { recursive: true });
  if (agentReport) {
    const { writeFileSync } = await import("fs");
    writeFileSync(`${outDir}/report.md`, agentReport);
    emit("saved", `${outDir}/report.md`);
  }
  const savedFiles = await downloadSessionFiles(finalSessionId, outDir, emit);
  if (manifest.run?.log_runs) {
    const logged = await appendRunLog(manifest, state, finalSessionId, brief, agentReport, lastOutcome, savedFiles);
    if (logged) emit("runlog", logged);
  }
  // Slice 100 — per-run reflection. Fires AFTER download but BEFORE
  // post_session_hook so a hook can include reflection findings in its
  // deploy manifest if desired. Authority: ProactiveQuestions decision
  // b8b27dbf (ordering with post_session_hook). reflectionShouldFire gates
  // on the terminal trigger (idle = fire; terminated / giveup = skip).
  if (manifest.run?.reflection) {
    const gate = reflectionShouldFire(terminalTrigger ?? "session_terminated", manifest.run.reflection);
    emit("reflection.gate", gate);
    if (gate.fire) {
      const result = await runReflection(
        manifest,
        state,
        finalSessionId,
        agentReport,
        lastOutcome,
        savedFiles,
      );
      if (result.ok) {
        emit("reflection.ok", { storedPath: result.storedPath, durationMs: result.durationMs });
      } else {
        emit("reflection.error", { error: result.error, durationMs: result.durationMs });
      }
    }
  }
  // Slice 10 §1.F2 — host-side post-session hook. Carries credentials that
  // must not enter agent context. Authority: NIST SP 800-204C, OWASP Secrets
  // Management Cheat Sheet, CVE-2026-44479.
  if (manifest.run?.post_session_hook) {
    emit("post_hook", "starting");
    const hookResult = await runPostSessionHook(manifest.run.post_session_hook, {
      sessionId: finalSessionId,
      flowName,
      flowDir,
      outputDir: outDir,
    });
    if (hookResult.error) {
      emit("post_hook", `error: ${hookResult.error}`);
    } else if (hookResult.exitCode !== 0) {
      emit("post_hook", `exit ${hookResult.exitCode} (${hookResult.durationMs}ms)`);
      if (hookResult.stderr) emit("post_hook_stderr", hookResult.stderr.slice(-2000));
    } else {
      emit("post_hook", `ok (${hookResult.durationMs}ms)`);
      if (hookResult.stdout) emit("post_hook_stdout", hookResult.stdout.slice(-2000));
    }
  }
  emit("done", outDir);
  stop();
}

async function sessions(flowName: string, action?: string) {
  const { manifest, flowDir } = loadManifest(flowPath(flowName));
  const state = loadState(resolve(flowDir, manifest.state_file));
  const tracked = state.sessions ?? [];
  if (tracked.length === 0) { console.log("no tracked sessions"); return; }

  type Row = { id: string; status: string; createdAt?: string };
  const rows: Row[] = await Promise.all(tracked.map(async (id) => {
    try {
      const s = await c.beta.sessions.retrieve(id) as { id: string; status: string; created_at?: string };
      return { id: s.id, status: s.status, createdAt: s.created_at };
    } catch (err) {
      return { id, status: `error: ${(err as Error).message.slice(0, 40)}` };
    }
  }));

  if (action === "--kill" || action === "--kill-all") {
    const targets = action === "--kill-all" ? rows : rows.filter((r) => r.status === "running");
    if (targets.length === 0) { console.log("nothing to kill"); return; }
    console.log(`killing ${targets.length} session(s)...`);
    const killed: string[] = [];
    for (const r of targets) {
      try {
        try {
          await c.beta.sessions.events.send(r.id, {
            events: [{ type: "user.interrupt" }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
          });
        } catch (interruptErr) {
          // Slice 20 §2.A2 — interrupt may fail (session already done, network
          // hiccup). Surface it so operators see why the kill path proceeded.
          console.log(`  interrupt failed for ${r.id}: ${(interruptErr as Error).message}`);
        }
        for (let i = 0; i < 30; i++) {
          const s = await c.beta.sessions.retrieve(r.id) as { status: string };
          if (s.status === "terminated" || s.status === "idle") break;
          await Bun.sleep(1000);
        }
        await c.beta.sessions.delete(r.id);
        console.log(`  ✓ ${r.id}`);
        killed.push(r.id);
      } catch (err) {
        console.log(`  ✗ ${r.id}  ${(err as Error).message}`);
      }
    }
    state.sessions = tracked.filter((id) => !killed.includes(id));
    saveState(resolve(flowDir, manifest.state_file), state);
    return;
  }

  if (action === "--pick") {
    const running = rows.filter((r) => r.status === "running");
    if (running.length === 0) {
      console.log("no running sessions. all tracked:");
      for (const r of rows) console.log(`  ${r.id}  [${r.status}]`);
      return;
    }
    console.log("\nrunning sessions:");
    running.forEach((r, i) => {
      const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
      console.log(`  [${i + 1}] ${r.id}  ${when}`);
    });
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(`\npick [1-${running.length}] (or q): `)).trim();
    rl.close();
    if (answer === "q" || answer === "") return;
    const idx = Number.parseInt(answer, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= running.length) {
      console.error("invalid"); process.exit(1);
    }
    const picked = running[idx].id;
    console.log(`\nresuming ${picked}...\n`);
    spawn("bun", ["run", resolve(SKILL_DIR, "braid.ts"), "run", flowName, "", picked], { stdio: "inherit", cwd: REPO_ROOT })
      .on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  for (const r of rows) console.log(`  ${r.id}  [${r.status}]  ${r.createdAt ?? ""}`);
}

/**
 * Slice 80 — `bun run demo <flow>` zero-cost evaluation.
 *
 * Runs setup() then run() inline so a newcomer doesn't need to know about
 * the two-step lifecycle. Only fires when BRAID_DEMO_MODE=1 is set (which
 * the npm script enforces). The mock Anthropic client is already swapped
 * in at module load via lib.ts createInitialClient.
 *
 * Authority: Slice 80 design decisions df5a6be9 (graduate mock) +
 * af93996e (refuse real API calls in demo mode).
 */
async function demoFlow(flowName: string): Promise<void> {
  if (process.env.BRAID_DEMO_MODE !== "1") {
    throw new Error(
      "demo: BRAID_DEMO_MODE=1 must be set. Use `bun run demo <flow>` (the npm script sets it).",
    );
  }
  if (!flowName) {
    const flows = listFlows();
    console.log("Usage: bun run demo <flow>\nAvailable flows: " + flows.join(", "));
    return;
  }
  // Slice 80 security decision af93996e — every env credential a flow might
  // read becomes the visibly-fake sentinel value in demo mode. No real key
  // is consulted; if a flow tries to actually use one, the value is
  // unambiguously fake so leaked demo logs cannot be mistaken for real creds.
  const SENTINEL = "DEMO-NOT-A-REAL-TOKEN";
  for (const key of ["ANTHROPIC_API_KEY", "FAL_API_KEY", "VERCEL_TOKEN"]) {
    if (!process.env[key]) process.env[key] = SENTINEL;
  }
  console.log(`[demo] zero-cost evaluation of '${flowName}' (no real API calls)`);
  // Every demo run is fresh — wipe any prior state.json so provisioning
  // re-fires and the event timeline is reproducible. Authority: Slice 80
  // PerformanceLatency decision bc93dd45 ("Every demo run is fresh — no caching").
  const flowDir = dirname(resolve(REPO_ROOT, flowPath(flowName)));
  const { existsSync, unlinkSync } = await import("fs");
  const statePath = resolve(flowDir, "state.json");
  if (existsSync(statePath)) {
    unlinkSync(statePath);
    console.log(`[demo] cleared prior state.json for fresh run`);
  }
  await setup(flowName);
  console.log(`[demo] setup complete, running...`);
  await run(flowName);
  console.log(`[demo] complete — see events above`);
}

async function pull(flowName: string, keys: string[]) {
  const { manifest, flowDir } = loadManifest(flowPath(flowName));
  const state = loadState(resolve(flowDir, manifest.state_file));
  // Slice 20 §2.A8 — extract --dry-run from positional args before passing
  // the remaining tokens to pullAgents as key filters.
  const dryRun = keys.includes("--dry-run");
  const filteredKeys = keys.filter((k) => k !== "--dry-run");
  console.log(
    `${dryRun ? "[dry-run] " : ""}pulling ${filteredKeys.length ? filteredKeys.join(", ") : "all agents"} for ${manifest.name}...`,
  );
  await pullAgents(manifest, state, flowDir, filteredKeys.length ? filteredKeys : undefined, { dryRun });
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = "true";
    } else positional.push(a);
  }
  return { positional, flags };
}

async function dream(flowName: string, extra: string[]) {
  const { manifest, flowDir } = loadManifest(flowPath(flowName));
  const state = loadState(resolve(flowDir, manifest.state_file));
  const { flags } = parseFlags(extra);

  const stores = state.stores ?? {};
  const storeKeys = Object.keys(stores).filter((k) => k !== "runLog" || flags["store"] === "runLog");
  if (storeKeys.length === 0) { console.log("no memory stores in state — nothing to dream over"); return; }

  let storeKey = flags["store"];
  if (!storeKey) {
    if (storeKeys.length === 1) storeKey = storeKeys[0];
    else {
      console.log("\nstores:");
      storeKeys.forEach((k, i) => console.log(`  [${i + 1}] ${k}  ${stores[k]}`));
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = (await rl.question(`\npick [1-${storeKeys.length}] (or q): `)).trim();
      rl.close();
      if (answer === "q" || answer === "") return;
      const idx = Number.parseInt(answer, 10) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= storeKeys.length) {
        console.error("invalid"); process.exit(1);
      }
      storeKey = storeKeys[idx];
    }
  }
  const storeId = stores[storeKey];
  if (!storeId) { console.error(`unknown store: ${storeKey}`); process.exit(1); }

  const limit = flags["sessions"] ? Number.parseInt(flags["sessions"], 10) : 20;
  const recent = (state.sessions ?? []).slice(0, limit);
  if (recent.length === 0) { console.log("no sessions yet"); return; }

  const spec = manifest.memory_stores?.find((s) => s.key === storeKey);
  const instructions = flags["instructions"] ?? spec?.dream_instructions ??
    `Review session decisions and outcomes. Consolidate stable patterns into the store; prune contradictions and one-off noise.`;

  const model = flags["model"] ?? "claude-sonnet-4-6";
  console.log(`dreaming over ${recent.length} session(s) -> ${storeKey} (${storeId})...`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/dreams", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "managed-agents-2026-04-01,dreaming-2026-04-21",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inputs: [
        { type: "memory_store", memory_store_id: storeId },
        { type: "sessions", session_ids: recent },
      ],
      model,
      instructions,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dream create failed (${res.status}): ${text}`);
  let dream = JSON.parse(text) as {
    id?: string; status?: string;
    output?: { memory_store_id?: string };
    memory_store_id?: string;
    outputs?: Array<{ memory_store_id?: string }>;
  };
  console.log(`  dream ${dream.id} status=${dream.status}`);

  while (dream.id && (dream.status === "pending" || dream.status === "running")) {
    await Bun.sleep(5000);
    const r = await fetch(`https://api.anthropic.com/v1/dreams/${dream.id}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "managed-agents-2026-04-01,dreaming-2026-04-21",
      },
    });
    const t = await r.text();
    if (!r.ok) { console.error(`poll failed: ${t}`); break; }
    dream = JSON.parse(t);
    process.stdout.write(`  status=${dream.status}\n`);
  }

  const newId =
    dream?.outputs?.[0]?.memory_store_id ??
    dream?.output?.memory_store_id ??
    dream?.memory_store_id ??
    storeId;
  state.stores![storeKey] = newId;
  saveState(resolve(flowDir, manifest.state_file), state);
  console.log(`✓ ${storeKey} -> ${newId} (${dream.status})`);
}

function usage() {
  const flows = listFlows();
  console.log(`braid — run multi-agent workflows

  braid list                            show available flows
  braid create <description>            scaffold a new flow from a natural-language description
  braid setup <flow>                    create env/vault/stores/agents from flows/<flow>/flow.yaml
  braid run <flow> [brief] [sesn_id]    create or resume a session and stream
  braid sessions <flow> [--pick|--kill|--kill-all]
  braid pull <flow> [key...]            overwrite flows/<flow>/agents/*.yaml from anthropic
  braid dream <flow> [--store K] [--instructions "..."] [--sessions N] [--model M]
                                        run a dream over tracked sessions; consolidates into store K
  braid purge [--select]                tear down all infra

Available flows: ${flows.length ? flows.join(", ") : "(none — create flows/<name>/flow.yaml)"}

Examples:
  braid create "generate 5 product photos with fal and deploy a gallery to vercel"
  braid setup ad
  braid run ad "60s ad for hiking boots"
  braid sessions ad --pick`);
}

async function createFromTemplate(flags: Record<string, string>): Promise<void> {
  const templateName = flags.template;
  const flowName = flags.name;
  if (!templateName) throw new Error("create --template <name> is required");
  if (!flowName) throw new Error("create --name <flow> is required");
  // Allow namespaced names like `_examples/foo` for hidden reference flows.
  if (!/^(_[a-z][a-z0-9-]*\/)?[a-z][a-z0-9-]*$/.test(flowName)) {
    throw new Error(`create --name: ${flowName} must be lowercase kebab-case (optionally prefixed with _namespace/)`);
  }
  const targetDir = resolve(REPO_ROOT, "flows", flowName);
  if (existsSync(targetDir) && !flags.force) {
    throw new Error(`flows/${flowName} already exists. Pass --force to overwrite.`);
  }
  const { manifest } = loadTemplate(REPO_ROOT, templateName);
  const vars = flags.vars ? parseVarsArg(flags.vars, REPO_ROOT) : {};
  // The template binds `flow_name` to its YAML resource names (Anthropic
  // env_name, agent name prefixes, memory store names, etc.) which must
  // be plain kebab-case. The on-disk path may be namespaced (e.g.
  // `_examples/foo`); we feed only the tail into the template.
  const templateFlowName = flowName.includes("/") ? flowName.split("/").pop()! : flowName;
  const { writes } = instantiateTemplate({ repoRoot: REPO_ROOT, templateName, flowName: templateFlowName, vars });
  mkdirSync(targetDir, { recursive: true });
  for (const w of writes) {
    const abs = resolve(targetDir, w.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, w.content);
  }
  // Smoke-validate by loading the generated flow.yaml — same path setup() takes.
  loadManifest(flowPath(flowName));
  console.log(`[braid:create] template=${manifest.name} -> flows/${flowName}`);
  console.log(`  wrote ${writes.length} files`);
  console.log(`\nNext: bun .claude/skills/braid/braid.ts setup ${flowName}`);
}

function createGuidance(description: string) {
  const desc = description.trim();
  if (!desc) {
    console.error("braid create — missing description.\n\nUsage: braid create <description>");
    process.exit(1);
  }
  // The actual scaffolding is assistant-driven. The CLI prints a marker the
  // assistant recognizes so it follows the "Create command" procedure in
  // SKILL.md instead of trying to template a flow inline.
  console.log(`[braid:create] assistant-driven scaffold requested.

Description: ${desc}

This command is handled by the assistant (Claude). Follow the procedure
documented in .claude/skills/braid/SKILL.md under "## Create command":

  1. Classify the flow (simple-task / mcp / fal / website / builder-deployer /
     ad-generator / multi-shot video).
  2. Pick a kebab-case flow name (ask the user if ambiguous — one question max).
  3. Scaffold flows/<name>/flow.yaml, agents/<key>.yaml, rubric.md, LESSONS.md.
  4. Respect the security posture defaults (networking limited, permission_policy
     always_ask, no secrets in briefs, deploys via run.post_session_hook).
  5. Run \`bun .claude/skills/braid/braid.ts setup <name>\` and confirm with the
     user before the first run.

Then, after every run, follow "## Self-improvement after every run" — inspect
outcome/sentinel/manifest signals, patch the flow at the root cause, append to
flows/<name>/LESSONS.md, and re-run.
`);
}

try {
  switch (cmd) {
    case "list": {
      const flows = listFlows();
      console.log(flows.length ? flows.join("\n") : "(no flows yet)");
      break;
    }
    case "examples": {
      const sub = rest[0] ?? "list";
      if (sub !== "list") { console.error("usage: braid examples list"); process.exit(1); }
      const dir = resolve(REPO_ROOT, "flows", "_examples");
      if (!existsSync(dir)) { console.log("(no examples yet)"); break; }
      const { readdirSync } = await import("fs");
      const names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, "flow.yaml")))
        .map((e) => `_examples/${e.name}`)
        .sort();
      console.log(names.length ? names.join("\n") : "(no examples yet)");
      break;
    }
    case "create": {
      const { positional, flags } = parseFlags(rest);
      if (flags.template) {
        await createFromTemplate(flags);
      } else if (positional[0] === "list" || flags.list === "true") {
        const t = listTemplates(REPO_ROOT);
        console.log(t.length ? t.join("\n") : "(no templates yet)");
      } else {
        const desc = flags.freeform || positional.join(" ");
        createGuidance(desc);
      }
      break;
    }
    case "setup": await setup(rest[0]); break;
    case "demo": await demoFlow(rest[0]); break;
    case "run": await run(rest[0], rest[1] || undefined, rest[2] || undefined); break;
    case "sessions": await sessions(rest[0], rest[1]); break;
    case "pull": await pull(rest[0], rest.slice(1)); break;
    case "dream": await dream(rest[0], rest.slice(1)); break;
    case "purge": {
      spawn("bun", ["run", resolve(SKILL_DIR, "purge.ts"), ...rest], { stdio: "inherit", cwd: REPO_ROOT })
        .on("exit", (code) => process.exit(code ?? 0));
      break;
    }
    default: usage(); process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
