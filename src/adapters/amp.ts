import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message, UsageRecord } from "./index";

/**
 * Amp (Sourcegraph) stores threads as JSON files at:
 *   ~/.local/share/amp/threads/<thread-id>.json
 *
 * Each file is a JSON object with a `messages` array:
 *   { "messages": [{ "role": "user"|"assistant", "content": "...", ... }], "usageLedger": {...}, ... }
 *
 * Messages have `role`, `content` (string or array), and optionally a timestamp.
 */

function getAmpThreadsDir(): string {
  return join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "amp", "threads");
}

export function ampAdapter(): Adapter {
  return {
    name: "amp",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const threadsDir = getAmpThreadsDir();
      const role = options?.role ?? "user";

      let files: string[];
      try {
        files = await readdir(threadsDir);
      } catch {
        return; // Amp not installed or no threads
      }

      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of jsonFiles) {
        const filePath = join(threadsDir, file);
        const threadId = file.replace(".json", "");

        try {
          const thread = await readAmpThread(filePath);
          if (!thread) {
            continue;
          }

          if (!thread.messages || !Array.isArray(thread.messages)) {
            continue;
          }

          for (const msg of thread.messages) {
            if (msg.role !== role) {
              continue;
            }

            const text = extractText(msg.content);
            if (!text) {
              continue;
            }

            const timestamp = msg.timestamp ?? msg.createdAt ?? undefined;
            if (options?.since && timestamp) {
              const ts = new Date(timestamp);
              if (ts < options.since) {
                continue;
              }
            }

            yield {
              text,
              timestamp,
              session: threadId,
            };
          }
        } catch {
          // Skip malformed files
        }
      }
    },
    async *usage(options?: AdapterOptions): AsyncGenerator<UsageRecord> {
      const threadsDir = getAmpThreadsDir();

      let files: string[];
      try {
        files = await readdir(threadsDir);
      } catch {
        return;
      }

      for (const file of files.filter((f) => f.endsWith(".json"))) {
        const filePath = join(threadsDir, file);
        const threadId = file.replace(".json", "");

        try {
          const thread = await readAmpThread(filePath);
          if (!thread?.usageLedger) {
            continue;
          }

          for (const record of extractAmpUsageRecords(thread.usageLedger, threadId)) {
            if (options?.since && record.timestamp) {
              const ts = new Date(record.timestamp);
              if (ts < options.since) {
                continue;
              }
            }

            yield record;
          }
        } catch {
          // Skip malformed files
        }
      }
    },
  };
}

async function readAmpThread(filePath: string): Promise<AmpThread | null> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return asRecord(parsed) ? (parsed as AmpThread) : null;
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { type: string; text: string } =>
          typeof p === "object" && p !== null && typeof p.text === "string",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

interface AmpMessage {
  role?: string;
  content?: unknown;
  timestamp?: string;
  createdAt?: string;
}

interface AmpThread {
  messages?: AmpMessage[];
  usageLedger?: unknown;
}

interface AmpUsageContext {
  provider?: string;
  model?: string;
  timestamp?: string;
}

function extractAmpUsageRecords(usageLedger: unknown, threadId: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  collectAmpUsage(usageLedger, threadId, records, {});
  return records;
}

function collectAmpUsage(
  value: unknown,
  threadId: string,
  records: UsageRecord[],
  context: AmpUsageContext,
  depth = 0,
): void {
  if (depth > 12) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAmpUsage(item, threadId, records, context, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const nextContext = {
    provider: stringField(record, ["provider", "providerID", "providerId"]) ?? context.provider,
    model: stringField(record, ["model", "modelID", "modelId"]) ?? context.model,
    timestamp: timestampField(record) ?? context.timestamp,
  };
  const usageSource = firstRecordField(record, ["usage", "tokens", "tokenUsage"]) ?? record;
  const rawInputTokens = tokenField(usageSource, ["inputTokens", "input_tokens", "promptTokens"]);
  const outputTokens = tokenField(usageSource, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
  ]);
  const reasoningTokens = tokenField(usageSource, ["reasoningTokens", "reasoning_output_tokens"]);
  const cachedInputSubset = tokenField(usageSource, ["cachedInputTokens", "cached_input_tokens"]);
  const cacheReadTokens = tokenField(usageSource, [
    "cacheReadTokens",
    "cache_read_tokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedInputTokens",
    "cached_input_tokens",
  ]);
  const inputTokens = Math.max(rawInputTokens - cachedInputSubset, 0);
  const cacheWriteTokens = tokenField(usageSource, [
    "cacheWriteTokens",
    "cache_write_tokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteInputTokens",
    "cache_write_input_tokens",
  ]);
  const billedCost = tokenField(record, [
    "cost",
    "totalCost",
    "total_cost",
    "billedCost",
    "billed_cost",
  ]);

  if (
    inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens + billedCost >
    0
  ) {
    records.push({
      agent: "amp",
      provider: nextContext.provider,
      model: nextContext.model,
      timestamp: nextContext.timestamp,
      session: threadId,
      billedCost,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
    });
  }

  for (const child of Object.values(record)) {
    if (child !== usageSource && typeof child === "object" && child !== null) {
      collectAmpUsage(child, threadId, records, nextContext, depth + 1);
    }
  }
}

function firstRecordField(
  record: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> | null {
  for (const field of fields) {
    const value = asRecord(record[field]);
    if (value) {
      return value;
    }
  }

  return null;
}

function stringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function timestampField(record: Record<string, unknown>): string | undefined {
  const value = stringField(record, ["timestamp", "createdAt", "time", "date"]);
  if (value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  return undefined;
}

function tokenField(record: Record<string, unknown>, fields: string[]): number {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
