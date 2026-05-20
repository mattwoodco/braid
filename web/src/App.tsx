import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasShell } from "./components/CanvasShell";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FlowNav } from "./components/FlowNav";
import { FlowsList } from "./components/FlowsList";
import { SessionTabs } from "./components/SessionTabs";
import { AgentGraph } from "./components/AgentGraph";
import { EventLog } from "./components/EventLog";
import { Lightbox } from "./components/Lightbox";
import { NewSessionDialog } from "./components/NewSessionDialog";
import {
  fetchFlows,
  fetchSessions,
  fetchSessionFiles,
  purgeFlow,
  startSession,
  streamSession,
  type SessionFile,
} from "./data/api";
import type { Flow, FlowEvent, Session } from "./data/mock";
import { useUrlState } from "./lib/use-url-state";
import { deriveAgentStates } from "./state/derive";

function App() {
  const { get: urlGet, set: urlSet } = useUrlState();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [sessionsByFlow, setSessionsByFlow] = useState<Record<string, Session[]>>({});
  const [eventsBySession, setEventsBySession] = useState<Record<string, FlowEvent[]>>({});
  const [filesBySession, setFilesBySession] = useState<Record<string, SessionFile[]>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<string | undefined>(undefined);

  const selectedFlowKey = urlGet("flow");
  const selectedSessionId = urlGet("session");
  const selectedAgentKey = urlGet("agent");
  const lightboxFileId = urlGet("file");
  const sessionsOpen = urlGet("sessions") !== "0";
  const eventsOpen = urlGet("events") !== "0";

  const setSelectedFlowKey = useCallback(
    (key: string | undefined) => urlSet({ flow: key }),
    [urlSet],
  );
  const setSelectedSessionId = useCallback(
    (id: string | undefined) => urlSet({ session: id }),
    [urlSet],
  );
  const setSelectedAgentKey = useCallback(
    (key: string | undefined) => urlSet({ agent: key }),
    [urlSet],
  );
  const setLightboxFileId = useCallback(
    (id: string | undefined) => urlSet({ file: id }),
    [urlSet],
  );
  const toggleSessions = useCallback(
    () => urlSet({ sessions: sessionsOpen ? "0" : undefined }),
    [urlSet, sessionsOpen],
  );
  const toggleEvents = useCallback(
    () => urlSet({ events: eventsOpen ? "0" : undefined }),
    [urlSet, eventsOpen],
  );

  useEffect(() => {
    let cancelled = false;
    fetchFlows()
      .then((f) => {
        if (cancelled) return;
        setFlows(f);
        if (f.length > 0 && !urlGet("flow")) setSelectedFlowKey(f[0].key);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Poll /api/flows every 5s so new state.json files (new flows) appear live.
  useEffect(() => {
    const id = window.setInterval(() => {
      fetchFlows()
        .then(setFlows)
        .catch(() => {
          /* ignore transient errors */
        });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const flow = useMemo(
    () => flows.find((f) => f.key === selectedFlowKey),
    [flows, selectedFlowKey],
  );

  // If the URL points at a flow that doesn't exist, go back to home
  // (clear flow + dependent params) so the default-flow effect can pick.
  useEffect(() => {
    if (!selectedFlowKey || flows.length === 0) return;
    if (!flows.some((f) => f.key === selectedFlowKey)) {
      urlSet({ flow: undefined, agent: undefined, session: undefined, file: undefined });
    }
  }, [flows, selectedFlowKey, urlSet]);
  const director = useMemo(
    () => flow?.agents.find((a) => a.isDirector) ?? flow?.agents[0],
    [flow],
  );

  // Load + poll sessions for the selected flow every 4s so new runs appear live.
  useEffect(() => {
    if (!selectedFlowKey) return;
    let cancelled = false;
    const load = () => {
      fetchSessions(selectedFlowKey)
        .then((s) => {
          if (cancelled) return;
          setSessionsByFlow((prev) => ({ ...prev, [selectedFlowKey]: s }));
        })
        .catch(() => {
          /* ignore transient errors */
        });
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedFlowKey]);

  // Auto-select most recent session for the current flow.
  useEffect(() => {
    if (!selectedFlowKey) return;
    const list = sessionsByFlow[selectedFlowKey] ?? [];
    const stillValid = list.some((s) => s.id === selectedSessionId);
    if (!stillValid) {
      const live = list.find((s) => s.status === "live");
      const fallback = live ?? list[0];
      setSelectedSessionId(fallback?.id);
    }
  }, [selectedFlowKey, sessionsByFlow, selectedSessionId]);

  // Persistent EventSource handles, keyed by session id. Streams stay open
  // for the lifetime of the app so we don't lose events when re-rendering
  // (e.g. from the 4s sessions poll) and so all live sessions accumulate
  // in the background — not just the selected one.
  const streamHandlesRef = useRef<Map<string, () => void>>(new Map());

  // Subscribe to: (a) the currently selected session, (b) every session
  // whose status is "live" across all flows. Once subscribed, a stream is
  // kept open until it ends naturally on the server (which closes when the
  // session reaches a terminal state).
  useEffect(() => {
    const needed = new Map<string, string | undefined>(); // sessionId → flowKey
    if (selectedSessionId) needed.set(selectedSessionId, selectedFlowKey);
    for (const [flowKey, list] of Object.entries(sessionsByFlow)) {
      for (const s of list) {
        if (s.status === "live") needed.set(s.id, flowKey);
      }
    }
    for (const [id, flowKey] of needed) {
      if (streamHandlesRef.current.has(id)) continue;
      setEventsBySession((prev) =>
        prev[id] !== undefined ? prev : { ...prev, [id]: [] },
      );
      const cleanup = streamSession(
        id,
        flowKey,
        (e) => {
          setEventsBySession((prev) => ({
            ...prev,
            [id]: [...(prev[id] ?? []), e],
          }));
        },
        () => {
          /* stream complete — leave the handle in the map so we don't
             re-subscribe. */
        },
        (msg) => {
          console.warn(`[stream ${id}] ${msg}`);
        },
      );
      streamHandlesRef.current.set(id, cleanup);
    }
  }, [selectedSessionId, selectedFlowKey, sessionsByFlow]);

  // Close every open stream on unmount.
  useEffect(() => {
    const handles = streamHandlesRef.current;
    return () => {
      for (const close of handles.values()) close();
      handles.clear();
    };
  }, []);

  const effectiveAgentKey = selectedAgentKey ?? director?.key ?? "";
  const selectedAgent = flow?.agents.find((a) => a.key === effectiveAgentKey);

  const sessionEvents = useMemo(
    () => (selectedSessionId ? (eventsBySession[selectedSessionId] ?? []) : []),
    [eventsBySession, selectedSessionId],
  );

  const flowSessions = useMemo(
    () => (selectedFlowKey ? (sessionsByFlow[selectedFlowKey] ?? []) : []),
    [sessionsByFlow, selectedFlowKey],
  );
  const session = flowSessions.find((s) => s.id === selectedSessionId);

  const agentStates = useMemo(
    () =>
      flow
        ? deriveAgentStates(
            flow.agents,
            sessionEvents,
            session?.status === "live",
            nowTick,
          )
        : new Map(),
    [flow, sessionEvents, session, nowTick],
  );
  const agentEvents = useMemo(
    () => sessionEvents.filter((e) => e.agentKey === effectiveAgentKey),
    [sessionEvents, effectiveAgentKey],
  );

  const handleSelectFlow = useCallback(
    (key: string) => {
      urlSet({ flow: key, agent: undefined, session: undefined, file: undefined });
    },
    [urlSet],
  );

  const handleStartSession = useCallback(
    async (brief: string) => {
      if (!selectedFlowKey) return;
      await startSession(selectedFlowKey, brief);
      // The 4s sessions poll will surface the new sesn_* shortly.
    },
    [selectedFlowKey],
  );

  const handlePurgeFlow = useCallback(async () => {
    if (!purgeTarget) return;
    await purgeFlow(purgeTarget);
    // Drop cached sessions/events for this flow so the UI shows a clean slate.
    setSessionsByFlow((prev) => {
      const next = { ...prev };
      delete next[purgeTarget];
      return next;
    });
  }, [purgeTarget]);

  // Poll session files (assets) for the selected session every 5s.
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    const load = () => {
      fetchSessionFiles(selectedSessionId)
        .then((files) => {
          if (!cancelled)
            setFilesBySession((prev) => ({ ...prev, [selectedSessionId]: files }));
        })
        .catch(() => {
          /* ignore */
        });
    };
    load();
    const id = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedSessionId]);

  // Combine Anthropic files (scope_id = session) with external media URLs
  // that appear inside event payloads (e.g. fal.media video URLs).
  const selectedFiles = useMemo<SessionFile[]>(() => {
    const anthropicFiles = selectedSessionId
      ? (filesBySession[selectedSessionId] ?? [])
      : [];
    if (!selectedSessionId) return anthropicFiles;
    const evs = eventsBySession[selectedSessionId] ?? [];
    const externals = extractExternalFiles(evs);
    return [...anthropicFiles, ...externals];
  }, [selectedSessionId, filesBySession, eventsBySession]);

  const lightboxFile = useMemo(
    () => (lightboxFileId ? (selectedFiles.find((f) => f.id === lightboxFileId) ?? null) : null),
    [lightboxFileId, selectedFiles],
  );

  const purgeFlowObj = purgeTarget ? flows.find((f) => f.key === purgeTarget) : undefined;

  if (loadError) {
    return (
      <div style={{ padding: 32, color: "var(--danger-text)", fontFamily: "system-ui" }}>
        <h2>Couldn't reach the API</h2>
        <p style={{ color: "var(--muted)" }}>{loadError}</p>
        <p style={{ color: "var(--muted)" }}>
          Run <code>bun web</code> from the braid repo root.
        </p>
      </div>
    );
  }

  if (!flow || !director) {
    return (
      <div style={{ padding: 32, color: "var(--muted)", fontFamily: "system-ui" }}>
        Loading flows…
      </div>
    );
  }

  return (
    <>
      <CanvasShell
        sessionsOpen={sessionsOpen}
        eventsOpen={eventsOpen}
        onToggleSessions={toggleSessions}
        onToggleEvents={toggleEvents}
        flowNav={
          <FlowNav
            sessionsOpen={sessionsOpen}
            eventsOpen={eventsOpen}
            onToggleSessions={toggleSessions}
            onToggleEvents={toggleEvents}
          />
        }
        sessions={
          <FlowsList
            flows={flows}
            selectedFlowKey={flow.key}
            onSelect={handleSelectFlow}
            onPurge={(key) => setPurgeTarget(key)}
          />
        }
        sessionTabs={
          <SessionTabs
            sessions={flowSessions}
            selectedSessionId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onNew={() => setNewSessionOpen(true)}
          />
        }
        graph={
          <AgentGraph
            agents={flow.agents}
            states={agentStates}
            selectedAgentKey={effectiveAgentKey}
            onSelect={setSelectedAgentKey}
          />
        }
        events={
          <EventLog
            agent={selectedAgent}
            events={agentEvents}
            files={selectedFiles}
            onOpenFile={(f) => setLightboxFileId(f.id)}
          />
        }
      />
      <NewSessionDialog
        open={newSessionOpen}
        flowName={flow.name}
        onClose={() => setNewSessionOpen(false)}
        onSubmit={handleStartSession}
      />
      <Lightbox file={lightboxFile} onClose={() => setLightboxFileId(undefined)} />
      <ConfirmDialog
        open={Boolean(purgeTarget)}
        title={`Purge ${purgeFlowObj?.name ?? purgeTarget}?`}
        body="This archives this flow's managed-agents resources (sessions, agents, env, vaults, stores) and clears its state.json. The flow definition stays on disk."
        confirmLabel="Purge"
        destructive
        onClose={() => setPurgeTarget(undefined)}
        onConfirm={handlePurgeFlow}
      />
    </>
  );
}

const URL_RE = /\bhttps?:\/\/[^\s)"'<>]+/g;
const MEDIA_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

function extractExternalFiles(events: FlowEvent[]): SessionFile[] {
  const seen = new Set<string>();
  const out: SessionFile[] = [];
  for (const e of events) {
    const matches = e.payload.match(URL_RE);
    if (!matches) continue;
    for (const url of matches) {
      if (seen.has(url)) continue;
      const m = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
      const ext = m ? m[1].toLowerCase() : "";
      const mime = MEDIA_EXT[ext];
      if (!mime) continue;
      seen.add(url);
      const filename = url.split("/").pop()?.split("?")[0] ?? url;
      out.push({
        id: `ext:${url}`,
        filename,
        mime_type: mime,
        created_at: new Date(e.ts).toISOString(),
        url,
        source: "external",
      });
    }
  }
  return out;
}

export default App;
