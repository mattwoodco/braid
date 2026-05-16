/**
 * Slice 120 — docs-anchor-parity gate.
 *
 * Per Slice 120 TddStrategy decision 27a5f0f8: every §X.Y audit anchor
 * referenced in docs/troubleshooting.md must exist in the private audit
 * doc. Prevents anchor rot when the audit doc evolves.
 *
 * Also: structural checks on docs/architecture.md and docs/costs.md
 * (presence, key sections, date stamps).
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

describe("docs/architecture.md", () => {
  const path = join(REPO_ROOT, "docs", "architecture.md");
  test("exists", () => expect(existsSync(path)).toBe(true));
  const src = existsSync(path) ? readFileSync(path, "utf-8") : "";

  test("contains a Mermaid diagram block", () => {
    expect(src).toMatch(/```mermaid\b/);
  });

  test("references trust boundaries", () => {
    expect(src).toContain("Trust boundaries");
  });

  test("links to SKILL.md and SECURITY.md", () => {
    expect(src).toContain("SKILL.md");
    expect(src).toContain("SECURITY.md");
  });

  test("carries an ISO-8601 last-updated date", () => {
    expect(src).toMatch(/Architecture last updated \d{4}-\d{2}-\d{2}/);
  });
});

describe("docs/costs.md", () => {
  const path = join(REPO_ROOT, "docs", "costs.md");
  test("exists", () => expect(existsSync(path)).toBe(true));
  const src = existsSync(path) ? readFileSync(path, "utf-8") : "";

  test("contains per-flow estimate table", () => {
    expect(src).toMatch(/\| Flow \|/);
  });

  test("uses USD with `$` symbol explicitly", () => {
    expect(src).toMatch(/\$\d+\.\d+/);
  });

  test("carries an `as of YYYY-MM` stamp on figures", () => {
    expect(src).toMatch(/as of \d{4}-\d{2}/i);
  });

  test("links to Anthropic + Fal + Vercel pricing pages", () => {
    expect(src).toContain("anthropic.com/pricing");
    expect(src).toContain("fal.ai/pricing");
    expect(src).toContain("vercel.com/pricing");
  });

  test("carries an ISO-8601 last-updated date", () => {
    expect(src).toMatch(/Costs document last updated \d{4}-\d{2}-\d{2}/);
  });
});

describe("docs/troubleshooting.md", () => {
  const path = join(REPO_ROOT, "docs", "troubleshooting.md");
  test("exists", () => expect(existsSync(path)).toBe(true));
  const src = existsSync(path) ? readFileSync(path, "utf-8") : "";

  test("uses symptom → cause → resolution structure", () => {
    expect(src).toContain("**Cause.**");
    expect(src).toContain("**Resolution.**");
  });

  test("contains an audit-anchor index", () => {
    expect(src).toContain("Audit anchor index");
  });

  test("references every shipped error message we care about", () => {
    // These are the canonical error strings the audit-driven slices added.
    const required = [
      "Missing env var",
      "MCP host",
      "{{file:",
      "reconnect.gaveup",
      "max restarts reached",
      "purge refused",
      "unknown template",
      "agent-prompt-safety",
    ];
    for (const phrase of required) {
      expect(src).toContain(phrase);
    }
  });

  test("carries an ISO-8601 last-updated date", () => {
    expect(src).toMatch(/Troubleshooting last updated \d{4}-\d{2}-\d{2}/);
  });
});

describe("audit-anchor parity (troubleshooting → audit)", () => {
  const trouble = join(REPO_ROOT, "docs", "troubleshooting.md");
  const audit = join(REPO_ROOT, "docs", "audit-2026-05-15.PRIVATE.md");

  test("private audit doc exists locally (gitignored)", () => {
    // It's gitignored, but it should exist on the author's machine.
    // If not, the test prints a clear hint rather than failing on missing file.
    if (!existsSync(audit)) {
      console.warn(
        `[anchor-parity] ${audit} not present locally. Anchor verification skipped. ` +
          `This is acceptable in fresh clones; the file is gitignored.`,
      );
      return;
    }
    expect(existsSync(audit)).toBe(true);
  });

  test("every §X.Y anchor in troubleshooting.md exists in the private audit", () => {
    if (!existsSync(audit)) {
      console.warn("[anchor-parity] skipping — private audit not present locally");
      return;
    }
    const troubleSrc = readFileSync(trouble, "utf-8");
    const auditSrc = readFileSync(audit, "utf-8");
    const anchors = Array.from(troubleSrc.matchAll(/§(\d+)\.([A-Z]\d+)/g)).map(
      (m) => `§${m[1]}.${m[2]}`,
    );
    expect(anchors.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const a of anchors) {
      // Search for anchor with optional Markdown anchor formatting variations.
      const pattern = new RegExp(a.replace(/[.]/g, "\\."), "g");
      if (!pattern.test(auditSrc)) missing.push(a);
    }
    expect(missing).toEqual([]);
  });
});
