#!/usr/bin/env bun
/**
 * Slice 90 — agent scaffolder.
 *
 * Usage:
 *   bun run new-agent <flow> <key> [--template=director|web-builder|reflector|sentinel]
 *
 * Creates `flows/<flow>/agents/<key>.yaml` from a template, substituting
 * {{FLOW}} and {{KEY}} placeholders. Refuses to overwrite an existing file.
 *
 * Authority: Slice 90 architectural decision 7f86f4da, ProactiveQuestions
 * decision 00cc2ffa (filesystem-listing template lookup).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// scripts/new-agent.ts lives at .claude/skills/braid/scripts/new-agent.ts.
// dirname once → scripts/, dirname twice → braid/ (the skill root).
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES_DIR = join(SKILL_DIR, "examples", "agents");

export type ScaffoldArgs = {
  flow: string;
  key: string;
  template: string;
};

export type ScaffoldResult = {
  wrote: boolean;
  path?: string;
  content?: string;
  error?: string;
  available_templates?: string[];
};

/** List available templates (filesystem-listing per ProactiveQuestion decision 00cc2ffa). */
export function listTemplates(templatesDir: string = TEMPLATES_DIR): string[] {
  if (!existsSync(templatesDir)) return [];
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => e.name.replace(/\.yaml$/, ""))
    .sort();
}

/** Pure: render a template with placeholder substitution. */
export function renderTemplate(template: string, flow: string, key: string): string {
  return template
    .replace(/\{\{FLOW\}\}/g, flow)
    .replace(/\{\{KEY\}\}/g, key);
}

/** Scaffold (writes to disk unless dryRun). */
export function scaffoldAgent(
  args: ScaffoldArgs,
  opts: {
    repoRoot: string;
    templatesDir?: string;
    dryRun?: boolean;
  },
): ScaffoldResult {
  const templates = listTemplates(opts.templatesDir);
  if (!templates.includes(args.template)) {
    return {
      wrote: false,
      error: `unknown template '${args.template}'`,
      available_templates: templates,
    };
  }
  const templatePath = join(opts.templatesDir ?? TEMPLATES_DIR, `${args.template}.yaml`);
  const target = join(opts.repoRoot, "flows", args.flow, "agents", `${args.key}.yaml`);
  if (existsSync(target)) {
    return {
      wrote: false,
      path: target,
      error: `target already exists: ${target}. Pick a different <key> or remove the file first.`,
    };
  }
  const content = renderTemplate(readFileSync(templatePath, "utf-8"), args.flow, args.key);
  if (opts.dryRun) {
    return { wrote: false, path: target, content };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return { wrote: true, path: target, content };
}

/** CLI entry. Only runs when executed directly, not when imported. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.log(
      "Usage: bun run new-agent <flow> <key> [--template=director|web-builder|reflector|sentinel]\n" +
        "Available templates: " +
        listTemplates().join(", "),
    );
    process.exit(1);
  }
  const flow = argv[0]!;
  const key = argv[1]!;
  const templateFlag = argv.find((a) => a.startsWith("--template="));
  const template = templateFlag ? templateFlag.split("=")[1] ?? "director" : "director";
  // SKILL_DIR = <repo>/.claude/skills/braid
  //  → ../.claude/skills
  //  → ../.claude
  //  → <repo>     ← three dirnames
  const REPO_ROOT = dirname(dirname(dirname(SKILL_DIR)));
  if (!REPO_ROOT || REPO_ROOT === "/") {
    console.error(`could not resolve repo root from SKILL_DIR=${SKILL_DIR}`);
    process.exit(3);
  }
  const result = scaffoldAgent({ flow, key, template }, { repoRoot: REPO_ROOT });
  if (result.error) {
    console.error(result.error);
    if (result.available_templates) {
      console.error("Available templates: " + result.available_templates.join(", "));
    }
    process.exit(2);
  }
  console.log(`✓ wrote ${result.path}`);
}

if (import.meta.main) {
  await main();
}
