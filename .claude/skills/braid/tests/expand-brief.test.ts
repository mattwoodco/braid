/**
 * Slice 10 §1.F4 — {{file:...}} interpolation is sandboxed to the flow directory.
 *
 * Authority:
 *   https://cwe.mitre.org/data/definitions/22.html  (CWE-22: Path Traversal)
 *   https://owasp.org/www-community/attacks/Path_Traversal
 *
 * Until this RED test passes, lib.ts:127 reads any user-supplied path verbatim
 * via readFileSync, including `..` segments and absolute paths.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expandBrief } from "../lib";

let flowDir: string;
let outsideFile: string;

beforeAll(() => {
  flowDir = mkdtempSync(join(tmpdir(), "braid-flowdir-"));
  mkdirSync(join(flowDir, "brand"), { recursive: true });
  writeFileSync(join(flowDir, "brand", "style.md"), "STYLE-CONTENT");
  writeFileSync(join(flowDir, "rubric.md"), "RUBRIC");

  // A file *outside* the flow dir that an attacker brief would try to read.
  outsideFile = join(tmpdir(), `braid-outside-${Date.now()}.txt`);
  writeFileSync(outsideFile, "SECRET");
});

afterAll(() => {
  rmSync(flowDir, { recursive: true, force: true });
  rmSync(outsideFile, { force: true });
});

describe("expandBrief — {{file:...}} path sandbox", () => {
  test("reads relative paths within the flow directory", () => {
    const out = expandBrief("style is: {{file:brand/style.md}}", flowDir);
    expect(out).toBe("style is: STYLE-CONTENT");
  });

  test("rejects absolute paths", () => {
    expect(() => expandBrief("{{file:/etc/passwd}}", flowDir)).toThrow(
      /outside flow directory|absolute/i,
    );
  });

  test("rejects traversal via ../", () => {
    expect(() => expandBrief("{{file:../../etc/passwd}}", flowDir)).toThrow(
      /outside flow directory/i,
    );
  });

  test("rejects paths that resolve outside the flow dir even via redundant segments", () => {
    expect(() =>
      expandBrief("{{file:brand/../../../etc/passwd}}", flowDir),
    ).toThrow(/outside flow directory/i);
  });

  test("rejects symlink-like absolute escapes via prefix matching", () => {
    // A path that *looks* relative but resolves to absolute via leading slash should fail.
    expect(() => expandBrief("{{file://etc/passwd}}", flowDir)).toThrow();
  });

  test("returns brief unchanged when there are no substitutions", () => {
    expect(expandBrief("plain brief, no placeholders", flowDir)).toBe(
      "plain brief, no placeholders",
    );
  });
});
