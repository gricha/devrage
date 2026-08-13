import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";
import { openReadonlySqliteDatabase, type SqliteDatabase } from "./sqlite";

/**
 * Reads Cursor's VS Code-style state stores read-only. Extraction is limited to
 * known AI keys and confidently attributed message shapes; unreadable DBs skip.
 */

const CANDIDATE_KEY_PREFIXES = [
  "bubbleId:",
  "composerData:",
  "composer.composerData",
  "aiService.prompts",
  "aiService.generations",
  "workbench.panel.composerChatViewPane.",
];

const STATE_TABLES = ["ItemTable", "cursorDiskKV"];

interface CursorStateStore {
  path: string;
  scope: string;
  project?: string;
}

interface StateRow {
  key: string;
  value: unknown;
}

interface ExtractedMessage {
  text: string;
  timestamp?: string;
  session?: string;
}

export function cursorAdapter(): Adapter {
  return {
    name: "cursor",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const stores = await discoverCursorStateStores();

      for (const store of stores) {
        yield* parseCursorStore(store, options);
      }
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      const stores = await discoverCursorStateStores();

      for (const store of stores) {
        yield* parseCursorUsageStore(store, options);
      }
    },
  };
}

async function discoverCursorStateStores(): Promise<CursorStateStore[]> {
  const stores: CursorStateStore[] = [];
  const seen = new Set<string>();

  for (const userDir of getCursorUserDirs()) {
    if (!existsSync(userDir)) {
      continue;
    }

    const globalState = join(userDir, "globalStorage", "state.vscdb");
    if (existsSync(globalState) && !seen.has(globalState)) {
      seen.add(globalState);
      stores.push({ path: globalState, scope: "global" });
    }

    const workspaceRoot = join(userDir, "workspaceStorage");
    let workspaceIds: string[] = [];
    try {
      workspaceIds = await readdir(workspaceRoot);
    } catch {
      continue;
    }

    for (const workspaceId of workspaceIds) {
      const statePath = join(workspaceRoot, workspaceId, "state.vscdb");
      if (existsSync(statePath) && !seen.has(statePath)) {
        seen.add(statePath);
        stores.push({ path: statePath, scope: "workspace", project: workspaceId });
      }
    }
  }

  return stores;
}

function getCursorUserDirs(): string[] {
  const configHome = envOrDefault("XDG_CONFIG_HOME", join(homedir(), ".config"));
  const appData = envOrDefault("APPDATA", join(homedir(), "AppData", "Roaming"));

  return uniqueStrings([
    join(homedir(), "Library", "Application Support", "Cursor", "User"),
    join(configHome, "Cursor", "User"),
    join(appData, "Cursor", "User"),
  ]);
}

async function* parseCursorStore(
  store: CursorStateStore,
  options?: AdapterOptions,
): AsyncGenerator<Message> {
  const db = await openCursorDb(store.path);
  if (!db) {
    return;
  }

  try {
    const rows = readStateRows(db);
    const seen = new Set<string>();

    for (const row of rows) {
      try {
        if (!isCandidateKey(row.key)) {
          continue;
        }

        const parsed = parseJsonValue(row.value);
        if (parsed === undefined) {
          continue;
        }

        for (const message of extractCursorMessages(parsed, row.key, options?.role ?? "user")) {
          const text = message.text.trim();
          if (!isLikelyMessageText(text)) {
            continue;
          }

          if (options?.since && message.timestamp) {
            const timestamp = new Date(message.timestamp);
            if (Number.isFinite(timestamp.getTime()) && timestamp < options.since) {
              continue;
            }
          }

          const session = message.session ?? `${store.scope}:${row.key}`;
          const dedupeKey = `${session}\u0000${message.timestamp ?? ""}\u0000${text}`;
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          yield {
            text,
            timestamp: message.timestamp,
            session,
            project: store.project,
          };
        }
      } catch {
        continue;
      }
    }
  } finally {
    db.close();
  }
}

