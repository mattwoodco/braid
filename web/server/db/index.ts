import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.BRAID_WEB_DB ?? resolve(HERE, "../../data/braid-web.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    flow_key TEXT,
    agent_key TEXT NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_session_ts_idx ON events (session_id, ts);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    flow_key TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    label TEXT,
    last_synced_at INTEGER NOT NULL
  );
`);

export const db = drizzle({ client: sqlite, schema });
export { schema };
export const DB_FILE = DB_PATH;
