import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message } from "./index";
import { openReadonlySqliteDatabase } from "./sqlite";

/**
 * Zed stores AI conversations in two places:
 *
 * 1. Text threads (older assistant panel):
 *    ~/.local/share/zed/conversations/*.json (Linux)
 *    ~/Library/Application Support/Zed/conversations/*.json (macOS)
 *    These are markdown-like JSON with messages.
 *
 * 2. Agent threads (newer):
 *    Stored in SQLite at ~/.local/share/zed/db (Linux)
 *    or ~/Library/Application Support/Zed/db (macOS)
 *    We'd need to query this, but the schema isn't well documented.
 *
 * We support the text thread JSON files for now, and SQLite agent threads
 * when a local SQLite reader is available.
 */

function getZedPaths(): { conversations: string; db: string } {
  if (process.platform === "darwin") {
    const base = join(homedir(), "Library", "Application Support", "Zed");
    return {
      conversations: join(base, "conversations"),
      db: join(base, "db"),
    };
  }
  // Linux / others
  const base = join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "zed");
  return {
    conversations: join(base, "conversations"),
    db: join(base, "db"),
  };
}

export function zedAdapter(): Adapter {
  return {
    name: "zed",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const paths = getZedPaths();

      // 1. Parse text thread JSON conversations
      yield* parseTextThreads(paths.conversations, options);

      // 2. Try SQLite agent threads
      yield* parseAgentThreads(paths.db, options);
    },
  };
}

async function* parseTextThreads(dir: string, options?: AdapterOptions): AsyncGenerator<Message> {
  if (!existsSync(dir)) {
    return;
  }

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    const filePath = join(dir, file);
    const session = file.replace(".json", "");

    try {
      const raw = await readFile(filePath, "utf-8");
      const conversation = JSON.parse(raw) as ZedConversation;

      if (!conversation.messages || !Array.isArray(conversation.messages)) {
        continue;
      }

      const role = options?.role ?? "user";
      for (const msg of conversation.messages) {
        if (msg.role !== role) {
          continue;
        }

        const text = typeof msg.content === "string" ? msg.content : null;
        if (!text) {
          continue;
        }

        yield {
          text,
          session,
        };
      }
    } catch {
      // Skip malformed files
    }
  }
}

async function* parseAgentThreads(
  dbDir: string,
  options?: AdapterOptions,
): AsyncGenerator<Message> {
  // Zed uses a directory of SQLite databases. The main one is typically
  // a file like 0-dev.db or similar inside the db/ directory.
  if (!existsSync(dbDir)) {
    return;
  }

  let dbFiles: string[];
  try {
    const entries = await readdir(dbDir);
    dbFiles = entries.filter((f) => f.endsWith(".db"));
  } catch {
    return;
  }

  if (dbFiles.length === 0) {
    return;
  }

  for (const dbFile of dbFiles) {
    const dbPath = join(dbDir, dbFile);
    const db = await openReadonlySqliteDatabase(dbPath);
    if (!db) {
      continue;
    }

    try {
      // Check if this DB has a threads/messages table
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      // Look for message-like tables (Zed's schema may vary by version)
      const msgTable = tableNames.find(
        (t) => t === "messages" || t === "thread_messages" || t.includes("message"),
      );

      if (!msgTable) {
        continue;
      }

      const columns = db.prepare(`PRAGMA table_info("${msgTable}")`).all() as {
        name: string;
      }[];
      const colNames = columns.map((c) => c.name);

      const hasRole = colNames.includes("role");

      if (!hasRole) {
        continue;
      }

      const contentCol = colNames.includes("content")
        ? "content"
        : colNames.includes("body")
          ? "body"
          : "text";

      const query = `SELECT "${contentCol}" as text FROM "${msgTable}" WHERE role = ?`;

      const rows = db.prepare(query).all(options?.role ?? "user") as { text: string }[];
      for (const row of rows) {
        if (!row.text?.trim()) {
          continue;
        }
        yield { text: row.text };
      }
    } catch {
      // Schema mismatch or other error
    } finally {
      db.close();
    }
  }
}

interface ZedConversation {
  messages?: { role?: string; content?: unknown }[];
}
