# Pop-Quiz Flow Rubric

## Critical — FAIL if any fail
1. `/mnt/session/outputs/manifest.json` exists and is valid JSON
2. `manifest.shots` is an array of exactly 3 entries
3. Each shot's `image_url` and `video_url` is an https URL and reachable (HTTP 200)
4. `manifest.final_video_path` is `/mnt/session/outputs/final.mp4`
5. `/mnt/session/outputs/final.mp4` exists and is non-empty (> 100 KB)

## Quality — flag but do not fail
6. `manifest.generated_at` is an ISO 8601 timestamp
7. Each shot has distinct framing (wide / medium / close-medium)
8. The composite mp4 plays as a single contiguous H.264 stream (faststart for web)
