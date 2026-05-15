import { mkdirSync, existsSync } from "fs";
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
} from "./lib";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const [, , cmd, ...rest] = process.argv;

function flowPath(name: string) {
  return name.endsWith(".yaml") ? name : `flows/${name}/flow.yaml`;
}

async function setup(flowName: string) {
  const manifest = loadManifest(flowPath(flowName));
  const state = loadState(manifest.state_file);
  console.log(`setting up ${manifest.name}...`);
  await ensureResources(manifest, state);
  saveState(manifest.state_file, state);
  console.log(`\nstate -> ${manifest.state_file}`);
}

async function run(flowName: string, briefArg?: string, resumeId?: string) {
  const manifest = loadManifest(flowPath(flowName));
  const state = loadState(manifest.state_file);
  if (!state.env) throw new Error(`No state in ${manifest.state_file} — run: braid setup ${flowName}`);

  const brief = expandBrief(briefArg ?? manifest.brief_default ?? "");
  if (!brief) throw new Error("no brief provided and no brief_default in manifest");

  const { emit, stop } = startSseServer();
  emit("brief", brief.slice(0, 200));

  const { session, resumed } = await createOrResumeSession(manifest, state, resumeId);
  saveState(manifest.state_file, state);
  emit(resumed ? "resumed" : "session", session.id);

  let stream = await c.beta.sessions.events.stream(session.id);
  if (!resumed) {
    await c.beta.sessions.events.send(session.id, {
      events: buildInitialEvents(manifest, brief) as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
  }

  const STALL_MS = manifest.run?.stall_ms ?? 180_000;
  const MAX_RESTARTS = manifest.run?.max_restarts ?? 0;
  let restartCount = 0;
  let finalSessionId = session.id;
  let agentReport = "";
  let lastOutcome: { result?: unknown; note?: string } | null = null;

  while (true) {
    let finished = false;
    let needsRestart = false;
    let sentinelFired = false;
    let lastEventAt = Date.now();

    const watchdog = manifest.sentinel_key
      ? setInterval(async () => {
          const silence = Date.now() - lastEventAt;
          if (silence < STALL_MS) return;
          if (!sentinelFired) {
            sentinelFired = true;
            const silenceSec = Math.round(silence / 1000);
            emit("sentinel", `${silenceSec}s silence — diagnosing...`);
            const recovery = await runSentinel(manifest, state, brief, session.id, silenceSec, emit);
            if (recovery) {
              try {
                await c.beta.sessions.events.send(session.id, {
                  events: [{ type: "user.message", content: [{ type: "text", text: recovery }] }] as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
                });
                lastEventAt = Date.now();
                emit("sentinel", `nudged: ${recovery.slice(0, 120)}`);
              } catch (err) {
                emit("sentinel", `nudge failed: ${(err as Error).message}`);
              }
            }
          } else if (silence > STALL_MS * 2) {
            if (restartCount < MAX_RESTARTS) {
              emit("sentinel", `still stalled — restart ${restartCount + 1}/${MAX_RESTARTS}`);
              needsRestart = true;
            } else {
              emit("sentinel", "max restarts reached, giving up");
            }
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
        if (e.type === "session.status_terminated") { finished = true; break; }
        if (e.type === "session.status_idle" && (e as { stop_reason?: { type: string } }).stop_reason?.type !== "requires_action") {
          finished = true; break;
        }
        if (needsRestart) { finished = true; break; }
      }
    } catch {
      if (!needsRestart) {
        emit("reconnect", "stream dropped — checking...");
        await Bun.sleep(2000);
        try {
          const s = await c.beta.sessions.retrieve(session.id) as { status: string };
          if (s.status === "running") {
            stream = await c.beta.sessions.events.stream(session.id);
            continue;
          }
        } catch {}
        finished = true;
      }
    }

    if (watchdog) clearInterval(watchdog);
    if (!needsRestart) break;
    restartCount++;
    const next = await createOrResumeSession(manifest, state);
    finalSessionId = next.session.id;
    saveState(manifest.state_file, state);
    emit("session", next.session.id);
    stream = await c.beta.sessions.events.stream(next.session.id);
    await c.beta.sessions.events.send(next.session.id, {
      events: buildInitialEvents(manifest, brief) as Parameters<typeof c.beta.sessions.events.send>[1]["events"],
    });
  }

  const date = new Date().toISOString().split("T")[0];
  const outDir = `${manifest.output_dir}/${date}-${finalSessionId.slice(-6)}`;
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
  emit("done", outDir);
  stop();
}

async function sessions(flowName: string, action?: string) {
  const manifest = loadManifest(flowPath(flowName));
  const state = loadState(manifest.state_file);
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
        } catch {}
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
    saveState(manifest.state_file, state);
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

async function pull(flowName: string, keys: string[]) {
  const manifest = loadManifest(flowPath(flowName));
  const state = loadState(manifest.state_file);
  console.log(
    `pulling ${keys.length ? keys.join(", ") : "all agents"} for ${manifest.name}...`,
  );
  await pullAgents(manifest, state, keys.length ? keys : undefined);
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
  const manifest = loadManifest(flowPath(flowName));
  const state = loadState(manifest.state_file);
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
  saveState(manifest.state_file, state);
  console.log(`✓ ${storeKey} -> ${newId} (${dream.status})`);
}

function usage() {
  const flows = listFlows();
  console.log(`braid — run multi-agent workflows

  braid list                            show available flows
  braid setup <flow>                    create env/vault/stores/agents from flows/<flow>/flow.yaml
  braid run <flow> [brief] [sesn_id]    create or resume a session and stream
  braid sessions <flow> [--pick|--kill|--kill-all]
  braid pull <flow> [key...]            overwrite flows/<flow>/agents/*.yaml from anthropic
  braid dream <flow> [--store K] [--instructions "..."] [--sessions N] [--model M]
                                        run a dream over tracked sessions; consolidates into store K
  braid purge [--select]                tear down all infra

Available flows: ${flows.length ? flows.join(", ") : "(none — create flows/<name>/flow.yaml)"}

Examples:
  braid setup ad
  braid run ad "60s ad for hiking boots"
  braid sessions ad --pick`);
}

try {
  switch (cmd) {
    case "list": {
      const flows = listFlows();
      console.log(flows.length ? flows.join("\n") : "(no flows yet)");
      break;
    }
    case "setup": await setup(rest[0]); break;
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
