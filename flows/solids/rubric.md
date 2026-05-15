# Outcome rubric — solids

PASS only if ALL of the following are true.

## Files

- `/mnt/session/outputs/index.html` exists and is a single self-contained HTML file.
- `/mnt/session/outputs/README.md` exists.
- `/mnt/session/outputs/manifest.json` exists and is valid JSON containing `title`,
  `vercel_url`, and `deployed_at`.

## Title

- The chosen title is a natural-language time-of-day phrase (e.g. "Late Afternoon",
  "Blue Hour", "Midnight Oil").
- The title is NOT "Solids", "Solids · Vol. 01", or any string containing "Vol. 0".
- The title appears in the `<title>` tag of index.html AND in the visible header brand.

## Design fidelity

- `index.html` includes:
  - The Fraunces font (`fonts.googleapis.com/css2?family=Fraunces`).
  - The JetBrains Mono font.
  - A Three.js import (via importmap or script tag, unpkg or jsdelivr).
  - At least 4 distinct geometry types from: Icosahedron, Dodecahedron, Octahedron,
    Tetrahedron, Torus, TorusKnot.
  - `MeshPhysicalMaterial` usage.
  - The film-grain SVG noise overlay (`feTurbulence`).
  - A keyboard handler for ArrowLeft / ArrowRight.

## Deploy

- `manifest.json.vercel_url` starts with `https://` and resolves (HTTP 200).
- The deployed page's HTML contains the chosen title.

## Fail conditions

- Missing any deliverable file.
- Title is from the reference set.
- `vercel_url` is absent, malformed, or 4xx/5xx.
