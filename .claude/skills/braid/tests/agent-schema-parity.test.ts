/**
 * Slice 90 — agent.schema.json validates every shipped agent yaml.
 *
 * Mirrors the flow-schema parity test (Slice 30) for the agent layer.
 * Authority: Slice 90 architectural decision 7f86f4da.
 */

import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCHEMA_PATH = join(import.meta.dir, "..", "agent.schema.json");
const FLOWS_DIR = join(REPO_ROOT, "flows");
const EXAMPLES_AGENTS = join(import.meta.dir, "..", "examples", "agents");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const validate = ajv.compile(schema);

function findAgentYamls(): string[] {
  const out: string[] = [];
  if (existsSync(FLOWS_DIR)) {
    for (const flow of readdirSync(FLOWS_DIR, { withFileTypes: true })) {
      if (!flow.isDirectory() || flow.name === "_archive") continue;
      const agentsDir = join(FLOWS_DIR, flow.name, "agents");
      if (!existsSync(agentsDir)) continue;
      for (const ent of readdirSync(agentsDir, { withFileTypes: true })) {
        if (ent.isFile() && ent.name.endsWith(".yaml")) {
          out.push(join(agentsDir, ent.name));
        }
      }
    }
  }
  if (existsSync(EXAMPLES_AGENTS)) {
    for (const ent of readdirSync(EXAMPLES_AGENTS, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith(".yaml")) {
        out.push(join(EXAMPLES_AGENTS, ent.name));
      }
    }
  }
  return out;
}

describe("agent.schema.json validates every shipped agent yaml", () => {
  const files = findAgentYamls();

  test("at least one agent yaml exists", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const path of files) {
    const rel = path.slice(REPO_ROOT.length + 1);
    test(`${rel} validates`, () => {
      const data = parse(readFileSync(path, "utf-8"));
      const ok = validate(data);
      if (!ok) {
        const msg = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join("\n  ");
        throw new Error(`${rel} failed validation:\n  ${msg}`);
      }
      expect(ok).toBe(true);
    });
  }
});

describe("agent.schema.json rejects malformed input", () => {
  test("missing required `system` fails", () => {
    expect(validate({ name: "x" })).toBe(false);
  });

  test("empty `system` fails (minLength 1)", () => {
    expect(validate({ name: "x", system: "" })).toBe(false);
  });

  test("invalid permission_policy.type fails", () => {
    expect(
      validate({
        name: "x",
        system: "ok",
        tools: [{ type: "t", default_config: { permission_policy: { type: "bogus" } } }],
      }),
    ).toBe(false);
  });

  test("unknown top-level key fails (additionalProperties:false)", () => {
    expect(validate({ name: "x", system: "ok", surprise_field: true })).toBe(false);
  });
});
