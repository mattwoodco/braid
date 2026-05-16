/**
 * Slice 10 §1.F5 — MCP server URLs must be on an explicit allowlist before
 * a vault credential is issued against them.
 *
 * Authority:
 *   https://platform.claude.com/docs/en/managed-agents/vaults — vault matches
 *   server URL at session runtime and injects the token. There is no
 *   server-side host allowlist; client-side allowlisting is the only defense
 *   against a typo'd or compromised `mcp_server_url` in flow.yaml.
 *
 * OpenClaw mirror: CVE-2026-25253 — URL parameter trusted without validation.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { validateMcpHost } from "../lib";

describe("validateMcpHost", () => {
  beforeEach(() => {
    delete process.env.BRAID_MCP_ALLOWLIST;
  });
  afterEach(() => {
    delete process.env.BRAID_MCP_ALLOWLIST;
  });

  test("accepts default-allowed host: mcp.fal.ai", () => {
    expect(() => validateMcpHost("https://mcp.fal.ai/mcp")).not.toThrow();
  });

  test("accepts default-allowed host: mcp.vercel.com", () => {
    expect(() => validateMcpHost("https://mcp.vercel.com")).not.toThrow();
  });

  test("rejects http (non-https) URL", () => {
    expect(() => validateMcpHost("http://mcp.fal.ai/mcp")).toThrow(/https/i);
  });

  test("rejects URL whose host is not on the allowlist", () => {
    expect(() => validateMcpHost("https://attacker.example.com/mcp")).toThrow(
      /allowlist/i,
    );
  });

  test("rejects malformed URL", () => {
    expect(() => validateMcpHost("not-a-url")).toThrow();
  });

  test("respects BRAID_MCP_ALLOWLIST env override", () => {
    process.env.BRAID_MCP_ALLOWLIST = "custom.example.com,extra.example.com";
    expect(() => validateMcpHost("https://custom.example.com/mcp")).not.toThrow();
    expect(() => validateMcpHost("https://extra.example.com/path")).not.toThrow();
    expect(() => validateMcpHost("https://other.example.com/mcp")).toThrow(
      /allowlist/i,
    );
  });

  test("rejects host with embedded credentials (URL userinfo)", () => {
    expect(() =>
      validateMcpHost("https://attacker:pw@mcp.fal.ai/mcp"),
    ).toThrow(/userinfo|credentials/i);
  });
});
