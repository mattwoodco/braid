/**
 * Slice 10 §1.F3 — when Braid injects a default agent_toolset_20260401 (because
 * an agent's yaml file declares no `tools:` block), the injected default uses
 * `permission_policy: always_ask`, not the platform's `always_allow`.
 *
 * Authority:
 *   Pluto Security hardening guide for Claude Managed Agents:
 *   "If your agent needs bash or write access, use `always_ask`."
 *
 * OpenClaw mirror: CVE-2026-29607, CVE-2026-28460 — command approval bypass.
 *
 * Flows that *explicitly* opt into `always_allow` in their flow.yaml keep
 * their behavior (with a `# rationale:` comment). The injected default is
 * what catches agents the author forgot to configure.
 */

import { test, expect, describe } from "bun:test";
import { DEFAULT_AGENT_TOOLS } from "../lib";

describe("DEFAULT_AGENT_TOOLS", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_AGENT_TOOLS)).toBe(true);
    expect(DEFAULT_AGENT_TOOLS.length).toBeGreaterThan(0);
  });

  test("first entry is the agent_toolset_20260401", () => {
    const first = DEFAULT_AGENT_TOOLS[0] as {
      type: string;
      default_config?: { permission_policy?: { type: string } };
    };
    expect(first.type).toBe("agent_toolset_20260401");
  });

  test("default permission_policy is always_ask, not always_allow", () => {
    const first = DEFAULT_AGENT_TOOLS[0] as {
      default_config?: { permission_policy?: { type: string } };
    };
    expect(first.default_config?.permission_policy?.type).toBe("always_ask");
    expect(first.default_config?.permission_policy?.type).not.toBe(
      "always_allow",
    );
  });
});
