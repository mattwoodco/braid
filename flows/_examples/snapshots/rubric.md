# snapshots flow rubric

## Critical — FAIL if any fail
1. `/mnt/session/outputs/manifest.json` exists and is valid JSON
2. `manifest.shots` has exactly 3 entries
3. 3 non-empty `.jpg` files exist under `/mnt/session/outputs/`, named `01.jpg` … `3.jpg` (zero-padded)
4. Every image has dimensions consistent with aspect_ratio 16:9
5. Every `manifest.shots[i].image_url` is reachable (HTTP 200)

## Quality — flag but do not fail
6. The N shots actually differ along the `variation` axis — not near-duplicates
7. The locked Visual Bible appears verbatim in every recorded prompt
