import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message } from "./index";

/**
 * OpenCode stores sessions in a SQLite database at:
 *   ~/.local/share/opencode/opencode.db
 *
 * Schema:
 *   message: { id, session_id, time_created (epoch ms), time_updated, data (JSON) }
 *   part:    { id, message_id, session_id, time_created, time_updated, data (JSON) }
 *
 * message.data: { "role": "user"|"assistant", "time": {...}, "agent": "...", ... }
 * part.data:    { "type": "text", "text": "the user's message" }
 *
 * User messages have role="user" in message.data. The actual text content is in
 * the associated part rows where part.data.type === "text".
 */

function getOpencodeDatabasePath(): string | null {
  // macOS: ~/.local/share/opencode/opencode.db (despite XDG, this is where it actually lives)
  const xdgPath = join(
    process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"),
    "opencode",
    "opencode.db",
  );
  if (existsSync(xdgPath)) return xdgPath;

  // macOS Application Support fallback
  if (process.platform === "darwin") {
    const macPath = join(
      homedir(),
      "Library",
      "Application Support",
      "opencode",
      "opencode.db",
    );
    if (existsSync(macPath)) return macPath;
  }

  return null;
}

export function opencodeAdapter(): Adapter {
  return {
    name: "opencode",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const dbPath = getOpencodeDatabasePath();
      if (!dbPath) return;

      let db: SqliteDatabase;
      try {
        db = await openSqliteDatabase(dbPath);
      } catch {
        console.warn(
          "devrage: SQLite driver not available, skipping OpenCode sessions",
        );
        return;
      }

      try {
        yield* queryUserMessages(db, options);
      } finally {
        db.close();
      }
    },
  };
}

function* queryUserMessages(
  db: SqliteDatabase,
  options?: AdapterOptions,
): Generator<Message> {
  // Query: join message + part, filter to user role and text parts
  let query = `
    SELECT
      m.session_id,
      m.time_created,
      json_extract(p.data, '$.text') as text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
  `;

  if (options?.since) {
    const sinceMs = options.since.getTime();
    query += ` AND m.time_created >= ${sinceMs}`;
  }

  query += ` ORDER BY m.time_created ASC`;

  const rows = db.prepare(query).all() as {
    session_id: string;
    time_created: number;
    text: string;
  }[];

  for (const row of rows) {
    if (!row.text || !row.text.trim()) continue;

    yield {
      text: row.text,
      timestamp: new Date(row.time_created).toISOString(),
      session: row.session_id,
    };
  }
}

type SqliteDatabase = {
  prepare(sql: string): {
    get(): unknown;
    all(): unknown[];
  };
  close(): void;
};

async function openSqliteDatabase(path: string): Promise<SqliteDatabase> {
  // Try better-sqlite3 first (Node.js)
  try {
    const BetterSqlite3 = await import("better-sqlite3");
    const Ctor = BetterSqlite3.default ?? BetterSqlite3;
    return new (Ctor as unknown as new (...args: unknown[]) => SqliteDatabase)(
      path,
      { readonly: true },
    );
  } catch {
    // Fall back to bun:sqlite (Bun runtime)
    // @ts-ignore bun:sqlite is only available in the Bun runtime
    const mod = await import("bun:sqlite");
    const Ctor = mod.Database;
    return new Ctor(path, { readonly: true });
  }
}
