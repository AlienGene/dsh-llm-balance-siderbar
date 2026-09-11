/**
 * Plugin configuration: every knob the row may carry, normalized once at mount.
 *
 * The row ships without a `config:` block so the market can hot-mount it, which
 * means this module — not a schema — owns the defaults. An unknown or malformed
 * value is replaced by its default and reported through `warnings` instead of
 * failing the mount: a display plugin must never be the reason a host refuses to
 * boot.
 *
 * @module dsh-llm-balance/config
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_THRESHOLDS } from './format.ts'
import type {
  BalanceThresholdRule,
  BalanceThresholds,
  ColorKey,
  DisplayMode,
  PercentMode,
  Thresholds,
} from './protocol.ts'

/** `< error` red, `< warn` yellow, `active` green, else the brand accent (blue). */
export const DEFAULT_COLORS: Record<ColorKey, string> = {
  normal: 'var(--dsw-alias-brand-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  // The "this is the account you are using" accent.
  active: 'var(--dsw-alias-state-success-primary)',
}

/** Cap a single upstream request; long enough for a slow provider, short enough to be invisible. */
export const DEFAULT_TIMEOUT_MS = 8_000

/** Both the host cache TTL and the card's poll interval. */
export const DEFAULT_REFRESH_MS = 60_000

/** Kimi Code is the only shipped source that talks to a subscription surface. */
export const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'

/** One row's override for a single source id. */
export interface SourceOverride {
  enabled?: boolean
  label?: string
  apiKeyEnv?: string
  baseURL?: string
  region?: 'cn' | 'intl'
}

/** The raw row config as authored in YAML (everything optional). */
export interface PluginInput {
  defaultMode?: unknown
  percentMode?: unknown
  sources?: unknown
  thresholds?: unknown
  colors?: unknown
  refreshMs?: unknown
  timeoutMs?: unknown
  balanceThresholds?: unknown
  deepseek?: unknown
  moonshot?: unknown
  kimiCode?: unknown
  opencode?: unknown
}

/** Fully resolved configuration. */
export interface ResolvedConfig {
  defaultMode: DisplayMode
  percentMode: PercentMode
  refreshMs: number
  timeoutMs: number
  thresholds: Thresholds
  colors: Record<ColorKey, string>
  /** `null` means "auto": only sources answering for a registered LLM route are read. */
  explicitSources: string[] | null
  sourceOverrides: Record<string, SourceOverride>
  /** Absolute amount boundaries for balance rows, keyed `"<sourceId>:<CURRENCY>"` (or `"<sourceId>:*"`). */
  balanceThresholds: BalanceThresholds
  deepseek: { apiKeyEnv: string; baseURL: string | null }
  moonshot: { apiKeyEnv: string; region: 'cn' | 'intl' }
  /** Optional override for the `opencode*` family; the probe ships known endpoints. */
  opencode?: { apiKeyEnv?: string; baseURL?: string }
  kimiCode: {
    apiKeyEnv: string
    tokenFile: string | null
    tokenFileFallbacks: string[]
    oauthHost: string
    baseURL: string
    clientId: string
    persistRefreshedToken: boolean
  }
  warnings: string[]
}

/** Where the Kimi Code CLI keeps its OAuth credential on disk. */
export function kimiTokenFileCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env['HOME'] ?? homedir()
  return [
    join(home, '.kimi-code', 'credentials', 'kimi-code.json'),
    join(home, '.kimi', 'credentials', 'kimi-code.json'),
  ]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asPositiveInt(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return rounded < min ? fallback : rounded
}

function asMode(value: unknown): DisplayMode | null {
  return value === 'current' || value === 'summary' || value === 'all' ? value : null
}

