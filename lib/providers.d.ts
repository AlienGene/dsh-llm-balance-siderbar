import { d as QuotaWindow } from "./protocol-ziHJjbju.js";
import { n as ProbeHost, r as SkipSource, t as Probe } from "./types-B2mCWfag.js";
//#region src/providers/deepseek.d.ts
/** Stable source id; also the key prefix of this source's balance thresholds. */
declare const DEEPSEEK_SOURCE_ID = "deepseek-balance";
/** One currency row as the provider sends it. */
interface DeepseekBalanceRow {
  currency: string;
  total: number;
  granted: number | null;
  toppedUp: number | null;
}
/** Parse the documented balance payload without trusting its exact shape. */
declare function parseDeepseekBalance(payload: unknown): {
  rows: DeepseekBalanceRow[];
  isAvailable: boolean | null;
};
/** DeepSeek balance probe. */
declare const deepseekProbe: Probe;
//#endregion
//#region src/providers/kimi-code.d.ts
/** Stable source id. */
declare const KIMI_SOURCE_ID = "kimi-code";
/** One credential triple read from the CLI's OAuth document. */
interface KimiTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
}
/** Drop the cached token (tests, and a failed refresh). */
declare function resetKimiTokenCache(): void;
/** Read the CLI credential document, tolerating every shape variant it has shipped. */
declare function parseKimiTokens(raw: string): KimiTokens | null;
/** Parse `resetTime` (an ISO instant) into epoch milliseconds. */
declare function parseKimiResetTime(value: unknown): number | undefined;
/** Parse the usage payload into ordered windows (narrowest rolling window first, pool last). */
declare function parseKimiUsage(payload: unknown): {
  windows: QuotaWindow[];
};
/** Kimi For Coding subscription-quota probe. */
declare const kimiCodeProbe: Probe;
//#endregion
//#region src/providers/moonshot.d.ts
/** Stable source id; also the key prefix of this source's balance thresholds. */
declare const MOONSHOT_SOURCE_ID = "moonshot-balance";
/** One parsed balance payload. */
interface MoonshotBalance {
  currency: string;
  available: number;
  voucher: number | null;
  cash: number | null;
}
/** Parse one balance payload, mapping the region to its billing currency. */
declare function parseMoonshotBalance(payload: unknown, region: 'cn' | 'intl'): MoonshotBalance | null;
/** Moonshot / Kimi Open Platform balance probe. */
declare const moonshotProbe: Probe;
//#endregion
//#region src/providers/opencode.d.ts
/** Stable source id. */
declare const OPENCODE_SOURCE_ID = "opencode-go";
/** The catalog default credential reference; a configured route overrides it. */
declare const OPENCODE_DEFAULT_API_KEY_ENV = "OPENCODE_API_KEY";
/** Which usage endpoint this route uses, or `null` when the route is not one we know. */
declare function opencodeBaseURL(host: ProbeHost, routeId: string | undefined): string | null;
/**
 * Parse the usage payload into ordered windows.
 *
 * A window is kept when it carries a finite `percent`; `status` is advisory
 * (`ok` or `rate-limited`) because a limited window still has a number worth
 * showing. `resetAt`/`resetsAt` are accepted as ISO strings.
 */
declare function parseOpencodeUsage(payload: unknown): QuotaWindow[];
/** Read an ISO instant (or epoch seconds/milliseconds) into epoch milliseconds. */
declare function parseResetInstant(value: unknown): number | undefined;
/** OpenCode usage probe. */
declare const opencodeProbe: Probe;
//#endregion
//#region src/providers/index.d.ts
/**
 * Every shipped source, in display order.
 *
 * Registration order decides the card's row order and the fallback when two
 * sources could answer for one route. A new provider appends one entry here.
 */
declare const PROBES: readonly Probe[];
/** Look one probe up by its stable id. */
declare function probeById(id: string): Probe | undefined;
/** The probes that answer for one registered LLM route id. */
declare function probesForRoute(routeId: string): Probe[];
//#endregion
export { DEEPSEEK_SOURCE_ID, KIMI_SOURCE_ID, MOONSHOT_SOURCE_ID, OPENCODE_DEFAULT_API_KEY_ENV, OPENCODE_SOURCE_ID, PROBES, type Probe, type ProbeHost, SkipSource, deepseekProbe, kimiCodeProbe, moonshotProbe, opencodeBaseURL, opencodeProbe, parseDeepseekBalance, parseKimiResetTime, parseKimiTokens, parseKimiUsage, parseMoonshotBalance, parseOpencodeUsage, parseResetInstant, probeById, probesForRoute, resetKimiTokenCache };