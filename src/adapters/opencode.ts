import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";
import { openReadonlySqliteDatabase, type SqliteDatabase } from "./sqlite";

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
 * Messages carry role="user" or role="assistant" in message.data. Their text is
 * in associated part rows where part.data.type === "text".
 */

function getOpencodeDatabasePath(): string | null {
  // macOS: ~/.local/share/opencode/opencode.db (despite XDG, this is where it actually lives)
  const xdgPath = join(
    process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"),
    "opencode",
    "opencode.db",
  );
  if (existsSync(xdgPath)) {
    return xdgPath;
  }

  // macOS Application Support fallback
  if (process.platform === "darwin") {
    const macPath = join(homedir(), "Library", "Application Support", "opencode", "opencode.db");
    if (existsSync(macPath)) {
      return macPath;
    }
  }

  return null;
}

export function opencodeAdapter(): Adapter {
  return {
    name: "opencode",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const db = await openOpencodeDb();
      if (!db) {
        return;
      }

      try {
        yield* queryMessages(db, options);
      } finally {
        db.close();
      }
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      const db = await openOpencodeDb();
      if (!db) {
        return;
      }

      try {
        yield* queryUsageRecords(db, options);
      } finally {
        db.close();
      }
    },
  };
}

async function openOpencodeDb(): Promise<SqliteDatabase | null> {
  const dbPath = getOpencodeDatabasePath();
  if (!dbPath) {
    return null;
  }

  const db = await openReadonlySqliteDatabase(dbPath);
  if (!db) {
    console.warn("devrage: SQLite support not available, skipping OpenCode sessions");
  }

  return db;
}

function* queryMessages(db: SqliteDatabase, options?: AdapterOptions): Generator<Message> {
  // Query: join message + part, filter to the selected role and text parts.
  let query = `
    SELECT
      m.session_id,
      m.time_created,
      json_extract(p.data, '$.text') as text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE json_extract(m.data, '$.role') = ?
      AND json_extract(p.data, '$.type') = 'text'
  `;

  const params: unknown[] = [options?.role ?? "user"];
  if (options?.since) {
    query += ` AND m.time_created >= ?`;
    params.push(options.since.getTime());
  }

  query += ` ORDER BY m.time_created ASC`;

  const rows = db.prepare(query).all(...params) as {
    session_id: string;
    time_created: number;
    text: string;
  }[];

  for (const row of rows) {
    if (!row.text || !row.text.trim()) {
      continue;
    }

    yield {
      text: row.text,
      timestamp: new Date(row.time_created).toISOString(),
      session: row.session_id,
    };
  }
}

/** OpenCode assistant messages store provider/model, billed cost, and token usage in message.data. */
function* queryUsageRecords(db: SqliteDatabase, options?: AdapterOptions): Generator<UsageRecord> {
  let where = `WHERE json_type(data, '$.tokens') = 'object'`;
  const params: unknown[] = [];

  if (options?.since) {
    where += ` AND time_created >= ?`;
    params.push(options.since.getTime());
  }

  const rows = db
    .prepare(`
    SELECT
      session_id,
      time_created,
      COALESCE(json_extract(data, '$.providerID'), json_extract(data, '$.model.providerID')) AS provider,
      COALESCE(json_extract(data, '$.modelID'), json_extract(data, '$.model.modelID')) AS model,
      json_extract(data, '$.cost') AS billed_cost,
      json_extract(data, '$.tokens.input') AS input_tokens,
      json_extract(data, '$.tokens.output') AS output_tokens,
      json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
      json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
      json_extract(data, '$.tokens.cache.write') AS cache_write_tokens
    FROM message
    ${where}
    ORDER BY time_created ASC
  `)
    .all(...params) as {
    session_id: string | null;
    time_created: number | null;
    provider: string | null;
    model: string | null;
    billed_cost: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
  }[];

  for (const row of rows) {
    const inputTokens = numberValue(row.input_tokens);
    const outputTokens = numberValue(row.output_tokens);
    const reasoningTokens = numberValue(row.reasoning_tokens);
    const cacheReadTokens = numberValue(row.cache_read_tokens);
    const cacheWriteTokens = numberValue(row.cache_write_tokens);
    const billedCost = numberValue(row.billed_cost);

    if (
      inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens === 0 &&
      billedCost === 0
    ) {
      continue;
    }

    yield {
      agent: "opencode",
      provider: stringValue(row.provider),
      model: stringValue(row.model),
      timestamp: row.time_created ? new Date(row.time_created).toISOString() : undefined,
      session: stringValue(row.session_id),
      billedCost,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
    };
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
