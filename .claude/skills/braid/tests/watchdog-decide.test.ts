/**
 * Slice 20 §2.A3 — watchdog cancel race.
 *
 * Historical defect: the watchdog `setInterval` callback closed over mutable
 * loop locals (`finished`, `needsRestart`, `sentinelFired`). `clearInterval`
 * prevents *new* firings but does NOT cancel an already-in-flight async
 * callback — which can therefore complete and mutate state AFTER cleanup,
 * including emitting events or sending `sessions.events.send` calls.
 *
 * Fix: pull the watchdog's decision logic into a pure `watchdogDecide`
 * function and add a `cancelled` flag the callback checks at each await
 * boundary. This test exercises the pure decision logic; the integration
 * with setInterval is straightforward once the decision is data-driven.
 */

import { test, expect, describe } from "bun:test";
import { watchdogDecide } from "../lib";

const STALL = 30_000;

describe("watchdogDecide", () => {
  test("no action when cancelled", () => {
    const d = watchdogDecide({
      cancelled: true,
      sentinelFired: false,
      silenceMs: STALL * 3,
      stallMs: STALL,
      restartCount: 0,
      maxRestarts: 1,
    });
    expect(d.action).toBe("none");
  });

  test("no action when silence below stall threshold", () => {
    const d = watchdogDecide({
      cancelled: false,
      sentinelFired: false,
      silenceMs: STALL - 1,
      stallMs: STALL,
      restartCount: 0,
      maxRestarts: 1,
    });
    expect(d.action).toBe("none");
  });

  test("fires sentinel on first stall", () => {
    const d = watchdogDecide({
      cancelled: false,
      sentinelFired: false,
      silenceMs: STALL + 1,
      stallMs: STALL,
      restartCount: 0,
      maxRestarts: 1,
    });
    expect(d.action).toBe("fire_sentinel");
  });

  test("requests restart after 2x stall when sentinel already fired and restarts remain", () => {
    const d = watchdogDecide({
      cancelled: false,
      sentinelFired: true,
      silenceMs: STALL * 2 + 1,
      stallMs: STALL,
      restartCount: 0,
      maxRestarts: 1,
    });
    expect(d.action).toBe("restart");
  });

  test("gives up when sentinel fired, double-stall hit, but no restarts remain", () => {
    const d = watchdogDecide({
      cancelled: false,
      sentinelFired: true,
      silenceMs: STALL * 2 + 1,
      stallMs: STALL,
      restartCount: 1,
      maxRestarts: 1,
    });
    expect(d.action).toBe("give_up");
  });

  test("no action between stall and 2x stall after sentinel fired", () => {
    const d = watchdogDecide({
      cancelled: false,
      sentinelFired: true,
      silenceMs: STALL + 1,
      stallMs: STALL,
      restartCount: 0,
      maxRestarts: 1,
    });
    expect(d.action).toBe("none");
  });
});
