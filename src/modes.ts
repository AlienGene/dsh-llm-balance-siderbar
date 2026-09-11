/**
 * The card's display derivation: what the three modes show, and how a source
 * becomes rows.
 *
 * Pure and framework-free on purpose — the React component below only renders
 * what {@link buildCard} returns, so every mode rule is unit-testable without a
 * DOM, and the same helpers could back a second surface (a right-sidebar tab,
 * a command's output) later.
 *
 * @module dsh-llm-balance/modes
 */
import {
  displayPercent,
  formatAmount,
  formatCountdown,
  formatPercent,
  formatWindowLabel,
  levelOf,
  levelOfBalance,
  sumBalances,
  tightestWindow,
  worstLevel,
  type Locale,
} from './format.ts'
import type {
  BalanceThresholds,
  ColorKey,
  DisplayMode,
  Level,
  PercentMode,
  QuotaWindow,
  SourceState,
  StateResponse,
  Thresholds,
  TranslateFn,
} from './protocol.ts'

/** One line of the card: the whole line, already localized, plus its colour. */
export interface CardRow {
  key: string
  text: string
  level: Level
  /** Hover detail that must not crowd the card, such as a window's raw counts. */
  title?: string
}

/** One source's block (or the single summary block). */
export interface CardBlock {
  key: string
  label: string
  rows: CardRow[]
  level: Level
  /** True when this source answers for the provider the current model uses. */
  active?: boolean
  error?: string
  stale?: boolean
}

/** Everything the component renders. */
export interface CardModel {
  blocks: CardBlock[]
  empty?: string
  level: Level
}

/** Inputs shared by every derivation step. */
export interface BuildOptions {
  mode: DisplayMode
  currentProvider: string | null
  locale: Locale
  percentMode: PercentMode
  thresholds: Thresholds
  /** Absolute amount boundaries for balance rows (empty = never colour them). */
  balanceThresholds: BalanceThresholds
  now: number
  t: TranslateFn
}

const MODE_CYCLE: readonly DisplayMode[] = ['current', 'summary', 'all']

/** The mode the icon switches to next. */
export function nextMode(mode: DisplayMode): DisplayMode {
  const index = MODE_CYCLE.indexOf(mode)
  return MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? 'all'
}

/** The provider a `current` card scopes to: the active session's, else the deployment default. */
export function effectiveProvider(response: StateResponse, currentProvider: string | null): string | null {
  if (currentProvider !== null && currentProvider.length > 0) return currentProvider
  return response.defaultProvider?.provider ?? null
}

/** Which sources one mode shows. */
export function visibleSources(
  response: StateResponse,
  mode: DisplayMode,
  currentProvider: string | null,
): SourceState[] {
  if (mode !== 'current') return response.sources
  const provider = effectiveProvider(response, currentProvider)
  if (provider === null) return response.sources
  return response.sources.filter((source) => source.providers.includes(provider))
}

/** Build the whole render model. */
export function buildCard(response: StateResponse, options: BuildOptions): CardModel {
  const sources = visibleSources(response, options.mode, options.currentProvider)
  const provider = effectiveProvider(response, options.currentProvider)

  if (sources.length === 0) {
    return {
      blocks: [],
      empty:
        options.mode === 'current' && provider !== null
          ? options.t('empty.current', { provider })
          : options.t('empty'),
      level: 'normal',
    }
  }

  if (options.mode === 'summary') return summaryCard(sources, options)

  const blocks = sources.map((source) => sourceBlock(source, options, provider))
  return { blocks, level: worstLevel(blocks.map((block) => block.level)) }
}

