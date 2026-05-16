/**
 * Slice 50 §2.A2-observability — bounded exponential backoff for reconnect.
 *
 * Defect (pre-Slice 50): the stream-reconnect path in braid.ts retried once
 * with a flat 2-second sleep. A transient SDK or network blip that took
 * longer than 2s caused the loop to give up silently. A persistent fault
 * (paused upstream) had no progressive backoff, so repeated runs hammered
 * the API.
 *
 * Fix: pure `backoffDelays(attempts, baseMs, capMs)` returns the sequence
 * of delays for an exponential schedule capped at `capMs`. The reconnect
 * loop walks the sequence and emits a `reconnect.gaveup` event after the
 * final attempt — explicit, observable, bounded.
 */

import { test, expect, describe } from "bun:test";
import { backoffDelays } from "../lib";

describe("backoffDelays", () => {
  test("returns N values for N attempts", () => {
    expect(backoffDelays(0, 100, 5000)).toEqual([]);
    expect(backoffDelays(3, 100, 5000).length).toBe(3);
  });

  test("doubles on each attempt up to the cap", () => {
    expect(backoffDelays(5, 100, 1000)).toEqual([100, 200, 400, 800, 1000]);
  });

  test("respects the cap (no overflow)", () => {
    const out = backoffDelays(8, 100, 800);
    expect(out[out.length - 1]).toBeLessThanOrEqual(800);
    expect(Math.max(...out)).toBeLessThanOrEqual(800);
  });

  test("starts at baseMs", () => {
    const out = backoffDelays(1, 250, 99_999);
    expect(out[0]).toBe(250);
  });

  test("rejects negative attempts", () => {
    expect(() => backoffDelays(-1, 100, 1000)).toThrow();
  });
});
