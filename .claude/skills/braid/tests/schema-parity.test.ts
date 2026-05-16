/**
 * Slice 30 §3.S1 — flow.schema.json must validate every shipped flow.yaml.
 *
 * Defect: the schema set `additionalProperties: false` everywhere but the
 * `Manifest` TypeScript type grew during Slices 10 and 20 to include:
 *   - `environment.networking` (NetworkingSpec)
 *   - `run.post_session_hook` (PostSessionHookSpec)
 *   - `run.sentinel_context_store`
 *   - `run.log_runs`
 *   - `memory_stores[].dream_instructions`
 *
 * A CI step that runs JSON-Schema validation would reject every current flow.
 * Slice 30 brings the schema back in sync.
 */

import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCHEMA_PATH = join(import.meta.dir, "..", "flow.schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const validate = ajv.compile(schema);

const flowDirs = existsSync(join(REPO_ROOT, "flows"))
  ? readdirSync(join(REPO_ROOT, "flows"), { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          d.name !== "_archive" &&
          existsSync(join(REPO_ROOT, "flows", d.name, "flow.yaml")),
      )
      .map((d) => d.name)
  : [];

describe("flow.schema.json validates every shipped flow.yaml", () => {
  test("at least one shipped flow exists", () => {
    expect(flowDirs.length).toBeGreaterThan(0);
  });

  for (const flowName of flowDirs) {
    test(`${flowName}/flow.yaml validates`, () => {
      const yamlPath = join(REPO_ROOT, "flows", flowName, "flow.yaml");
      const data = parse(readFileSync(yamlPath, "utf-8"));
      const ok = validate(data);
      if (!ok) {
        const msg = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join("\n  ");
        throw new Error(`${flowName}/flow.yaml failed validation:\n  ${msg}`);
      }
      expect(ok).toBe(true);
    });
  }
});

describe("schema rejects unknown top-level keys (additionalProperties:false works)", () => {
  test("unknown_key at top level fails validation", () => {
    const ok = validate({
      name: "x",
      agents: [{ key: "a", file: "a.yaml" }],
      unknown_top_level_key: true,
    });
    expect(ok).toBe(false);
  });
});
