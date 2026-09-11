/**
 * Wire contract shared by the host half, the browser half, and the tests.
 *
 * Pure data only: no Node builtins, no Cordis imports, no live DSH objects —
 * the browser bundle inlines the modules that import this, so every type here
 * must survive a browser build. Every field is lossless JSON.
 *
 * Text the user reads is deliberately NOT carried on the wire: quantities are
 * sent raw (a currency code, a window duration, a part key) and the card
 * localizes them, so the host half never needs a translator.
 *
 * @module dsh-llm-balance/protocol
 */

/** Semantic colour tier derived from a *remaining* percentage. */
export type Level = 'normal' | 'warn' | 'error'

/** Which sources the corner card shows. */
export type DisplayMode = 'current' | 'summary' | 'all'

/** Whether the card prints the remaining or the consumed share of a window. */
export type PercentMode = 'left' | 'used'

/** The two boundaries of the colour rule: `< error` red, `< warn` yellow, else blue. */
export interface Thresholds {
  warn: number
  error: number
}

/**
 * Every colour the card resolves from the host's palette:
 * the three tiers a percentage can land in, plus `active` — the accent that
 * marks the account the current model is actually drawing on.
 */
export type ColorKey = Level | 'active'

/** A qualifier the card localizes next to a balance. */
export type BalanceNote = 'deficit' | 'unavailable'

/**
 * One currency's remaining credit.
 *
 * A top-up account has no natural denominator, so this card deliberately
 * reports the amount alone: an invented percentage (of a historical high-water
 * mark, say) reads as precision the number does not have, and a breakdown line
 * under it is noise the user did not ask for. Whether an amount is low is a
 * user-owned judgement, expressed through {@link BalanceThresholds}.
 */
export interface BalanceEntry {
  currency: string
  /** Remaining credit in `currency`, as the provider reports it. */
  total: number
}

/**
 * Absolute amount boundaries for one balance key (`<sourceId>:<CURRENCY>`, or
 * `<sourceId>:*` for every currency of a source). Absent means "never colour
 * this balance": an amount with no configured threshold is simply reported.
 */
export interface BalanceThresholdRule {
  /** Colour the row warn while `total < warnBelow`. */
  warnBelow?: number
  /** Colour the row error while `total < errorBelow`. */
  errorBelow?: number
}

/** Configured balance boundaries, keyed by `sourceId:CURRENCY` or `sourceId:*`. */
export type BalanceThresholds = Readonly<Record<string, BalanceThresholdRule>>

/**
 * Which window a quota row describes. The card labels them semantically —
 * `频限 / 周 / 月 / 日` — rather than by duration, so two providers describing
 * the same period read the same way.
 */
export type QuotaWindowKind = 'rolling' | 'week' | 'month' | 'day'

/**
 * One subscription window.
 *
 * `kind` names the period; `duration`/`timeUnit` keep the provider's own
 * description (`{duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}` for a five-hour
 * rolling window) for the row's hover detail.
 */
export interface QuotaWindow {
  kind: QuotaWindowKind
  duration: number | null
  timeUnit: string | null
  used: number
  limit: number
  remaining: number
  remainingPercent: number
  /** Epoch milliseconds when this window resets; the card counts down locally. */
  resetsAt?: number
}

/** Why a source shows no numbers at all. */
export type UnsupportedReason = 'no-usage-api'

/** What one source reported, normalized for display. */
export type SourceSnapshot =
  | {
      kind: 'balance'
      entries: BalanceEntry[]
      note?: BalanceNote
    }
  | {
      kind: 'quota'
      windows: QuotaWindow[]
    }
  | {
      /**
       * The provider is configured and reachable, but exposes no usage surface
       * this plugin can read. The card still names it, so a configured provider
       * never silently disappears.
       */
      kind: 'unsupported'
      reason: UnsupportedReason
      /**
       * Host-side explanation — a credential-name list, a missing endpoint —
       * shown only on hover. It is diagnostic text, so it stays in the host's
       * language rather than going through the card's dictionary.
       */
      detail?: string
    }

/** Failure vocabulary; stable across host, client, and tests. */
export type ErrorCode =
  | 'NO_CREDENTIAL'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE'
  | 'NOT_SUPPORTED'

/** One source's state in the response. */
export interface SourceState {
  id: string
  /** Display label (a product name, not translated). */
  label: string
  /** Whether `snapshot` is the result of this round (false = error or stale). */
  ok: boolean
  /** Registered LLM route ids this source answers for (matched against the live route list). */
  providers: string[]
  /** Epoch milliseconds of the successful read backing `snapshot`. */
  fetchedAt?: number
  /** Age of that read at `now`. */
  ageMs?: number
  /** True when the last attempt failed and `snapshot` is the previous success. */
  stale?: boolean
  snapshot?: SourceSnapshot
  error?: { code: ErrorCode; message: string }
}

/** The whole `GET /dsh-llm-balance/state` payload. Never contains a secret. */
export interface StateResponse {
  ok: true
  /** Host clock at response time, for local countdown anchoring. */
  now: number
  /** Suggested poll interval for the card. */
  refreshMs: number
  defaultMode: DisplayMode
  percentMode: PercentMode
  colors: Record<ColorKey, string>
  thresholds: Thresholds
  /** Absolute amount boundaries for balance rows; empty means "no colour rule". */
  balanceThresholds: BalanceThresholds
  /** The deployment's default model route, used while no session selection exists. */
  defaultProvider: { provider: string; model: string } | null
  sources: SourceState[]
}

/** Current model selection projected from the active session (client-side shape). */
export interface SessionSelectionLike {
  provider?: string
  model?: string
}

/** The `modelSelection` session projection as the browser half receives it. */
export interface ModelSelectionProjectionLike {
  lastUsed?: SessionSelectionLike | null
  next?: SessionSelectionLike | null
}

/** One row of the session list snapshot the shell hands to a root-scoped seat. */
export interface SessionSummaryLike {
  id?: string
  projectionValues?: { modelSelection?: ModelSelectionProjectionLike } & Record<string, unknown>
}

/** `SessionListState`, narrowed to what the corner card reads. */
export interface SessionListStateLike {
  current?: string
  byId?: Record<string, SessionSummaryLike>
}

/** A dictionary-bound translator: `t('key', { name: value })`. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string
