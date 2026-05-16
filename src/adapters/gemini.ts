import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message } from "./index";

/**
 * Gemini CLI stores session history at:
 *   ~/.gemini/tmp/<project-hash>/chats/session-<timestamp>-<id>.json
 *
 * Each session JSON contains:
 *   { "sessionId": "...", "messages": [{ "type": "user", "timestamp": "...", "content": "..." | [{ "text": "..." }] }] }
 *
 * User messages have type === "user" and content is either a plain string
 * or an array of { text: "..." } blocks.
 */

const GEMINI_TMP_DIR = join(homedir(), ".gemini", "tmp");

export function geminiAdapter(): Adapter {
  return {
    name: "gemini",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      let projects: string[];
      try {
        projects = await readdir(GEMINI_TMP_DIR);
      } catch {
        return; // Gemini CLI not installed or no sessions
      }

      for (const project of projects) {
        const chatsDir = join(GEMINI_TMP_DIR, project, "chats");
        const chatsStat = await stat(chatsDir).catch(() => null);
        if (!chatsStat?.isDirectory()) continue;

        let sessions: string[];
        try {
          sessions = await readdir(chatsDir);
        } catch {
          continue;
        }

        for (const session of sessions) {
          if (!session.endsWith(".json")) continue;
          const sessionPath = join(chatsDir, session);

          try {
            const raw = await readFile(sessionPath, "utf-8");
            const data = JSON.parse(raw) as GeminiSession;

            if (!data.messages || !Array.isArray(data.messages)) continue;

            for (const msg of data.messages) {
              if (msg.type !== "user") continue;

              const text = extractText(msg.content);
              if (!text) continue;

              const timestamp = msg.timestamp;
              if (options?.since && timestamp) {
                const ts = new Date(timestamp);
                if (ts < options.since) continue;
              }

              yield {
                text,
                timestamp,
                session: data.sessionId ?? session,
                project,
              };
            }
          } catch {
            // Skip malformed sessions
          }
        }
      }
    },
  };
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { text: string } =>
          typeof p === "object" && p !== null && typeof p.text === "string",
      )
      .map((p) => p.text);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

interface GeminiMessage {
  type?: string;
  timestamp?: string;
  content?: unknown;
}

interface GeminiSession {
  sessionId?: string;
  messages?: GeminiMessage[];
}
