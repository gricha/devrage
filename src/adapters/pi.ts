import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter, AdapterOptions, Message } from "./index";

/**
 * Pi stores sessions as JSONL files at:
 *   ~/.pi/agent/sessions/--<cwd-with-slashes-replaced>--/<timestamp>_<uuid>.jsonl
 *
 * Each line is a JSON object with a `type` field. User messages have:
 *   { "type": "message", "message": { "role": "user", "content": "..." } }
 *
 * Content can also be an array of blocks, where text blocks have:
 *   { "type": "text", "text": "..." }
 */

function getPiSessionsDir(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  return join(expandTilde(agentDir), "sessions");
}

function expandTilde(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function piAdapter(): Adapter {
  return {
    name: "pi",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const sessionsDir = getPiSessionsDir();

      let projectDirs: string[];
      try {
        projectDirs = await readdir(sessionsDir);
      } catch {
        return; // Pi not installed or no sessions
      }

      for (const projectDir of projectDirs) {
        const projectPath = join(sessionsDir, projectDir);
        const projectStat = await stat(projectPath).catch(() => null);
        if (!projectStat?.isDirectory()) {
          continue;
        }

        yield* parsePiProjectSessions(projectPath, {
          project: projectDir,
          since: options?.since,
        });
      }
    },
  };
}

async function* parsePiProjectSessions(
  dir: string,
  context: { project: string; since?: Date },
): AsyncGenerator<Message> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) {
      continue;
    }

    yield* parsePiJsonl(join(dir, entry), {
      session: entry.replace(".jsonl", ""),
      project: context.project,
      since: context.since,
    });
  }
}

async function* parsePiJsonl(
  filePath: string,
  context: { session: string; project: string; since?: Date },
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
      const entry = JSON.parse(line) as PiEntry;
      if (entry.type !== "message") {
        continue;
      }
      if (entry.message?.role !== "user") {
        continue;
      }

      const text = contentToString(entry.message.content);
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

      yield {
        text,
        timestamp,
        session: context.session,
        project: context.project,
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

function extractTimestamp(entry: PiEntry): string | undefined {
  if (typeof entry.timestamp === "string") {
    return entry.timestamp;
  }

  const messageTimestamp = entry.message?.timestamp;
  if (typeof messageTimestamp === "string") {
    return messageTimestamp;
  }
  if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
    return new Date(messageTimestamp).toISOString();
  }

  return undefined;
}

interface PiEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: string | number;
  };
}