async function* parseCursorUsageStore(
  store: CursorStateStore,
  options?: AdapterOptions,
): AsyncGenerator<UsageRecord> {
  const db = await openCursorDb(store.path);
  if (!db) {
    return;
  }

  try {
    const rows = readStateRows(db);
    const composerModels = collectComposerModels(rows);
    const seen = new Set<string>();

    for (const row of rows) {
      try {
        if (!row.key.startsWith("bubbleId:")) {
          continue;
        }

        const parsed = parseJsonValue(row.value);
        const usage = extractCursorBubbleUsage(parsed, row.key, composerModels);
        if (!usage) {
          continue;
        }

        if (options?.since && usage.timestamp) {
          const timestamp = new Date(usage.timestamp);
          if (Number.isFinite(timestamp.getTime()) && timestamp < options.since) {
            continue;
          }
        }

        const dedupeKey = `${usage.session ?? ""}\u0000${usage.timestamp ?? ""}\u0000${usage.model ?? ""}\u0000${usage.inputTokens}\u0000${usage.outputTokens}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        yield usage;
      } catch {
        continue;
      }
    }
  } finally {
    db.close();
  }
}

async function openCursorDb(dbPath: string): Promise<SqliteDatabase | null> {
  return openReadonlySqliteDatabase(dbPath);
}

function readStateRows(db: SqliteDatabase): StateRow[] {
  const rows: StateRow[] = [];

  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: unknown;
    }[];
    const availableTables = new Set(tables.flatMap((table) => stringValue(table.name) ?? []));

    for (const table of STATE_TABLES) {
      if (!availableTables.has(table)) {
        continue;
      }

      const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: unknown }[];
      const columnNames = new Set(columns.flatMap((column) => stringValue(column.name) ?? []));
      if (!columnNames.has("key") || !columnNames.has("value")) {
        continue;
      }

      const tableRows = db.prepare(`SELECT key, value FROM "${table}"`).all() as {
        key: unknown;
        value: unknown;
      }[];
      rows.push(
        ...tableRows.flatMap((row) =>
          typeof row.key === "string" ? [{ key: row.key, value: row.value }] : [],
        ),
      );
    }
  } catch {
    return rows;
  }

  return rows;
}

function isCandidateKey(key: string): boolean {
  return CANDIDATE_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix));
}

function parseJsonValue(value: unknown): unknown | undefined {
  const raw = decodeStateValue(value);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "string") {
      return parsed;
    }

    const trimmed = parsed.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return parsed;
    }

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return parsed;
    }
  } catch {
    return undefined;
  }
}

function decodeStateValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf-8");
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf-8");
  }

  return null;
}

function extractCursorMessages(
  root: unknown,
  rowKey: string,
  role: "user" | "assistant",
): ExtractedMessage[] {
  if (rowKey.startsWith("bubbleId:")) {
    const message = extractCursorBubbleMessage(root, rowKey, role);
    return message ? [message] : [];
  }

  const messages: ExtractedMessage[] = [];
  collectRoleMessages(root, messages, role);

  if (
    role === "user" &&
    (rowKey.startsWith("aiService.prompts") || rowKey.startsWith("aiService.generations"))
  ) {
    collectPromptMessages(root, messages);
  }

  return uniqueMessages(messages);
}

function extractCursorBubbleMessage(
  root: unknown,
  rowKey: string,
  role: "user" | "assistant",
): ExtractedMessage | null {
  const record = asRecord(root);
  const expectedType = role === "user" ? 1 : 2;
  if (!record || numberValue(record["type"]) !== expectedType) {
    return null;
  }

  const text = firstTextField(record, ["text", "richText"]);
  if (!text) {
    return null;
  }

  return {
    text,
    timestamp: extractTimestamp(record),
    session: cursorBubbleSession(rowKey) ?? extractSession(record),
  };
}

function collectComposerModels(rows: StateRow[]): Map<string, string> {
  const models = new Map<string, string>();

  for (const row of rows) {
    if (!row.key.startsWith("composerData:")) {
      continue;
    }

    const parsed = parseJsonValue(row.value);
    const record = asRecord(parsed);
    if (!record) {
      continue;
    }

    const composerId = stringValue(record["composerId"]) ?? row.key.slice("composerData:".length);
    const model = extractCursorModel(record);
    if (composerId && model) {
      models.set(composerId, model);
    }
  }

  return models;
}

function extractCursorBubbleUsage(
  root: unknown,
  rowKey: string,
  composerModels: Map<string, string>,
): UsageRecord | null {
  const record = asRecord(root);
  if (!record || numberValue(record["type"]) !== 2) {
    return null;
  }

  const tokenCount = asRecord(record["tokenCount"]);
  if (!tokenCount) {
    return null;
  }

  const inputTokens = numberValue(tokenCount["inputTokens"] ?? tokenCount["input"]);
  const outputTokens = numberValue(tokenCount["outputTokens"] ?? tokenCount["output"]);
  const cacheReadTokens = numberValue(tokenCount["cacheReadTokens"] ?? tokenCount["cacheRead"]);
  const cacheWriteTokens = numberValue(tokenCount["cacheWriteTokens"] ?? tokenCount["cacheWrite"]);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
    return null;
  }

  const composerId = cursorBubbleSession(rowKey);
  const model =
    extractCursorModel(record) ?? (composerId ? composerModels.get(composerId) : undefined);

  return {
    agent: "cursor",
    model,
    timestamp: extractTimestamp(record),
    session: composerId ?? extractSession(record),
    inputTokens,
    outputTokens,
    reasoningTokens: numberValue(tokenCount["reasoningTokens"] ?? tokenCount["reasoning"]),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function extractCursorModel(record: Record<string, unknown>): string | undefined {
  const direct = firstStringField(record, ["model", "modelName", "modelId"]);
  if (direct) {
    return direct;
  }

  for (const field of ["modelInfo", "modelConfig"]) {
    const modelRecord = asRecord(record[field]);
    if (!modelRecord) {
      continue;
    }

    const nested = firstStringField(modelRecord, ["modelName", "modelId", "id", "name"]);
    if (nested && nested !== "default") {
      return nested;
    }

    const selected = modelRecord["selectedModels"];
    if (Array.isArray(selected)) {
      for (const item of selected) {
        const itemRecord = asRecord(item);
        const selectedModel = itemRecord
          ? firstStringField(itemRecord, ["modelId", "modelName", "id", "name"])
          : undefined;
        if (selectedModel && selectedModel !== "default") {
          return selectedModel;
        }
      }
    }

    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function cursorBubbleSession(rowKey: string): string | undefined {
  const [, composerId] = rowKey.split(":");
  return composerId?.trim() || undefined;
}

function collectRoleMessages(
  value: unknown,
  messages: ExtractedMessage[],
  role: "user" | "assistant",
  inheritedSession?: string,
  depth = 0,
): void {
  if (depth > 12) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRoleMessages(item, messages, role, inheritedSession, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const session = extractSession(record) ?? inheritedSession;
  if (isAuthoredBy(record, role)) {
    const text = extractMessageText(record);
    if (text) {
      messages.push({ text, timestamp: extractTimestamp(record), session });
    }
  }

  for (const child of Object.values(record)) {
    if (typeof child === "object" && child !== null) {
      collectRoleMessages(child, messages, role, session, depth + 1);
    }
  }
}

function collectPromptMessages(
  value: unknown,
  messages: ExtractedMessage[],
  inheritedSession?: string,
  depth = 0,
): void {
  if (depth > 12) {
    return;
  }

  if (typeof value === "string") {
    messages.push({ text: value, session: inheritedSession });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPromptMessages(item, messages, inheritedSession, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const session = extractSession(record) ?? inheritedSession;
  const prompt = firstTextField(record, [
    "prompt",
    "userPrompt",
    "originalPrompt",
    "currentPrompt",
    "query",
    "input",
  ]);

  if (prompt && !isAssistantAuthored(record)) {
    messages.push({ text: prompt, timestamp: extractTimestamp(record), session });
  }

  for (const child of Object.values(record)) {
    if (typeof child === "object" && child !== null) {
      collectPromptMessages(child, messages, session, depth + 1);
    }
  }
}

function isAuthoredBy(record: Record<string, unknown>, role: "user" | "assistant"): boolean {
  return role === "user" ? isUserAuthored(record) : isAssistantAuthored(record);
}

function isUserAuthored(record: Record<string, unknown>): boolean {
  return ["role", "speaker", "sender", "author", "source", "from", "type", "kind"].some((field) =>
    actorIsUser(record[field]),
  );
}

function isAssistantAuthored(record: Record<string, unknown>): boolean {
  return ["role", "speaker", "sender", "author", "source", "from", "type", "kind"].some((field) =>
    actorIsAssistant(record[field]),
  );
}

function actorIsUser(value: unknown): boolean {
  const actor = actorString(value);
  return actor === "user" || actor === "human" || actor === "usermessage";
}

function actorIsAssistant(value: unknown): boolean {
  const actor = actorString(value);
  return actor === "assistant" || actor === "ai" || actor === "assistantmessage";
}

function actorString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.toLowerCase().replace(/[^a-z]/g, "");
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  for (const field of ["role", "type", "name"]) {
    if (typeof record[field] === "string") {
      return record[field].toLowerCase().replace(/[^a-z]/g, "");
    }
  }

  return null;
}

function extractMessageText(record: Record<string, unknown>): string | null {
  return firstTextField(record, ["text", "content", "message", "prompt", "query", "input"]);
}

function firstTextField(record: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const text = contentToText(record[field]);
    if (text) {
      return text;
    }
  }

  return null;
}

function firstStringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = stringValue(record[field]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function contentToText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.map(contentToText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return firstTextField(record, ["text", "content", "message", "value"]);
}

function extractTimestamp(record: Record<string, unknown>): string | undefined {
  for (const field of ["timestamp", "createdAt", "updatedAt", "time", "created", "date", "ts"]) {
    const timestamp = normalizeTimestamp(record[field]);
    if (timestamp) {
      return timestamp;
    }
  }

  return undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  return undefined;
}

function extractSession(record: Record<string, unknown>): string | undefined {
  for (const field of ["conversationId", "composerId", "sessionId", "chatId", "threadId", "id"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function isLikelyMessageText(text: string): boolean {
  return text.length > 0 && !text.startsWith("<environment_context>");
}

function uniqueMessages(messages: ExtractedMessage[]): ExtractedMessage[] {
  const seen = new Set<string>();
  const unique: ExtractedMessage[] = [];

  for (const message of messages) {
    const key = `${message.session ?? ""}\u0000${message.timestamp ?? ""}\u0000${message.text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(message);
  }

  return unique;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
