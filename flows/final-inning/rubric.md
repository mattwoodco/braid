# Final Inning Flow Rubric

## Critical — FAIL if any fail
1. `/mnt/session/outputs/manifest.json` exists and is valid JSON
2. `manifest.video_urls` is an array of length 3, every URL reachable (HTTP 200)
3. `manifest.page_url` is an https URL on a Vercel production deployment and reachable (HTTP 200)
4. The HTML at `page_url` contains exactly 3 `<video>` elements whose `src` attributes match the three `video_urls` in order
5. The HTML at `page_url` contains visible text "Save the Field" inside a clickable element

## Quality
6. `manifest.deployed_at` is ISO 8601
7. Donate → https://example.com/donate
8. Headline evokes the last game / saving the field
