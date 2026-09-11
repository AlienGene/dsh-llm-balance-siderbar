import { g as SourceSnapshot, s as ErrorCode } from "./protocol-ziHJjbju.js";
import { o as ResolvedConfig } from "./config-Bp7K9jAZ.js";
//#region src/http.d.ts
/** Injected fetch shape (globals are not assumed: the tests pass a stub). */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
//#endregion
//#region src/providers/types.d.ts
/** Everything a probe may use from the host. */
interface ProbeHost {
  config: ResolvedConfig;
  timeoutMs: number;
  fetchImpl: FetchLike;
  /**
   * Facts the mounted `llm-deepseek` adapter resolves per request, read from its
   * user-settings section. Present so this card follows the same endpoint and
   * credential reference the routed model actually uses.
   */
  llmDeepseek?: {
    baseURL?: string;
    apiKeyEnv?: string;
  } | null;
  /**
   * Credential reference configured for the registered route this probe answers
   * for (e.g. `KIMI_CODING_API_KEY` for a `kimi-coding` route). Present only
   * when the host could read it, and preferred over the plugin's own default:
   * the route names the account the harness actually spends from.
   */
  routeApiKeyEnv?: string;
  /**
   * The registered route id that selected this probe, when there is one. A
   * probe whose endpoint varies by route (the `opencode*` family) reads it;
   * everything else ignores it.
   */
  routeId?: string;
  now(): number;
  /** Resolve one credential reference (the DSH credential seam, then the process environment). */
  resolveSecret(envName: string): Promise<string | null>;
  warn(message: string): void;
}
/** One readable account surface. */
interface Probe {
  id: string;
  /** Product name shown on the card; not translated. */
  label: string;
  /** Whether this probe answers for one registered LLM route id. */
  match(routeId: string): boolean;
  probe(host: ProbeHost, signal: AbortSignal): Promise<SourceSnapshot>;
}
/** Thrown when a probe has nothing to read — the source stays out of the payload. */
declare class SkipSource extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string);
}
//#endregion
export { FetchLike as i, ProbeHost as n, SkipSource as r, Probe as t };