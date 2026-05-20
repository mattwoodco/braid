import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    flowKey: text("flow_key"),
    agentKey: text("agent_key").notNull(),
    ts: integer("ts").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => ({
    bySession: index("events_session_ts_idx").on(t.sessionId, t.ts),
  }),
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  flowKey: text("flow_key").notNull(),
  startedAt: text("started_at").notNull(),
  status: text("status").notNull(),
  label: text("label"),
  lastSyncedAt: integer("last_synced_at").notNull(),
});

export type EventRow = typeof events.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
