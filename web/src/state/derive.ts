import type { Agent, FlowEvent } from "../data/mock";

export type AgentStatus = "idle" | "active" | "done";

export type AgentState = {
  agentKey: string;
  status: AgentStatus;
  lastMessage?: string;
  lastTs?: number;
};

const ACTIVE_WINDOW_MS = 60_000;

export function deriveAgentStates(
  agents: Agent[],
  sessionEvents: FlowEvent[],
  sessionIsLive: boolean,
  nowMs: number = Date.now(),
): Map<string, AgentState> {
  const byAgent = new Map<string, FlowEvent[]>();
  for (const a of agents) byAgent.set(a.key, []);
  for (const e of sessionEvents) {
    const arr = byAgent.get(e.agentKey);
    if (arr) arr.push(e);
  }

  const hasOutcome = sessionEvents.some((e) => e.type === "outcome");
  const result = new Map<string, AgentState>();

  for (const a of agents) {
    const events = byAgent.get(a.key) ?? [];
    const last = events[events.length - 1];
    let status: AgentStatus = "idle";
    if (sessionIsLive && last && nowMs - last.ts < ACTIVE_WINDOW_MS) {
      status = "active";
    } else if (hasOutcome || (!sessionIsLive && last)) {
      status = "done";
    }
    result.set(a.key, {
      agentKey: a.key,
      status,
      lastMessage: last?.payload,
      lastTs: last?.ts,
    });
  }
  return result;
}
