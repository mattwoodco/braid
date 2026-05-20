# fundraiser flow rubric

## Critical — FAIL if any fail
1. `/mnt/session/outputs/manifest.json` exists and is valid JSON
2. `manifest.shots` is an array of length 1; every `video_url` is reachable (HTTP 200)
3. `manifest.ready_to_deploy` is `true` and `manifest.site_dir` points at a folder containing `index.html`
4. The local `index.html` contains exactly 1 `<video>` elements whose `src` attributes are the corresponding `video_url`s in order
5. The local `index.html` contains the visible text "Donate Now" inside a clickable element

## Quality — flag but do not fail
6. CTA `<a>` href equals https://example.com/donate
7. Headline evokes the "Save the Community Centre" theme above the videos

## Post-hook — graded outside the session
The host post_session_hook deploys the site to Vercel AFTER the agent
session ends and appends `manifest.page_url` + `manifest.deployed_at`.
That work is not gradable by the in-session rubric. Check the saved
outputs dir for the final manifest.
