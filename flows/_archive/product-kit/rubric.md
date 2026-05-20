# product-kit outcome rubric

Pass if EITHER (A) or (B) is true.

## (A) No-URL graceful exit

- The brief contained no `http://` or `https://` URL.
- The director's final reply is EXACTLY: `no URL provided — nothing to do`
- `/mnt/session/outputs/` is empty (or contains only an empty `manifest.json` is NOT acceptable — there must be no outputs at all).

## (B) Full kit produced

The brief contained a valid http(s) URL and every condition below is met:

1. `/mnt/session/outputs/manifest.json` exists and parses as JSON.
2. `manifest.json` contains non-empty fields:
   - `product.url` (the input URL)
   - `product.slug` (kebab-case product identifier)
   - `product.name`, `product.price`, `product.description`
   - `assets.image_urls` (array of at least 1 URL)
   - `brand.summary`, `brand.colors_file`, `brand.typography_file`
   - `copy.headlines` (5 strings), `copy.primary` (5 strings), `copy.ctas` (5 strings)
   - `ads.static` (3 paths), `ads.story` (3 paths), `landing.hero_html`
3. Each file referenced under `brand.*`, `copy.*`, `ads.*`, `landing.*` exists at the stated path.
4. The HTML files contain a `<link>` or `<style>` reference that pulls in the colors/typography from `/brand/`.
5. Every product claim in the copy appears in the scout-extracted facts (no invented claims).

## Hard fails

- Any HTML file is empty or contains only placeholder content.
- `assets/images.json` is empty when a URL was provided.
- Copy contains claims not present in scout's `facts.json`.