/** One source's detail: a balance row per currency, one line per quota window. */
export function sourceBlock(source: SourceState, options: BuildOptions, provider?: string | null): CardBlock {
  const { t, locale, percentMode, thresholds, balanceThresholds, now } = options
  const rows: CardRow[] = []
  const snapshot = source.snapshot

  if (snapshot !== undefined && snapshot.kind === 'balance') {
    for (const entry of snapshot.entries) {
      rows.push({
        key: `${source.id}:${entry.currency}`,
        // A top-up account reports an amount and nothing else: no percentage is
        // invented, and no breakdown line sits under it.
        text: formatAmount(entry.total, entry.currency),
        level: levelOfBalance(source.id, entry.currency, entry.total, balanceThresholds),
      })
    }
    if (snapshot.note !== undefined) {
      rows.push({
        key: `${source.id}:note`,
        text: t(`note.${snapshot.note}`),
        level: snapshot.note === 'unavailable' ? 'warn' : 'error',
      })
    }
  } else if (snapshot !== undefined && snapshot.kind === 'quota') {
    for (const window of snapshot.windows) {
      rows.push({
        key: `${source.id}:${window.kind}:${window.limit}`,
        text: quotaRowText(window, options),
        title: quotaRowTitle(window, options),
        // The printed share follows `percentMode`, but the colour always answers
        // "how much is left" — that is the number that runs out.
        level: levelOf(window.remainingPercent, thresholds),
      })
    }
  } else if (snapshot !== undefined && snapshot.kind === 'unsupported') {
    rows.push({
      key: `${source.id}:unsupported`,
      text: t('note.noUsageApi'),
      ...(snapshot.detail === undefined ? {} : { title: snapshot.detail }),
      level: 'normal',
    })
  }

  return {
    key: source.id,
    label: source.label,
    rows,
    level: worstLevel(rows.map((row) => row.level)),
    ...(provider === undefined || provider === null ? {} : { active: source.providers.includes(provider) }),
    ...(source.error === undefined ? {} : { error: errorText(source.error.code, t) }),
    ...(source.stale === true ? { stale: true } : {}),
  }
}

/** The aggregate view: one balance total per currency, one tightest window per subscription. */
export function summaryCard(sources: readonly SourceState[], options: BuildOptions): CardModel {
  const { t, thresholds, balanceThresholds } = options
  const rows: CardRow[] = []

  for (const total of sumBalances(sources)) {
    // A total is still judged by the boundaries of the accounts it adds up.
    const levels: Level[] = []
    for (const source of sources) {
      if (source.snapshot === undefined || source.snapshot.kind !== 'balance') continue
      for (const entry of source.snapshot.entries) {
        if (entry.currency.toUpperCase() !== total.currency) continue
        levels.push(levelOfBalance(source.id, entry.currency, entry.total, balanceThresholds))
      }
    }
    rows.push({
      key: `total:${total.currency}`,
      text: `${t('summary.balance')} ${formatAmount(total.total, total.currency)}`,
      level: worstLevel(levels),
    })
  }

  for (const source of sources) {
    if (source.snapshot === undefined || source.snapshot.kind !== 'quota') continue
    const window = tightestWindow(source.snapshot)
    if (window === null) continue
    rows.push({
      key: `tight:${source.id}`,
      text: `${source.label} ${quotaRowText(window, options)}`,
      title: quotaRowTitle(window, options),
      level: levelOf(window.remainingPercent, thresholds),
    })
  }

  for (const source of sources) {
    if (source.snapshot !== undefined && source.snapshot.kind === 'unsupported') {
      rows.push({ key: `unsupported:${source.id}`, text: `${source.label} ${t('note.noUsageApi')}`, level: 'normal' })
      continue
    }
    if (source.error === undefined) continue
    rows.push({
      key: `error:${source.id}`,
      text: `${source.label} ${errorText(source.error.code, t)}`,
      level: 'error',
    })
  }

  if (rows.length === 0) {
    return { blocks: [], empty: t('empty'), level: 'normal' }
  }
  return {
    blocks: [
      {
        key: 'summary',
        label: t('mode.summary'),
        rows,
        level: worstLevel(rows.map((row) => row.level)),
      },
    ],
    level: worstLevel(rows.map((row) => row.level)),
  }
}

/** Every code this card has copy for; anything else falls back to a generic line. */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'NO_CREDENTIAL',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'HTTP_ERROR',
  'BAD_RESPONSE',
  'NOT_SUPPORTED',
])

/** Localized text for one failure code. */
export function errorText(code: string, t: TranslateFn): string {
  return t(KNOWN_ERROR_CODES.has(code) ? `error.${code}` : 'error.UNKNOWN')
}


/** The dot of a source the current model is not drawing on. */
export const MUTED_DOT = 'var(--dsw-alias-label-secondary)'

