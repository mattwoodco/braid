# gauntlet-ads outcome rubric

Pass requires ALL of:

1. `/mnt/session/outputs/manifest.json` with:
   - `product.url` = a gauntletai.com URL
   - `product.slug`, `product.name`
   - `product.hero_image_url` — HEAD-verified, https
   - `ads`: array of 5 items, each with `html`, `png`, `viewport: {width, height}`, `pass: true`, `issues: []`

2. Files exist directly in `/mnt/session/outputs/`:
   - `colors.css`, `typography.css`
   - `ad-1.html` + `ad-1.png` — 1080×1080 (square)
   - `ad-2.html` + `ad-2.png` — 1080×1350 (portrait)
   - `ad-3.html` + `ad-3.png` — 1080×1920 (story)
   - `ad-4.html` + `ad-4.png` — 1200×628 (landscape link card)
   - `ad-5.html` + `ad-5.png` — 1080×566 (wide / Twitter inline)
   - `validation.json` with `pass: 5, fail: 0`

3. Each PNG ≥ 50 KB, decoded at its target viewport.

4. Each ad HTML contains exactly one `<img data-role="product-hero">`, hero dominance ≥ 35%, no text overlap on hero bbox, no broken images (`broken_images: []` in validation.json for every ad).

## Hard fails
- Any PNG missing, empty, or showing a broken-image placeholder.
- Any ad missing the `data-role="product-hero"` image.
- `product.hero_image_url` null or not a gauntletai.com asset host.
- `validation.json` reports any `broken_images` entry.
