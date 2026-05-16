/**
 * Slice 20 §2.A5 — session-history truncation must return both the kept
 * list and the dropped list, so the dropped ids can be cleaned up at the
 * Anthropic side (otherwise they accrue cost as orphans).
 *
 * Pure function; the actual `c.beta.sessions.delete` call is integrated at
 * the call site.
 */

import { test, expect, describe } from "bun:test";
import { truncateSessionHistory } from "../lib";

describe("truncateSessionHistory", () => {
  test("prepends new session id and dedupes", () => {
    const { kept, dropped } = truncateSessionHistory(
      "sesn_new",
      ["sesn_old1", "sesn_new", "sesn_old2"],
      20,
    );
    expect(kept).toEqual(["sesn_new", "sesn_old1", "sesn_old2"]);
    expect(dropped).toEqual([]);
  });

  test("drops ids beyond maxKeep", () => {
    // 22 prior + 1 new = 23 merged. slice(0,20) keeps 20; dropped is the last 3.
    const prior = Array.from({ length: 22 }, (_, i) => `sesn_${i}`);
    const { kept, dropped } = truncateSessionHistory("sesn_new", prior, 20);
    expect(kept.length).toBe(20);
    expect(kept[0]).toBe("sesn_new");
    expect(kept[19]).toBe("sesn_18");
    expect(dropped).toEqual(["sesn_19", "sesn_20", "sesn_21"]);
  });

  test("handles empty prior list", () => {
    const { kept, dropped } = truncateSessionHistory("sesn_new", [], 20);
    expect(kept).toEqual(["sesn_new"]);
    expect(dropped).toEqual([]);
  });

  test("preserves order: newest first", () => {
    const prior = ["sesn_b", "sesn_a"];
    const { kept } = truncateSessionHistory("sesn_c", prior, 20);
    expect(kept).toEqual(["sesn_c", "sesn_b", "sesn_a"]);
  });
});
