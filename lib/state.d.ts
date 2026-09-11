import { s as ErrorCode, v as StateResponse } from "./protocol-ziHJjbju.js";
import { o as ResolvedConfig } from "./config-Bp7K9jAZ.js";
import { i as FetchLike, t as Probe } from "./types-B2mCWfag.js";
//#region src/state.d.ts
/** Retry cadence for a source that failed or was skipped. */
declare const RETRY_MS = 15000;
/** What the aggregator needs from the host process. */
interface AggregatorInput {
  config: ResolvedConfig;
  probes: readonly Probe[];
  fetchImpl?: FetchLike;
  now?: () => number;
  resolveSecret: (envName: string) => Promise<string | null>;
  /**
   * Live LLM routes (id plus the adapter's display name). They bind a source to
   * the models it answers for, and in auto mode they are the gate: a source
   * whose provider this harness never registered is not read at all. The name
   * labels a route no probe could read.
   */
  listRoutes?: () => {
    id: string;
    name: string | null;
  }[];
  /** Facts the mounted `llm-deepseek` adapter resolves, when that plugin is present. */
  llmDeepseek?: () => {
    baseURL?: string;
    apiKeyEnv?: string;
  } | null;
  /**
   * The credential reference one registered route is configured with, as the
   * `llm-pi-ai` settings section declares it. A source reads the account this
   * harness actually routes to instead of guessing at an environment name.
   */
  piAiApiKeyEnv?: (routeId: string) => string | undefined;
  /** The deployment's default model route. */
  defaultSelection?: () => {
    provider: string;
    model: string;
  } | null;
  warn?: (message: string) => void;
}
/** The state builder the HTTP route calls. */
interface Aggregator {
  /** Refresh what is due and build the payload. Never rejects. */
  state(signal?: AbortSignal): Promise<StateResponse>;
}
/** Turn any thrown value into the shared failure vocabulary. */
declare function toFailure(error: unknown): {
  code: ErrorCode;
  message: string;
};
/**
 * Build the aggregator.
 * @param input - configuration plus the host seams every probe needs.
 * @returns the state builder used by the HTTP route and by the tests.
 */
declare function createAggregator(input: AggregatorInput): Aggregator;
//#endregion
export { Aggregator, AggregatorInput, RETRY_MS, createAggregator, toFailure };