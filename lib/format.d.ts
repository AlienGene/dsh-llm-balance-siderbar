import { _ as SourceState, c as Level, d as QuotaWindow, g as SourceSnapshot, i as BalanceThresholds, r as BalanceThresholdRule, u as PercentMode, y as Thresholds } from "./protocol-ziHJjbju.js";
//#region src/format.d.ts
/** `< error` is red, `< warn` is yellow, everything else is blue (the brand accent). */
declare const DEFAULT_THRESHOLDS: Thresholds;
/** Locales this card speaks; the shell's locale dictionary ids. */
type Locale = 'zh' | 'en';
/**
 * Classify a *remaining* percentage into the card's colour tier.
 * An absent or non-finite percentage is `normal`: an unknown reference is not
 * evidence of a low balance, so it must not raise an alarm.
 */
declare function levelOf(remainingPercent: number | null | undefined, thresholds?: Thresholds): Level;
/** The most severe tier among the given ones (error > warn > normal). */
declare function worstLevel(levels: readonly Level[]): Level;
/** Remaining share of one window in percent, or `null` for a degenerate limit. */
declare function remainingPercentOf(remaining: number, limit: number): number | null;
/** Clamp to `[0, 100]` and drop float noise (`94.99999` → `95`). */
declare function clampPercent(value: number): number;
/** ISO currency symbol, falling back to the code for anything unmapped. */
declare function currencySymbol(currency: string): string;
/** `¥95.30`, `$1,024.5`, `12.00 XYZ` — two decimals for the main balance line. */
declare function formatAmount(amount: number, currency: string, digits?: number): string;
/** `95%`, `95.3%`, `4.25%` — at most one decimal, no trailing `.0`. */
declare function formatPercent(percent: number | null | undefined): string;
/** The share a row prints, honouring `percentMode`; colour always uses the remaining share. */
declare function displayPercent(window: QuotaWindow, mode: PercentMode): number | null;
/**
 * Label one rate-limit window from the provider's duration/time unit pair.
 * Kimi Code reports `{duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}` — a rolling
 * five-hour window. The card's own row label is semantic (`频限 / 周 / 月`); this
 * one only ever appears in a row's hover detail.
 */
declare function formatWindowLabel(duration: number, timeUnit: string, locale?: Locale): string;
/**
 * A countdown to a reset instant in compact units, so one row reads
 * `频限（47%） 3d0h0m重置`. Days only appear once a day is left; minutes and
 * hours are always spelled out.
 */
declare function formatCountdown(msRemaining: number, locale?: Locale): string;
/** `刚刚`, `2分钟前`, `3小时前`, `2天前` (or the English equivalents). */
declare function formatRelativeTime(ageMs: number, locale?: Locale): string;
/** One aggregated currency row for the summary mode. */
interface BalanceTotal {
  currency: string;
  total: number;
}
/** Sum every visible balance entry per currency. */
declare function sumBalances(sources: readonly SourceState[]): BalanceTotal[];
/**
 * The threshold rule that governs one balance row, if the user configured one:
 * an exact `<sourceId>:<CURRENCY>` key wins over the `<sourceId>:*` wildcard.
 */
declare function ruleForBalance(sourceId: string, currency: string, rules: BalanceThresholds): BalanceThresholdRule | null;
/**
 * Classify a balance row by absolute amount.
 *
 * An amount has no percentage this card trusts, so the tier comes from the
 * user's own boundaries and defaults to `normal` when none are configured — an
 * unconfigured balance is reported, not judged. A negative balance is an
 * overdraft and always reads as an error.
 */
declare function levelOfBalance(sourceId: string, currency: string, total: number, rules: BalanceThresholds): Level;
/**
 * The tightest window of one source — the one a summary line should show.
 * Absent percentages sort last so a measured window always wins.
 */
declare function tightestWindow(snapshot: SourceSnapshot | undefined): QuotaWindow | null;
//#endregion
export { BalanceTotal, DEFAULT_THRESHOLDS, Locale, clampPercent, currencySymbol, displayPercent, formatAmount, formatCountdown, formatPercent, formatRelativeTime, formatWindowLabel, levelOf, levelOfBalance, remainingPercentOf, ruleForBalance, sumBalances, tightestWindow, worstLevel };