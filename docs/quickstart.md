# Braid quickstart — ten minutes from clone to a flow you wrote yourself

This is a tutorial, not a reference. The reference lives in [`SKILL.md`](../.claude/skills/braid/SKILL.md). If you want the design rationale, see [`SECURITY.md`](../SECURITY.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

**Time budget:** 10 minutes. Three phases of ~5 minutes each. You can stop after any phase.

**What you'll need:**

| Phase | What you need |
|---|---|
| 1. Zero-cost demo | [`bun`](https://bun.sh) ≥ 1.0. **No API keys.** |
| 2. First real run | An [Anthropic API key](https://console.anthropic.com/settings/keys), a [Fal API key](https://fal.ai/dashboard/keys). Expect ~$0.05 in API spend. |
| 3. First custom agent | Same as phase 2. |

---

## Phase 1 — Zero-cost evaluation (5 min)

You'll run Braid end-to-end against a deterministic fake. No real API calls, no money spent. The event timeline is illustrative — same shape as a real run.

### Setup

```bash
git clone https://github.com/mattwoodco/braid.git
cd braid

# Install root + skill deps (frozen lockfile per project policy).
bun install
cd .claude/skills/braid && bun install && cd ../../..
```

If `bun` isn't installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

On Apple Silicon Macs this works natively (arm64). Windows users: run inside WSL2.

### Run the demo

From the repo root:

```bash
bun run --cwd .claude/skills/braid demo ad
```

You should see, in roughly this order:

```
[demo] zero-cost evaluation of 'ad' (no real API calls)
[demo] cleared prior state.json for fresh run
setting up ad...
  env: env_mock_01
  vault fal: vlt_mock_01
  store brandStore: mem_mock_01
  ...
[demo] setup complete, running...
[ready] http://localhost:0/stream
[brief] 60s viral ad for an indie hiking boot brand
[session] sesn_mock_01
[agent] Demo: I would normally call an MCP tool here. ...
[outcome] {"result":"pass","note":"Demo outcome ..."}
[saved] /Users/.../flows/ad/outputs/ads/2026-XX-XX-ock_01/report.md
[done] /Users/.../flows/ad/outputs/ads/2026-XX-XX-ock_01
[demo] complete — see events above
```

**What just happened.** Braid's orchestrator provisioned a fake environment, a fake vault, fake memory stores, fake agents, then ran a fake session that emitted a canned `agent.message` and an `outcome` event. No network call left your machine.

### What to look at

- `flows/ad/flow.yaml` — the flow definition the orchestrator just executed
- `flows/ad/agents/*.yaml` — the four agent personas (director, producer, critic, sentinel)
- The `[saved]` path — the orchestrator wrote a fake `report.md` you can open

**Try `demo` against other flows** — they all work the same way:

```bash
bun run --cwd .claude/skills/braid demo snapshots   # has reflection enabled
bun run --cwd .claude/skills/braid demo solids
```

**You can stop here.** If you're evaluating whether Braid fits your use case, the demo gives you the model. Phase 2 only matters if you want to actually run a flow against real Anthropic.

---

## Phase 2 — First real run (5 min)

This phase runs the `pop-quiz` flow against real Anthropic. It's the cheapest shipped flow — one storyboarder agent, a few Fal video generations. Budget: **~$0.05** in API + Fal credits, as of 2026-05.

### Get keys

1. Create an [Anthropic API key](https://console.anthropic.com/settings/keys). You need at least a Tier 1 account (free credits suffice for one run).
2. Create a [Fal API key](https://fal.ai/dashboard/keys). Pay-as-you-go; one pop-quiz run is a few cents.

### Configure

In the repo root, create `.env.local` (this file is gitignored):

```bash
echo "ANTHROPIC_API_KEY=$(your_anthropic_key_here)" > .env.local
echo "FAL_API_KEY=$(your_fal_key_here)" >> .env.local
```

⚠️ **Don't commit `.env.local`.** The project's `.gitignore` excludes `.env*.local`, but double-check with `git status` before any commit.

### Run

```bash
bun run --cwd .claude/skills/braid -- braid.ts setup pop-quiz
bun run --cwd .claude/skills/braid -- braid.ts run pop-quiz
```

`setup` provisions real cloud resources (environment, vault, agents) at Anthropic. `run` starts the session and streams events. Expected wall-clock: **3–6 minutes** depending on Fal video latency.

While it runs, you'll see real events: tool calls into Fal, agent reasoning, file downloads to your `outputs/pop-quiz/` directory.

### When it's done

Look in `outputs/pop-quiz/<date>-<sid>/` — you should have:

- 3 storyboard PNGs
- 3 short MP4 clips
- a composited `final.mp4` (the storyboarder agent runs ffmpeg + mediabunny in-sandbox)
- a `manifest.json` describing what it made

### Clean up

```bash
bun run --cwd .claude/skills/braid -- braid.ts purge --yes
```

This terminates and deletes the cloud resources the setup created. Without this they continue to exist (and potentially accrue cost) until you do it manually.

### If something goes wrong

| Symptom | What to do |
|---|---|
| `Missing env var: ANTHROPIC_API_KEY` | Bun loaded `.env.local` but the key wasn't in it. Re-write the file and try again. |
| `MCP host '...' is not on the allowlist` | The flow.yaml references an MCP host Braid doesn't know about. Either it's a typo, or you need `BRAID_MCP_ALLOWLIST=mcp.something.com bun run ...`. |
| `[reconnect.gaveup]` events | The Anthropic stream dropped and didn't recover after 5 attempts. Likely a transient network issue; retry the run. |
| `purge refused` | Pass `--yes` to confirm wiping local state, or `--select` to pick interactively. |

Full troubleshooting in [`docs/troubleshooting.md`](./troubleshooting.md) (lands in Slice 120).

---

## Phase 3 — Your first custom agent (5 min, optional)

Add a new agent persona to an existing flow using the scaffolder.

### Scaffold

```bash
bun run --cwd .claude/skills/braid -- new-agent pop-quiz mygrader --template=critic
```

(Templates available: `director`, `web-builder`, `sentinel`, `reflector`. Pick the one closest to what you want.)

You should see:

```
✓ wrote /Users/.../flows/pop-quiz/agents/mygrader.yaml
```

### Edit the system prompt

Open `flows/pop-quiz/agents/mygrader.yaml`. The template substitutes `{{FLOW}}` and `{{KEY}}` placeholders — you'll see your flow name and agent key in the `name:` and `description:` fields.

Replace the `system:` block with your grading rules. **Don't** include `{{env:...}}` references, `--token=` literals, or hard-coded MCP URLs — the prompt-safety lint will block them.

### Validate

```bash
bun run --cwd .claude/skills/braid test tests/agent-schema-parity.test.ts
bun run --cwd .claude/skills/braid test tests/agent-prompt-safety.test.ts
```

Both should pass. If they don't, the error messages point at exactly what to fix.

### Wire it in

Edit `flows/pop-quiz/flow.yaml` to add your agent to the `agents:` list:

```yaml
agents:
  - key: storyboarder
    file: agents/storyboarder.yaml
    is_director: true
  - key: mygrader        # <- new
    file: agents/mygrader.yaml
```

Then test it with the demo:

```bash
bun run --cwd .claude/skills/braid demo pop-quiz
```

The demo loads your new agent yaml and validates it gets provisioned. No real API needed for this validation step.

When you're confident, do a real `setup` + `run` to see it in action.

---

## What now?

| Want to | Read |
|---|---|
| Understand the architecture | [`docs/architecture.md`](./architecture.md) (Slice 120) |
| See what a run costs | [`docs/costs.md`](./costs.md) (Slice 120) |
| Diagnose an error | [`docs/troubleshooting.md`](./troubleshooting.md) (Slice 120) |
| Write a new flow from scratch | [`SKILL.md`](../.claude/skills/braid/SKILL.md) "Adding a new flow" section |
| Understand the security model | [`SECURITY.md`](../SECURITY.md) |
| Contribute back | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |

---

*Tutorial last updated 2026-05-15. Slice 110 plan node `75775a16`. Commands verified by `tests/quickstart-commands.test.ts`.*
