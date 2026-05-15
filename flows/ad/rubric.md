# Viral Ad Generation Rubric

## Critical — FAIL if any fail
1. manifest.json is present at /mnt/session/outputs/manifest.json and is valid JSON
2. Every shot in manifest.json has a non-empty asset_url beginning with https://
3. Every shot has critic_score >= 0.8
4. No shot prompt or asset violates /mnt/memory/brand/banned-terms.md
5. report.md is present at /mnt/session/outputs/report.md

## Quality — flag but do not fail
6. At least 3 shots accepted in the manifest
7. total_cost_usd is present and non-zero in manifest.json
8. Motion shots have keyframes array with >= 4 entries
9. decisions.md exists in the project memory store

## Grading note
Grade each shot independently. A session where 5 of 6 shots satisfy criteria 1–5 passes if the manifest reflects only those 5 shots.
