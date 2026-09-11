import { _ as SourceState, a as ColorKey, b as TranslateFn, c as Level, d as QuotaWindow, i as BalanceThresholds, o as DisplayMode, u as PercentMode, v as StateResponse, y as Thresholds } from "./protocol-ziHJjbju.js";
import { Locale } from "./format.js";
//#region src/modes.d.ts
/** One line of the card: the whole line, already localized, plus its colour. */
interface CardRow {
  key: string;
  text: string;
  level: Level;
  /** Hover detail that must not crowd the card, such as a window's raw counts. */
  title?: string;
}
/** One source's block (or the single summary block). */
interface CardBlock {
  key: string;
  label: string;
  rows: CardRow[];
  level: Level;
  /** True when this source answers for the provider the current model uses. */
  active?: boolean;
  error?: string;
  stale?: boolean;
}
/** Everything the component renders. */
interface CardModel {
  blocks: CardBlock[];
  empty?: string;
  level: Level;
}
/** Inputs shared by every derivation step. */
interface BuildOptions {
  mode: DisplayMode;
  currentProvider: string | null;
  locale: Locale;
  percentMode: PercentMode;
  thresholds: Thresholds;
  /** Absolute amount boundaries for balance rows (empty = never colour them). */
  balanceThresholds: BalanceThresholds;
  now: number;
  t: TranslateFn;
}
/** The mode the icon switches to next. */
declare function nextMode(mode: DisplayMode): DisplayMode;
/** The provider a `current` card scopes to: the active session's, else the deployment default. */
declare function effectiveProvider(response: StateResponse, currentProvider: string | null): string | null;
/** Which sources one mode shows. */
declare function visibleSources(response: StateResponse, mode: DisplayMode, currentProvider: string | null): SourceState[];
/** Build the whole render model. */
declare function buildCard(response: StateResponse, options: BuildOptions): CardModel;
/** One source's detail: a balance row per currency, one line per quota window. */
declare function sourceBlock(source: SourceState, options: BuildOptions, provider?: string | null): CardBlock;
/** The aggregate view: one balance total per currency, one tightest window per subscription. */
declare function summaryCard(sources: readonly SourceState[], options: BuildOptions): CardModel;
/** Localized text for one failure code. */
declare function errorText(code: string, t: TranslateFn): string;
/** The dot of a source the current model is not drawing on. */
declare const MUTED_DOT = "var(--dsw-alias-label-secondary)";
/**
 * A source block's dot colour.
 *
 * Being in use wins: the green accent answers "which account is this session
 * spending?" — the question the dot now exists for. An idle source still shows
 * its alarm tier (its own numbers stay colour-coded either way), and an idle,
 * healthy one is muted.
 */
declare function blockDotColor(level: Level, active: boolean | undefined, colors: Record<ColorKey, string>): string;
/** The localized label of one window, tolerating an older payload's kinds. */
declare function windowLabelOf(window: QuotaWindow, options: BuildOptions): string;
/**
 * One subscription window's line: `频限（47%） 3d0h0m重置`.
 *
 * The share and the countdown are separate dictionary entries so each language
 * owns its own punctuation and spacing (`rolling (47%) resets in 3d0h0m`).
 */
declare function quotaRowText(window: QuotaWindow, options: BuildOptions): string;
/** One window's hover detail: the raw counts, plus the provider's own window length. */
declare function quotaRowTitle(window: QuotaWindow, options: BuildOptions): string;
/** The card surface for one transparency choice. */
interface CardSurface {
  /** `1` for the solid surface; lower lets the page behind show through. */
  opacity: number;
  /** Backdrop blur radius in px; `0` disables it. */
  blur: number;
}
/**
 * The card's own surface for the translucency toggle.
 *
 * Only the surface dims — the text stays fully opaque — so the card can sit
 * quietly over the conversation while its numbers remain readable.
 */
