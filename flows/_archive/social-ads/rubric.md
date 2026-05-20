# social-ads outcome rubric

Pass if EITHER (A) or (B) is true.

## (A) No-URL graceful exit
- Brief contained no http(s) URL.
- Director's final reply EXACTLY: `no URL provided — nothing to do`
- `/mnt/session/outputs/` is empty.

## (B) 3 social ads rendered and validated

All of:

1. `/mnt/session/outputs/manifest.json` with:
   - `product.url`, `product.slug`, `product.name`
   - `product.hero_image_url` (https, HEAD-verified)
   - `ads`: array of 3 items, each with `html`, `png`, `viewport: {width, height}`, `pass: true`, `issues: []`
2. Files exist directly in `/mnt/session/outputs/`:
   - `colors.css`, `typography.css`
   - `static-ad-1.html`, `static-ad-1.png` — 1080×1080 (Instagram square)
   - `static-ad-2.html`, `static-ad-2.png` — 1080×1350 (Instagram portrait)
   - `static-ad-3.html`, `static-ad-3.png` — 1080×1920 (Instagram/TikTok story)
   - `validation.json` with `pass: 3, fail: 0`
3. Each PNG ≥ 50 KB and decoded at the target viewport.
4. Each ad HTML contains exactly one `<img data-role="product-hero" src="{hero_image_url}">`, dominance ≥ 35% of canvas, with no text overlap on the hero bbox.

## Hard fails
- Any PNG missing or empty.
- Any ad missing the `data-role="product-hero"` image (or more than one).
- `product.hero_image_url` null or missing.
