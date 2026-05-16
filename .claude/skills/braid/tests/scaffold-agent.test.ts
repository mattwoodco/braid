/**
 * Slice 90 — scaffolder pure-helper tests.
 *
 * The CLI entry point is integration-tested by the lint passing on every
 * template + the scaffolder producing schema-valid output. The actual
 * scaffolding logic is tested here as a pure function.
 *
 * Authority: Slice 90 architectural decision 7f86f4da.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { listTemplates, renderTemplate, scaffoldAgent } from "../scripts/new-agent";
import { lintAgentSource } from "../lib-agent-lint";

const SKILL_DIR = join(import.meta.dir, "..");
const TEMPLATES_DIR = join(SKILL_DIR, "examples", "agents");
const SCHEMA_PATH = join(SKILL_DIR, "agent.schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const validateAgent = ajv.compile(schema);

let repoRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "braid-scaffold-test-"));
});
afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
beforeEach(() => {
  // Reset the flow dir each test
  const flowAgents = join(repoRoot, "flows", "myflow", "agents");
  if (existsSync(flowAgents)) rmSync(flowAgents, { recursive: true, force: true });
});

describe("scaffolder CLI entry — regression test for SKILL_DIR resolution", () => {
  test("CLI invocation from REPO_ROOT writes to the correct flows/<flow>/agents/ path", () => {
    // Real subprocess. The bug I shipped (and now fixed) was that the CLI
    // computed SKILL_DIR by string-concatenating /.. to a file URL and then
    // calling dirname — which silently produced a nonsense path so
    // listTemplates returned []. The unit tests injected templatesDir so
    // never exercised this. Now: run the CLI for real and verify the file
    // lands at the right place.
    const flowAgentsDir = join(REPO_ROOT, "flows", "pop-quiz", "agents");
    const target = join(flowAgentsDir, "_cli_smoke.yaml");
    rmSync(target, { force: true });
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        "--cwd",
        join(REPO_ROOT, ".claude", "skills", "braid"),
        "new-agent",
        "pop-quiz",
        "_cli_smoke",
        "--template=sentinel",
      ],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
    const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
    try {
      expect(proc.exitCode).toBe(0);
      expect(stdout + stderr).toContain("✓ wrote");
      expect(existsSync(target)).toBe(true);
      const content = readFileSync(target, "utf-8");
      expect(content).toContain("name: braid-pop-quiz-_cli_smoke");
    } finally {
      rmSync(target, { force: true });
    }
  }, 15_000);
});

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

describe("listTemplates", () => {
  test("returns the shipped templates from examples/agents/", () => {
    const templates = listTemplates(TEMPLATES_DIR);
    expect(templates).toContain("director");
    expect(templates).toContain("web-builder");
    expect(templates).toContain("reflector");
    expect(templates).toContain("sentinel");
  });

  test("returns [] when the templates dir does not exist", () => {
    expect(listTemplates("/no/such/path")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  test("substitutes {{FLOW}} and {{KEY}}", () => {
    const out = renderTemplate("name: braid-{{FLOW}}-{{KEY}}\n", "fundraiser", "director");
    expect(out).toBe("name: braid-fundraiser-director\n");
  });

  test("substitutes multiple occurrences", () => {
    const out = renderTemplate("{{FLOW}}/{{FLOW}}/{{KEY}}", "f", "k");
    expect(out).toBe("f/f/k");
  });
});

describe("scaffoldAgent", () => {
  test("writes a new agent yaml from the director template", () => {
    const result = scaffoldAgent(
      { flow: "myflow", key: "director", template: "director" },
      { repoRoot, templatesDir: TEMPLATES_DIR },
    );
    expect(result.wrote).toBe(true);
    expect(result.path).toBe(join(repoRoot, "flows/myflow/agents/director.yaml"));
    expect(existsSync(result.path!)).toBe(true);
    const content = readFileSync(result.path!, "utf-8");
    expect(content).toContain("name: braid-myflow-director");
  });

  test("scaffold output validates against agent.schema.json", () => {
    const result = scaffoldAgent(
      { flow: "myflow", key: "tester", template: "web-builder" },
      { repoRoot, templatesDir: TEMPLATES_DIR },
    );
    expect(result.wrote).toBe(true);
    const parsed = parse(readFileSync(result.path!, "utf-8"));
    const ok = validateAgent(parsed);
    if (!ok) {
      const msg = (validateAgent.errors ?? [])
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join(", ");
      throw new Error(`scaffold output failed schema validation: ${msg}`);
    }
    expect(ok).toBe(true);
  });

  test("scaffold output passes the prompt-safety lint", () => {
    const result = scaffoldAgent(
      { flow: "myflow", key: "myreflector", template: "reflector" },
      { repoRoot, templatesDir: TEMPLATES_DIR },
    );
    expect(result.wrote).toBe(true);
    const findings = lintAgentSource({ source: readFileSync(result.path!, "utf-8") });
    expect(findings).toEqual([]);
  });

  test("refuses to overwrite an existing file", () => {
    mkdirSync(join(repoRoot, "flows/myflow/agents"), { recursive: true });
    writeFileSync(join(repoRoot, "flows/myflow/agents/director.yaml"), "existing\n");
    const result = scaffoldAgent(
      { flow: "myflow", key: "director", template: "director" },
      { repoRoot, templatesDir: TEMPLATES_DIR },
    );
    expect(result.wrote).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  test("rejects unknown templates with available list", () => {
    const result = scaffoldAgent(
      { flow: "myflow", key: "x", template: "doesnotexist" },
      { repoRoot, templatesDir: TEMPLATES_DIR },
    );
    expect(result.wrote).toBe(false);
    expect(result.error).toMatch(/unknown template/i);
    expect(result.available_templates).toContain("director");
  });

  test("dry-run does NOT write the file", () => {
    const result = scaffoldAgent(
      { flow: "myflow", key: "dryrun", template: "sentinel" },
      { repoRoot, templatesDir: TEMPLATES_DIR, dryRun: true },
    );
    expect(result.wrote).toBe(false);
    expect(result.content).toContain("name: braid-myflow-dryrun");
    expect(existsSync(join(repoRoot, "flows/myflow/agents/dryrun.yaml"))).toBe(false);
  });
});
