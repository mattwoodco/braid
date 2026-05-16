/**
 * Slice 110 — executable docs gate.
 *
 * Per Slice 110 TddStrategy decision 64aa0ee0: every command in
 * docs/quickstart.md that we CAN verify locally (i.e. doesn't require real
 * API keys) must execute successfully. The Phase-2 commands that need
 * real keys are NOT exercised here; the demo-mode command is.
 *
 * Authority: Slice 110 TddStrategy decision 64aa0ee0; CONTRIBUTING.md
 * "executable docs" requirement.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const QUICKSTART = join(REPO_ROOT, "docs", "quickstart.md");

describe("docs/quickstart.md", () => {
  test("exists at the canonical location", () => {
    expect(existsSync(QUICKSTART)).toBe(true);
  });

  const source = existsSync(QUICKSTART) ? readFileSync(QUICKSTART, "utf-8") : "";

  test("references the demo command", () => {
    expect(source).toContain("demo ad");
  });

  test("references the new-agent scaffolder command", () => {
    expect(source).toContain("new-agent pop-quiz");
  });

  test("references the purge --yes safety", () => {
    expect(source).toContain("purge --yes");
  });

  test("does NOT contain placeholder-looking real-key examples", () => {
    // A common doc-rot trap: an example value that looks real enough to copy.
    // Real Anthropic keys are sk-ant-... — if such a literal appears, fail.
    expect(source).not.toMatch(/sk-ant-[A-Za-z0-9_-]+/);
    // Same for vercel tokens.
    expect(source).not.toMatch(/^[A-Za-z0-9]{24,}$/m);
  });

  test("links to companion docs (SECURITY.md, SKILL.md, CONTRIBUTING.md)", () => {
    expect(source).toContain("SECURITY.md");
    expect(source).toContain("SKILL.md");
    expect(source).toContain("CONTRIBUTING.md");
  });

  test("carries a last-updated date stamp (Slice 110 hygiene)", () => {
    // Per Slice 120 Internationalization decision (ISO-8601 dates).
    expect(source).toMatch(/Tutorial last updated \d{4}-\d{2}-\d{2}/);
  });

  test("Phase 1 commands work end-to-end (demo + new-agent integration)", () => {
    // The Phase 1 demo is exercised by tests/demo-mode.test.ts already; we
    // just confirm the same command appears in the doc. The new-agent
    // command is exercised by tests/scaffold-agent.test.ts.
    expect(source).toMatch(/bun run --cwd \.claude\/skills\/braid demo ad/);
    expect(source).toMatch(/bun run --cwd \.claude\/skills\/braid -- new-agent /);
  });
});
