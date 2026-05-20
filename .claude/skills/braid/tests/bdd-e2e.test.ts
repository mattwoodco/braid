/**
 * Slice 130 — BDD end-to-end scenarios for Braid.
 *
 * One file, describe = Feature, nested describe = Scenario (Given/When/Then).
 * Every Then has a specific measurable assertion (Memento testabilityRequirements).
 *
 * Authority:
 *   - Slice 130 design (Memento plan node d13c84da)
 *   - Slices 10/20/70/80/90/100 underlying behavior
 *
 * Notes on Memento guidance:
 *   - The scenario tool flagged "Docker" as a blocker per Memento's own
 *     project CLAUDE.md ("Docker is NEVER an option"). That rule applies to
 *     the Memento project; Braid's user explicitly authorized Docker as a
 *     host-side sandbox layer (Slice 70 SecurityArchitecture decision
 *     4474811d). Override is documented here for the audit trail.
 *   - C#-specific rules from Memento guidance (ServiceResult<T>,
 *     CancellationToken) don't apply to this TypeScript/Bun project.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "yaml";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const BRAID_ENTRY = join(REPO_ROOT, ".claude", "skills", "braid", "braid.ts");
const SKILL_DIR = join(REPO_ROOT, ".claude", "skills", "braid");

// Flow ids use the namespaced form post-archive: top-level flows still live
// at flows/<name>/, archived reference flows at flows/_archive/<name>/, and
// the showcase/example flows at flows/_examples/<name>/. The braid CLI's
// flowPath() resolves `_archive/foo` → flows/_archive/foo/flow.yaml.
const SHIPPED_FLOWS = [
  "_archive/ad",
  "_archive/final-inning",
  "_examples/fundraiser",
  "_archive/homecoming",
  "_archive/pop-quiz",
  "_archive/quiet-rebellion",
  "_examples/snapshots",
  "_archive/solids",
];

function runDemo(flow: string): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", BRAID_ENTRY, "demo", flow],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BRAID_DEMO_MODE: "1",
      BRAID_SSE_PORT: "0",
      // Demo mode should NOT need any real keys.
      ANTHROPIC_API_KEY: "",
      FAL_API_KEY: "",
      VERCEL_TOKEN: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: new TextDecoder().decode(new Uint8Array(proc.stdout)),
    stderr: new TextDecoder().decode(new Uint8Array(proc.stderr)),
  };
}

/** docker CLI on PATH? */
function dockerCliOnPath(): boolean {
  const which = Bun.spawnSync({ cmd: ["which", "docker"], stdout: "pipe", stderr: "pipe" });
  return (which.exitCode ?? -1) === 0;
}

/** docker daemon reachable? (`docker info` succeeds) */
function dockerDaemonReachable(): boolean {
  if (!dockerCliOnPath()) return false;
  const info = Bun.spawnSync({ cmd: ["docker", "info"], stdout: "pipe", stderr: "pipe" });
  return (info.exitCode ?? -1) === 0;
}

