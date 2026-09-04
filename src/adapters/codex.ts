import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";

/**
 * Codex stores sessions as JSONL files at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *   ~/.codex/archived_sessions/rollout-*.jsonl
 *
 * Each line is JSON with structure:
 *   { "timestamp": "...", "type": "response_item", "payload": { "type": "message", "role": "user", "content": [...] } }
 *
 * User messages use payload.role === "user" with input_text parts. Assistant
 * messages use payload.role === "assistant" with output_text parts.
 *
 * We skip user messages that are just environment context injections.
 */

const CODEX_HOME = join(homedir(), ".codex");
const CODEX_SESSION_DIRS = [join(CODEX_HOME, "sessions"), join(CODEX_HOME, "archived_sessions")];

export function codexAdapter(): Adapter {
  return {
    name: "codex",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      for (const dir of CODEX_SESSION_DIRS) {
        for await (const file of discoverCodexSessionFiles(dir)) {
          yield* parseCodexJsonl(file.filePath, {
            session: file.session,
            role: options?.role ?? "user",
            since: options?.since,
          });
        }
      }
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      const seenUsage = new Set<string>();
      for (const dir of CODEX_SESSION_DIRS) {
        for await (const file of discoverCodexSessionFiles(dir)) {
          for await (const record of parseCodexUsageJsonl(file.filePath, {
            session: file.session,
            since: options?.since,
          })) {
            const key = codexUsageRecordKey(record);
            if (seenUsage.has(key)) {
              continue;
            }
            seenUsage.add(key);
            yield record;
          }
        }
      }
    },
  };
}

async function* discoverCodexSessionFiles(
  dir: string,
): AsyncGenerator<{ filePath: string; session: string }> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath);

    if (entryStat.isDirectory()) {
      yield* discoverCodexSessionFiles(fullPath);
    } else if (entry.endsWith(".jsonl")) {
      yield { filePath: fullPath, session: sessionFromRolloutFileName(entry) };
    }
  }
}

function sessionFromRolloutFileName(fileName: string): string {
  return (
    fileName.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
    )?.[1] ?? fileName.replace(".jsonl", "")
  );
}

async function* parseCodexJsonl(
  filePath: string,
  context: { session: string; role: "user" | "assistant"; since?: Date },
): AsyncGenerator<Message> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as CodexEntry;

      // Visible user and assistant prose is persisted as response_item messages.
      if (entry.type !== "response_item") {
        continue;
      }

      const payload = entry.payload;
      if (!payload || payload.role !== context.role) {
        continue;
      }

      const text = extractText(payload.content, context.role);
      if (!text) {
        continue;
      }

      if (context.role === "user") {
        // Skip environment context and permission injections that are not user-authored prose.
        if (
          text.startsWith("<environment_context>") ||
          text.startsWith("<permissions instructions>")
        ) {
          continue;
        }
      }

      if (context.since && entry.timestamp) {
        const ts = new Date(entry.timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      yield {
        text,
        timestamp: entry.timestamp,
        session: context.session,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

function extractText(content: unknown, role: "user" | "assistant"): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const textTypes =
    role === "assistant" ? new Set(["output_text", "text"]) : new Set(["input_text"]);
  const parts = content
    .filter(
      (p): p is { type: string; text: string } =>
        typeof p === "object" && p !== null && textTypes.has(p.type) && typeof p.text === "string",
    )
    .map((p) => p.text);

  return parts.length > 0 ? parts.join(" ") : null;
}

interface CodexEntry {
  timestamp?: string;
  type: string;
  payload?: {
    type?: string;
    role?: string;
    content?: unknown;
  };
}

interface CodexTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

/** Codex token_count events include both cumulative totals and the last completed response. */
async function* parseCodexUsageJsonl(
  filePath: string,
  context: { session: string; since?: Date },
): AsyncGenerator<UsageRecord> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let model: string | undefined;
  let previousTotal: CodexTokenUsage | null = null;
  let previousUsageSignature: string | null = null;
  let session = context.session;
  let sawSessionMeta = false;
  let forkReplayStartedAt: number | null = null;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const payload = asRecord(entry["payload"]);

      if (entry["type"] === "session_meta") {
        const metaSession = stringValue(payload?.["id"]) ?? stringValue(entry["id"]);
        if (metaSession && !sawSessionMeta) {
          session = metaSession;
          sawSessionMeta = true;

          if (payload?.["thread_source"] === "subagent") {
            forkReplayStartedAt =
              uuidV7Timestamp(metaSession) ??
              timestampMilliseconds(entry["timestamp"]) ??
              timestampMilliseconds(payload["timestamp"]);
          }
        }
        continue;
      }

      if (forkReplayStartedAt !== null) {
        if (isLiveForkTaskStart(entry, payload, forkReplayStartedAt)) {
          forkReplayStartedAt = null;
        }
        continue;
      }

      if (entry["type"] === "turn_context") {
        model = stringValue(payload?.["model"]) ?? model;
        continue;
      }

      if (entry["type"] !== "event_msg" || payload?.["type"] !== "token_count") {
        continue;
      }

      const info = asRecord(payload["info"]);
      if (!info) {
        continue;
      }

      const lastUsageValue = info["last_token_usage"];
      const lastUsage = parseCodexTokenUsage(lastUsageValue);
      const total = parseCodexTokenUsage(info["total_token_usage"]);
      let usage: CodexTokenUsage | null = null;

      if (lastUsageValue !== undefined) {
        if (lastUsage && hasBillableUsage(lastUsage)) {
          const signature = codexUsageSignature(lastUsage, total);
          if (signature !== previousUsageSignature) {
            usage = lastUsage;
          }
          previousUsageSignature = signature;
        }
      } else if (total) {
        const delta = previousTotal ? subtractCodexUsage(total, previousTotal) : total;
        if (hasBillableUsage(delta)) {
          usage = delta;
        }
      }
      if (total && hasBillableUsage(total)) {
        previousTotal = total;
      }
      if (!usage) {
        continue;
      }

      const timestamp = stringValue(entry["timestamp"]);
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) {
          continue;
        }
      }

      const reasoningTokens = Math.min(usage.reasoningOutputTokens, usage.outputTokens);
      yield {
        agent: "codex",
        provider: "openai",
        model,
        timestamp,
        session,
        inputTokens: Math.max(usage.inputTokens - usage.cachedInputTokens, 0),
        outputTokens: Math.max(usage.outputTokens - reasoningTokens, 0),
        reasoningTokens,
        cacheReadTokens: usage.cachedInputTokens,
        cacheWriteTokens: 0,
      };
    } catch {
      // Skip malformed lines
    }
  }
}