/**
 * A source block's dot colour.
 *
 * Being in use wins: the green accent answers "which account is this session
 * spending?" — the question the dot now exists for. An idle source still shows
 * its alarm tier (its own numbers stay colour-coded either way), and an idle,
 * healthy one is muted.
 */
export function blockDotColor(level: Level, active: boolean | undefined, colors: Record<ColorKey, string>): string {
  if (active === true) return colors.active
  if (level !== 'normal') return colors[level]
  return MUTED_DOT
}

/**
 * Window labels for the `rate` / `pool` kinds an older host still sends. The
 * browser half reloads on its own schedule, so it can face a payload from a
 * host that has not restarted yet; naming those kinds beats printing a key.
 */
const LEGACY_WINDOW_LABELS: Readonly<Record<string, { zh: string; en: string }>> = {
  rate: { zh: '频限', en: 'rolling' },
  pool: { zh: '周', en: 'week' },
}

/** The localized label of one window, tolerating an older payload's kinds. */
export function windowLabelOf(window: QuotaWindow, options: BuildOptions): string {
  const { t, locale } = options
  const key = `window.${window.kind}`
  const text = t(key)
  if (text !== key) return text
  const legacy = LEGACY_WINDOW_LABELS[String(window.kind)]
  if (legacy !== undefined) return legacy[locale]
  return String(window.kind)
}

/**
 * One subscription window's line: `频限（47%） 3d0h0m重置`.
 *
 * The share and the countdown are separate dictionary entries so each language
 * owns its own punctuation and spacing (`rolling (47%) resets in 3d0h0m`).
 */
export function quotaRowText(window: QuotaWindow, options: BuildOptions): string {
  const { t, locale, percentMode, now } = options
  const percent = displayPercent(window, percentMode)
  const share =
    percent === null ? '' : t(percentMode === 'used' ? 'used' : 'remaining', { percent: formatPercent(percent) })
  const head = `${windowLabelOf(window, options)}${share}`
  if (window.resetsAt === undefined) return head
  const reset = t('reset', { time: formatCountdown(window.resetsAt - now, locale) })
  return reset.length === 0 ? head : `${head} ${reset}`
}

/** One window's hover detail: the raw counts, plus the provider's own window length. */
export function quotaRowTitle(window: QuotaWindow, options: BuildOptions): string {
  const { t, locale } = options
  const counts = t('usedOf', {
    used: window.used,
    limit: window.limit,
    remaining: formatPercent(window.remainingPercent),
  })
  if (window.duration === null || window.timeUnit === null) return counts
  return `${counts} · ${formatWindowLabel(window.duration, window.timeUnit, locale)}`
}

/** The card surface for one transparency choice. */
export interface CardSurface {
  /** `1` for the solid surface; lower lets the page behind show through. */
  opacity: number
  /** Backdrop blur radius in px; `0` disables it. */
  blur: number
}

/**
 * The card's own surface for the translucency toggle.
 *
 * Only the surface dims — the text stays fully opaque — so the card can sit
 * quietly over the conversation while its numbers remain readable.
 */
export function cardSurface(translucent: boolean): CardSurface {
  return translucent ? { opacity: 0.55, blur: 6 } : { opacity: 1, blur: 0 }
}

// ── Poll-interval selector and card positioning (v0.5) ───────────────────────

/** The intervals the TTL chip offers, in ascending order. */
export const POLL_PRESETS: readonly number[] = [60_000, 300_000, 1_800_000, 3_600_000]

/** `60000` → `60s`, `300000` → `5m`, `1800000` → `30m`, `3600000` → `1h`. */
export function pollLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '60s'
  const minutes = Math.round(ms / 60_000)
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes >= 2) return `${minutes}m`
  // The first preset is spelled in seconds because the list itself says "60s".
  return `${Math.max(1, Math.round(ms / 1000))}s`
}

/** Read the stored poll override; anything unreadable means "use the host default". */
export function parseStoredPollMs(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1000) return null
  return parsed
}

/** The side a card is magnetically parked on. */
export type DockedSide = 'left' | 'right'

