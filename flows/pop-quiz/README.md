# pop-quiz

A Canada goose in a brown corduroy blazer subs for the regular teacher at a 1970s public school. Three deadpan shots, composited into one mp4 via ffmpeg.

**Status:** scaffolded — not yet deployed (no public site; this flow produces a video, not a webpage).

## Run it

```bash
bun .claude/skills/braid/braid.ts setup pop-quiz && bun .claude/skills/braid/braid.ts run pop-quiz
```

Outputs land in `/mnt/session/outputs/`:
- `shot_01.mp4`, `shot_02.mp4`, `shot_03.mp4` — raw kling clips
- `final.mp4` — composited via ffmpeg concat
- `manifest.json`
