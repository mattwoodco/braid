/**
 * Slice 10 §1.F7 — `purge` requires explicit confirmation before wiping
 * local state files in non-interactive mode.
 *
 * The historical default was to wipe every `flows/*\/state.json` to `{}`
 * the moment `purge` was invoked without `--select`. That's a destructive
 * default and an OpenClaw-style "easy mistake" — the OpenClaw retrospective
 * documents how destructive defaults amplified incidents during the rebrand
 * window when operators were under pressure.
 */

import { test, expect, describe } from "bun:test";
import { shouldWipeStateFiles } from "../lib";

describe("shouldWipeStateFiles", () => {
  test("refuses to wipe when neither --select nor --yes is set", () => {
    const result = shouldWipeStateFiles([]);
    expect(result.wipe).toBe(false);
    expect(result.reason).toMatch(/--yes|--select/);
  });

  test("refuses to wipe in interactive mode (state files left intact)", () => {
    expect(shouldWipeStateFiles(["--select"]).wipe).toBe(false);
    expect(shouldWipeStateFiles(["-s"]).wipe).toBe(false);
  });

  test("wipes when --yes is set explicitly", () => {
    expect(shouldWipeStateFiles(["--yes"]).wipe).toBe(true);
    expect(shouldWipeStateFiles(["-y"]).wipe).toBe(true);
  });

  test("--select takes precedence over --yes (interactive wins)", () => {
    // Interactive mode means the user is picking each thing manually;
    // we don't blanket-wipe even if --yes is also passed.
    expect(shouldWipeStateFiles(["--select", "--yes"]).wipe).toBe(false);
  });
});