function codexUsageRecordKey(record: UsageRecord): string {
  return JSON.stringify([
    record.session ?? "",
    record.timestamp ?? "",
    record.provider ?? "",
    record.model ?? "",
    record.inputTokens,
    record.outputTokens,
    record.reasoningTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
  ]);
}

function parseCodexTokenUsage(value: unknown): CodexTokenUsage | null {
  const usage = asRecord(value);
  if (!usage) {
    return null;
  }

  const hasUsageField = [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ].some((key) => typeof usage[key] === "number" && Number.isFinite(usage[key]));
  if (!hasUsageField) {
    return null;
  }

  return {
    inputTokens: numberValue(usage["input_tokens"]),
    cachedInputTokens: numberValue(usage["cached_input_tokens"]),
    outputTokens: numberValue(usage["output_tokens"]),
    reasoningOutputTokens: numberValue(usage["reasoning_output_tokens"]),
    totalTokens: numberValue(usage["total_tokens"]),
  };
}

function subtractCodexUsage(current: CodexTokenUsage, previous: CodexTokenUsage): CodexTokenUsage {
  return {
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - previous.cachedInputTokens, 0),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
      0,
    ),
    totalTokens: Math.max(current.totalTokens - previous.totalTokens, 0),
  };
}

function hasBillableUsage(usage: CodexTokenUsage): boolean {
  return (
    usage.inputTokens + usage.cachedInputTokens + usage.outputTokens + usage.reasoningOutputTokens >
    0
  );
}

function codexUsageSignature(usage: CodexTokenUsage, total: CodexTokenUsage | null): string {
  return [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningOutputTokens,
    total?.inputTokens ?? "",
    total?.cachedInputTokens ?? "",
    total?.outputTokens ?? "",
    total?.reasoningOutputTokens ?? "",
  ].join(":");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isLiveForkTaskStart(
  entry: Record<string, unknown>,
  payload: Record<string, unknown> | null,
  forkStartedAt: number,
): boolean {
  if (entry["type"] !== "event_msg" || payload?.["type"] !== "task_started") {
    return false;
  }

  const taskIdStartedAt = uuidV7Timestamp(stringValue(payload["turn_id"]));
  if (taskIdStartedAt !== null) {
    return taskIdStartedAt >= forkStartedAt;
  }

  const taskStartedAt = timestampMilliseconds(payload["started_at"]);
  return taskStartedAt !== null && taskStartedAt >= Math.floor(forkStartedAt / 1_000) * 1_000;
}

function uuidV7Timestamp(value: string | undefined): number | null {
  const normalized = value?.replaceAll("-", "");
  if (!normalized || !/^[0-9a-f]{12}7/i.test(normalized)) {
    return null;
  }

  const timestamp = Number.parseInt(normalized.slice(0, 12), 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function timestampMilliseconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1_000_000_000_000 ? value : value * 1_000;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
