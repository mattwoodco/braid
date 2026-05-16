/**
 * Slice 90 — pure prompt-safety lint for agent yaml files.
 *
 * Catches the semantic issues schemas can't express:
 *   - {{env:...}} references in system prompts (Slice 10 F2 forbids these)
 *   - --token= / --password= CLI flag literals (CVE-2026-44479 class)
 *   - Bearer token / authorization header literals
 *   - Raw http:// MCP URLs (must be https) or unlisted hostnames
 *
 * Authority: Slice 90 SecurityArchitecture decision 6e02c9cb.
 *
 * Pure function; the test harness reads files and calls this for each.
 */

export type AgentLintFinding = {
  rule: string;
  line: number;
  excerpt: string;
  why: string;
};

export type AgentLintInput = {
  /** File contents as a single string. */
  source: string;
  /** Optional allowlist of MCP hostnames. Defaults to the project's BRAID_MCP_ALLOWLIST defaults (mcp.fal.ai, mcp.vercel.com). */
  mcpAllowlist?: ReadonlySet<string>;
};

const DEFAULT_MCP_ALLOWLIST: ReadonlySet<string> = new Set([
  "mcp.fal.ai",
  "mcp.vercel.com",
]);

const RULES: Array<{
  id: string;
  re: RegExp;
  why: string;
}> = [
  {
    id: "no-env-interpolation",
    re: /\{\{\s*env\s*:[^}]+\}\}/i,
    why: "Slice 10 F2 forbids {{env:...}} in agent prompts — secrets must flow via host post_session_hook + env_passthrough, never the brief.",
  },
  {
    id: "no-token-cli-arg",
    re: /--token\s*=|--password\s*=|--api-?key\s*=/i,
    why: "CVE-2026-44479-class — tokens passed as CLI args leak via process listings and shell history. Use env vars consumed by the CLI natively.",
  },
  {
    id: "no-authorization-header-literal",
    re: /Authorization\s*:\s*Bearer\s+\S+/i,
    why: "Hard-coded Authorization headers in prompts encode the secret in the agent context — exfiltrable. Use vault credentials.",
  },
  {
    id: "no-http-url",
    re: /\bhttp:\/\/[^\s'"]+/,
    why: "Plain http:// is rejected by the MCP host allowlist (Slice 10 F5). Use https only.",
  },
];

export function lintAgentSource(input: AgentLintInput): AgentLintFinding[] {
  const findings: AgentLintFinding[] = [];
  const lines = input.source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (m) {
        findings.push({
          rule: rule.id,
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
          why: rule.why,
        });
      }
    }
  }
  // MCP URL allowlist check — extract https://...mcp paths and compare.
  const allow = input.mcpAllowlist ?? DEFAULT_MCP_ALLOWLIST;
  const urlRe = /https:\/\/([a-zA-Z0-9.-]+)\b/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(line)) !== null) {
      const host = m[1]!;
      // Only flag MCP-shaped URLs (host starts with "mcp.").
      if (host.startsWith("mcp.") && !allow.has(host)) {
        findings.push({
          rule: "mcp-host-not-on-allowlist",
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
          why: `MCP host '${host}' not on BRAID_MCP_ALLOWLIST. Add it via env or use a known good host (Slice 10 F5).`,
        });
      }
    }
    urlRe.lastIndex = 0; // reset between lines
  }
  return findings;
}
