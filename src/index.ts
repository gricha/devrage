export {
  detect,
  createDetector,
  type DetectionResult,
  type Match,
  type Severity,
  type WordEntry,
} from "./detector/index";
export {
  detectSlop,
  type SlopCategory,
  type SlopDetectionResult,
  type SlopMatch,
} from "./slop/index";
export {
  createAdapter,
  allAdapters,
  type Adapter,
  type AdapterOptions,
  type CostModelSummary,
  type CostSummary,
  type Message,
  type PricingMetadata,
  type PricingSource,
  type UsageRecord,
} from "./adapters/index";
