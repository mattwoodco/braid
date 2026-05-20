export type Agent = {
  key: string;
  name: string;
  isDirector: boolean;
  model: string;
};

export type Flow = {
  key: string;
  name: string;
  director: string;
  agents: Agent[];
};

export type SessionStatus = "live" | "completed" | "failed";
export type Session = {
  id: string;
  flowKey: string;
  startedAt: string;
  status: SessionStatus;
  label?: string;
};

export type EventType =
  | "brief"
  | "agent"
  | "tool"
  | "outcome"
  | "error"
  | "sentinel";

export type FlowEvent = {
  id: string;
  ts: number;
  sessionId: string;
  agentKey: string;
  type: EventType;
  payload: string;
};

const now = Date.now();

export const FLOWS: Flow[] = [
  {
    key: "ad",
    name: "Ad",
    director: "director",
    agents: [
      { key: "director", name: "ad-director", isDirector: true, model: "opus-4.7" },
      { key: "producer", name: "ad-producer", isDirector: false, model: "sonnet-4.6" },
      { key: "critic", name: "ad-critic", isDirector: false, model: "haiku-4.5" },
    ],
  },
  {
    key: "pop-quiz",
    name: "Pop Quiz",
    director: "director",
    agents: [
      { key: "director", name: "quiz-director", isDirector: true, model: "opus-4.7" },
      { key: "writer", name: "quiz-writer", isDirector: false, model: "sonnet-4.6" },
      { key: "grader", name: "quiz-grader", isDirector: false, model: "haiku-4.5" },
    ],
  },
  {
    key: "fundraiser",
    name: "Fundraiser",
    director: "director",
    agents: [
      { key: "director", name: "fund-director", isDirector: true, model: "opus-4.7" },
      { key: "researcher", name: "fund-researcher", isDirector: false, model: "sonnet-4.6" },
      { key: "outreach", name: "fund-outreach", isDirector: false, model: "sonnet-4.6" },
      { key: "critic", name: "fund-critic", isDirector: false, model: "haiku-4.5" },
    ],
  },
];

export const SESSIONS: Session[] = [
  { id: "sesn_ad_001", flowKey: "ad", startedAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(), status: "completed", label: "Vans summer spot" },
  { id: "sesn_ad_002", flowKey: "ad", startedAt: new Date(now - 1000 * 60 * 60 * 4).toISOString(), status: "completed", label: "Liquid Death rerun" },
  { id: "sesn_ad_003", flowKey: "ad", startedAt: new Date(now - 1000 * 60 * 8).toISOString(), status: "live", label: "Patagonia launch" },
  { id: "sesn_quiz_001", flowKey: "pop-quiz", startedAt: new Date(now - 1000 * 60 * 60 * 12).toISOString(), status: "completed", label: "World history hard" },
  { id: "sesn_quiz_002", flowKey: "pop-quiz", startedAt: new Date(now - 1000 * 60 * 2).toISOString(), status: "live", label: "JS trivia" },
  { id: "sesn_fund_001", flowKey: "fundraiser", startedAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(), status: "failed", label: "Climate org pitch" },
  { id: "sesn_fund_002", flowKey: "fundraiser", startedAt: new Date(now - 1000 * 60 * 60 * 6).toISOString(), status: "completed", label: "Animal shelter" },
];

function mkEvents(sessionId: string, agents: string[]): FlowEvent[] {
  const events: FlowEvent[] = [];
  let t = now - 1000 * 60 * 30;
  events.push({ id: `${sessionId}-1`, ts: t, sessionId, agentKey: agents[0], type: "brief", payload: "Starting flow with user brief." });
  for (let i = 0; i < 24; i++) {
    t += 1000 * (10 + Math.floor(Math.random() * 90));
    const agentKey = agents[i % agents.length];
    const type: EventType = i % 7 === 0 ? "tool" : i % 11 === 0 ? "sentinel" : "agent";
    const samples = [
      "Reading the brief and drafting initial direction.",
      "Calling search tool for reference material.",
      "Drafted first option — handing to critic for review.",
      "Critique: tone too corporate, retry with more edge.",
      "Iterating on copy variant 2.",
      "Producer queued media generation request.",
      "Sentinel: budget check OK.",
      "Final candidate selected.",
    ];
    events.push({
      id: `${sessionId}-${i + 2}`,
      ts: t,
      sessionId,
      agentKey,
      type,
      payload: samples[i % samples.length],
    });
  }
  events.push({ id: `${sessionId}-end`, ts: t + 2000, sessionId, agentKey: agents[0], type: "outcome", payload: "Outcome rubric passed. Run complete." });
  return events;
}

export const INITIAL_EVENTS: FlowEvent[] = [
  ...mkEvents("sesn_ad_001", ["director", "producer", "critic"]),
  ...mkEvents("sesn_ad_002", ["director", "producer", "critic"]),
  ...mkEvents("sesn_quiz_001", ["director", "writer", "grader"]),
  ...mkEvents("sesn_fund_002", ["director", "researcher", "outreach", "critic"]),
  // live sessions get only partial event history (no outcome yet)
  ...mkEvents("sesn_ad_003", ["director", "producer", "critic"]).slice(0, 14),
  ...mkEvents("sesn_quiz_002", ["director", "writer", "grader"]).slice(0, 8),
  // failed
  ...mkEvents("sesn_fund_001", ["director", "researcher", "outreach", "critic"]).slice(0, 10).concat([
    { id: "sesn_fund_001-err", ts: now - 1000 * 60 * 60 * 47, sessionId: "sesn_fund_001", agentKey: "researcher", type: "error", payload: "MCP tool timeout after 3 retries." },
  ]),
];
