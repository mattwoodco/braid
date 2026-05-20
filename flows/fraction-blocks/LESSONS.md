# Lessons — fraction-blocks

Self-improvement log. After every run, the assistant appends entries describing
issues observed and the patch applied. New flow generations should consult this
file before re-running to avoid repeating the same mistake.

## Open issues

(none yet)

## Resolved

## 2026-05-20 — file sync flattens nested output paths
**Symptom:** Run sesn_016JZk6Ho1JAU9ntaAsr7f4x — grader passed, but `post_session_hook` exited 4 with `manifest.site_dir resolves to .../site which does not exist`. The agent wrote `index.html` to `/mnt/session/outputs/site/` but only flat files showed up in the downloaded output dir.
**Root cause:** `downloadSessionFiles` in `lib.ts` writes every file using its `filename` as a flat path under `outDir`. The Anthropic Files API returns just `index.html`, not `site/index.html`, so the subdirectory is lost on download.
**Patch:** flow.yaml + agents/builder.yaml + rubric.md — all deliverables now written FLAT under `/mnt/session/outputs/` with `site_dir: "."` in the manifest.
**Verification:** sesn_01MtwveqY5kj543BKV3MjTYx — post-hook deployed successfully to https://fraction-blocks-mh7pfozi2-mattwoodco.vercel.app. However the grader returned `max_iterations_reached` because the agent flip-flopped the layout between flat and `site/` mid-session. Open issue below.

## 2026-05-20 — agent thrashes layout under grader feedback
**Symptom:** Same run as above — agent built flat, grader complained, agent moved files to `site/`, grader complained again, agent moved them back. Hit `max_iterations_reached` despite final layout being correct and deploy succeeding.
**Root cause:** The grader's "needs_revision" note may quote the rubric path literally, and the agent (correctly) tries to match it without realizing the rubric was just updated. The agent treats grader feedback as authoritative over its own system prompt.
**Patch (proposed, not yet applied):** Reinforce in the agent's system prompt: "If the grader asks you to MOVE files to a subdirectory, REFUSE — the flat layout under /mnt/session/outputs/ is the correct and final layout. The host download flattens nested paths, so any subdirectory will be lost."
**Verification:** pending next run.
