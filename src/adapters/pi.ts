import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";

/**
 * Pi Agent stores sessions as JSONL files at:
 *   ~/.pi/agent/sessions/<project>/<session-id>.jsonl
 *
 * Each line is a JSON object:
 *   { "type": "session", "cwd": "/path/to/project" }   — session metadata
 *   { "type": "message", "timestamp": "...", "message": { "role": "user", "content": "..." } }
 *
 * Content can be a string or array of { type: "text", text: "..." } parts.
 */

const PI_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

export function piAdapter(): Adapter {
  return {
    name: "pi",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      yield* walkPiSessions(PI_SESSIONS_DIR, options);
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      yield* walkPiUsageSessions(PI_SESSIONS_DIR, options);
    },
  };
}

async function* walkPiSessions(
  dir: string,
  options?: AdapterOptions,
  project?: string,
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
    if (!entryStat) {
      continue;
    }

    if (entryStat.isDirectory()) {
      yield* walkPiSessions(fullPath, options, project ?? entry);
    } else if (entry.endsWith(".jsonl")) {
      const session = entry.replace(".jsonl", "");
      yield* parsePiJsonl(fullPath, {
        session,
        project,
        role: options?.role ?? "user",
        since: options?.since,
      });
    }
  }
}

async function* walkPiUsageSessions(
  dir: string,
  options?: AdapterOptions,
  project?: string,
): AsyncGenerator<UsageRecord> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath).catch(() => null);
    if (!entryStat) {
      continue;
    }

    if (entryStat.isDirectory()) {
      yield* walkPiUsageSessions(fullPath, options, project ?? entry);
    } else if (entry.endsWith(".jsonl")) {
      const session = entry.replace(".jsonl", "");
      yield* parsePiUsageJsonl(fullPath, { session, project, since: options?.since });
    }
  }
}

async function* parsePiJsonl(
  filePath: string,
  context: {
    session: string;
    project?: string;
    role: "user" | "assistant";
    since?: Date;
  },
): AsyncGenerator<Message> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let project = context.project;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as PiEntry;

      // Session metadata line carries cwd
      if (entry.type === "session") {
        project = entry.cwd ?? project;
        continue;
      }

      if (entry.type !== "message") {
        continue;
      }

      const message = entry.message;
      if (!message || message.role !== context.role) {
        continue;
      }

      const text = contentToString(message.content);
      if (!text) {
        continue;
      }

      const timestamp =
        typeof entry.timestamp === "string"
          ? entry.timestamp
          : typeof message.timestamp === "number"
            ? new Date(message.timestamp).toISOString()
            : undefined;

      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      yield {
        text,
        timestamp,
        session: context.session,
        project,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

async function* parsePiUsageJsonl(
  filePath: string,
  context: { session: string; project?: string; since?: Date },
): AsyncGenerator<UsageRecord> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as PiEntry;
      if (entry.type !== "message") {
        continue;
      }

      const message = entry.message;
      if (!message || message.role !== "assistant") {
        continue;
      }

      const usage = asRecord(message.usage);
      if (!usage) {
        continue;
      }

      const inputTokens = numberValue(usage["input"]);
      const outputTokens = numberValue(usage["output"]);
      const cacheReadTokens = numberValue(usage["cacheRead"]);
      const cacheWriteTokens = numberValue(usage["cacheWrite"]);
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
        continue;
      }

      const timestamp =
        typeof entry.timestamp === "string"
          ? entry.timestamp
          : typeof message.timestamp === "number"
            ? new Date(message.timestamp).toISOString()
            : undefined;
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      const responseModel = stringValue(message.responseModel);
      const model = responseModel ?? stringValue(message.model);

      yield {
        agent: "pi",
        provider: responseModel?.includes("/") ? undefined : stringValue(message.provider),
        model,
        timestamp,
        session: context.session,
        inputTokens,
        outputTokens,
        reasoningTokens: 0,
        cacheReadTokens,
        cacheWriteTokens,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

function contentToString(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { type: string; text: string } =>
          typeof p === "object" && p !== null && p.type === "text" && typeof p.text === "string",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

interface PiEntry {
  type?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: number;
    provider?: unknown;
    model?: unknown;
    responseModel?: unknown;
    usage?: unknown;
  };
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
