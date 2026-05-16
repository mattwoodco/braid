#!/usr/bin/env bun
/**
 * Slice 10 §1.F2 — Vercel post-session deploy hook.
 *
 * Runs on the host AFTER the agent session ends. Reads the session's
 * `manifest.json` (which the agent writes before terminating) and performs
 * the credentialed deploy with `VERCEL_TOKEN` from the host environment.
 *
 * The token never enters the session transcript, never lands in the sandbox,
 * and is never passed as a CLI argument. It is consumed by the Vercel CLI
 * via env-var read.
 *
 * Authoritative basis:
 *   - NIST SP 800-204C — separation of build and deploy stages with separate
 *     credential scope.
 *     https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-204C.pdf
 *   - OWASP Secrets Management Cheat Sheet — limit CI/CD credential scope to
 *     what the deploy step needs.
 *     https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
 *   - CVE-2026-44479 (Vercel CLI Information Disclosure) — tokens passed as
 *     CLI args leak via process listings and shell history. Use env vars.
 *   - Vercel CLI docs — `VERCEL_TOKEN` env var is read natively by the CLI.
 *     https://vercel.com/docs/cli/global-options
 *   - Anthropic vault docs — for in-session work, vaults are the only secret
 *     channel; in-session deploy with token-bearing CLI is outside that model.
 *     https://platform.claude.com/docs/en/managed-agents/vaults
 *
 * Expected manifest shape (the agent writes this to /mnt/session/outputs/):
 *   {
 *     "ready_to_deploy": true,
 *     "site_dir": "site",            // relative to the output dir
 *     "project_name": "fundraiser",  // optional; defaults to braid-<flow>
 *     ...                            // any other fields the flow uses
 *   }
 *
 * After deploy, the manifest is updated with:
 *   {
 *     "page_url": "https://...vercel.app",
 *     "deployed_at": "<ISO>"
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

export type DeployManifest = {
  ready_to_deploy?: boolean;
  site_dir?: string;
  project_name?: string;
  page_url?: string;
  deployed_at?: string | null;
  [k: string]: unknown;
};

/** Parse a deploy manifest from JSON. Throws on invalid JSON. */
export function parseDeployManifest(raw: string): DeployManifest {
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("deploy manifest must be a JSON object");
  }
  return parsed as DeployManifest;
}

/**
 * Extract the production Vercel URL from the CLI's stdout. The Vercel CLI
 * prints multiple https://*.vercel.app URLs (inspect link + production URL);
 * the LAST one is canonically the production URL.
 */
export function extractVercelUrl(stdout: string): string | null {
  const urls = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g);
  if (!urls || urls.length === 0) return null;
  return urls[urls.length - 1] ?? null;
}

/** Pure: returns a new manifest with the URL + deployed_at fields set. */
export function updateManifestWithDeploy(
  m: DeployManifest,
  pageUrl: string,
  now: Date = new Date(),
): DeployManifest {
  return {
    ...m,
    page_url: pageUrl,
    deployed_at: now.toISOString(),
  };
}

/**
 * Determine whether a deploy should proceed based on the manifest contents.
 * The agent signals intent via `ready_to_deploy: true`. Anything else is a
 * no-op (success exit code 0 — the agent might intentionally produce a flow
 * that doesn't deploy).
 */
export function shouldDeploy(m: DeployManifest): { deploy: boolean; reason: string } {
  if (m.ready_to_deploy !== true) {
    return { deploy: false, reason: "manifest.ready_to_deploy !== true" };
  }
  return { deploy: true, reason: "manifest.ready_to_deploy === true" };
}

/**
 * Verify the manifest's declared `site_dir` actually contains the artifact
 * the deploy will publish (an `index.html`). Agents that report
 * `ready_to_deploy: true` but produce a broken layout (e.g. `index.html`
 * dropped at the output root instead of inside `site_dir`) are caught here
 * BEFORE invoking the Vercel CLI — the CLI's own error ("Could not find …")
 * is opaque and surfaces the path mismatch only on careful reading.
 *
 * Exported for unit-testing.
 */
