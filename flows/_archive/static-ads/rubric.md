# static-ads outcome rubric

Pass if EITHER (A) or (B) is true.

## (A) No-URL graceful exit

- The brief contained no http(s) URL.
- The director's final reply is EXACTLY: `no URL provided — nothing to do`
- `/mnt/session/outputs/` is empty (no files at all).

## (B) Full static-ad set produced

The brief contained a valid http(s) URL and every condition below is met:

1. `/mnt/session/outputs/manifest.json` exists and parses as JSON with non-empty `product`, `assets`, `brand`, `copy`, and `ads` sections.
2. `/mnt/session/outputs/index.html` exists at the outputs root and references the 5 ads in an iframe grid.
3. `brand/` contains: `brand-summary.md`, `colors.css`, `typography.css`, `aesthetic.md`.
4. `assets/` contains: `images.json`, `logo.json`, `fonts.json`.
5. `copy/` contains: `headlines.md`, `primary-copy.md`, `ctas.md`.
6. `ads/` contains: `static-ad-1.html` through `static-ad-5.html`.
7. Each ad HTML:
   - Is valid HTML5 (`<!doctype html>`, `<html>`, `<head>`, `<body>`).
   - Has `<link rel="stylesheet" href="../brand/colors.css">` and `<link rel="stylesheet" href="../brand/typography.css">` in `<head>`.
   - References at least one product image URL with non-empty alt text.
   - Uses CSS variables defined in `colors.css` / `typography.css` (not redefined inline).
8. Every claim in `copy/` appears in scout's `facts.json` (no invented claims).

## Hard fails

- Any ad HTML file is empty or contains placeholder text.
- An ad references `./colors.css` or other wrong paths instead of `../brand/colors.css`.
- `assets/images.json` is empty.
- Copy contains claims not in scout's facts.json.
