import { ampAdapter } from "./amp";
import { claudeAdapter } from "./claude";
import { clineAdapter } from "./cline";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { opencodeAdapter } from "./opencode";
import { piAdapter } from "./pi";
import { t3codeAdapter } from "./t3code";
import { zedAdapter } from "./zed";

export interface Message {
  text: string;
  timestamp?: string;
  session?: string;
  project?: string;
}

export interface CostModelSummary {
  model: string;
  provider?: string;
  requests: number;
  estimatedCost: number;
  billedCost: number;
  pricingSource: PricingSource;
  unpricedRequests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CostDaySummary {
  day: string;
  requests: number;
  estimatedCost: number;
  billedCost: number;
  unpricedRequests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: CostModelSummary[];
}

export type PricingSource =
  | "catalog"
  | "stale-catalog"
  | "fallback"
  | "stored"
  | "unknown"
  | "mixed";

export interface PricingMetadata {
  source: "catalog" | "stale-catalog" | "fallback";
  fetchedAt?: string;
}

export interface CostSummary {
  requests: number;
  estimatedCost: number;
  billedCost: number;
  unpricedRequests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: CostModelSummary[];
  days: CostDaySummary[];
  pricing: PricingMetadata;
}

export interface UsageRecord {
  agent: string;
  provider?: string;
  model?: string;
  timestamp?: string;
  session?: string;
  billedCost?: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Adapter {
  name: string;
  /** Discover and yield messages from local session storage (user messages by default). */
  messages(options?: AdapterOptions): AsyncGenerator<Message>;
  /** Discover and yield token/cost accounting rows when the agent exposes them */
  usage?(options?: AdapterOptions): AsyncGenerator<UsageRecord>;
}

export interface AdapterOptions {
  /** Message author to read. Defaults to user for backwards compatibility. */
  role?: "user" | "assistant";
  since?: Date;
}

const ADAPTERS: Record<string, () => Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  opencode: opencodeAdapter,
  amp: ampAdapter,
  cline: clineAdapter,
  pi: piAdapter,
  t3code: t3codeAdapter,
  zed: zedAdapter,
};

export function createAdapter(name: string): Adapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(`unknown adapter: ${name} (available: ${Object.keys(ADAPTERS).join(", ")})`);
  }
  return factory();
}

export function allAdapters(): Adapter[] {
  return Object.values(ADAPTERS).map((f) => f());
}
