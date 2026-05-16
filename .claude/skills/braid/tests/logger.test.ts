/**
 * Slice 50 — structured logger.
 *
 * One JSON-line per emit, fields: `ts` (ISO 8601), `level`, `event`,
 * `payload?`. The line goes to a writer the caller passes in, so tests can
 * capture and assert without touching process.stdout.
 */

import { test, expect, describe } from "bun:test";
import { createLogger } from "../lib";

describe("createLogger", () => {
  test("emits one JSON line per call with required fields", () => {
    const out: string[] = [];
    const log = createLogger((line) => out.push(line));
    log.info("env.created", { id: "env_x" });
    expect(out.length).toBe(1);
    const entry = JSON.parse(out[0]!);
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("env.created");
    expect(entry.payload).toEqual({ id: "env_x" });
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
  });

  test("omits payload when undefined", () => {
    const out: string[] = [];
    const log = createLogger((line) => out.push(line));
    log.info("ping");
    const entry = JSON.parse(out[0]!);
    expect(entry).not.toHaveProperty("payload");
  });

  test("warn and error levels are distinct", () => {
    const out: string[] = [];
    const log = createLogger((line) => out.push(line));
    log.warn("hot", { degrees: 200 });
    log.error("boom", { reason: "fire" });
    expect(JSON.parse(out[0]!).level).toBe("warn");
    expect(JSON.parse(out[1]!).level).toBe("error");
  });

  test("each line ends with a newline so log streams stay line-delimited", () => {
    const out: string[] = [];
    const log = createLogger((line) => out.push(line));
    log.info("x");
    expect(out[0]!.endsWith("\n")).toBe(true);
  });
});
