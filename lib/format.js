//#region src/format.ts
/** `< error` is red, `< warn` is yellow, everything else is blue (the brand accent). */
const DEFAULT_THRESHOLDS = {
	warn: 40,
	error: 20
};
/**
* Classify a *remaining* percentage into the card's colour tier.
* An absent or non-finite percentage is `normal`: an unknown reference is not
* evidence of a low balance, so it must not raise an alarm.
*/
function levelOf(remainingPercent, thresholds = DEFAULT_THRESHOLDS) {
	if (remainingPercent === null || remainingPercent === void 0) return "normal";
	if (!Number.isFinite(remainingPercent)) return "normal";
	if (remainingPercent < thresholds.error) return "error";
	if (remainingPercent < thresholds.warn) return "warn";
	return "normal";
}
/** The most severe tier among the given ones (error > warn > normal). */
function worstLevel(levels) {
	if (levels.includes("error")) return "error";
	if (levels.includes("warn")) return "warn";
	return "normal";
}
/** Remaining share of one window in percent, or `null` for a degenerate limit. */
function remainingPercentOf(remaining, limit) {
	if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return null;
	return clampPercent(remaining / limit * 100);
}
/** Clamp to `[0, 100]` and drop float noise (`94.99999` → `95`). */
function clampPercent(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}
/** ISO currency symbol, falling back to the code for anything unmapped. */
function currencySymbol(currency) {
	const code = currency.toUpperCase();
	if (code === "CNY" || code === "RMB") return "¥";
	if (code === "USD") return "$";
	if (code === "EUR") return "€";
	return "";
}
/** `¥95.30`, `$1,024.5`, `12.00 XYZ` — two decimals for the main balance line. */
function formatAmount(amount, currency, digits = 2) {
	if (!Number.isFinite(amount)) return "—";
	const text = amount.toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
	const symbol = currencySymbol(currency);
	return symbol.length > 0 ? `${symbol}${text}` : `${text} ${currency.toUpperCase()}`;
}
/** `95%`, `95.3%`, `4.25%` — at most one decimal, no trailing `.0`. */
function formatPercent(percent) {
	if (percent === null || percent === void 0 || !Number.isFinite(percent)) return "—";
	const rounded = Math.round(percent * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
/** The share a row prints, honouring `percentMode`; colour always uses the remaining share. */
function displayPercent(window, mode) {
	if (mode === "used") return window.limit > 0 ? clampPercent(window.used / window.limit * 100) : null;
	return window.remainingPercent;
}
/**
* Label one rate-limit window from the provider's duration/time unit pair.
* Kimi Code reports `{duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}` — a rolling
* five-hour window. The card's own row label is semantic (`频限 / 周 / 月`); this
* one only ever appears in a row's hover detail.
*/
function formatWindowLabel(duration, timeUnit, locale = "zh") {
	const unit = timeUnit.replace(/^TIME_UNIT_/, "").toLowerCase();
	if (!Number.isFinite(duration) || duration <= 0) return locale === "zh" ? "窗口" : "window";
	if (unit === "minute") {
		if (duration % 1440 === 0) return unitLabel(duration / 1440, "day", locale);
		if (duration % 60 === 0) return unitLabel(duration / 60, "hour", locale);
		return unitLabel(duration, "minute", locale);
	}
	if (unit === "hour") return unitLabel(duration, "hour", locale);
	if (unit === "day") return unitLabel(duration, "day", locale);
	if (unit === "week") return unitLabel(duration, "week", locale);
	if (unit === "second") return unitLabel(duration, "second", locale);
	return locale === "zh" ? `${duration} ${timeUnit}` : `${duration} ${unit}`;
}
function unitLabel(count, unit, locale) {
	return locale === "zh" ? `${count}${{
		minute: "分钟",
		hour: "小时",
		day: "天",
		week: "周",
		second: "秒"
	}[unit]}` : `${count}${{
		minute: "m",
		hour: "h",
		day: "d",
		week: "w",
		second: "s"
	}[unit]}`;
}
/**
* A countdown to a reset instant in compact units, so one row reads
* `频限（47%） 3d0h0m重置`. Days only appear once a day is left; minutes and
* hours are always spelled out.
*/
function formatCountdown(msRemaining, locale = "zh") {
	if (!Number.isFinite(msRemaining) || msRemaining <= 0) return locale === "zh" ? "已到期" : "due now";
	const totalMinutes = Math.floor(msRemaining / 6e4);
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor(totalMinutes % 1440 / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d${hours}h${minutes}m`;
	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return "<1m";
}
/** `刚刚`, `2分钟前`, `3小时前`, `2天前` (or the English equivalents). */
function formatRelativeTime(ageMs, locale = "zh") {
	if (!Number.isFinite(ageMs) || ageMs < 0) return locale === "zh" ? "—" : "—";
	const minutes = Math.floor(ageMs / 6e4);
	if (minutes < 1) return locale === "zh" ? "刚刚" : "just now";
	if (minutes < 60) return locale === "zh" ? `${minutes}分钟前` : `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return locale === "zh" ? `${hours}小时前` : `${hours}h ago`;
	return locale === "zh" ? `${Math.floor(hours / 24)}天前` : `${Math.floor(hours / 24)}d ago`;
}
/** Sum every visible balance entry per currency. */
function sumBalances(sources) {
	const byCurrency = /* @__PURE__ */ new Map();
	for (const source of sources) {
		const snapshot = source.snapshot;
		if (snapshot === void 0 || snapshot.kind !== "balance") continue;
		for (const entry of snapshot.entries) {
			const key = entry.currency.toUpperCase();
			const running = byCurrency.get(key) ?? 0;
			byCurrency.set(key, running + (Number.isFinite(entry.total) ? entry.total : 0));
		}
	}
	return [...byCurrency.entries()].map(([currency, total]) => ({
		currency,
		total
	}));
}
/**
* The threshold rule that governs one balance row, if the user configured one:
* an exact `<sourceId>:<CURRENCY>` key wins over the `<sourceId>:*` wildcard.
*/
function ruleForBalance(sourceId, currency, rules) {
	const exact = rules[`${sourceId}:${currency.toUpperCase()}`];
	if (exact !== void 0) return exact;
	return rules[`${sourceId}:*`] ?? null;
}
/**
* Classify a balance row by absolute amount.
*
* An amount has no percentage this card trusts, so the tier comes from the
* user's own boundaries and defaults to `normal` when none are configured — an
* unconfigured balance is reported, not judged. A negative balance is an
* overdraft and always reads as an error.
*/
function levelOfBalance(sourceId, currency, total, rules) {
	if (!Number.isFinite(total)) return "normal";
	if (total < 0) return "error";
	const rule = ruleForBalance(sourceId, currency, rules);
	if (rule === null) return "normal";
	if (rule.errorBelow !== void 0 && total < rule.errorBelow) return "error";
	if (rule.warnBelow !== void 0 && total < rule.warnBelow) return "warn";
	return "normal";
}
/**
* The tightest window of one source — the one a summary line should show.
* Absent percentages sort last so a measured window always wins.
*/
function tightestWindow(snapshot) {
	if (snapshot === void 0 || snapshot.kind !== "quota" || snapshot.windows.length === 0) return null;
	let best = null;
	for (const window of snapshot.windows) {
		if (best === null) {
			best = window;
			continue;
		}
		if (window.remainingPercent < best.remainingPercent) best = window;
	}
	return best;
}
//#endregion
export { DEFAULT_THRESHOLDS, clampPercent, currencySymbol, displayPercent, formatAmount, formatCountdown, formatPercent, formatRelativeTime, formatWindowLabel, levelOf, levelOfBalance, remainingPercentOf, ruleForBalance, sumBalances, tightestWindow, worstLevel };
