import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter, AdapterOptions, Message } from "./index";

/**
 * Cursor stores IDE chat history in multiple locations depending on version:
 *
 * Newer (agent transcripts):
 *   ~/.cursor/projects/agent-transcripts/*.jsonl
 *   ~/.cursor/projects/<project_name>/agent-transcripts/<id>/*.jsonl
 *
 * Workspace-level prompts & generations (most recent):
 *   macOS:  ~/Library/Application Support/Cursor/User/workspaceStorage/<id>/state.vscdb
 *   Holds aiService.prompts (inline/Cmd+K prompts) and aiService.generations (composer)
 *
 * Older (VS Code-style global storage):
 *   macOS:  ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *   Linux:  ~/.config/Cursor/User/globalStorage/state.vscdb
 *   Windows: %APPDATA%/Cursor/User/globalStorage/state.vscdb
 *
 * The globalStorage SQLite database holds older chat data under:
 *   - workbench.panel.aichat.view.aichat.chatdata (tabs with bubbles)
 *   - inline-chat-history (array of prompt strings)
 */

function getCursorGlobalStoragePath(): string | null {
  let base: string;

  if (process.platform === "darwin") {
    base = join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
    );
  } else if (process.platform === "linux") {
    const configBase =
      process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
    base = join(configBase, "Cursor", "User", "globalStorage");
  } else {
    const appData =
      process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    base = join(appData, "Cursor", "User", "globalStorage");
  }

  const dbPath = join(base, "state.vscdb");
  return existsSync(dbPath) ? dbPath : null;
}

function getCursorWorkspaceStoragePath(): string | null {
  let base: string;

  if (process.platform === "darwin") {
    base = join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "workspaceStorage",
    );
  } else if (process.platform === "linux") {
    const configBase =
      process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
    base = join(configBase, "Cursor", "User", "workspaceStorage");
  } else {
    const appData =
      process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    base = join(appData, "Cursor", "User", "workspaceStorage");
  }

  return existsSync(base) ? base : null;
}

function getAgentTranscriptDirs(): string[] {
  const dirs: string[] = [];

  const projectsDir = join(homedir(), ".cursor", "projects");
  if (!existsSync(projectsDir)) return dirs;

  // Root-level agent-transcripts (e.g., empty-window sessions)
  const rootTranscripts = join(projectsDir, "agent-transcripts");
  if (existsSync(rootTranscripts)) dirs.push(rootTranscripts);

  // Per-project agent-transcripts
  try {
    const entries = readdirSyncSafe(projectsDir);
    for (const entry of entries) {
      const projectTranscripts = join(projectsDir, entry, "agent-transcripts");
      if (existsSync(projectTranscripts)) dirs.push(projectTranscripts);
    }
  } catch {
    // ignore
  }

  return dirs;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    const { readdirSync } = require("node:fs");
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function cursorAdapter(): Adapter {
  return {
    name: "cursor",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      // 1. Newer agent transcript JSONL files
      const transcriptDirs = getAgentTranscriptDirs();
      for (const dir of transcriptDirs) {
        yield* walkAgentTranscripts(dir, options);
      }

      // 2. Workspace-level prompts & generations (most data)
      const wsPath = getCursorWorkspaceStoragePath();
      if (wsPath) {
        yield* walkWorkspaceStorage(wsPath, options);
      }

      // 3. Older globalStorage SQLite data
      const globalDbPath = getCursorGlobalStoragePath();
      if (globalDbPath) {
        yield* queryGlobalStorage(globalDbPath, options);
      }
    },
  };
}

async function* walkAgentTranscripts(
  dir: string,
  options?: AdapterOptions,
): AsyncGenerator<Message> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath).catch(() => null);
    if (!entryStat) continue;

    if (entryStat.isDirectory()) {
      yield* walkAgentTranscripts(fullPath, options);
    } else if (entry.endsWith(".jsonl")) {
      yield* parseAgentTranscriptJsonl(fullPath, options);
    }
  }
}

