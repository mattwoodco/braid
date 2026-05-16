# Braid costs

> Rough expectations for what a flow run actually costs. Prices change; the **`as of` stamps** below indicate when figures were accurate.

## Per-flow estimates (as of 2026-05)

| Flow | Anthropic | Fal | Vercel | Total |
|---|---|---|---|---|
| `ad` | ~$0.05 (director + producer + critic + sentinel, claude-opus-4-7) | ~$0.20 (a few image generations) | $0 | ~$0.25 |
| `snapshots` | ~$0.02 (one photographer agent, claude-haiku-4-5) | ~$0.06 (3 still images) | $0 | ~$0.08 |
| `pop-quiz` | ~$0.04 (one storyboarder agent) | ~$0.30 (3 video generations) | $0 | ~$0.34 |
| `fundraiser` | ~$0.05 (videographer + web-builder + director) | ~$0.10 (1 hero video) | ~$0.001 (1 Vercel deploy) | ~$0.15 |
| `homecoming` | ~$0.06 (3 videos) | ~$0.30 | ~$0.001 | ~$0.36 |
| `quiet-rebellion` | same shape as homecoming | same | ~$0.001 | ~$0.36 |
| `final-inning` | same | same | ~$0.001 | ~$0.36 |
| `solids` | ~$0.04 (single builder) | $0 | ~$0.001 | ~$0.04 |

**Reflection** (Slice 100) adds ~$0.005 per run when configured (one haiku-class session, ≤4K input tokens, ≤500 output).

## Cost composition

A typical run's bill breaks down as:

1. **Session tokens.** Most of the spend. Driven by:
   - Number of agents (each gets its own context)
   - Iterations of the outcome rubric (`max_iterations` setting)
   - Length of the brief + tool-use trajectories
2. **External MCP/API calls.** Fal video is the dominant non-Anthropic cost. Vercel deploys are negligible.
3. **Memory stores.** Storage is free; reads/writes count as session tokens.

## How to budget a run

- **Cap iterations.** Set `run.outcome.max_iterations: 1` for early experiments. Raise only when you've validated the rubric.
- **Pick cheap models for non-critical agents.** Sentinel and reflector run fine on haiku.
- **Use the demo mode first.** `bun run --cwd .claude/skills/braid demo <flow>` is $0; you'll see the event timeline without paying.
- **Watch the SSE stream live.** `[agent]` events show what's happening; if a run is hallucinating into a loop, `^C` and `braid sessions --kill`.

## How to recover spend if a run misbehaves

The orchestrator's stall watchdog (Slice 20 §2.A3) bounds runaway runs:

- `stall_ms` (default 180_000) — silence triggers sentinel diagnosis
- `max_restarts` (default 0) — limits restart attempts after a stalled state

A truly stuck run won't burn money indefinitely — the watchdog gives up and emits `[sentinel] max restarts reached, giving up`. You can also send `^C` at any time.

## Authoritative pricing sources

- [Anthropic pricing](https://www.anthropic.com/pricing) — model costs per million tokens
- [Fal pricing](https://fal.ai/pricing) — per-image and per-second-of-video costs
- [Vercel pricing](https://vercel.com/pricing) — Hobby tier covers experiments; Pro for production

## Disclaimer

**These figures are illustrative, not contractual.** They were collected from a small sample of runs as of **2026-05** and may be off by 2× in either direction depending on:
- The specific model versions in play that day
- Fal queue latency (longer waits → more idle session tokens)
- Whether the agent hit its rubric on the first try or iterated
- Your account's pricing tier

Operators should monitor their own bills for the first few real runs and re-check Anthropic/Fal/Vercel pricing pages periodically.

---

*Costs document last updated 2026-05-15. All figures USD. Re-validate Anthropic + Fal pricing before relying on these for budgets.*
