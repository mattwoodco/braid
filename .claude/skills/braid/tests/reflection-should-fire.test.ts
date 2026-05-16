/**
 * Slice 100 — pure decision: given a terminal event and a manifest, should
 * reflection fire?
 *
 * Authority for the trigger semantics: Slice 100 architectural decision
 * 4dce6f31 (run.reflection block + post-session reflection agent). Per the
 * design, reflection fires on successful session terminus (session_idle
 * without requires_action) when configured; not on watchdog give-up or
 * abnormal termination — those don't have useful trajectories.
 */

import { test, expect, describe } from "bun:test";
import { reflectionShouldFire, type ReflectionConfig } from "../lib";

const enabled: ReflectionConfig = {
  agent_key: "reflector",
  target_store: "lessonsStore",
};

describe("reflectionShouldFire", () => {
  test("no fire when reflection is not configured", () => {
    const d = reflectionShouldFire("session_idle", undefined);
    expect(d.fire).toBe(false);
    expect(d.reason).toMatch(/not configured/i);
  });

  test("fires on session_idle when configured", () => {
    const d = reflectionShouldFire("session_idle", enabled);
    expect(d.fire).toBe(true);
  });

  test("does NOT fire on session_terminated (abnormal end, no useful trajectory)", () => {
    const d = reflectionShouldFire("session_terminated", enabled);
    expect(d.fire).toBe(false);
    expect(d.reason).toMatch(/terminated|abnormal/i);
  });

  test("does NOT fire on watchdog give-up (max restarts hit, run failed)", () => {
    const d = reflectionShouldFire("watchdog_giveup", enabled);
    expect(d.fire).toBe(false);
    expect(d.reason).toMatch(/give[ -]?up|stalled/i);
  });

  test("returns a reason string even when firing (for SSE event emission)", () => {
    const d = reflectionShouldFire("session_idle", enabled);
    expect(typeof d.reason).toBe("string");
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
