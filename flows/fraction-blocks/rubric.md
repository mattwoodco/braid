# Outcome rubric — fraction-blocks

PASS only if ALL of the following are true.

## Files

- `/mnt/session/outputs/index.html` exists and is a single self-contained HTML file (no external JS imports beyond Google Fonts CSS).
- `/mnt/session/outputs/README.md` exists.
- `/mnt/session/outputs/manifest.json` exists, is valid JSON, and contains:
  - `site_dir: "."`
  - `project_name: "fraction-blocks"`
  - `ready_to_deploy: true`

## Aesthetic — Duplo style

- `index.html` loads Fredoka OR Baloo 2 from `fonts.googleapis.com`.
- CSS sets a body background that is pastel/off-white (not pure white, not dark).
- At least 4 distinct bright primary colors are used as block fills.
- `border:` declarations are absent or only used for focus rings (no decorative borders).
- `border-radius` of 20px or larger appears multiple times.
- `box-shadow` is used for depth.
- Body font-size is >= 20px; at least one heading is >= 48px.

## Activities — three interactive sections

The HTML contains three distinct sections (anchors or ids) for:

1. SLICE — a divisible block with a live `N/D` fraction display and +/- controls.
2. MATCH — a fraction prompt, multiple candidate blocks, score, confetti on correct.
3. BUILD — a "whole" track, palette of fraction tiles, running-total readout.

JS implements click handlers for each. Web Audio API (`AudioContext` or `webkitAudioContext`) is used to play the celebration chime. Confetti is implemented in CSS/JS without external libraries.

## Accessibility

- All interactive elements are `<button>` (no `<div onclick>`).
- Each interactive button has an `aria-label` or accessible text content.
- A `:focus` or `:focus-visible` style is defined with a visible outline.
- `@media (prefers-reduced-motion: reduce)` is present.

## Deploy

- After the post-session hook runs, `manifest.json.page_url` starts with `https://` and resolves (HTTP 200).
- The deployed page's HTML contains the app title.

## Fail conditions

- Any deliverable file missing.
- Fewer than three interactive activities.
- Uses an external JS framework or library (React, Vue, jQuery, etc.).
- Page is monochrome, has visible decorative borders, or uses body font-size < 20px.
- `page_url` is absent, malformed, or returns 4xx/5xx.
