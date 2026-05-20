# 0005 — First-class per-run reflection primitive

- **Status:** Accepted
- **Date:** 2026-05-15

## Context

Flow authors frequently want pattern extraction after a session ends — a "critic" or "sentinel" or "dream" agent that reads the session trajectory, identifies what worked or what almost broke, and writes a short note into a long-term memory store for the next run to consume.

Anthropic's `dreaming-2026-04-21` beta covers *cross-session consolidation*. It does not cover the *per-run* case: extract one lesson from one session that just terminated. Without a first-class primitive, every flow author has to wire critic / sentinel / dream agents from scratch — which means most authors don't bother, and patterns that should be reusable get re-learned each run.

Hermes Agent (Nous Research) demonstrated value in an automatic per-run skill-extraction cycle; we want that loop here without coupling to Hermes specifically.

## Decision

Add a `run.reflection` block to `flow.yaml`:

```yaml
run:
  reflection:
    agent_key: reflector
    target_store: lessons
    after: idle_only          # or 'always'
    instructions: |
      Optional override prompt.
```

After the main session reaches a terminal event:

- `session_idle` (success) → fire reflection.
- `session_status_terminated` (abnormal) → skip (no successful trajectory).
- `watchdog_giveup` → skip.
- `after: always` opts into firing on terminated/giveup for recovery-pattern learning.

The orchestrator spawns a brief reflection session against the named agent. The reflector receives:

- The director agent's final report (text).
- The outcome evaluation (pass/fail + reason).
- A **list of saved filenames** — never file contents.

The reflector has read-write access to `target_store` and read-only access to `runLog`. No other tools, no MCP servers, no external network. Even with a fully prompt-injected reflector, the only effect is a memory-store entry — not a deploy, not a credentialed API call.

`reflectionShouldFire(event, manifest)` is the pure decision helper; `runReflection(manifest, state, sessionId, agentReport, outcome, savedFiles)` is the orchestration runner. Both are covered by unit tests; the integration is covered by a BDD scenario.

## Consequences

- Flow authors get reflection in two lines of YAML rather than reimplementing the cycle.
- **Security constraint: filenames only, never file contents.** A reflector that read full file contents could exfiltrate generated material into a long-term store — an under-the-radar data-exposure path. The contract is enforced by `tests/run-reflection.test.ts`.
- Reflection is per-flow; cross-session consolidation remains the `dreaming` beta's job.
- Reflection runs are a small additional cost per flow (short prompt, single message, no MCP tool calls).

## Alternatives considered

- **Use only Anthropic's `dreaming` beta.** Rejected — wrong granularity. Dreaming is cross-session consolidation, fired separately. Per-run reflection is a different cadence.
- **Leave to flow authors to wire by hand.** Rejected — the boilerplate is the wall; we want the loop to be the default-on path for any flow that opts in.
- **Read file contents in the reflector prompt.** Rejected on security grounds. Patterns can be inferred from filenames + agent report + outcome; raw contents add risk without proportional value.

## References

- Hermes Agent — Nous Research: <https://nousresearch.com/hermes-agent>
- Anthropic Managed Agents — dreaming beta: <https://platform.claude.com/docs/en/managed-agents/dreaming>
- Anthropic Managed Agents — memory stores: <https://platform.claude.com/docs/en/managed-agents/memory>
