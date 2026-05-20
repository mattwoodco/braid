# Fundraiser Flow Rubric

## Critical — FAIL if any fail
1. `/mnt/session/outputs/manifest.json` exists and is valid JSON
2. `manifest.video_url` is an https URL and reachable (HTTP 200)
3. `manifest.page_url` is an https URL pointing to a Vercel production deployment and reachable (HTTP 200)
4. The HTML at `page_url` contains a `<video>` element whose source resolves to `video_url`
5. The HTML at `page_url` contains visible text "Donate Now" inside a clickable element (anchor or button)

## Quality — flag but do not fail
6. `manifest.deployed_at` is an ISO 8601 timestamp
7. Donate button links to https://example.com/donate
8. Page has a clear fundraiser headline above the video
