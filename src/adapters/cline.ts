import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, Message } from "./index";

/**
 * Cline (formerly Claude Dev) stores task history at:
 *
 * VS Code extension:
 *   macOS:  ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/api_conversation_history.json
 *   Linux:  ~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/api_conversation_history.json
 *   Windows: %APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/api_conversation_history.json
 *
 * Standalone CLI / JetBrains (newer):
 *   ~/.cline/data/tasks/<task-id>/api_conversation_history.json
 *
 * Roo Code (fork) uses the same format at:
 *   globalStorage/rooveterinaryinc.roo-cline/tasks/<task-id>/api_conversation_history.json
 *
 * Each api_conversation_history.json is a JSON array of messages:
 *   [{ "role": "user"|"assistant", "content": "..." | [{type: "text", text: "..."}] }]
 */

function getClineTaskDirs(): string[] {
  const dirs: string[] = [];

  // VS Code extension paths
  const vscodePaths = getVSCodeGlobalStoragePaths();
  const extensionIds = ["saoudrizwan.claude-dev", "rooveterinaryinc.roo-cline"];

  for (const basePath of vscodePaths) {
    for (const extId of extensionIds) {
      const tasksDir = join(basePath, extId, "tasks");
      if (existsSync(tasksDir)) {
        dirs.push(tasksDir);
      }
    }
  }

  // Standalone CLI path
  const clineStandalone = join(homedir(), ".cline", "data", "tasks");
  if (existsSync(clineStandalone)) {
    dirs.push(clineStandalone);
  }

  return dirs;
}

function getVSCodeGlobalStoragePaths(): string[] {
  const paths: string[] = [];

  if (process.platform === "darwin") {
    paths.push(
      join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage"),
      join(homedir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage"),
      join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage"),
    );
  } else if (process.platform === "linux") {
    const configBase = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
    paths.push(
      join(configBase, "Code", "User", "globalStorage"),
      join(configBase, "Code - Insiders", "User", "globalStorage"),
      join(configBase, "Cursor", "User", "globalStorage"),
    );
  } else {
    // Windows
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    paths.push(
      join(appData, "Code", "User", "globalStorage"),
      join(appData, "Code - Insiders", "User", "globalStorage"),
      join(appData, "Cursor", "User", "globalStorage"),
    );
  }

  return paths;
}

export function clineAdapter(): Adapter {
  return {
    name: "cline",
    async *messages(options?: AdapterOptions): AsyncGenerator<Message> {
      const taskDirs = getClineTaskDirs();
      const role = options?.role ?? "user";

      for (const tasksDir of taskDirs) {
        let taskIds: string[];
        try {
          taskIds = await readdir(tasksDir);
        } catch {
          continue;
        }

        for (const taskId of taskIds) {
          const taskDir = join(tasksDir, taskId);
          const taskStat = await stat(taskDir).catch(() => null);
          if (!taskStat?.isDirectory()) {
            continue;
          }

          const historyFile = join(taskDir, "api_conversation_history.json");

          try {
            const raw = await readFile(historyFile, "utf-8");
            const messages = JSON.parse(raw) as ClineMessage[];

            if (!Array.isArray(messages)) {
              continue;
            }

            for (const msg of messages) {
              if (msg.role !== role) {
                continue;
              }

              const text = extractText(msg.content);
              if (!text) {
                continue;
              }

              // Cline doesn't store per-message timestamps in the conversation file
              // Use the task metadata file for approximate timing
              const timestamp = msg.ts ?? undefined;
              if (options?.since && timestamp) {
                const ts = new Date(timestamp);
                if (ts < options.since) {
                  continue;
                }
              }

              yield {
                text,
                session: taskId,
              };
            }
          } catch {
            // Skip tasks without history or malformed files
          }
        }
      }
    },
  };
}

function extractText(content: unknown): string | null {
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

interface ClineMessage {
  role?: string;
  content?: unknown;
  ts?: string;
}
