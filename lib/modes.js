import { displayPercent, formatAmount, formatCountdown, formatPercent, formatWindowLabel, levelOf, levelOfBalance, sumBalances, tightestWindow, worstLevel } from "./format.js";
//#region src/modes.ts
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
const MODE_CYCLE = [
	"current",
	"summary",
	"all"
];
/** The mode the icon switches to next. */
function nextMode(mode) {
	const index = MODE_CYCLE.indexOf(mode);
	return MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? "all";
}
/** The provider a `current` card scopes to: the active session's, else the deployment default. */
function effectiveProvider(response, currentProvider) {
	if (currentProvider !== null && currentProvider.length > 0) return currentProvider;
	return response.defaultProvider?.provider ?? null;
}
/** Which sources one mode shows. */
function visibleSources(response, mode, currentProvider) {
	if (mode !== "current") return response.sources;
	const provider = effectiveProvider(response, currentProvider);
	if (provider === null) return response.sources;
	return response.sources.filter((source) => source.providers.includes(provider));
}
/** Build the whole render model. */
function buildCard(response, options) {
	const sources = visibleSources(response, options.mode, options.currentProvider);
	const provider = effectiveProvider(response, options.currentProvider);
	if (sources.length === 0) return {
		blocks: [],
		empty: options.mode === "current" && provider !== null ? options.t("empty.current", { provider }) : options.t("empty"),
		level: "normal"
	};
	if (options.mode === "summary") return summaryCard(sources, options);
	const blocks = sources.map((source) => sourceBlock(source, options, provider));
	return {
		blocks,
		level: worstLevel(blocks.map((block) => block.level))
	};
}
/** One source's detail: a balance row per currency, one line per quota window. */
function sourceBlock(source, options, provider) {
	const { t, locale, percentMode, thresholds, balanceThresholds, now } = options;
	const rows = [];
	const snapshot = source.snapshot;
	if (snapshot !== void 0 && snapshot.kind === "balance") {
		for (const entry of snapshot.entries) rows.push({
			key: `${source.id}:${entry.currency}`,
			text: formatAmount(entry.total, entry.currency),
			level: levelOfBalance(source.id, entry.currency, entry.total, balanceThresholds)
		});
		if (snapshot.note !== void 0) rows.push({
			key: `${source.id}:note`,
			text: t(`note.${snapshot.note}`),
			level: snapshot.note === "unavailable" ? "warn" : "error"
		});
	} else if (snapshot !== void 0 && snapshot.kind === "quota") for (const window of snapshot.windows) rows.push({
		key: `${source.id}:${window.kind}:${window.limit}`,
		text: quotaRowText(window, options),
		title: quotaRowTitle(window, options),
		level: levelOf(window.remainingPercent, thresholds)
	});
	else if (snapshot !== void 0 && snapshot.kind === "unsupported") rows.push({
		key: `${source.id}:unsupported`,
		text: t("note.noUsageApi"),
		...snapshot.detail === void 0 ? {} : { title: snapshot.detail },
		level: "normal"
	});
	return {
		key: source.id,
		label: source.label,
		rows,
		level: worstLevel(rows.map((row) => row.level)),
		...provider === void 0 || provider === null ? {} : { active: source.providers.includes(provider) },
		...source.error === void 0 ? {} : { error: errorText(source.error.code, t) },
		...source.stale === true ? { stale: true } : {}
	};
}
/** The aggregate view: one balance total per currency, one tightest window per subscription. */
function summaryCard(sources, options) {
	const { t, thresholds, balanceThresholds } = options;
	const rows = [];
	for (const total of sumBalances(sources)) {
		const levels = [];
		for (const source of sources) {
			if (source.snapshot === void 0 || source.snapshot.kind !== "balance") continue;
			for (const entry of source.snapshot.entries) {
				if (entry.currency.toUpperCase() !== total.currency) continue;
				levels.push(levelOfBalance(source.id, entry.currency, entry.total, balanceThresholds));
			}
		}
		rows.push({
			key: `total:${total.currency}`,
			text: `${t("summary.balance")} ${formatAmount(total.total, total.currency)}`,
			level: worstLevel(levels)
		});
	}
	for (const source of sources) {
		if (source.snapshot === void 0 || source.snapshot.kind !== "quota") continue;
		const window = tightestWindow(source.snapshot);
		if (window === null) continue;
		rows.push({
			key: `tight:${source.id}`,
			text: `${source.label} ${quotaRowText(window, options)}`,
			title: quotaRowTitle(window, options),
			level: levelOf(window.remainingPercent, thresholds)
		});
	}
	for (const source of sources) {
		if (source.snapshot !== void 0 && source.snapshot.kind === "unsupported") {
			rows.push({
				key: `unsupported:${source.id}`,
				text: `${source.label} ${t("note.noUsageApi")}`,
				level: "normal"
			});
			continue;
		}
		if (source.error === void 0) continue;
		rows.push({
			key: `error:${source.id}`,
			text: `${source.label} ${errorText(source.error.code, t)}`,
			level: "error"
		});
	}
	if (rows.length === 0) return {
		blocks: [],
		empty: t("empty"),
		level: "normal"
	};
	return {
		blocks: [{
			key: "summary",
			label: t("mode.summary"),
			rows,
			level: worstLevel(rows.map((row) => row.level))
		}],
		level: worstLevel(rows.map((row) => row.level))
	};
}
/** Every code this card has copy for; anything else falls back to a generic line. */
const KNOWN_ERROR_CODES = /* @__PURE__ */ new Set([
	"NO_CREDENTIAL",
	"UNAUTHORIZED",
	"TOKEN_EXPIRED",
	"RATE_LIMITED",
	"TIMEOUT",
	"NETWORK",
	"HTTP_ERROR",
	"BAD_RESPONSE",
	"NOT_SUPPORTED"
]);
/** Localized text for one failure code. */
function errorText(code, t) {
	return t(KNOWN_ERROR_CODES.has(code) ? `error.${code}` : "error.UNKNOWN");
}
/** The dot of a source the current model is not drawing on. */
const MUTED_DOT = "var(--dsw-alias-label-secondary)";
/**
* A source block's dot colour.
*
* Being in use wins: the green accent answers "which account is this session
* spending?" — the question the dot now exists for. An idle source still shows
* its alarm tier (its own numbers stay colour-coded either way), and an idle,
* healthy one is muted.
*/
function blockDotColor(level, active, colors) {
	if (active === true) return colors.active;
	if (level !== "normal") return colors[level];
	return MUTED_DOT;
}
/**
* Window labels for the `rate` / `pool` kinds an older host still sends. The
* browser half reloads on its own schedule, so it can face a payload from a
* host that has not restarted yet; naming those kinds beats printing a key.
*/
const LEGACY_WINDOW_LABELS = {
	rate: {
		zh: "频限",
		en: "rolling"
	},
	pool: {
		zh: "周",
		en: "week"
	}
};
/** The localized label of one window, tolerating an older payload's kinds. */
function windowLabelOf(window, options) {
	const { t, locale } = options;
	const key = `window.${window.kind}`;
	const text = t(key);
	if (text !== key) return text;
	const legacy = LEGACY_WINDOW_LABELS[String(window.kind)];
	if (legacy !== void 0) return legacy[locale];
	return String(window.kind);
}
/**
* One subscription window's line: `频限（47%） 3d0h0m重置`.
*
* The share and the countdown are separate dictionary entries so each language
* owns its own punctuation and spacing (`rolling (47%) resets in 3d0h0m`).
*/
function quotaRowText(window, options) {
	const { t, locale, percentMode, now } = options;
	const percent = displayPercent(window, percentMode);
	const share = percent === null ? "" : t(percentMode === "used" ? "used" : "remaining", { percent: formatPercent(percent) });
	const head = `${windowLabelOf(window, options)}${share}`;
	if (window.resetsAt === void 0) return head;
	const reset = t("reset", { time: formatCountdown(window.resetsAt - now, locale) });
	return reset.length === 0 ? head : `${head} ${reset}`;
}
/** One window's hover detail: the raw counts, plus the provider's own window length. */
function quotaRowTitle(window, options) {
	const { t, locale } = options;
	const counts = t("usedOf", {
		used: window.used,
		limit: window.limit,
		remaining: formatPercent(window.remainingPercent)
	});
	if (window.duration === null || window.timeUnit === null) return counts;
	return `${counts} · ${formatWindowLabel(window.duration, window.timeUnit, locale)}`;
}
/**
* The card's own surface for the translucency toggle.
*
* Only the surface dims — the text stays fully opaque — so the card can sit
* quietly over the conversation while its numbers remain readable.
*/
function cardSurface(translucent) {
	return translucent ? {
		opacity: .55,
		blur: 6
	} : {
		opacity: 1,
		blur: 0
	};
}
/** The intervals the TTL chip offers, in ascending order. */
const POLL_PRESETS = [
	6e4,
	3e5,
	18e5,
	36e5
];
/** `60000` → `60s`, `300000` → `5m`, `1800000` → `30m`, `3600000` → `1h`. */
function pollLabel(ms) {
	if (!Number.isFinite(ms) || ms <= 0) return "60s";
	const minutes = Math.round(ms / 6e4);
	if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
	if (minutes >= 2) return `${minutes}m`;
	return `${Math.max(1, Math.round(ms / 1e3))}s`;
}
/** Read the stored poll override; anything unreadable means "use the host default". */
function parseStoredPollMs(value) {
	if (value === null) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1e3) return null;
	return parsed;
}
/** Clamp a position so the card stays fully inside the viewport. */
function clampPosition(pos, width, height, viewportWidth, viewportHeight, margin = 0) {
	const maxLeft = Math.max(margin, viewportWidth - width - margin);
	const maxTop = Math.max(margin, viewportHeight - height - margin);
	return {
		left: Math.min(Math.max(pos.left, margin), maxLeft),
		top: Math.min(Math.max(pos.top, margin), maxTop)
	};
}
/**
* Snap to the nearest horizontal edge when the drop lands within
* `thresholdPx` of it. "Docked" means a fixed 8px margin from that edge; the
* vertical position never changes, so a drag only ever parks the card sideways.
*/
function snapToHorizontalEdge(pos, width, viewportWidth, thresholdPx) {
	const margin = 8;
	if (pos.left < thresholdPx) return {
		position: {
			left: margin,
			top: pos.top
		},
		docked: "left"
	};
	if (viewportWidth - (pos.left + width) < thresholdPx) return {
		position: {
			left: viewportWidth - width - margin,
			top: pos.top
		},
		docked: "right"
	};
	return {
		position: pos,
		docked: null
	};
}
/**
* Read the stored position; missing or malformed values mean the default corner.
* A record written before v0.6 has no `docked`, which reads as "floats free".
*/
function parseStoredPosition(value) {
	if (value === null) return null;
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed.left !== "number" || !Number.isFinite(parsed.left)) return null;
		if (typeof parsed.top !== "number" || !Number.isFinite(parsed.top)) return null;
		const docked = parsed.docked === "left" || parsed.docked === "right" ? parsed.docked : null;
		return {
			left: parsed.left,
			top: parsed.top,
			docked
		};
	} catch {
		return null;
	}
}
/**
* The interval list opens above the card by default (it lives in the corner);
* near the viewport's top edge it flips below so it never clips offscreen.
*/
function popoverPlacement(cardTopPx, popoverHeightPx) {
	return cardTopPx >= popoverHeightPx + 16 ? "above" : "below";
}
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
function minimizeCorner(docked, topPx, viewportHeightPx) {
	if (docked !== "left" && docked !== "right") return null;
	const lowerHalf = Number.isFinite(topPx) && Number.isFinite(viewportHeightPx) && topPx >= viewportHeightPx / 2;
	if (docked === "left") return lowerHalf ? "top-left" : "bottom-left";
	return lowerHalf ? "top-right" : "bottom-right";
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
function cornerAnchor(corner, cardTopPx, cardHeightPx, viewportHeightPx, size = 22, gap = 6) {
	const outward = size + gap;
	const horizontal = corner === "top-left" || corner === "bottom-left" ? { left: -gap } : { right: -gap };
	const measurable = Number.isFinite(cardTopPx) && Number.isFinite(viewportHeightPx) && Number.isFinite(cardHeightPx);
	if (corner === "top-left" || corner === "top-right") {
		const roomAbove = measurable && cardTopPx >= outward + 2;
		return {
			...horizontal,
			top: roomAbove ? -outward : gap
		};
	}
	const roomBelow = measurable && cardHeightPx > 0 && cardTopPx + cardHeightPx <= viewportHeightPx - outward - 2;
	return {
		...horizontal,
		bottom: roomBelow ? -outward : gap
	};
}
/** First letter of a provider label, uppercased; a non-Latin label keeps its first code point. */
function initialOf(label) {
	const trimmed = label.trim();
	if (trimmed.length === 0) return "?";
	return (Array.from(trimmed)[0] ?? "?").toUpperCase();
}
/** The flush coordinates of a docked card (8px from its edge), or `null` when it floats free. */
function dockedPosition(docked, width, viewportWidth, top) {
	const margin = 8;
	if (docked === "left") return {
		left: margin,
		top,
		docked: "left"
	};
	if (docked === "right") return {
		left: Math.max(margin, viewportWidth - width - margin),
		top,
		docked: "right"
	};
	return null;
}
/**
* The source a minimized card speaks for: the one the current model is spending
* from, else the first one the active mode shows. `null` when the mode shows
* nothing at all, which keeps the full card (with its empty state) on screen.
*/
function compactSource(response, options) {
	const sources = visibleSources(response, options.mode, options.currentProvider);
	const first = sources[0];
	if (first === void 0) return null;
	const provider = effectiveProvider(response, options.currentProvider);
	if (provider !== null) {
		const active = sources.find((source) => source.providers.includes(provider));
		if (active !== void 0) return {
			source: active,
			active: true
		};
	}
	return {
		source: first,
		active: false
	};
}
/**
* The bubble: the chosen provider's uppercase initial, and under it the one
* number that matters — a balance amount for a top-up account, the rolling
* window's used share for a subscription.
*/
function compactBubble(response, options) {
	const chosen = compactSource(response, options);
	if (chosen === null) return null;
	const { source } = chosen;
	const base = {
		key: source.id,
		label: source.label,
		initial: initialOf(source.label)
	};
	const snapshot = source.snapshot;
	if (snapshot !== void 0 && snapshot.kind === "balance") {
		const entry = snapshot.entries[0];
		if (entry === void 0) return {
			...base,
			value: "—",
			title: source.label,
			level: "normal"
		};
		return {
			...base,
			value: formatAmount(entry.total, entry.currency),
			title: source.label,
			level: levelOfBalance(source.id, entry.currency, entry.total, options.balanceThresholds)
		};
	}
	if (snapshot !== void 0 && snapshot.kind === "quota") {
		const window = snapshot.windows.find((window) => window.kind === "rolling") ?? tightestWindow(snapshot);
		if (window === void 0 || window === null) return {
			...base,
			value: "—",
			title: source.label,
			level: "normal"
		};
		const percent = displayPercent(window, options.percentMode);
		return {
			...base,
			value: percent === null ? "—" : formatPercent(percent),
			title: quotaRowTitle(window, options),
			level: levelOf(window.remainingPercent, options.thresholds)
		};
	}
	return {
		...base,
		value: "—",
		title: options.t("note.noUsageApi"),
		level: "normal"
	};
}
//#endregion
export { MUTED_DOT, POLL_PRESETS, blockDotColor, buildCard, cardSurface, clampPosition, compactBubble, compactSource, cornerAnchor, dockedPosition, effectiveProvider, errorText, initialOf, minimizeCorner, nextMode, parseStoredPollMs, parseStoredPosition, pollLabel, popoverPlacement, quotaRowText, quotaRowTitle, snapToHorizontalEdge, sourceBlock, summaryCard, visibleSources, windowLabelOf };
