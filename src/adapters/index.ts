import { ampAdapter } from "./amp";
import { claudeAdapter } from "./claude";
import { clineAdapter } from "./cline";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { opencodeAdapter } from "./opencode";
import { zedAdapter } from "./zed";

export interface Message {
  text: string;
  timestamp?: string;
  session?: string;
  project?: string;
}

export interface Adapter {
  name: string;
  /** Discover and yield all user messages from local session storage */
  messages(options?: AdapterOptions): AsyncGenerator<Message>;
}

export interface AdapterOptions {
  since?: Date;
}

const ADAPTERS: Record<string, () => Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  opencode: opencodeAdapter,
  amp: ampAdapter,
  cline: clineAdapter,
  zed: zedAdapter,
};

export function createAdapter(name: string): Adapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(
      `unknown adapter: ${name} (available: ${Object.keys(ADAPTERS).join(", ")})`,
    );
  }
  return factory();
}

export function allAdapters(): Adapter[] {
  return Object.values(ADAPTERS).map((f) => f());
}