/** A free or edge-docked card position in viewport pixels. */
export interface CardPosition {
  left: number
  top: number
  /** Set when the drop snapped the card to a side; absent/`null` means it floats free. */
  docked?: DockedSide | null
}

/** Clamp a position so the card stays fully inside the viewport. */
export function clampPosition(
  pos: CardPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0,
): CardPosition {
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const maxTop = Math.max(margin, viewportHeight - height - margin)
  return {
    left: Math.min(Math.max(pos.left, margin), maxLeft),
    top: Math.min(Math.max(pos.top, margin), maxTop),
  }
}

/** Result of the drop-time edge snap. */
export interface SnapResult {
  position: CardPosition
  docked: DockedSide | null
}

/**
 * Snap to the nearest horizontal edge when the drop lands within
 * `thresholdPx` of it. "Docked" means a fixed 8px margin from that edge; the
 * vertical position never changes, so a drag only ever parks the card sideways.
 */
export function snapToHorizontalEdge(
  pos: CardPosition,
  width: number,
  viewportWidth: number,
  thresholdPx: number,
): SnapResult {
  const margin = 8
  if (pos.left < thresholdPx) return { position: { left: margin, top: pos.top }, docked: 'left' }
  if (viewportWidth - (pos.left + width) < thresholdPx) {
    return { position: { left: viewportWidth - width - margin, top: pos.top }, docked: 'right' }
  }
  return { position: pos, docked: null }
}

/**
 * Read the stored position; missing or malformed values mean the default corner.
 * A record written before v0.6 has no `docked`, which reads as "floats free".
 */
export function parseStoredPosition(value: string | null): CardPosition | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as { left?: unknown; top?: unknown; docked?: unknown }
    if (typeof parsed.left !== 'number' || !Number.isFinite(parsed.left)) return null
    if (typeof parsed.top !== 'number' || !Number.isFinite(parsed.top)) return null
    const docked = parsed.docked === 'left' || parsed.docked === 'right' ? parsed.docked : null
    return { left: parsed.left, top: parsed.top, docked }
  } catch {
    return null
  }
}

/**
 * The interval list opens above the card by default (it lives in the corner);
 * near the viewport's top edge it flips below so it never clips offscreen.
 */
export function popoverPlacement(cardTopPx: number, popoverHeightPx: number): 'above' | 'below' {
  return cardTopPx >= popoverHeightPx + 16 ? 'above' : 'below'
}

// ── Minimize affordance and the compact bubble (v0.6) ────────────────────────

/** Which corner of a docked card carries the minimize control. */
export type MinimizeCorner = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right'

/**
 * The corner that carries the minimize control.
 *
 * The horizontal side follows the dock (the control stays on the edge the card
 * is parked against); the vertical side faces the *open* half of the viewport:
 * a card in the lower half carries the control on a top corner, a card in the
 * upper half on a bottom corner. The control floats outward, so outward must
 * point at the room toward the viewport's centre — never at the screen edge
 * the card is already hugging, where it would clip or have to fall back inside.
 * A card that floats free has no corner — and no control.
 */
export function minimizeCorner(
  docked: DockedSide | null | undefined,
  topPx: number,
  viewportHeightPx: number,
): MinimizeCorner | null {
  if (docked !== 'left' && docked !== 'right') return null
  const lowerHalf = Number.isFinite(topPx) && Number.isFinite(viewportHeightPx) && topPx >= viewportHeightPx / 2
  if (docked === 'left') return lowerHalf ? 'top-left' : 'bottom-left'
  return lowerHalf ? 'top-right' : 'bottom-right'
}

