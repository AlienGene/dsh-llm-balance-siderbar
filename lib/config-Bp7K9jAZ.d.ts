import { a as ColorKey, i as BalanceThresholds, o as DisplayMode, u as PercentMode, y as Thresholds } from "./protocol-ziHJjbju.js";
//#region src/config.d.ts
/** `< error` red, `< warn` yellow, `active` green, else the brand accent (blue). */
declare const DEFAULT_COLORS: Record<ColorKey, string>;
/** Cap a single upstream request; long enough for a slow provider, short enough to be invisible. */
declare const DEFAULT_TIMEOUT_MS = 8000;
/** Both the host cache TTL and the card's poll interval. */
declare const DEFAULT_REFRESH_MS = 60000;
/** Kimi Code is the only shipped source that talks to a subscription surface. */
declare const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
/** One row's override for a single source id. */
interface SourceOverride {
  enabled?: boolean;
  label?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  region?: 'cn' | 'intl';
}
/** The raw row config as authored in YAML (everything optional). */
interface PluginInput {
  defaultMode?: unknown;
  percentMode?: unknown;
  sources?: unknown;
  thresholds?: unknown;
  colors?: unknown;
  refreshMs?: unknown;
  timeoutMs?: unknown;
  balanceThresholds?: unknown;
  deepseek?: unknown;
  moonshot?: unknown;
  kimiCode?: unknown;
  opencode?: unknown;
}
/** Fully resolved configuration. */
interface ResolvedConfig {
  defaultMode: DisplayMode;
  percentMode: PercentMode;
  refreshMs: number;
  timeoutMs: number;
  thresholds: Thresholds;
  colors: Record<ColorKey, string>;
  /** `null` means "auto": only sources answering for a registered LLM route are read. */
  explicitSources: string[] | null;
  sourceOverrides: Record<string, SourceOverride>;
  /** Absolute amount boundaries for balance rows, keyed `"<sourceId>:<CURRENCY>"` (or `"<sourceId>:*"`). */
  balanceThresholds: BalanceThresholds;
  deepseek: {
    apiKeyEnv: string;
    baseURL: string | null;
  };
  moonshot: {
    apiKeyEnv: string;
    region: 'cn' | 'intl';
  };
  /** Optional override for the `opencode*` family; the probe ships known endpoints. */
  opencode?: {
    apiKeyEnv?: string;
    baseURL?: string;
  };
  kimiCode: {
    apiKeyEnv: string;
    tokenFile: string | null;
    tokenFileFallbacks: string[];
    oauthHost: string;
    baseURL: string;
    clientId: string;
    persistRefreshedToken: boolean;
  };
  warnings: string[];
}
/** Where the Kimi Code CLI keeps its OAuth credential on disk. */
declare function kimiTokenFileCandidates(env?: NodeJS.ProcessEnv): string[];
/**
 * Normalize one row config into a fully resolved configuration.
 * @param raw - the row's `config:` value (absent when the row carries none).
 * @param env - environment used to locate `$DSH_HOME` and the Kimi credential.
 * @returns the resolved configuration plus human-readable warnings for anything ignored.
 */
declare function normalizeConfig(raw: unknown, env?: NodeJS.ProcessEnv): ResolvedConfig;
//#endregion
export { PluginInput as a, kimiTokenFileCandidates as c, KIMI_CLIENT_ID as i, normalizeConfig as l, DEFAULT_REFRESH_MS as n, ResolvedConfig as o, DEFAULT_TIMEOUT_MS as r, SourceOverride as s, DEFAULT_COLORS as t };