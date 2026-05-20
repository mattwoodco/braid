/**
 * Braid template engine — parameterized flow scaffolding.
 *
 * A template lives at flows/_templates/<name>/ and contains:
 *   - template.yaml          (parameter manifest)
 *   - flow.yaml.tmpl         (with {{var}} holes)
 *   - agents/*.yaml.tmpl
 *   - rubric.md.tmpl, README.md.tmpl (optional)
 *   - examples/<instance>.json (optional reference var sets)
 *
 * Interpolation supports two forms only — no expressions:
 *   - {{var}}            simple substitution
 *   - {{#each list}}…{{/each}}   per-item, with {{this}} or {{.}} as the item
 *
 * Variables of type string[] iterate with {{#each}}. Unknown variables throw.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import { parse } from "yaml";

export type ParamType = "string" | "int" | "string[]" | "enum";

export type TemplateParam = {
  key: string;
  type: ParamType;
  required?: boolean;
  default?: unknown;
  pattern?: string;
  enum?: Array<string | number>;
  multiline?: boolean;
  description?: string;
  example?: string;
};

export type TemplateManifest = {
  name: string;
  description?: string;
  parameters: TemplateParam[];
  /** Optional per-agent defaults (e.g. tier mapping). Free-form merge. */
  defaults?: Record<string, unknown>;
};

/** Read and parse template.yaml for a named template under flows/_templates/. */
export function loadTemplate(repoRoot: string, name: string): { manifest: TemplateManifest; dir: string } {
  const dir = resolve(repoRoot, "flows", "_templates", name);
  if (!existsSync(dir)) throw new Error(`template not found: ${name} (looked in ${dir})`);
  const file = resolve(dir, "template.yaml");
  if (!existsSync(file)) throw new Error(`template missing template.yaml: ${file}`);
  const raw = parse(readFileSync(file, "utf-8")) as Partial<TemplateManifest>;
  if (!raw?.name) throw new Error(`${file}: missing required field "name"`);
  if (!Array.isArray(raw.parameters)) throw new Error(`${file}: "parameters" must be an array`);
  return { manifest: raw as TemplateManifest, dir };
}

/** Resolve, validate, and coerce a user-supplied vars object against the param schema. */
export function resolveVars(manifest: TemplateManifest, supplied: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const p of manifest.parameters) {
    seen.add(p.key);
    let v = supplied[p.key];
    if (v === undefined || v === null || v === "") {
      if (p.default !== undefined) v = p.default;
      else if (p.required) throw new Error(`missing required variable: ${p.key}`);
      else { out[p.key] = ""; continue; }
    }
    out[p.key] = coerce(p, v);
  }
  for (const k of Object.keys(supplied)) {
    if (!seen.has(k)) throw new Error(`unknown variable in vars: ${k}`);
  }
  // Second pass: allow defaults to reference other vars (one level deep) via {{var}}.
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v.includes("{{")) out[k] = interpolate(v, out);
  }
  return out;
}

function coerce(p: TemplateParam, v: unknown): unknown {
  switch (p.type) {
    case "string": {
      if (typeof v !== "string") throw new Error(`${p.key}: expected string, got ${typeof v}`);
      if (p.pattern && !new RegExp(p.pattern).test(v)) {
        throw new Error(`${p.key}: value ${JSON.stringify(v)} does not match pattern ${p.pattern}`);
      }
      return v;
    }
    case "int": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n)) throw new Error(`${p.key}: expected integer, got ${JSON.stringify(v)}`);
      if (Array.isArray(p.enum) && !p.enum.includes(n)) {
        throw new Error(`${p.key}: ${n} not in enum [${p.enum.join(", ")}]`);
      }
      return n;
    }
    case "string[]": {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        throw new Error(`${p.key}: expected string[]`);
      }
      return v;
    }
    case "enum": {
      if (!Array.isArray(p.enum) || !p.enum.includes(v as string | number)) {
        throw new Error(`${p.key}: ${JSON.stringify(v)} not in enum [${(p.enum ?? []).join(", ")}]`);
      }
      return v;
    }
  }
}

/**
 * Interpolate {{var}} and {{#each list}}…{{/each}} blocks. Throws on unknown
 * names so authoring mistakes fail loudly at create time rather than silently
 * leaking template syntax into the rendered flow.
 */
