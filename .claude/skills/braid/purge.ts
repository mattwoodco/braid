import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";

const c = new Anthropic({ timeout: 15000, maxRetries: 0 });

const flags = new Set(process.argv.slice(2));
const interactive = flags.has("--select") || flags.has("-s");
const skipSession = process.argv.slice(2).find((a) => a.startsWith("sesn_"));

async function tryOp(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    process.stdout.write(".");
  } catch {
    process.stdout.write("x");
  }
}

async function listAll<T>(label: string, fn: () => AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  try {
    for await (const item of fn()) items.push(item);
    console.log(`  listed ${items.length} ${label}`);
  } catch (err) {
    console.log(`  list ${label} failed: ${(err as { message?: string }).message ?? String(err)}`);
  }
  return items;
}

async function deleteInBatches<T>(label: string, items: T[], fn: (item: T) => Promise<void>, batchSize = 25) {
  if (!items.length) return;
  console.log(`  deleting ${items.length} ${label} in batches of ${batchSize}...`);
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
    process.stdout.write(` ${Math.min(i + batchSize, items.length)}/${items.length}`);
  }
  console.log(" done");
}

type Pickable = { id: string; label?: string };

const rl = interactive
  ? createInterface({ input: stdin, output: stdout })
  : null;

async function pick<T extends Pickable>(category: string, items: T[]): Promise<T[]> {
  if (!interactive || !rl) return items;
  if (!items.length) {
    console.log(`  (no ${category} to pick)`);
    return [];
  }
  console.log(`\n${category}:`);
  items.forEach((it, i) => {
    console.log(`  [${i + 1}] ${it.id}${it.label ? `  ${it.label}` : ""}`);
  });
  const ans = (await rl.question(`select ${category} [all/none/1,2,3]: `)).trim().toLowerCase();
  if (ans === "" || ans === "none" || ans === "n") return [];
  if (ans === "all" || ans === "a" || ans === "*") return items;
  const picked: T[] = [];
  for (const tok of ans.split(/[,\s]+/).filter(Boolean)) {
    const idx = Number.parseInt(tok, 10) - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx < items.length) picked.push(items[idx]);
  }
  return picked;
}

// Load known IDs from all flow state files
import { readdirSync } from "fs";
const flowDirs = existsSync("flows")
  ? readdirSync("flows", { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`flows/${d.name}/state.json`))
      .map((d) => `flows/${d.name}/state.json`)
  : [];
const allStates = flowDirs.map((f) => JSON.parse(readFileSync(f, "utf-8")) as Record<string, any>);

const knownSessions = new Set<string>(allStates.flatMap((s) => s.sessions ?? []));
const knownAgents = new Set<string>(
  allStates.flatMap((s) => Object.values(s.agents ?? {}) as string[]),
);
const knownEnvs = new Set<string>(allStates.map((s) => s.env).filter(Boolean));
const knownVaults = new Set<string>(
  allStates.flatMap((s) => [s.vault, ...((s.vaults as string[] | undefined) ?? [])].filter(Boolean)),
);
const knownStores = new Set<string>(
  allStates.flatMap((s) => Object.values(s.stores ?? {}) as string[]),
);

console.log("=== 1. Sessions ===");
const sessions = await listAll("sessions", () => c.beta.sessions.list());
const sessionRows: Pickable[] = [
  ...sessions.map((s: any) => ({ id: s.id, label: s.status })),
  ...[...knownSessions]
    .filter((id) => !sessions.find((s: any) => s.id === id))
    .map((id) => ({ id, label: "tracked" })),
].filter((s) => s.id !== skipSession);

