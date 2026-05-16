/**
 * Tests for the pure helpers in post-hooks/vercel-deploy.ts.
 *
 * The actual `vercel deploy` call requires a real token and a real Vercel
 * account; it's integration-tested separately. These tests cover the
 * deterministic logic: manifest parsing, URL extraction, manifest update,
 * deploy gating.
 */

import { test, expect, describe } from "bun:test";
import {
  parseDeployManifest,
  extractVercelUrl,
  updateManifestWithDeploy,
  shouldDeploy,
} from "../post-hooks/vercel-deploy";

describe("parseDeployManifest", () => {
  test("parses a valid object", () => {
    const m = parseDeployManifest(
      '{"ready_to_deploy":true,"site_dir":"site","project_name":"fundraiser"}',
    );
    expect(m.ready_to_deploy).toBe(true);
    expect(m.site_dir).toBe("site");
    expect(m.project_name).toBe("fundraiser");
  });

  test("rejects arrays", () => {
    expect(() => parseDeployManifest("[]")).toThrow();
  });

  test("rejects non-JSON", () => {
    expect(() => parseDeployManifest("not json")).toThrow();
  });
});

describe("extractVercelUrl", () => {
  test("returns the last production URL in stdout", () => {
    const stdout = `
      Vercel CLI 39.0.0
      Inspect: https://vercel.com/team/project/abc123 [3s]
      Preview: https://fundraiser-abc-team.vercel.app [10s]
      Production: https://fundraiser-team.vercel.app [12s]
    `;
    expect(extractVercelUrl(stdout)).toBe("https://fundraiser-team.vercel.app");
  });

  test("returns null when no URL is present", () => {
    expect(extractVercelUrl("nothing here")).toBeNull();
  });
});

describe("updateManifestWithDeploy", () => {
  test("adds page_url and deployed_at, preserves other fields", () => {
    const m = {
      ready_to_deploy: true,
      site_dir: "site",
      project_name: "fundraiser",
      brief: "original",
    };
    const fixedNow = new Date("2026-05-15T17:30:00.000Z");
    const updated = updateManifestWithDeploy(
      m,
      "https://x.vercel.app",
      fixedNow,
    );
    expect(updated.page_url).toBe("https://x.vercel.app");
    expect(updated.deployed_at).toBe("2026-05-15T17:30:00.000Z");
    expect(updated.brief).toBe("original");
    expect(updated.site_dir).toBe("site");
  });

  test("does not mutate the input manifest (pure)", () => {
    const m: { ready_to_deploy: boolean; page_url?: string } = { ready_to_deploy: true };
    updateManifestWithDeploy(m, "https://x.vercel.app");
    expect(m.page_url).toBeUndefined();
  });
});

describe("shouldDeploy", () => {
  test("deploys when ready_to_deploy === true", () => {
    expect(shouldDeploy({ ready_to_deploy: true }).deploy).toBe(true);
  });

  test("does not deploy when ready_to_deploy is omitted", () => {
    expect(shouldDeploy({}).deploy).toBe(false);
  });

  test("does not deploy when ready_to_deploy === false", () => {
    expect(shouldDeploy({ ready_to_deploy: false }).deploy).toBe(false);
  });

  test("does not deploy for truthy non-boolean values (strict)", () => {
    expect(shouldDeploy({ ready_to_deploy: "true" as unknown as boolean }).deploy).toBe(false);
  });
});
