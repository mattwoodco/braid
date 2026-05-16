/**
 * Slice 10 §1.F2 — host-side post-session hook for deploy/credential work
 * that must NOT enter the agent's context (transcript, brief, sandbox).
 *
 * Enterprise-proper basis:
 *   - NIST SP 800-204C "Implementation of DevSecOps for a Microservices-based
 *     Application" — build, package, and deploy are separate pipeline stages
 *     with separate credential scope.
 *     https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-204C.pdf
 *   - OWASP Secrets Management Cheat Sheet — "credentials used by CI/CD
 *     tooling — only authorize those secrets and services of the secret
 *     management system required for the CI/CD tooling to execute its job."
 *     https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
 *   - CVE-2026-44479 (Vercel CLI Information Disclosure) — tokens passed as
 *     CLI args are exposed in shell history and process listings; use env
 *     vars instead.
 *   - Anthropic vault docs — vault is the only documented secret channel for
 *     in-session work; secrets must not enter the brief or sandbox.
 *
 * Pattern: the agent BUILDS the artifact and writes a manifest describing the
 * deploy intent. The host's post_session_hook reads the manifest and performs
 * the credentialed action with env-passthrough'd secrets. Secret never enters
 * the session transcript or the sandbox container.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runPostSessionHook, type PostSessionHookSpec } from "../lib";

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "braid-hook-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("runPostSessionHook", () => {
  test("executes a simple command and returns exit code 0 on success", async () => {
    const spec: PostSessionHookSpec = {
      command: "echo hello > out.txt",
      cwd: workDir,
    };
    const result = await runPostSessionHook(spec, {
      sessionId: "sesn_test",
      flowName: "test-flow",
      flowDir: workDir,
      outputDir: workDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("");
    const content = await Bun.file(join(workDir, "out.txt")).text();
    expect(content.trim()).toBe("hello");
  });

  test("passes BRAID_* context env vars to the hook", async () => {
    const spec: PostSessionHookSpec = {
      command:
        'echo "$BRAID_SESSION_ID|$BRAID_FLOW_NAME|$BRAID_OUTPUT_DIR" > context.txt',
      cwd: workDir,
    };
    await runPostSessionHook(spec, {
      sessionId: "sesn_abc123",
      flowName: "fundraiser",
      flowDir: workDir,
      outputDir: workDir,
    });
    const out = (await Bun.file(join(workDir, "context.txt")).text()).trim();
    expect(out).toBe(`sesn_abc123|fundraiser|${workDir}`);
  });

  test("only env_passthrough host vars reach the hook (least privilege)", async () => {
    process.env.BRAID_TEST_ALLOWED = "allowed-value";
    process.env.BRAID_TEST_SECRET = "should-not-leak";
    try {
      const spec: PostSessionHookSpec = {
        command:
          'echo "allowed=$BRAID_TEST_ALLOWED secret=${BRAID_TEST_SECRET:-empty}" > scope.txt',
        cwd: workDir,
        env_passthrough: ["BRAID_TEST_ALLOWED"],
      };
      await runPostSessionHook(spec, {
        sessionId: "sesn_test",
        flowName: "test-flow",
        flowDir: workDir,
        outputDir: workDir,
      });
      const out = (await Bun.file(join(workDir, "scope.txt")).text()).trim();
      expect(out).toBe("allowed=allowed-value secret=empty");
    } finally {
      delete process.env.BRAID_TEST_ALLOWED;
      delete process.env.BRAID_TEST_SECRET;
    }
  });

  test("non-zero exit code is captured, not thrown", async () => {
    const spec: PostSessionHookSpec = {
      command: "exit 7",
      cwd: workDir,
    };
    const result = await runPostSessionHook(spec, {
      sessionId: "sesn_test",
      flowName: "test-flow",
      flowDir: workDir,
      outputDir: workDir,
    });
    expect(result.exitCode).toBe(7);
    expect(result.error).toBeUndefined();
  });

  test("hook missing env_passthrough var fails fast with actionable message", async () => {
    const spec: PostSessionHookSpec = {
      command: 'echo "$MUST_BE_SET"',
      cwd: workDir,
      env_passthrough: ["MUST_BE_SET_BUT_NOT_PRESENT"],
    };
    delete process.env.MUST_BE_SET_BUT_NOT_PRESENT;
    const result = await runPostSessionHook(spec, {
      sessionId: "sesn_test",
      flowName: "test-flow",
      flowDir: workDir,
      outputDir: workDir,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toMatch(/MUST_BE_SET_BUT_NOT_PRESENT/);
  });
});

describe("expandBrief — {{env:...}} is no longer accepted", () => {
  test("rejects {{env:TOKEN}} with actionable error pointing to post_session_hook", async () => {
    const { expandBrief } = await import("../lib");
    process.env.SOME_VAR = "value";
    try {
      expect(() => expandBrief("token={{env:SOME_VAR}}", workDir)).toThrow(
        /post_session_hook|env_passthrough/i,
      );
    } finally {
      delete process.env.SOME_VAR;
    }
  });
});
