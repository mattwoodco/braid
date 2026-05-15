# solids

Single web-builder agent. Each run rebuilds the Claude Design "shape carousel"
prototype as one self-contained HTML file, picks a fresh natural-language
**time-of-day title** (e.g. *Slow Morning*, *Blue Hour*, *Midnight Oil*) — never
"Solids · Vol. 01" — and deploys it to Vercel.

## Layout

```
flows/solids/
├── flow.yaml          # builder agent, Vercel MCP vault, rubric wiring
├── rubric.md          # outcome criteria (deliverables, fidelity, deploy check)
├── agents/builder.yaml
├── design/            # reference HTML from the claude.ai/design handoff
│   ├── SoloCarousel.html
│   ├── Pair.html
│   ├── Stack.html
│   └── Screens.html
└── outputs/           # per-run artifacts (gitignored)
```

## Setup once

```sh
bun .claude/skills/braid/braid.ts setup solids
```

Requires `ANTHROPIC_API_KEY` and `VERCEL_TOKEN` in `.env.local`.

## Run

```sh
bun .claude/skills/braid/braid.ts run solids
```

The agent:

1. Reads `date -u` and picks a phrase that fits the current UTC hour.
2. Reads the three reference HTML files (inlined via `{{file:...}}`).
3. Writes a single `index.html` to `/mnt/session/outputs/`, plus a `README.md`
   and `manifest.json` with the production URL.
4. Runs `vercel deploy --prod --yes --token=$VERCEL_TOKEN --name solids-<slug>`.
5. `curl`s the deployed URL to confirm the title is live.

## Design source

Handoff bundle from claude.ai/design — Three.js carousel of six platonic /
topological solids in pearl, gilt brass, jade, crystal, copper, and obsidian.
Fraunces + JetBrains Mono on a near-black radial background with an SVG
film-grain overlay. The Solo Carousel is the layout spine; Pair and Stack
contribute typographic detail (breadcrumbs, plate numbering, F·V·E rows,
upcoming-pill side rail).

## Example output

UTC 08:30 run → title **"Slow Morning"**, accent shifted from gilt to a
cream-peach, deployed to https://solids-slow-morning.vercel.app
