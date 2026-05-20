import type { Agent, Flow, FlowEvent, Session } from "./mock";

type ApiFlow = {
  key: string;
  name: string;
  director: string;
  agents: Array<{
    key: string;
    name: string;
    isDirector: boolean;
    model: string;
    agentId?: string;
  }>;
  sessionIds: string[];
};

export type ApiStatus = "loading" | "ready" | "error";

export async function fetchFlows(): Promise<Flow[]> {
  const res = await fetch("/api/flows");
  if (!res.ok) throw new Error(`fetchFlows: ${res.status}`);
  const data = (await res.json()) as ApiFlow[];
  return data.map((f) => ({
    key: f.key,
    name: f.name,
    director: f.director,
    agents: f.agents.map(
      (a): Agent => ({
        key: a.key,
        name: a.name,
        isDirector: a.isDirector,
        model: a.model,
      }),
    ),
  }));
}

export async function fetchSessions(flowKey: string): Promise<Session[]> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowKey)}/sessions`);
  if (!res.ok) throw new Error(`fetchSessions: ${res.status}`);
  return (await res.json()) as Session[];
}

export type SessionFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes?: number;
  created_at: string;
  /** Optional direct URL. When absent, the file is served via /api/files/:id/raw. */
  url?: string;
  /** Where the file came from. Defaults to "anthropic" when omitted. */
  source?: "anthropic" | "external";
};

export async function fetchSessionFiles(sessionId: string): Promise<SessionFile[]> {
  const res = await fetch(`/api/sessions/${sessionId}/files`);
  if (!res.ok) return [];
  return (await res.json()) as SessionFile[];
}

export function fileRawUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/raw`;
}

export async function startSession(
  flowKey: string,
  brief: string,
): Promise<{ ok: boolean; pid: number }> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flowKey, brief }),
  });
  if (!res.ok) throw new Error(`startSession: ${res.status} — ${await res.text()}`);
  return (await res.json()) as { ok: boolean; pid: number };
}

export async function purgeFlow(flowKey: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowKey)}/purge`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`purgeFlow: ${res.status} — ${await res.text()}`);
  return (await res.json()) as { ok: boolean };
}

export function streamSession(
  sessionId: string,
  flowKey: string | undefined,
  onEvent: (e: FlowEvent) => void,
  onEnd: () => void,
  onError: (msg: string) => void,
): () => void {
  const qs = flowKey ? `?flowKey=${encodeURIComponent(flowKey)}` : "";
  const es = new EventSource(`/api/sessions/${sessionId}/stream${qs}`);
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "__end__") {
        es.close();
        onEnd();
        return;
      }
      if (data.type === "__error__") {
        es.close();
        onError(String(data.message));
        return;
      }
      onEvent(data as FlowEvent);
    } catch (err) {
      onError((err as Error).message);
    }
  };
  es.onerror = () => {
    es.close();
    onError("stream connection lost");
  };
  return () => es.close();
}
