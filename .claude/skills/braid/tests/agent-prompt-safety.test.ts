/**
 * Slice 90 — prompt-safety lint as a CI gate.
 *
 * Runs lintAgentSource against every shipped agent yaml and asserts no
 * findings. Also exercises the rule set with deliberately-bad fixtures so
 * we know the rules actually fire when they should.
 *
 * Authority: Slice 90 SecurityArchitecture decision 6e02c9cb.
 */

import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { lintAgentSource, type AgentLintFinding } from "../lib-agent-lint";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "flows");
const EXAMPLES_AGENTS = join(import.meta.dir, "..", "examples", "agents");

function shippedAgentFiles(): string[] {
  const out: string[] = [];
  if (existsSync(FLOWS_DIR)) {
    for (const flow of readdirSync(FLOWS_DIR, { withFileTypes: true })) {
      if (!flow.isDirectory() || flow.name === "_archive") continue;
      const agents = join(FLOWS_DIR, flow.name, "agents");
      if (!existsSync(agents)) continue;
      for (const e of readdirSync(agents, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".yaml")) out.push(join(agents, e.name));
      }
    }
  }
  if (existsSync(EXAMPLES_AGENTS)) {
    for (const e of readdirSync(EXAMPLES_AGENTS, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".yaml")) out.push(join(EXAMPLES_AGENTS, e.name));
    }
  }
  return out;
}

describe("agent-prompt-safety lint — shipped yamls are clean", () => {
  for (const path of shippedAgentFiles()) {
    const rel = path.slice(REPO_ROOT.length + 1);
    test(`${rel} passes the lint`, () => {
      const findings = lintAgentSource({ source: readFileSync(path, "utf-8") });
      if (findings.length > 0) {
        const msg = findings
          .map((f) => `  [${f.rule}] line ${f.line}: ${f.excerpt}\n    → ${f.why}`)
          .join("\n");
        throw new Error(`${rel} has prompt-safety findings:\n${msg}`);
      }
      expect(findings).toEqual([]);
    });
  }
});

describe("agent-prompt-safety lint — rules fire on bad input", () => {
  test("flags {{env:...}} in system prompt", () => {
    const findings = lintAgentSource({
      source: 'system: |\n  Use the token: {{env:VERCEL_TOKEN}}\n',
    });
    expect(findings.some((f) => f.rule === "no-env-interpolation")).toBe(true);
  });

  test("flags --token= CLI literal", () => {
    const findings = lintAgentSource({
      source: 'system: |\n  Run: vercel deploy --token=$VAR\n',
    });
    expect(findings.some((f) => f.rule === "no-token-cli-arg")).toBe(true);
  });

  test("flags Authorization Bearer literal", () => {
    const findings = lintAgentSource({
      source: 'system: |\n  curl -H "Authorization: Bearer abc123" example.com\n',
    });
    expect(findings.some((f) => f.rule === "no-authorization-header-literal")).toBe(true);
  });

  test("flags http:// URL", () => {
    const findings = lintAgentSource({
      source: 'system: |\n  Use http://insecure.example.com\n',
    });
    expect(findings.some((f) => f.rule === "no-http-url")).toBe(true);
  });

  test("flags MCP host not on the allowlist", () => {
    const findings = lintAgentSource({
      source: 'mcp_servers:\n  - url: https://mcp.attacker.example.com/mcp\n',
    });
    expect(findings.some((f) => f.rule === "mcp-host-not-on-allowlist")).toBe(true);
  });

  test("does NOT flag mcp.fal.ai (default allowlist member)", () => {
    const findings = lintAgentSource({
      source: 'mcp_servers:\n  - url: https://mcp.fal.ai/mcp\n',
    });
    expect(findings.filter((f: AgentLintFinding) => f.rule === "mcp-host-not-on-allowlist")).toEqual([]);
  });

  test("respects custom mcpAllowlist when supplied", () => {
    const findings = lintAgentSource({
      source: 'mcp_servers:\n  - url: https://mcp.custom.example.com/mcp\n',
      mcpAllowlist: new Set(["mcp.custom.example.com"]),
    });
    expect(findings.filter((f) => f.rule === "mcp-host-not-on-allowlist")).toEqual([]);
  });

  test("returns line numbers and excerpts that point at the offending text", () => {
    const source = [
      "name: x",
      "system: |",
      "  no problem here",
      "  Use the token: {{env:FOO}}",
      "  also fine",
    ].join("\n");
    const findings = lintAgentSource({ source });
    const hit = findings.find((f) => f.rule === "no-env-interpolation");
    expect(hit).toBeDefined();
    expect(hit?.line).toBe(4);
    expect(hit?.excerpt).toContain("{{env:FOO}}");
  });
});
