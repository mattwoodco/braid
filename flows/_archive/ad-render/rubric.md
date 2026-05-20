# ad-render outcome rubric

Pass if EITHER (A) or (B) is true.

## (A) No-URL graceful exit

- The brief contained no http(s) URL.
- Director's final reply is EXACTLY: `no URL provided — nothing to do`
- `/mnt/session/outputs/` is empty.

## (B) Full 3-ad set produced (PRE-render)

The brief contained a valid http(s) URL and every condition below is met (the
host post-hook will render PNGs and run validation AFTER this grade — those
results are not required for this rubric to pass):

1. `/mnt/session/outputs/manifest.json` exists and parses as JSON with:
   - `product.url`, `product.slug`, `product.name`, `product.price`, `product.description`
   - `product.hero_image_url` (non-empty, https://, HEAD-verified by scout)
   - `assets.image_urls` (≥1), `assets.logo_url`, `assets.fonts`
   - `brand.summary` and references to colors.css/typography.css
   - `copy.headlines` (3), `copy.primary` (3), `copy.ctas` (3)
   - `ads.files`: ["static-ad-1.html","static-ad-2.html","static-ad-3.html"]
2. These files exist directly in `/mnt/session/outputs/` (flat layout — braid's
   extractor flattens, so designer writes them flat with `./colors.css`-style
   relative links):
   - brand-summary.md, colors.css, typography.css, aesthetic.md
   - images.json, logo.json, fonts.json
   - headlines.md, primary-copy.md, ctas.md
   - static-ad-1.html, static-ad-2.html, static-ad-3.html
3. Each ad HTML:
   - Is valid HTML5.
   - Has `<link rel="stylesheet" href="./colors.css">` and `<link rel="stylesheet" href="./typography.css">` in <head>.
   - Contains EXACTLY ONE `<img data-role="product-hero" src="{hero_image_url}" alt="…">` element.
   - Uses the hero image as the dominant visual (designer's CSS must size the
     product-hero element to at least 50% of the ad's width or height).
   - Includes alt text on every <img>.
   - Has no text element styled to overlap the product image (designer keeps
     text in its own region — see designer prompt for the rule).
4. Every claim in copy/ appears in scout's facts.json.

## Hard fails

- product-hero `<img>` missing from any ad.
- Ad references `../brand/colors.css` instead of `./colors.css`.
- More than one `[data-role="product-hero"]` in a single ad.
- Copy contains claims not in scout's facts.json.