async function* parseAgentTranscriptJsonl(
  filePath: string,
  _options?: AdapterOptions,
): AsyncGenerator<Message> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  const session = basename(filePath, ".jsonl");

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as AgentTranscriptEntry;
      if (entry.role !== "user") continue;

      const text = extractTranscriptText(entry.message);
      if (!text) continue;

      yield {
        text,
        session,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

function extractTranscriptText(message?: AgentMessage): string | null {
  if (!message) return null;

  if (typeof message.content === "string") return message.content;

  if (Array.isArray(message.content)) {
    const parts = message.content
      .filter(
        (p): p is { type: string; text: string } =>
          typeof p === "object" &&
          p !== null &&
          p.type === "text" &&
          typeof p.text === "string",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }

  return null;
}

async function* walkWorkspaceStorage(
  basePath: string,
  options?: AdapterOptions,
): AsyncGenerator<Message> {
  let workspaceIds: string[];
  try {
    workspaceIds = await readdir(basePath);
  } catch {
    return;
  }

  for (const wsId of workspaceIds) {
    const dbPath = join(basePath, wsId, "state.vscdb");
    if (!existsSync(dbPath)) continue;

    // Try to read workspace.json for project name
    let project: string | undefined;
    try {
      const wsJsonPath = join(basePath, wsId, "workspace.json");
      const wsJsonRaw = await readFile(wsJsonPath, "utf-8");
      const wsJson = JSON.parse(wsJsonRaw) as { folder?: string };
      if (wsJson.folder) {
        // folder is a file URI like file:///Users/.../project-name
        project = wsJson.folder.split("/").pop() ?? undefined;
      }
    } catch {
      // ignore
    }

    let db: SqliteDatabase;
    try {
      db = await openSqliteDatabase(dbPath);
    } catch {
      continue;
    }

    try {
      yield* queryWorkspaceDb(db, wsId, project, options);
    } finally {
      db.close();
    }
  }
}

function* queryWorkspaceDb(
  db: SqliteDatabase,
  workspaceId: string,
  project: string | undefined,
  _options?: AdapterOptions,
): Generator<Message> {
  // aiService.prompts — inline / Cmd+K prompts
  const promptsRow = db
    .prepare(`SELECT value FROM ItemTable WHERE key = 'aiService.prompts'`)
    .get() as { value: Buffer | string } | undefined;

  if (promptsRow) {
    const value =
      typeof promptsRow.value === "string"
        ? promptsRow.value
        : promptsRow.value.toString("utf-8");
    let prompts: Array<{ text?: string }>;
    try {
      prompts = JSON.parse(value);
    } catch {
      prompts = [];
    }
    if (Array.isArray(prompts)) {
      for (const p of prompts) {
        if (typeof p.text === "string" && p.text.trim()) {
          yield {
            text: p.text.trim(),
            session: workspaceId,
            project,
          };
        }
      }
    }
  }

  // aiService.generations — composer / chat panel generations
  const genRow = db
    .prepare(`SELECT value FROM ItemTable WHERE key = 'aiService.generations'`)
    .get() as { value: Buffer | string } | undefined;

  if (genRow) {
    const value =
      typeof genRow.value === "string"
        ? genRow.value
        : genRow.value.toString("utf-8");
    let generations: Array<{ textDescription?: string }>;
    try {
      generations = JSON.parse(value);
    } catch {
      generations = [];
    }
    if (Array.isArray(generations)) {
      for (const g of generations) {
        if (typeof g.textDescription === "string" && g.textDescription.trim()) {
          yield {
            text: g.textDescription.trim(),
            session: workspaceId,
            project,
          };
        }
      }
    }
  }
}

async function* queryGlobalStorage(
  dbPath: string,
  options?: AdapterOptions,
): AsyncGenerator<Message> {
  let db: SqliteDatabase;
  try {
    db = await openSqliteDatabase(dbPath);
  } catch {
    console.warn(
      "devrage: SQLite driver not available, skipping Cursor global storage",
    );
    return;
  }

  try {
    // Older chat sidebar data (tabs -> bubbles)
    const chatDataRow = db
      .prepare(
        `SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'`,
      )
      .get() as { value: Buffer | string } | undefined;

    if (chatDataRow) {
      const value =
        typeof chatDataRow.value === "string"
          ? chatDataRow.value
          : chatDataRow.value.toString("utf-8");
      yield* parseAichatChatdata(value, options);
    }

    // Inline chat history (simple array of strings)
    const inlineRow = db
      .prepare(`SELECT value FROM ItemTable WHERE key = 'inline-chat-history'`)
      .get() as { value: Buffer | string } | undefined;

    if (inlineRow) {
      const value =
        typeof inlineRow.value === "string"
          ? inlineRow.value
          : inlineRow.value.toString("utf-8");
      yield* parseInlineChatHistory(value, options);
    }
  } finally {
    db.close();
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

function* parseAichatChatdata(
  raw: string,
  _options?: AdapterOptions,
): Generator<Message> {
  let data: AichatData;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (!data.tabs || !Array.isArray(data.tabs)) return;

  for (const tab of data.tabs) {
    if (!tab.bubbles || !Array.isArray(tab.bubbles)) continue;

    for (const bubble of tab.bubbles) {
      if (bubble.type !== "user") continue;

      // Prefer plain-text delegate.a, fall back to Lexical initText
      let text: string | null = null;
      if (bubble.delegate?.a) {
        text = bubble.delegate.a;
      } else if (bubble.initText) {
        text = extractLexicalText(bubble.initText);
      }

      if (!text) continue;

      yield {
        text,
        session: tab.tabId,
      };
    }
  }
}

function extractLexicalText(raw: string): string | null {
  try {
    const doc = JSON.parse(raw) as LexicalRoot;
    const texts: string[] = [];
    collectLexicalTexts(doc.root, texts);
    return texts.length > 0 ? texts.join("") : null;
  } catch {
    return null;
  }
}

function collectLexicalTexts(node: LexicalNode, out: string[]): void {
  if (node.type === "text" && typeof node.text === "string") {
    out.push(node.text);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectLexicalTexts(child, out);
    }
  }
}

function* parseInlineChatHistory(
  raw: string,
  _options?: AdapterOptions,
): Generator<Message> {
  let items: string[];
  try {
    items = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      yield { text: item.trim() };
    }
  }
}

/* ------------------------------------------------------------------ */
// Types

interface AgentTranscriptEntry {
  role?: string;
  message?: AgentMessage;
}

interface AgentMessage {
  content?: string | Array<{ type: string; text: string }>;
}

interface AichatData {
  tabs?: Array<{
    tabId?: string;
    bubbles?: Array<{
      type?: string;
      delegate?: { a?: string };
      initText?: string;
    }>;
  }>;
}

interface LexicalRoot {
  root: LexicalNode;
}

interface LexicalNode {
  type?: string;
  text?: string;
  children?: LexicalNode[];
}
