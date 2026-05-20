# ad-render-v2 outcome rubric

Pass if EITHER (A) or (B) is true.

## (A) No-URL graceful exit
- Brief contained no http(s) URL.
- Director's final reply EXACTLY: `no URL provided — nothing to do`
- `/mnt/session/outputs/` is empty.

## (B) In-session Playwright render validated

The brief contained a valid http(s) URL and all of:

1. `/mnt/session/outputs/playwright-env.json` exists with non-empty `chromium_version` and `playwright_version`. This proves Playwright + apt-installed chromium work in the managed-agent sandbox.
2. `/mnt/session/outputs/manifest.json` exists with:
   - `product.url`, `product.slug`, `product.name`
   - `product.hero_image_url` (https, HEAD-verified by scout)
   - `ads`: array of 2 items, each with `html`, `png`, `viewport: {width,height}`, `pass: true`, `issues: []`
   - `playwright`: { chromium_version, playwright_version }
3. Files exist directly in `/mnt/session/outputs/`:
   - `static-ad-1.html`, `static-ad-1.png`
   - `static-ad-2.html`, `static-ad-2.png`
   - `colors.css` and `typography.css` (used by the HTML)
   - `validation.json` with `pass: 2, fail: 0`
4. Each PNG is a real image (≥ 50 KB, decoded by Playwright at the target viewport).
5. Each ad's HTML contains exactly one `<img data-role="product-hero" src="{hero_image_url}">` element. The product image was dominant (≥35% canvas area) and no text element overlapped its bounding box (validator confirmed in-session).

## Hard fails
- `playwright-env.json` missing — the test of the architecture has not been run.
- Any PNG missing or zero bytes.
- `manifest.product.hero_image_url` empty.
- More than one `[data-role="product-hero"]` per ad.