export function validateSiteLayout(
  outputDir: string,
  m: DeployManifest,
  exists: (p: string) => boolean = existsSync,
): { ok: true } | { ok: false; reason: string } {
  const siteDir = m.site_dir ? resolve(outputDir, m.site_dir) : outputDir;
  if (!exists(siteDir)) {
    return {
      ok: false,
      reason: `manifest.site_dir resolves to ${siteDir} which does not exist. The agent likely wrote index.html at the output root instead of inside site_dir. Fix the agent's system prompt to write to /mnt/session/outputs/<site_dir>/index.html.`,
    };
  }
  const indexPath = join(siteDir, "index.html");
  if (!exists(indexPath)) {
    return {
      ok: false,
      reason: `no index.html at ${indexPath}. Either the agent placed it elsewhere or the manifest's site_dir is wrong.`,
    };
  }
  return { ok: true };
}

/**
 * Main entry point. Only invoked when this file is run directly, not when
 * imported by tests.
 */
async function main(): Promise<void> {
  const outputDir = process.env.BRAID_OUTPUT_DIR;
  if (!outputDir) {
    console.error("BRAID_OUTPUT_DIR not set");
    process.exit(2);
  }
  if (!process.env.VERCEL_TOKEN) {
    console.error(
      "VERCEL_TOKEN not in env. Add it to .env.local and ensure the flow.yaml " +
        "post_session_hook env_passthrough includes VERCEL_TOKEN. " +
        "Authority: NIST SP 800-204C, OWASP Secrets Management Cheat Sheet.",
    );
    process.exit(2);
  }

  const manifestPath = join(outputDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.log(`no manifest.json at ${manifestPath} — nothing to deploy`);
    return;
  }

  const m = parseDeployManifest(readFileSync(manifestPath, "utf-8"));
  const gate = shouldDeploy(m);
  if (!gate.deploy) {
    console.log(`skipping deploy: ${gate.reason}`);
    return;
  }

  const layout = validateSiteLayout(outputDir, m);
  if (!layout.ok) {
    console.error(`site layout invalid: ${layout.reason}`);
    process.exit(4);
  }

  const siteDir = m.site_dir ? resolve(outputDir, m.site_dir) : outputDir;
  const projectName =
    m.project_name ?? `braid-${process.env.BRAID_FLOW_NAME ?? "site"}`;

  console.log(`deploying ${siteDir} as ${projectName}...`);

  // Token via env, NOT --token arg (CVE-2026-44479 — Vercel CLI < 52.0.0
  // included CLI args verbatim in suggested-command output, leaking tokens).
  // Pin to a CVE-patched version explicitly; never use `vercel@latest`.
  // npm has no 52.0.1 (registry jumps 52.0.0 → 52.2.0); use 52.2.0 as the
  // first post-CVE release available on npm.
  const cmd = [
    "npx",
    "--yes",
    "vercel@52.2.0",
    "deploy",
    "--prod",
    "--yes",
    "--name",
    projectName,
  ];
  // Non-interactive deploys without a pre-linked project require an explicit
  // scope. Opt-in via VERCEL_SCOPE in env_passthrough; if absent, the CLI
  // surfaces a clear missing_scope error.
  const scope = process.env.VERCEL_SCOPE;
  if (scope) cmd.push("--scope", scope);
  cmd.push(siteDir);
  const proc = Bun.spawnSync({
    cmd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Bun's spawnSync stdout/stderr are Buffer; coerce to Uint8Array so
  // TextDecoder accepts them under strict Bun-types vs node-types semantics.
  const stdout = new TextDecoder().decode(new Uint8Array(proc.stdout));
  const stderr = new TextDecoder().decode(new Uint8Array(proc.stderr));
  if (proc.exitCode !== 0) {
    console.error(`vercel deploy failed (exit ${proc.exitCode})`);
    if (stderr) console.error(stderr);
    process.exit(proc.exitCode ?? 1);
  }

  const pageUrl = extractVercelUrl(stdout);
  if (!pageUrl) {
    console.error("could not parse Vercel production URL from CLI output");
    console.error(stdout);
    process.exit(3);
  }

  const updated = updateManifestWithDeploy(m, pageUrl);
  writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
  console.log(`deployed: ${pageUrl}`);
}

if (import.meta.main) {
  await main();
}