function asPercentMode(value: unknown): PercentMode | null {
  return value === 'left' || value === 'used' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Normalize one row config into a fully resolved configuration.
 * @param raw - the row's `config:` value (absent when the row carries none).
 * @param env - environment used to locate `$DSH_HOME` and the Kimi credential.
 * @returns the resolved configuration plus human-readable warnings for anything ignored.
 */
export function normalizeConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const input = asRecord(raw) as PluginInput
  const warnings: string[] = []

  const defaultMode = asMode(input.defaultMode)
  if (input.defaultMode !== undefined && defaultMode === null) {
    warnings.push(`defaultMode must be current|summary|all, got ${JSON.stringify(input.defaultMode)}`)
  }
  const percentMode = asPercentMode(input.percentMode)
  if (input.percentMode !== undefined && percentMode === null) {
    warnings.push(`percentMode must be left|used, got ${JSON.stringify(input.percentMode)}`)
  }

  const thresholdInput = asRecord(input.thresholds)
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS }
  for (const key of ['warn', 'error'] as const) {
    const value = thresholdInput[key]
    if (value === undefined) continue
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
      thresholds[key] = value
    } else {
      warnings.push(`thresholds.${key} must be a number within 0..100`)
    }
  }
  if (thresholds.error > thresholds.warn) {
    warnings.push('thresholds.error is above thresholds.warn; the red tier will never appear')
  }

  const colors: Record<ColorKey, string> = { ...DEFAULT_COLORS }
  const colorInput = asRecord(input.colors)
  for (const key of ['normal', 'warn', 'error', 'active'] as const) {
    const value = asString(colorInput[key])
    if (value !== null) colors[key] = value
  }

  const { explicitSources, sourceOverrides, sourceWarnings } = parseSources(input.sources)
  warnings.push(...sourceWarnings)

  const balanceThresholds = parseBalanceThresholds(input.balanceThresholds, warnings)

  const deepseek = asRecord(input.deepseek)
  const moonshot = asRecord(input.moonshot)
  const kimi = asRecord(input.kimiCode)
  const opencodeInput = asRecord(input.opencode)
  const opencodeBaseURL = asString(opencodeInput['baseURL'])
  const opencodeApiKeyEnv = asString(opencodeInput['apiKeyEnv'])
  const opencode =
    opencodeBaseURL === null && opencodeApiKeyEnv === null
      ? undefined
      : {
          ...(opencodeApiKeyEnv === null ? {} : { apiKeyEnv: opencodeApiKeyEnv }),
          ...(opencodeBaseURL === null ? {} : { baseURL: opencodeBaseURL }),
        }

  const tokenFile = asString(kimi['tokenFile'])
  const candidates = kimiTokenFileCandidates(env)
  const regionValue = moonshot['region']
  const region: 'cn' | 'intl' = regionValue === 'intl' ? 'intl' : 'cn'
  if (regionValue !== undefined && regionValue !== 'cn' && regionValue !== 'intl') {
    warnings.push(`moonshot.region must be cn|intl, got ${JSON.stringify(regionValue)}`)
  }

  return {
    defaultMode: defaultMode ?? 'all',
    // Subscription windows read as "how much have I used"; the colour still
    // tracks what is left, which is the number that matters when it runs out.
    percentMode: percentMode ?? 'used',
    refreshMs: asPositiveInt(input.refreshMs, DEFAULT_REFRESH_MS, 5_000),
    timeoutMs: asPositiveInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000),
    thresholds,
    colors,
    explicitSources,
    sourceOverrides,
    balanceThresholds,
    deepseek: {
      apiKeyEnv: asString(deepseek['apiKeyEnv']) ?? 'DEEPSEEK_API_KEY',
      baseURL: asString(deepseek['baseURL']),
    },
    moonshot: {
      apiKeyEnv: asString(moonshot['apiKeyEnv']) ?? 'MOONSHOT_API_KEY',
      region,
    },
    ...(opencode === undefined ? {} : { opencode }),
    kimiCode: {
      apiKeyEnv: asString(kimi['apiKeyEnv']) ?? 'KIMI_API_KEY',
      tokenFile: tokenFile ?? (candidates[0] ?? null),
      tokenFileFallbacks: candidates.filter((candidate) => candidate !== tokenFile),
      oauthHost: asString(kimi['oauthHost']) ?? 'https://auth.kimi.com',
      baseURL: asString(kimi['baseURL']) ?? 'https://api.kimi.com/coding/v1',
      clientId: asString(kimi['clientId']) ?? KIMI_CLIENT_ID,
      persistRefreshedToken: asBoolean(kimi['persistRefreshedToken'], true),
    },
    warnings,
  }
}

function parseSources(value: unknown): {
  explicitSources: string[] | null
  sourceOverrides: Record<string, SourceOverride>
  sourceWarnings: string[]
} {
  const sourceWarnings: string[] = []
  const sourceOverrides: Record<string, SourceOverride> = {}
  if (value === undefined || value === 'auto') return { explicitSources: null, sourceOverrides, sourceWarnings }
  if (!Array.isArray(value)) {
    sourceWarnings.push('sources must be "auto" or an array of source entries; using auto')
    return { explicitSources: null, sourceOverrides, sourceWarnings }
  }
  const ids: string[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (typeof entry === 'string') {
      ids.push(entry)
      continue
    }
    const id = asString(record['id'])
    if (id === null) {
      sourceWarnings.push('each sources entry needs a string id; entry ignored')
      continue
    }
    const override: SourceOverride = {}
    if (record['enabled'] !== undefined) override.enabled = record['enabled'] === true
    const label = asString(record['label'])
    if (label !== null) override.label = label
    const apiKeyEnv = asString(record['apiKeyEnv'])
    if (apiKeyEnv !== null) override.apiKeyEnv = apiKeyEnv
    const baseURL = asString(record['baseURL'])
    if (baseURL !== null) override.baseURL = baseURL
    if (record['region'] === 'cn' || record['region'] === 'intl') override.region = record['region']
    sourceOverrides[id] = override
    if (override.enabled !== false) ids.push(id)
  }
  return { explicitSources: ids, sourceOverrides, sourceWarnings }
}

/**
 * Read the optional absolute balance boundaries.
 *
 * Shape: `{ '<sourceId>:<CURRENCY>': { warnBelow?, errorBelow? }, '<sourceId>:*': … }`.
 * A rule without any usable number is dropped, and an unreadable value is
 * reported rather than silently ignored — the row simply keeps its normal
 * colour, which is the safe default for a status display.
 */
function parseBalanceThresholds(value: unknown, warnings: string[]): BalanceThresholds {
  const rules: Record<string, BalanceThresholdRule> = {}
  for (const [key, raw] of Object.entries(asRecord(value))) {
    const record = asRecord(raw)
    const rule: BalanceThresholdRule = {}
    for (const field of ['warnBelow', 'errorBelow'] as const) {
      const candidate = record[field]
      if (candidate === undefined) continue
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
        rule[field] = candidate
      } else {
        warnings.push(`balanceThresholds.${key}.${field} must be a non-negative number`)
      }
    }
    if (rule.warnBelow === undefined && rule.errorBelow === undefined) {
      warnings.push(`balanceThresholds.${key} carries no usable boundary; entry ignored`)
      continue
    }
    if (rule.warnBelow !== undefined && rule.errorBelow !== undefined && rule.errorBelow > rule.warnBelow) {
      warnings.push(`balanceThresholds.${key}.errorBelow is above warnBelow; the red tier will never appear`)
    }
    rules[key] = rule
  }
  return rules
}
