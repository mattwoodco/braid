/**
 * Slice 10 §1.F1 — environment.networking defaults to `limited`.
 *
 * Per Anthropic environments docs:
 *   "For production deployments, use `limited` networking with an
 *    explicit `allowed_hosts` list. Follow the principle of least
 *    privilege..."
 * Source: https://platform.claude.com/docs/en/managed-agents/environments
 *
 * Until this RED test passes, lib.ts hardcodes `unrestricted` in
 * ensureResources (line 179), which is the Anthropic-documented
 * production anti-pattern.
 */

import { test, expect, describe } from "bun:test";
import { applyDefaults } from "../lib";

describe("applyDefaults — environment.networking", () => {
  test("defaults to limited with empty allowed_hosts when manifest omits environment", () => {
    const m = applyDefaults({
      name: "test-flow",
      agents: [{ key: "d", file: "d.yaml" }],
    });
    expect(m.environment).toBeDefined();
    expect(m.environment?.networking).toEqual({
      type: "limited",
      allowed_hosts: [],
      allow_mcp_servers: false,
      allow_package_managers: false,
    });
  });

  test("preserves explicit unrestricted opt-in", () => {
    const m = applyDefaults({
      name: "test-flow",
      agents: [{ key: "d", file: "d.yaml" }],
      environment: { networking: { type: "unrestricted" } },
    });
    expect(m.environment?.networking?.type).toBe("unrestricted");
  });

  test("preserves explicit limited config with allowed_hosts", () => {
    const m = applyDefaults({
      name: "test-flow",
      agents: [{ key: "d", file: "d.yaml" }],
      environment: {
        networking: {
          type: "limited",
          allowed_hosts: ["api.example.com"],
          allow_mcp_servers: true,
        },
      },
    });
    expect(m.environment?.networking).toEqual({
      type: "limited",
      allowed_hosts: ["api.example.com"],
      allow_mcp_servers: true,
      allow_package_managers: false,
    });
  });
});