/** Absolute `top`/`bottom` + `left`/`right` offsets for the minimize control. */
export interface CornerAnchor {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

/**
 * Where to float the minimize control relative to the card box.
 *
 * The control sits *outside* the card's corner, clear of the title row that a
 * control straddling the edge would cover; on the vertical side it falls back
 * inside (`gap`) when the viewport has no room out there, so it is never
 * clipped. Horizontal placement is inward (`-gap`), i.e. the control hangs off
 * the edge the card is docked against.
 *
 * Every returned offset is finite: unknown dimensions make the function choose
 * the safe inward offset rather than emit `NaN` into a style object.
 */
export function cornerAnchor(
  corner: MinimizeCorner,
  cardTopPx: number,
  cardHeightPx: number,
  viewportHeightPx: number,
  size = 22,
  gap = 6,
): CornerAnchor {
  const outward = size + gap
  const horizontal: CornerAnchor =
    corner === 'top-left' || corner === 'bottom-left' ? { left: -gap } : { right: -gap }
  const measurable =
    Number.isFinite(cardTopPx) && Number.isFinite(viewportHeightPx) && Number.isFinite(cardHeightPx)
  if (corner === 'top-left' || corner === 'top-right') {
    const roomAbove = measurable && cardTopPx >= outward + 2
    return { ...horizontal, top: roomAbove ? -outward : gap }
  }
  const roomBelow =
    measurable && cardHeightPx > 0 && cardTopPx + cardHeightPx <= viewportHeightPx - outward - 2
  return { ...horizontal, bottom: roomBelow ? -outward : gap }
}

/** First letter of a provider label, uppercased; a non-Latin label keeps its first code point. */
export function initialOf(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length === 0) return '?'
  return (Array.from(trimmed)[0] ?? '?').toUpperCase()
}

/** The flush coordinates of a docked card (8px from its edge), or `null` when it floats free. */
export function dockedPosition(
  docked: DockedSide | null | undefined,
  width: number,
  viewportWidth: number,
  top: number,
): CardPosition | null {
  const margin = 8
  if (docked === 'left') return { left: margin, top, docked: 'left' }
  if (docked === 'right') {
    return { left: Math.max(margin, viewportWidth - width - margin), top, docked: 'right' }
  }
  return null
}

/** What a minimized card shows: the current provider's initial plus one number. */
export interface CompactBubble {
  key: string
  label: string
  initial: string
  value: string
  /** Hover detail explaining the number (raw counts, or why there is none). */
  title: string
  level: Level
}

/**
 * The source a minimized card speaks for: the one the current model is spending
 * from, else the first one the active mode shows. `null` when the mode shows
 * nothing at all, which keeps the full card (with its empty state) on screen.
 */
export function compactSource(
  response: StateResponse,
  options: BuildOptions,
): { source: SourceState; active: boolean } | null {
  const sources = visibleSources(response, options.mode, options.currentProvider)
  const first = sources[0]
  if (first === undefined) return null
  const provider = effectiveProvider(response, options.currentProvider)
  if (provider !== null) {
    const active = sources.find((source) => source.providers.includes(provider))
    if (active !== undefined) return { source: active, active: true }
  }
  return { source: first, active: false }
}

/**
 * The bubble: the chosen provider's uppercase initial, and under it the one
 * number that matters — a balance amount for a top-up account, the rolling
 * window's used share for a subscription.
 */
export function compactBubble(response: StateResponse, options: BuildOptions): CompactBubble | null {
  const chosen = compactSource(response, options)
  if (chosen === null) return null
  const { source } = chosen
  const base = { key: source.id, label: source.label, initial: initialOf(source.label) }
  const snapshot = source.snapshot

  if (snapshot !== undefined && snapshot.kind === 'balance') {
    const entry = snapshot.entries[0]
    if (entry === undefined) return { ...base, value: '—', title: source.label, level: 'normal' }
    return {
      ...base,
      value: formatAmount(entry.total, entry.currency),
      title: source.label,
      level: levelOfBalance(source.id, entry.currency, entry.total, options.balanceThresholds),
    }
  }

  if (snapshot !== undefined && snapshot.kind === 'quota') {
    const rolling = snapshot.windows.find((window) => window.kind === 'rolling')
    const window = rolling ?? tightestWindow(snapshot)
    if (window === undefined || window === null) {
      return { ...base, value: '—', title: source.label, level: 'normal' }
    }
    const percent = displayPercent(window, options.percentMode)
    return {
      ...base,
      value: percent === null ? '—' : formatPercent(percent),
      // The same hover detail the full card's row carries.
      title: quotaRowTitle(window, options),
      level: levelOf(window.remainingPercent, options.thresholds),
    }
  }

  return { ...base, value: '—', title: options.t('note.noUsageApi'), level: 'normal' }
}
