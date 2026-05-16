/**
 * Slice 70 — property tests for the container configuration.
 *
 * Container content is not RGR-able the way TypeScript code is, but its
 * properties are. This test parses the Dockerfile, .dockerignore,
 * docker-compose.yml, and devcontainer.json and asserts the security
 * invariants from Slice 70's SecurityArchitecture decision (4474811d):
 *   - USER directive sets non-root
 *   - No EXPOSE without explicit opt-in
 *   - .dockerignore excludes secrets and outputs
 *   - Base image is pinned by version (digest pin happens in CI)
 *   - docker-compose drops capabilities and uses read_only
 *
 * Authority: Slice 70 architectural decision b1d5f3d8 + TddStrategy
 * decision 528ab4ca.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function readRepoFile(rel: string): string {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) throw new Error(`expected file not present: ${rel}`);
  return readFileSync(p, "utf-8");
}

describe("Dockerfile — security properties", () => {
  const df = readRepoFile("Dockerfile");

  test("declares a non-root USER", () => {
    expect(df).toMatch(/^USER\s+braid$/m);
  });

  test("base image is pinned by exact tag, not :latest or floating", () => {
    const fromLines = df.match(/^FROM\s+\S+/gm) ?? [];
    expect(fromLines.length).toBeGreaterThan(0);
    for (const line of fromLines) {
      expect(line).not.toMatch(/:latest\b/);
      // Must include an explicit version tag (one colon segment after image name).
      expect(line).toMatch(/^FROM\s+[a-z0-9./-]+:[a-zA-Z0-9._-]+/);
    }
  });

  test("does NOT declare any EXPOSE port (opt-in via compose override only)", () => {
    expect(df).not.toMatch(/^EXPOSE\s+/m);
  });

  test("installs deps with --frozen-lockfile (no upstream drift at build)", () => {
    expect(df).toContain("--frozen-lockfile");
  });
});

describe(".dockerignore — secret exclusion", () => {
  const di = readRepoFile(".dockerignore");

  test("excludes .env and variants", () => {
    expect(di).toMatch(/^\.env\s*$/m);
    expect(di).toMatch(/^\.env\.\*\s*$/m);
  });

  test("excludes per-flow state files", () => {
    expect(di).toMatch(/^flows\/\*\/state\.json\s*$/m);
  });

  test("excludes outputs (would balloon the image)", () => {
    expect(di).toMatch(/^outputs\/?\s*$/m);
    expect(di).toMatch(/^flows\/\*\/outputs\/?\s*$/m);
  });

  test("excludes node_modules", () => {
    expect(di).toMatch(/^node_modules\/?\s*$/m);
  });

  test("excludes private audit docs (double-belt with .gitignore)", () => {
    expect(di).toMatch(/PRIVATE\.md\s*$/m);
  });

  test("excludes the git directory (not needed at runtime)", () => {
    expect(di).toMatch(/^\.git\/?\s*$/m);
  });
});

describe("docker-compose.yml — sandboxing properties", () => {
  const dc = readRepoFile("docker-compose.yml");

  test("declares read_only root filesystem", () => {
    expect(dc).toMatch(/read_only:\s*true/);
  });

  test("drops ALL capabilities by default", () => {
    expect(dc).toMatch(/cap_drop:[\s\S]*-\s*ALL/);
  });

  test("declares no-new-privileges security_opt", () => {
    expect(dc).toMatch(/no-new-privileges:true/);
  });

  test("mounts .env.local read-only", () => {
    expect(dc).toMatch(/\.env\.local:\/workspace\/\.env\.local:ro/);
  });

  test("does NOT mount the host home directory", () => {
    // Scan ONLY the lines that look like mount declarations (start with `- `
    // and have `:/` separator), not prose comments which legitimately mention
    // ~/.ssh as the threat being prevented.
    const mountLines = dc
      .split("\n")
      .filter((l) => /^\s*-\s+\S+:\/\S/.test(l) && !l.trim().startsWith("#"));
    for (const line of mountLines) {
      expect(line).not.toMatch(/\$\{HOME\}|^[\s-]*~\/|^\s*-\s+\/home\/[^/]+:/);
    }
  });

  test("does NOT bind to all interfaces — no inbound ports by default", () => {
    // The `ports:` key MAY appear in the override example but the base
    // compose file should not declare any ports.
    expect(dc).not.toMatch(/^\s*ports:\s*\n\s*-\s*["']/m);
  });
});

describe("devcontainer.json — same trust boundary as compose", () => {
  const dvc = readRepoFile(".devcontainer/devcontainer.json");

  test("remoteUser is non-root (braid)", () => {
    expect(dvc).toMatch(/"remoteUser":\s*"braid"/);
  });

  test("references the project Dockerfile (single source of truth)", () => {
    expect(dvc).toMatch(/"dockerfile":\s*"\.\.\/Dockerfile"/);
  });

  test("workspaceFolder matches the Dockerfile WORKDIR", () => {
    expect(dvc).toMatch(/"workspaceFolder":\s*"\/workspace"/);
  });
});
