#!/usr/bin/env bun
/**
 * ad-render host post-session hook.
 *
 * Runs AFTER the agent session ends. For each of the 3 ad HTMLs in
 * /mnt/session/outputs/ (locally, $BRAID_OUTPUT_DIR):
 *   - launches headless Chromium at the exact target viewport
 *   - validates: no broken images, [data-role="product-hero"] exists and is
 *     dominant on the canvas, no text element overlaps the hero bounding box
 *   - screenshots to static-ad-N.png
 *
 * Writes validation.json + a PNG gallery index.html + updates manifest.json.
 *
 * Inputs: BRAID_OUTPUT_DIR, BRAID_FLOW_NAME, BRAID_FLOW_DIR, BRAID_SESSION_ID.
 * No secrets required.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const OUTPUT_DIR = process.env.BRAID_OUTPUT_DIR;
if (!OUTPUT_DIR) {
  console.error("[render] BRAID_OUTPUT_DIR not set; aborting");
  process.exit(2);
}

const manifestPath = join(OUTPUT_DIR, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("[render] no manifest.json — agent likely took the no-URL path; nothing to render");
  process.exit(0);
}

type Manifest = {
  product: { url: string; slug: string; name?: string; hero_image_url?: string };
  ads: {
    files: string[];
    dimensions: { file: string; width: number; height: number; name: string }[];
  };
  renders?: unknown;
  validation_summary?: unknown;
};

const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as Manifest;
if (!manifest.ads?.dimensions?.length) {
  console.error("[render] manifest.ads.dimensions missing; aborting");
  process.exit(2);
}

// Resolve playwright from the repo's node_modules. The hook runs with a
// stripped env (BRAID_*, PATH only) and cwd may be the output dir — so
// installing in-place won't work. We rely on playwright being a repo dep.
// If it's missing, fail with an actionable message.
function run(cmd: string, args: string[], opts: { cwd?: string } = {}): number {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd });
  return r.status ?? 1;
}

const REPO_ROOT = process.env.BRAID_FLOW_DIR
  ? join(process.env.BRAID_FLOW_DIR, "..", "..")
  : process.cwd();

const PW_ENTRY = join(REPO_ROOT, "node_modules", "playwright", "index.js");
let playwrightMod: typeof import("playwright");
try {
  // Force resolution from the repo root rather than the output dir.
  playwrightMod = await import(PW_ENTRY);
} catch {
  console.error(`[render] playwright not found under ${REPO_ROOT}/node_modules.`);
  console.error(`[render] install it once: cd ${REPO_ROOT} && bun add -d playwright`);
  process.exit(3);
}

// Install chromium if missing. Cheap on subsequent runs. Run from repo root
// so the browser cache lands in a stable location.
console.log("[render] ensuring chromium is installed (idempotent)...");
run("bunx", ["playwright", "install", "chromium"], { cwd: REPO_ROOT });

const { chromium } = playwrightMod;
const browser = await chromium.launch();

type Validation = {
  file: string;
  name: string;
  viewport: { width: number; height: number };
  png: string;
  broken_images: { src: string; alt: string }[];
  hero: { present: boolean; dominance?: number; rect?: { x: number; y: number; w: number; h: number } };
  text_overlaps_on_product: { tag: string; text: string }[];
  issues: string[];
  pass: boolean;
};

const validations: Validation[] = [];

for (const dim of manifest.ads.dimensions) {
  const htmlPath = join(OUTPUT_DIR, dim.file);
  if (!existsSync(htmlPath)) {
    validations.push({
      file: dim.file,
      name: dim.name,
      viewport: { width: dim.width, height: dim.height },
      png: "",
      broken_images: [],
      hero: { present: false },
      text_overlaps_on_product: [],
      issues: [`ad file missing on disk: ${dim.file}`],
      pass: false,
    });
    continue;
  }

  const ctx = await browser.newContext({
    viewport: { width: dim.width, height: dim.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle", timeout: 30000 });
  } catch (err) {
    validations.push({
      file: dim.file,
      name: dim.name,
      viewport: { width: dim.width, height: dim.height },
      png: "",
      broken_images: [],
      hero: { present: false },
      text_overlaps_on_product: [],
      issues: [`page load failed: ${(err as Error).message}`],
      pass: false,
    });
    await ctx.close();
    continue;
  }
  await page.waitForTimeout(500);

  const brokenImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("img"))
      .filter(img => img.naturalWidth === 0 || img.naturalHeight === 0)
      .map(img => ({ src: img.src, alt: img.alt }));
  });

  const hero = await page.evaluate(() => {
    const matches = document.querySelectorAll('[data-role="product-hero"]');
    if (matches.length === 0) return { present: false, count: 0 };
    if (matches.length > 1) return { present: true, count: matches.length };
    const el = matches[0] as HTMLElement;
    const r = el.getBoundingClientRect();
    const canvas = window.innerWidth * window.innerHeight;
    const area = r.width * r.height;
    return {
      present: true,
      count: 1,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      dominance: canvas > 0 ? area / canvas : 0,
    };
  });

  const textOverlaps = await page.evaluate(() => {
    const matches = document.querySelectorAll('[data-role="product-hero"]');
    if (matches.length !== 1) return [];
    const heroR = (matches[0] as HTMLElement).getBoundingClientRect();
    const inset = 4; // tiny tolerance for sub-pixel edge cases
    const intersects = (r: DOMRect) =>
      !(
        r.right < heroR.left + inset ||
        r.left > heroR.right - inset ||
        r.bottom < heroR.top + inset ||
        r.top > heroR.bottom - inset
      );
    const out: { tag: string; text: string }[] = [];
    const selector = "h1,h2,h3,h4,h5,h6,p,span,a,button,li,small,strong,em,b,i";
    document.querySelectorAll(selector).forEach(el => {
      if (el.children.length > 0) return; // only leaf text containers
      const text = (el.textContent || "").trim();
      if (!text) return;
      const cs = window.getComputedStyle(el);
      if (parseFloat(cs.fontSize) < 6) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (intersects(r)) {
        out.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 80) });
      }
    });
    return out;
  });

  const pngFile = dim.file.replace(/\.html$/, ".png");
  const pngPath = join(OUTPUT_DIR, pngFile);
  await page.screenshot({ path: pngPath, fullPage: false });

  const issues: string[] = [];
  if (brokenImages.length) {
    issues.push(`${brokenImages.length} broken image(s): ${brokenImages.map(b => b.src).join(", ")}`);
  }
  if (!hero.present) {
    issues.push(`no [data-role="product-hero"] element`);
  } else if (hero.count !== 1) {
    issues.push(`expected exactly 1 [data-role="product-hero"], found ${hero.count}`);
  } else if ((hero.dominance ?? 0) < 0.35) {
    issues.push(`product-hero dominance ${(((hero.dominance ?? 0) * 100)).toFixed(1)}% < 35% target — product not prominent enough`);
  }
  if (textOverlaps.length) {
    issues.push(`${textOverlaps.length} text element(s) overlap product-hero: ${textOverlaps.map(t => `<${t.tag}>"${t.text}"`).join(" | ")}`);
  }

  validations.push({
    file: dim.file,
    name: dim.name,
    viewport: { width: dim.width, height: dim.height },
    png: pngPath,
    broken_images: brokenImages,
    hero: {
      present: hero.present,
      dominance: hero.dominance,
      rect: (hero as { rect?: { x: number; y: number; w: number; h: number } }).rect,
    },
    text_overlaps_on_product: textOverlaps,
    issues,
    pass: issues.length === 0,
  });

  await ctx.close();
}

await browser.close();

const passCount = validations.filter(v => v.pass).length;
const failCount = validations.length - passCount;

const validationReport = {
  generated_at: new Date().toISOString(),
  session_id: process.env.BRAID_SESSION_ID,
  flow: process.env.BRAID_FLOW_NAME,
  pass: passCount,
  fail: failCount,
  ads: validations,
};
await writeFile(join(OUTPUT_DIR, "validation.json"), JSON.stringify(validationReport, null, 2));

manifest.renders = validations.map(v => ({
  html: v.file,
  png: v.png,
  viewport: v.viewport,
  pass: v.pass,
  issues: v.issues,
}));
manifest.validation_summary = { pass: passCount, fail: failCount };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const productName = manifest.product?.name ?? manifest.product?.slug ?? "product";
const galleryEntries = validations
  .map(v => {
    const png = v.png ? v.png.split("/").pop() : "";
    const status = v.pass ? `<span class="ok">PASS</span>` : `<span class="fail">FAIL</span>`;
    const issues = v.issues.length
      ? `<ul class="issues">${v.issues.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
      : "";
    return `
    <figure class="card">
      <figcaption>
        <strong>${escapeHtml(v.name)}</strong> · ${v.viewport.width}×${v.viewport.height} · ${status}
        <a href="${escapeHtml(v.file)}">html</a>
        ${png ? `· <a href="${escapeHtml(png)}">png</a>` : ""}
      </figcaption>
      ${png ? `<img src="${escapeHtml(png)}" alt="${escapeHtml(v.name)} render">` : `<div class="missing">no render</div>`}
      ${issues}
    </figure>`;
  })
  .join("");
const gallery = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(productName)} — ad renders</title>
<link rel="stylesheet" href="./colors.css">
<link rel="stylesheet" href="./typography.css">
<style>
  body { margin:0; padding:24px; background:var(--color-bg, #f5f5f5); font-family:var(--font-body, system-ui, sans-serif); color:var(--color-text, #111); }
  h1 { font-family:var(--font-display, system-ui, sans-serif); font-size:24px; margin:0 0 8px; }
  p.sub { margin:0 0 24px; color:var(--color-text-muted, #555); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(380px, 1fr)); gap:24px; }
  .card { background:#fff; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); overflow:hidden; padding:16px; }
  .card figcaption { font-size:13px; margin-bottom:12px; display:flex; gap:8px; align-items:center; }
  .card img { width:100%; height:auto; display:block; background:#fafafa; border-radius:8px; }
  .missing { padding:48px; text-align:center; background:#fafafa; border-radius:8px; color:#888; }
  .ok { color:#0a7d27; font-weight:600; }
  .fail { color:#b3251c; font-weight:600; }
  .issues { color:#b3251c; font-size:12px; margin:8px 0 0; padding-left:18px; }
</style>
</head>
<body>
  <h1>${escapeHtml(productName)}</h1>
  <p class="sub">Static ad renders · ${passCount}/${validations.length} passed validation · session ${escapeHtml(process.env.BRAID_SESSION_ID ?? "")}</p>
  <div class="grid">${galleryEntries}</div>
</body>
</html>`;
await writeFile(join(OUTPUT_DIR, "index.html"), gallery);

console.log(`[render] ${passCount}/${validations.length} passed`);
for (const v of validations) {
  console.log(`[render] ${v.file} → ${v.png || "(no render)"} ${v.pass ? "OK" : `ISSUES: ${v.issues.join("; ")}`}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

process.exit(failCount === 0 ? 0 : 0); // exit 0 even on fail — validation is informational; user inspects validation.json