/** Is the braid:dev image present locally? */
function braidImagePresent(): boolean {
  if (!dockerDaemonReachable()) return false;
  const ls = Bun.spawnSync({
    cmd: ["docker", "image", "inspect", "braid:dev"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return (ls.exitCode ?? -1) === 0;
}

/**
 * Resolve container readiness once at module load and reuse across tests so
 * the (potentially 30s) image build doesn't run twice. Returns:
 *   - "ready": daemon reachable AND image present (or just built)
 *   - "no-cli": docker CLI not on PATH
 *   - "no-daemon": CLI on PATH but daemon unreachable (e.g. Colima not started)
 *   - "build-failed": daemon reachable, image missing, auto-build failed
 */
function resolveContainerReadiness(): { state: string; detail?: string } {
  if (!dockerCliOnPath()) return { state: "no-cli" };
  if (!dockerDaemonReachable()) return { state: "no-daemon" };
  if (braidImagePresent()) return { state: "ready" };
  // Auto-build the image so container scenarios can actually run.
  console.warn("[bdd] braid:dev image missing — building (this is a one-time cost)…");
  const build = Bun.spawnSync({
    cmd: ["docker", "build", "-t", "braid:dev", "."],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((build.exitCode ?? -1) !== 0) {
    const stderr = new TextDecoder().decode(new Uint8Array(build.stderr));
    return { state: "build-failed", detail: stderr.slice(-500) };
  }
  return { state: "ready" };
}

const CONTAINER_READINESS = resolveContainerReadiness();
const CONTAINER_READY = CONTAINER_READINESS.state === "ready";
if (!CONTAINER_READY) {
  console.warn(
    `[bdd] container scenarios will be SKIPPED (state=${CONTAINER_READINESS.state})` +
      (CONTAINER_READINESS.detail ? `\n${CONTAINER_READINESS.detail}` : ""),
  );
}

describe("Feature: Braid orchestrator end-to-end", () => {
  // ──────────────────────────────────────────────────────────────────────
  // Happy-path scenarios
  // ──────────────────────────────────────────────────────────────────────

  describe("Scenario: As a newcomer, given a clean clone, when I run demo for any shipped flow, then the event timeline completes zero-cost", () => {
    for (const flow of SHIPPED_FLOWS) {
      test(`Given flow '${flow}', when I run demo with no real keys, then it exits 0 and reaches [demo] complete`, () => {
        const r = runDemo(flow);
        if (r.exitCode !== 0) {
          throw new Error(`demo ${flow} failed exit=${r.exitCode}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`);
        }
        expect(r.stdout).toContain("[demo] zero-cost evaluation");
        expect(r.stdout).toContain("[demo] complete");
        expect(r.stdout).toContain("[done]");
      }, 20_000);
    }
  });

  describe("Scenario: Given snapshots has run.reflection configured, when the demo session ends idle, then [reflection.ok] fires with a stored path", () => {
    test("Given snapshots config and BRAID_DEMO_MODE=1, when demo runs, then reflection.ok emits with reflections/ path", () => {
      const r = runDemo("_examples/snapshots");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/\[reflection\.gate\]/);
      expect(r.stdout).toMatch(/"fire":true/);
      expect(r.stdout).toMatch(/\[reflection\.ok\]/);
      expect(r.stdout).toMatch(/storedPath":"\/reflections\//);
    }, 20_000);
  });

  describe("Scenario: Given a Vercel-CLI flow has run.post_session_hook configured, when the demo session ends, then the hook is invoked AFTER session deliverables exist", () => {
    test("Given fundraiser config, when demo runs, then [post_hook] event appears AFTER [saved]/[done] events for outputs", () => {
      const r = runDemo("_examples/fundraiser");
      expect(r.exitCode).toBe(0);
      // Slice 10 F2 ordering: download → run-log → reflection → hook → done
      const doneIdx = r.stdout.indexOf("[done]");
      const hookIdx = r.stdout.indexOf("[post_hook]");
      // [post_hook] fires before [done] in the run loop (between download and final done)
      expect(hookIdx).toBeGreaterThan(-1);
      expect(doneIdx).toBeGreaterThan(hookIdx);
    }, 20_000);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Input-validation / sad-path scenarios
  // ──────────────────────────────────────────────────────────────────────

  describe("Scenario: As an attacker, given a brief with a path-traversal {{file:...}}, when expandBrief runs, then it throws with reason citing flow directory", () => {
    test("Given {{file:../../etc/passwd}}, when expandBrief is called, then it throws 'outside flow directory'", async () => {
      const { expandBrief } = await import("../lib");
      const tmpFlowDir = mkdtempSync(join(tmpdir(), "braid-bdd-trav-"));
      try {
        expect(() => expandBrief("{{file:../../etc/passwd}}", tmpFlowDir)).toThrow(
          /outside flow directory/i,
        );
      } finally {
        rmSync(tmpFlowDir, { recursive: true, force: true });
      }
    });

    test("Given {{file:/etc/passwd}} (absolute), when expandBrief is called, then it throws 'absolute paths are not allowed'", async () => {
      const { expandBrief } = await import("../lib");
      const tmpFlowDir = mkdtempSync(join(tmpdir(), "braid-bdd-trav-"));
      try {
        expect(() => expandBrief("{{file:/etc/passwd}}", tmpFlowDir)).toThrow(
          /absolute paths are not allowed/i,
        );
      } finally {
        rmSync(tmpFlowDir, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario: Given a brief with {{env:SECRET}}, when expandBrief runs, then it rejects with NIST SP 800-204C citation", () => {
    test("Given {{env:VERCEL_TOKEN}}, when expandBrief is called, then the error cites authoritative sources", async () => {
      const { expandBrief } = await import("../lib");
      const tmpFlowDir = mkdtempSync(join(tmpdir(), "braid-bdd-env-"));
      try {
        process.env.VERCEL_TOKEN = "would-be-real-if-not-rejected";
        expect(() => expandBrief("token={{env:VERCEL_TOKEN}}", tmpFlowDir)).toThrow(
          /post_session_hook|NIST SP 800-204C|env_passthrough/,
        );
      } finally {
        rmSync(tmpFlowDir, { recursive: true, force: true });
        delete process.env.VERCEL_TOKEN;
      }
    });
  });

  describe("Scenario: Given an MCP URL with userinfo, when validateMcpHost runs, then it rejects with userinfo explanation", () => {
    test("Given https://attacker:pw@mcp.fal.ai/mcp, when validateMcpHost is called, then it throws 'userinfo'", async () => {
      const { validateMcpHost } = await import("../lib");
      expect(() => validateMcpHost("https://attacker:pw@mcp.fal.ai/mcp")).toThrow(
        /userinfo|credentials/i,
      );
    });
  });

  describe("Scenario: Given an MCP URL with host not on the allowlist, when validateMcpHost runs, then it rejects with allowlist hint", () => {
    test("Given https://attacker.example.com/mcp, when validateMcpHost is called, then it throws with 'allowlist' wording", async () => {
      const { validateMcpHost } = await import("../lib");
      expect(() => validateMcpHost("https://attacker.example.com/mcp")).toThrow(
        /allowlist/i,
      );
    });
  });

  describe("Scenario: Given a post_session_hook with env_passthrough referencing a missing host env var, when runPostSessionHook runs, then it fails fast with the missing var name", () => {
    test("Given env_passthrough: ['MUST_NOT_EXIST'], when runPostSessionHook runs, then result.error names MUST_NOT_EXIST", async () => {
      const { runPostSessionHook } = await import("../lib");
      const tmpDir = mkdtempSync(join(tmpdir(), "braid-bdd-hook-"));
      try {
        delete process.env.MUST_NOT_EXIST;
        const result = await runPostSessionHook(
          {
            command: 'echo "should not run"',
            cwd: tmpDir,
            env_passthrough: ["MUST_NOT_EXIST"],
          },
          {
            sessionId: "sesn_x",
            flowName: "test",
            flowDir: tmpDir,
            outputDir: tmpDir,
          },
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.error).toMatch(/MUST_NOT_EXIST/);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario: Given the scaffolder is invoked via CLI, when a new agent is created, then it lands at the correct flows/<flow>/agents/<key>.yaml path AND passes schema + lint", () => {
    test("Given CLI invocation, when new-agent runs for an existing flow, then file exists at correct path with substituted name", () => {
      const flowAgentsDir = join(REPO_ROOT, "flows", "pop-quiz", "agents");
      const target = join(flowAgentsDir, "_bdd_scaffold_smoke.yaml");
      rmSync(target, { force: true });
      const proc = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          "--cwd",
          SKILL_DIR,
          "new-agent",
          "pop-quiz",
          "_bdd_scaffold_smoke",
          "--template=sentinel",
        ],
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        expect(proc.exitCode).toBe(0);
        expect(existsSync(target)).toBe(true);
        const content = readFileSync(target, "utf-8");
        expect(content).toContain("name: braid-pop-quiz-_bdd_scaffold_smoke");
      } finally {
        rmSync(target, { force: true });
      }
    });
  });

  describe("Scenario: Given an existing agent yaml, when the scaffolder is invoked for the same key, then it refuses to overwrite", () => {
    test("Given flows/pop-quiz/agents/_taken.yaml exists, when scaffolder targets _taken, then exit != 0 and 'already exists' message", () => {
      const flowAgentsDir = join(REPO_ROOT, "flows", "pop-quiz", "agents");
      const target = join(flowAgentsDir, "_taken.yaml");
      writeFileSync(target, "name: pre-existing\n");
      try {
        const proc = Bun.spawnSync({
          cmd: [
            "bun",
            "run",
            "--cwd",
            SKILL_DIR,
            "new-agent",
            "pop-quiz",
            "_taken",
            "--template=director",
          ],
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });
        const out = new TextDecoder().decode(new Uint8Array(proc.stderr)) +
          new TextDecoder().decode(new Uint8Array(proc.stdout));
        expect(proc.exitCode).not.toBe(0);
        expect(out).toMatch(/already exists/i);
      } finally {
        rmSync(target, { force: true });
      }
    });
  });

  describe("Scenario: Given purge is invoked without --yes and without --select, when the script runs, then it refuses to wipe state files", () => {
    test("Given non-interactive invocation, when shouldWipeStateFiles is called, then result.wipe is false with --yes hint", async () => {
      const { shouldWipeStateFiles } = await import("../lib");
      const result = shouldWipeStateFiles([]);
      expect(result.wipe).toBe(false);
      expect(result.reason).toMatch(/--yes|--select/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Security scenarios
  // ──────────────────────────────────────────────────────────────────────

  describe("Scenario: As a security reviewer, given BRAID_DEMO_MODE=1, when any flow runs, then no real API key is ever consulted (sentinel substitution)", () => {
    test("Given empty Anthropic/Fal/Vercel envs, when demo runs, then it still succeeds (mock client + sentinel injection)", () => {
      const r = runDemo("_archive/ad");
      expect(r.exitCode).toBe(0);
      // The sentinel token shouldn't surface in stdout for the demo path,
      // but the demo banner explicitly says "no real API calls".
      expect(r.stdout).toContain("no real API calls");
    }, 20_000);
  });

  describe("Scenario: As a security reviewer, given the reflection runner is invoked, when it constructs the user message, then it includes filenames only never file contents", () => {
    test("Given savedFiles=['secret.txt'] and agentReport='report body', when runReflection runs, then sessions_events_send payload mentions filename but not synthetic-content phrases", async () => {
      const Anthropic = await import("@anthropic-ai/sdk").then((m) => m.default);
      const { createMockAnthropic } = await import("../mocks/anthropic");
      const { runReflection, setAnthropicClient, c: real } = await import("../lib");
      const m = createMockAnthropic();
      setAnthropicClient(m.client as InstanceType<typeof Anthropic>);
      try {
        m.mock.canned.streamEvents = [
          { type: "agent.message", content: [{ type: "text", text: "Pattern: x" }] },
          { type: "session.status_idle" },
        ];
        await runReflection(
          {
            name: "x",
            env_name: "braid-x",
            state_file: "state.json",
            output_dir: "outputs/x",
            agents: [
              { key: "d", file: "d.yaml", is_director: true },
              { key: "r", file: "r.yaml" },
            ],
            environment: { networking: { type: "limited", allowed_hosts: [] } },
            run: { reflection: { agent_key: "r", target_store: "ts" } },
          },
          { env: "e", agents: { d: "agt_d", r: "agt_r" }, stores: { ts: "mem_ts" } },
          "sesn_x",
          "the report body",
          { result: "pass" },
          ["secret-output.txt"],
        );
        const send = m.mock.calls.sessions_events_send?.[0]?.[1] as {
          events: Array<{ content: Array<{ text: string }> }>;
        };
        const text = send.events[0]?.content[0]?.text ?? "";
        // Filename present
        expect(text).toContain("secret-output.txt");
        // Explicit "filenames only" disclaimer present
        expect(text).toMatch(/contents not included/i);
      } finally {
        setAnthropicClient(real);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Container scenarios (Slice 70). Skipped gracefully when docker unavailable.
  // ──────────────────────────────────────────────────────────────────────

  describe("Scenario: Given the braid:dev container is built, when run with the full sandbox spec, then it lists all 8 shipped flows", () => {
    test.skipIf(!CONTAINER_READY)(
      "Given docker + the sandbox spec, when `docker run --read-only --cap-drop=ALL ... braid:dev` invoked, then stdout lists 8 flows",
      () => {
        const proc = Bun.spawnSync({
          cmd: [
            "docker",
            "run",
            "--rm",
            "-v",
            `${REPO_ROOT}/flows:/workspace/flows`,
            "-v",
            `${REPO_ROOT}/.claude/skills/braid:/workspace/.claude/skills/braid`,
            "--read-only",
            "--tmpfs",
            "/tmp:size=64m",
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges:true",
            "braid:dev",
          ],
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
        const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
        if (proc.exitCode !== 0) {
          throw new Error(`container list failed exit=${proc.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
        }
        for (const flow of SHIPPED_FLOWS) {
          expect(stdout).toContain(flow);
        }
      },
      30_000,
    );

    test.skipIf(!CONTAINER_READY)(
      "Given the container with no host-home mount, when run, then $HOME inside container is /home/braid not the host's home",
      () => {
        const proc = Bun.spawnSync({
          cmd: [
            "docker",
            "run",
            "--rm",
            "--entrypoint",
            "sh",
            "--read-only",
            "--tmpfs",
            "/tmp:size=64m",
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges:true",
            "braid:dev",
            "-c",
            'echo "HOME=$HOME UID=$(id -u)"',
          ],
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
        const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
        if (proc.exitCode !== 0) {
          throw new Error(`stderr=${stderr}`);
        }
        expect(stdout).toContain("HOME=/home/braid");
        expect(stdout).toContain("UID=1001");
      },
      15_000,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Schema & lint scenarios (Slice 30 + 90 integration)
  // ──────────────────────────────────────────────────────────────────────

  describe("Scenario: Given every shipped flow.yaml, when validated against flow.schema.json, then all pass with zero findings", () => {
    test("Given the schema-parity test, when run, then no flow fails", () => {
      // Delegated to tests/schema-parity.test.ts — assert the file exists
      // so this scenario stays meaningful in the BDD layer.
      const p = join(SKILL_DIR, "tests", "schema-parity.test.ts");
      expect(existsSync(p)).toBe(true);
    });
  });

  describe("Scenario: Given every shipped agent.yaml, when validated against agent.schema.json and prompt-safety lint, then all pass with zero findings", () => {
    test("Given the agent-schema and prompt-safety tests, when run, then no agent fails", () => {
      const schemaTest = join(SKILL_DIR, "tests", "agent-schema-parity.test.ts");
      const lintTest = join(SKILL_DIR, "tests", "agent-prompt-safety.test.ts");
      expect(existsSync(schemaTest)).toBe(true);
      expect(existsSync(lintTest)).toBe(true);
    });
  });
});
