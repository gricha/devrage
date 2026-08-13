import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";

/**
 * Claude Code stores sessions as JSONL files at:
 *   ~/.claude/projects/<project-path>/<session-uuid>.jsonl
 *
 * Each line is a JSON object. User messages have:
 *   { "type": "human", "message": { "content": [...] } }
 * or sometimes:
 *   { "role": "user", "content": "..." }
 * Assistant messages use the matching "assistant" type/role and text blocks.
 */

const CLAUDE_DIR = join(homedir(), ".claude", "projects");

export function claudeAdapter(): Adapter {
  return {
    name: "claude",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      for await (const file of discoverClaudeJsonlFiles()) {
        yield* parseClaudeJsonl(file.filePath, {
          ...file,
          role: options?.role ?? "user",
          since: options?.since,
        });
      }
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      for await (const file of discoverClaudeJsonlFiles()) {
        yield* parseClaudeUsageJsonl(file.filePath, { ...file, since: options?.since });
      }
    },
  };
}

async function* discoverClaudeJsonlFiles(): AsyncGenerator<{
  filePath: string;
  session: string;
  project: string;
}> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(CLAUDE_DIR);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(CLAUDE_DIR, projectDir);
    const projectStat = await stat(projectPath);
    if (!projectStat.isDirectory()) {
      continue;
    }

    const entries = await readdir(projectPath);
    const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      yield {
        filePath: join(projectPath, file),
        session: file.replace(".jsonl", ""),
        project: projectDir,
      };
    }

    // Also check for subagent JSONL files in session subdirectories
    const subdirs = entries.filter((f) => !f.includes("."));
    for (const subdir of subdirs) {
      const subagentsDir = join(projectPath, subdir, "subagents");
      try {
        const subFiles = await readdir(subagentsDir);
        const subJsonl = subFiles.filter((f) => f.endsWith(".jsonl"));
        for (const file of subJsonl) {
          yield {
            filePath: join(subagentsDir, file),
            session: `${subdir}/${file.replace(".jsonl", "")}`,
            project: projectDir,
          };
        }
      } catch {
        // No subagents directory, skip
      }
    }
  }
}

async function* parseClaudeJsonl(
  filePath: string,
  context: {
    session: string;
    project: string;
    role: "user" | "assistant";
    since?: Date;
  },
): AsyncGenerator<Message> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  const seenAssistantRows = new Set<string>();

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const text = extractMessageText(entry, context.role);
      if (!text) {
        continue;
      }

      const timestamp = extractTimestamp(entry);
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      if (context.role === "assistant") {
        const message = asRecord(entry["message"]);
        const messageId = stringValue(message?.["id"]) ?? stringValue(entry["uuid"]);
        const dedupeKey = `${messageId ?? timestamp ?? ""}\u0000${text}`;
        if (seenAssistantRows.has(dedupeKey)) {
          continue;
        }
        seenAssistantRows.add(dedupeKey);
      }

      yield {
        text,
        timestamp: timestamp ?? undefined,
        session: context.session,
        project: context.project,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

function extractMessageText(
  entry: Record<string, unknown>,
  role: "user" | "assistant",
): string | null {
  // Format: { "type": "user"|"assistant", "message": { "role": ..., "content": ... } }
  if (entry["type"] === role) {
    const message = asRecord(entry["message"]);
    if (!message) {
      return null;
    }
    return contentToString(message["content"]);
  }

  // Legacy format: { "type": "human", "message": { "content": [...] } }
  if (role === "user" && entry["type"] === "human") {
    const message = asRecord(entry["message"]);
    if (!message) {
      return null;
    }
    return contentToString(message["content"]);
  }

  // Flat format: { "role": "user"|"assistant", "content": "..." }
  if (entry["role"] === role) {
    return contentToString(entry["content"]);
  }

  return null;
}

function contentToString(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { type: string; text: string } =>
          typeof p === "object" && p !== null && p.type === "text",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

function extractTimestamp(entry: Record<string, unknown>): string | null {
  if (typeof entry["timestamp"] === "string") {
    return entry["timestamp"];
  }
  if (typeof entry["createdAt"] === "string") {
    return entry["createdAt"];
  }
  return null;
}

/** Claude Code repeats assistant rows while streaming, so request/message IDs are deduped. */
async function* parseClaudeUsageJsonl(
  filePath: string,
  context: { session: string; project: string; since?: Date },
): AsyncGenerator<UsageRecord> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  const seen = new Set<string>();

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const message = asRecord(entry["message"]);
      if (!message || entry["type"] !== "assistant" || message["role"] !== "assistant") {
        continue;
      }

      const usage = asRecord(message["usage"]);
      if (!usage) {
        continue;
      }

      const model = stringValue(message["model"]);
      const timestamp = extractTimestamp(entry) ?? undefined;
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      const inputTokens = numberValue(usage["input_tokens"]);
      const outputTokens = numberValue(usage["output_tokens"]);
      const cacheReadTokens = numberValue(usage["cache_read_input_tokens"]);
      const cacheWriteTokens = cacheCreationTokens(usage);
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
        continue;
      }

      const dedupeKey =
        stringValue(entry["requestId"]) ??
        stringValue(message["id"]) ??
        `${context.session}:${timestamp ?? ""}:${model ?? "unknown"}:${inputTokens}:${outputTokens}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      yield {
        agent: "claude",
        provider: "anthropic",
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

function cacheCreationTokens(usage: Record<string, unknown>): number {
  const explicit = numberValue(usage["cache_creation_input_tokens"]);
  if (explicit > 0) {
    return explicit;
  }

  const cacheCreation = asRecord(usage["cache_creation"]);
  return (
    numberValue(cacheCreation?.["ephemeral_1h_input_tokens"]) +
    numberValue(cacheCreation?.["ephemeral_5m_input_tokens"])
  );
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