const selectedSessions = await pick("sessions", sessionRows);
const selectedSessionIds = new Set(selectedSessions.map((s) => s.id));
const runningSelected = sessions.filter(
  (s: any) => s.status === "running" && selectedSessionIds.has(s.id),
);
if (runningSelected.length) {
  console.log(`  interrupting ${runningSelected.length} running sessions...`);
  await deleteInBatches("interrupts", runningSelected, (s: any) =>
    tryOp(`interrupt ${s.id}`, () =>
      c.beta.sessions.events.send(s.id, { events: [{ type: "user.interrupt" }] as any })
    )
  );
  console.log("  polling until sessions leave running state...");
  const ids = runningSelected.map((s: any) => s.id);
  for (let attempt = 0; attempt < 15; attempt++) {
    await Bun.sleep(2000);
    const still: string[] = [];
    for (const id of ids) {
      const s = (await c.beta.sessions.retrieve(id)) as any;
      if (s.status === "running") still.push(id);
    }
    process.stdout.write(` ${still.length} still running...`);
    if (!still.length) break;
  }
  console.log();
}
await deleteInBatches("sessions", [...selectedSessionIds], (id) =>
  tryOp(`session ${id}`, () => c.beta.sessions.delete(id))
);

console.log("\n=== 2. Agents (archive) ===");
const listedAgents = await listAll("agents", () => c.beta.agents.list());
const agentRows: Pickable[] = [
  ...listedAgents.map((a: any) => ({ id: a.id, label: a.name ?? "" })),
  ...[...knownAgents]
    .filter((id) => !listedAgents.find((a: any) => a.id === id))
    .map((id) => ({ id, label: "tracked" })),
];
const selectedAgents = await pick("agents", agentRows);
await deleteInBatches("agents", selectedAgents.map((a) => a.id), (id) =>
  tryOp(`agent ${id}`, () => c.beta.agents.archive(id))
);

console.log("\n=== 3. Environments ===");
const listedEnvs = await listAll("environments", () => c.beta.environments.list());
const envRows: Pickable[] = [
  ...listedEnvs.map((e: any) => ({ id: e.id, label: e.name ?? "" })),
  ...[...knownEnvs]
    .filter((id) => !listedEnvs.find((e: any) => e.id === id))
    .map((id) => ({ id, label: "tracked" })),
];
const selectedEnvs = await pick("environments", envRows);
await deleteInBatches("environments", selectedEnvs.map((e) => e.id), (id) =>
  tryOp(`env ${id}`, () => c.beta.environments.delete(id))
);

console.log("\n=== 4. Vaults ===");
const listedVaults = await listAll("vaults", () => c.beta.vaults.list());
const vaultRows: Pickable[] = [
  ...listedVaults.map((v: any) => ({ id: v.id, label: v.name ?? "" })),
  ...[...knownVaults]
    .filter((id) => !listedVaults.find((v: any) => v.id === id))
    .map((id) => ({ id, label: "tracked" })),
];
const selectedVaults = await pick("vaults", vaultRows);
for (const v of selectedVaults) {
  const creds = await listAll(`creds in ${v.id}`, () => c.beta.vaults.credentials.list(v.id));
  await deleteInBatches("creds", creds, (cred) =>
    tryOp(`cred ${(cred as any).id}`, () => c.beta.vaults.credentials.delete(v.id, (cred as any).id))
  );
  await tryOp(`vault ${v.id}`, () => c.beta.vaults.delete(v.id));
}

console.log("\n=== 5. Memory stores ===");
const listedStores = await listAll("memory stores", () => (c.beta as any).memoryStores.list());
const storeRows: Pickable[] = [
  ...listedStores.map((s: any) => ({ id: s.id, label: s.name ?? "" })),
  ...[...knownStores]
    .filter((id) => !listedStores.find((s: any) => s.id === id))
    .map((id) => ({ id, label: "tracked" })),
];
const selectedStores = await pick("memory stores", storeRows);
await deleteInBatches("stores", selectedStores.map((s) => s.id), (id) =>
  tryOp(`store ${id}`, () => (c.beta as any).memoryStores.delete(id))
);

rl?.close();

if (!interactive) {
  for (const f of flowDirs) writeFileSync(f, "{}");
  console.log(`\n✓ Reset ${flowDirs.length} state file(s). Run: bun scripts/braid.ts setup <flow>`);
} else {
  console.log("\n✓ Done (interactive mode — state files left intact).");
}
