/**
 * Slice 20 §2.A2 — no silent `catch {}` blocks in production code.
 *
 * Per project CLAUDE.md ("evidence over assumptions"), every error path must
 * either be logged with structured context or rethrown. Empty catches swallow
 * the observability that diagnostics depend on. This is a structural test:
 * grep for `catch {}` and fail if any remain in production source.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SKILL_DIR = join(import.meta.dir, "..");
const PRODUCTION_FILES = [
  "lib.ts",
  "braid.ts",
  "purge.ts",
  "post-hooks/vercel-deploy.ts",
];

describe("no silent catch blocks", () => {
  for (const rel of PRODUCTION_FILES) {
    test(`${rel} contains no empty catch blocks`, () => {
      const path = join(SKILL_DIR, rel);
      const source = readFileSync(path, "utf-8");
      // Match `catch {}`, `catch { }`, `catch (e) {}`, `catch(e){}` etc.
      const silent = source.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) ?? [];
      expect(silent).toEqual([]);
    });
  }
});