declare function cardSurface(translucent: boolean): CardSurface;
/** The intervals the TTL chip offers, in ascending order. */
declare const POLL_PRESETS: readonly number[];
/** `60000` → `60s`, `300000` → `5m`, `1800000` → `30m`, `3600000` → `1h`. */
declare function pollLabel(ms: number): string;
/** Read the stored poll override; anything unreadable means "use the host default". */
declare function parseStoredPollMs(value: string | null): number | null;
/** The side a card is magnetically parked on. */
type DockedSide = 'left' | 'right';
/** A free or edge-docked card position in viewport pixels. */
interface CardPosition {
  left: number;
  top: number;
  /** Set when the drop snapped the card to a side; absent/`null` means it floats free. */
  docked?: DockedSide | null;
}
/** Clamp a position so the card stays fully inside the viewport. */
declare function clampPosition(pos: CardPosition, width: number, height: number, viewportWidth: number, viewportHeight: number, margin?: number): CardPosition;
/** Result of the drop-time edge snap. */
interface SnapResult {
  position: CardPosition;
  docked: DockedSide | null;
}
/**
 * Snap to the nearest horizontal edge when the drop lands within
 * `thresholdPx` of it. "Docked" means a fixed 8px margin from that edge; the
 * vertical position never changes, so a drag only ever parks the card sideways.
 */
declare function snapToHorizontalEdge(pos: CardPosition, width: number, viewportWidth: number, thresholdPx: number): SnapResult;
/**
 * Read the stored position; missing or malformed values mean the default corner.
 * A record written before v0.6 has no `docked`, which reads as "floats free".
 */
declare function parseStoredPosition(value: string | null): CardPosition | null;
/**
 * The interval list opens above the card by default (it lives in the corner);
 * near the viewport's top edge it flips below so it never clips offscreen.
 */
declare function popoverPlacement(cardTopPx: number, popoverHeightPx: number): 'above' | 'below';
/** Which corner of a docked card carries the minimize control. */
type MinimizeCorner = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';
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
declare function minimizeCorner(docked: DockedSide | null | undefined, topPx: number, viewportHeightPx: number): MinimizeCorner | null;
/** Absolute `top`/`bottom` + `left`/`right` offsets for the minimize control. */
interface CornerAnchor {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
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
declare function cornerAnchor(corner: MinimizeCorner, cardTopPx: number, cardHeightPx: number, viewportHeightPx: number, size?: number, gap?: number): CornerAnchor;
/** First letter of a provider label, uppercased; a non-Latin label keeps its first code point. */
declare function initialOf(label: string): string;
/** The flush coordinates of a docked card (8px from its edge), or `null` when it floats free. */
declare function dockedPosition(docked: DockedSide | null | undefined, width: number, viewportWidth: number, top: number): CardPosition | null;
/** What a minimized card shows: the current provider's initial plus one number. */
interface CompactBubble {
  key: string;
  label: string;
  initial: string;
  value: string;
  /** Hover detail explaining the number (raw counts, or why there is none). */
  title: string;
  level: Level;
}
/**
 * The source a minimized card speaks for: the one the current model is spending
 * from, else the first one the active mode shows. `null` when the mode shows
 * nothing at all, which keeps the full card (with its empty state) on screen.
 */
declare function compactSource(response: StateResponse, options: BuildOptions): {
  source: SourceState;
  active: boolean;
} | null;
/**
 * The bubble: the chosen provider's uppercase initial, and under it the one
 * number that matters — a balance amount for a top-up account, the rolling
 * window's used share for a subscription.
 */
declare function compactBubble(response: StateResponse, options: BuildOptions): CompactBubble | null;
//#endregion
export { BuildOptions, CardBlock, CardModel, CardPosition, CardRow, CardSurface, CompactBubble, CornerAnchor, DockedSide, MUTED_DOT, MinimizeCorner, POLL_PRESETS, SnapResult, blockDotColor, buildCard, cardSurface, clampPosition, compactBubble, compactSource, cornerAnchor, dockedPosition, effectiveProvider, errorText, initialOf, minimizeCorner, nextMode, parseStoredPollMs, parseStoredPosition, pollLabel, popoverPlacement, quotaRowText, quotaRowTitle, snapToHorizontalEdge, sourceBlock, summaryCard, visibleSources, windowLabelOf };