export function interpolate(src: string, vars: Record<string, unknown>): string {
  // Each blocks first (so {{var}} inside still resolves per iteration).
  const eachRe = /\{\{#each\s+([a-zA-Z_][\w]*)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let out = src.replace(eachRe, (_m, key: string, body: string) => {
    if (!(key in vars)) throw new Error(`interpolate: unknown variable in {{#each ${key}}}`);
    const list = vars[key];
    if (!Array.isArray(list)) throw new Error(`interpolate: {{#each ${key}}} requires array, got ${typeof list}`);
    return list
      .map((item, i) => {
        const scope = { ...vars, this: item, "@index": i, "@one": i + 1 };
        return interpolate(body, scope);
      })
      .join("");
  });
  // Simple {{var}} / {{.}} / {{this}} / {{@index}} / {{@one}} / {{var|indentN}}
  const simpleRe = /\{\{\s*([a-zA-Z_@][\w@.]*)\s*(?:\|\s*indent(\d+))?\s*\}\}/g;
  out = out.replace(simpleRe, (_m, key: string, indentN: string | undefined) => {
    let v: unknown;
    if (key === "." || key === "this") v = vars["this"];
    else {
      if (!(key in vars)) throw new Error(`interpolate: unknown variable {{${key}}}`);
      v = vars[key];
    }
    let s = v === undefined || v === null ? "" : String(v);
    if (indentN) {
      const pad = " ".repeat(Number.parseInt(indentN, 10));
      s = s.split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
    }
    return s;
  });
  return out;
}

export type PlannedWrite = { relPath: string; content: string };

/**
 * Walk the template directory and produce the list of files to write to the
 * new flow dir. Suffix `.tmpl` is stripped on emit; non-`.tmpl` files are
 * copied byte-for-byte. The `template.yaml` and `examples/` subtree are
 * excluded.
 */
export function instantiateTemplate(opts: {
  repoRoot: string;
  templateName: string;
  flowName: string;
  vars: Record<string, unknown>;
}): { writes: PlannedWrite[]; targetDir: string } {
  const { manifest, dir } = loadTemplate(opts.repoRoot, opts.templateName);
  const resolved = resolveVars(manifest, { ...opts.vars, flow_name: opts.flowName });
  const targetDir = resolve(opts.repoRoot, "flows", opts.flowName);
  const writes: PlannedWrite[] = [];

  const skip = (rel: string) =>
    rel === "template.yaml" || rel === "" || rel.startsWith("examples/") || rel.startsWith("examples");

  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      const rel = relative(dir, childAbs);
      if (skip(rel)) continue;
      if (entry.isDirectory()) { walk(childAbs); continue; }
      const buf = readFileSync(childAbs);
      const isTmpl = entry.name.endsWith(".tmpl");
      const outRel = isTmpl ? rel.slice(0, -".tmpl".length) : rel;
      // Binary safety: only interpolate text templates (.tmpl). Pass through everything else.
      const content = isTmpl ? interpolate(buf.toString("utf-8"), resolved) : buf.toString("utf-8");
      writes.push({ relPath: outRel, content });
    }
  };
  walk(dir);
  return { writes, targetDir };
}

/** Parse `--vars` flag value: JSON file path OR inline `k=v,k2=v2`. */
export function parseVarsArg(arg: string, baseDir: string): Record<string, unknown> {
  if (!arg) return {};
  const abs = resolve(baseDir, arg);
  if (existsSync(abs) && statSync(abs).isFile()) {
    const raw = readFileSync(abs, "utf-8");
    if (abs.endsWith(".yaml") || abs.endsWith(".yml")) return parse(raw) as Record<string, unknown>;
    return JSON.parse(raw) as Record<string, unknown>;
  }
  // Inline k=v,k2=v2 — strings only; use a JSON file for typed/multiline vars.
  const out: Record<string, unknown> = {};
  for (const pair of arg.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) throw new Error(`--vars: bad pair ${JSON.stringify(pair)}; expected key=value`);
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
  return out;
}

export function listTemplates(repoRoot: string): string[] {
  const dir = resolve(repoRoot, "flows", "_templates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, "template.yaml")))
    .map((e) => e.name)
    .sort();
}
