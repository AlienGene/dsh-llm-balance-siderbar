window.__ModuleLoader__.load({
	id: "dsh-llm-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#region src/client/api.ts
		/** Path of the host route this card reads. */
		const STATE_PATH = "dsh-llm-balance/state";
		/** Resolve the state URL against the directory the shell served this bundle from. */
		function stateUrl() {
			if (typeof document === "undefined") return `/${STATE_PATH}`;
			return new URL(STATE_PATH, document.baseURI).pathname;
		}
		/** Read one state payload. */
		async function fetchState(signal) {
			const response = await fetch(stateUrl(), {
				method: "GET",
				headers: { accept: "application/json" },
				credentials: "same-origin",
				...signal === void 0 ? {} : { signal }
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = await response.json();
			if (payload.ok !== true || !Array.isArray(payload.sources)) throw new Error("unexpected payload");
			return payload;
		}
		//#endregion
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
		//#region src/client/BalanceCard.tsx
		/**
		* The corner card.
		*
		* Rendered inside the shell's `shell.overlay` seat, which is a click-through
		* layer above every column: this component opts back into pointer events and
		* pins itself to the bottom-right corner. It polls the host route on the
		* interval the host suggests, re-reads on tab focus, and counts reset windows
		* down locally so a countdown never costs a request.
		*
		* @module dsh-llm-balance/client/BalanceCard
		*/
		/** Colour tiers used before the first payload arrives. */
		const FALLBACK_COLORS = {
			normal: "var(--dsw-alias-brand-primary)",
			warn: "var(--dsw-alias-state-warn-primary)",
			error: "var(--dsw-alias-state-error-primary)",
			active: "var(--dsw-alias-state-success-primary)"
		};
		const MODE_GLYPH = {
			current: "◉",
			summary: "≣",
			all: "☰"
		};
		/** Poll cadence before the host has told us better. */
		const FALLBACK_REFRESH_MS = 6e4;
		/** Local countdown tick; no network behind it. */
		const TICK_MS = 3e4;
		const MODE_STORAGE_KEY = "dsh-llm-balance:mode";
		const COLLAPSED_STORAGE_KEY = "dsh-llm-balance:collapsed";
		const TRANSLUCENT_STORAGE_KEY = "dsh-llm-balance:translucent";
		const POLL_STORAGE_KEY = "dsh-llm-balance:pollMs";
		const POSITION_STORAGE_KEY = "dsh-llm-balance:position";
		const MINIMIZED_STORAGE_KEY = "dsh-llm-balance:minimized";
		const CARD = {
			position: "fixed",
			right: 14,
			bottom: 14,
			zIndex: 9500,
			pointerEvents: "auto",
			minWidth: 240,
			maxWidth: 340,
			padding: "8px 10px",
			color: "var(--dsw-alias-label-primary)",
			font: "12px/1.45 ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
			cursor: "pointer",
			userSelect: "none"
		};
		/**
		* The painted surface, in its own layer behind the text: only this dims when the
		* translucent toggle is on, so the numbers stay fully readable.
		*/
		const SURFACE = {
			position: "absolute",
			inset: 0,
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)",
			pointerEvents: "none"
		};
		const CONTENT = { position: "relative" };
		const HEADER = {
			display: "flex",
			alignItems: "center",
			gap: 6
		};
		const DOT = {
			width: 6,
			height: 6,
			borderRadius: "50%",
			flex: "0 0 auto"
		};
		/** The whole title row is the drag handle: grab cursor, and no text selection mid-drag. */
		const TITLE = {
			fontWeight: 600,
			flex: "1 1 auto",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
			cursor: "grab",
			touchAction: "none",
			userSelect: "none"
		};
		const ICON_BUTTON = {
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer",
			padding: "0 2px",
			font: "inherit",
			lineHeight: 1
		};
		const BLOCK = {
			marginTop: 6,
			paddingTop: 6,
			borderTop: "1px solid var(--dsw-alias-border-l1)"
		};
		const BLOCK_HEAD = {
			display: "flex",
			alignItems: "center",
			gap: 6
		};
		const BLOCK_LABEL = {
			fontWeight: 600,
			flex: "1 1 auto",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const CHIP = {
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 999,
			padding: "0 6px",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			whiteSpace: "nowrap"
		};
		const ROW = {
			marginTop: 3,
			paddingLeft: 12,
			whiteSpace: "normal",
			wordBreak: "break-word"
		};
		const EMPTY = {
			marginTop: 6,
			color: "var(--dsw-alias-label-secondary)"
		};
		const TTL_CHIP = {
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 999,
			padding: "0 6px",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			whiteSpace: "nowrap",
			cursor: "pointer",
			background: "transparent",
			font: "inherit",
			lineHeight: 1.5
		};
		/** The interval list, anchored to the card and opening above (or below near the top edge). */
		const POPOVER_BASE = {
			position: "absolute",
			right: 8,
			zIndex: 9501,
			minWidth: 72,
			padding: 4,
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)"
		};
		const POPOVER_ITEM = {
			display: "block",
			width: "100%",
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer",
			padding: "4px 10px",
			borderRadius: 6,
			font: "inherit",
			textAlign: "left",
			whiteSpace: "nowrap"
		};
		/** The minimize control, floating clear of the corner of a docked card. */
		const CORNER_BUTTON = {
			position: "absolute",
			zIndex: 9502,
			width: 22,
			height: 22,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 0,
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 7,
			background: "var(--dsw-alias-bg-overlay)",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 14,
			lineHeight: 1,
			cursor: "pointer"
		};
		/** The minimized card: a narrow pill pinned to the docked edge. */
		const BUBBLE = {
			position: "fixed",
			zIndex: 9500,
			pointerEvents: "auto",
			padding: "6px 9px",
			color: "var(--dsw-alias-label-primary)",
			font: "12px/1.3 ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
			userSelect: "none",
			cursor: "pointer"
		};
		/** The current provider's initial. The whole bubble is the restore target. */
		const BUBBLE_INITIAL = {
			font: "600 15px/1.1 ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
			textAlign: "center"
		};
		const BUBBLE_VALUE = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 11,
			textAlign: "center",
			whiteSpace: "nowrap"
		};
		function readStorage(key) {
			try {
				return window.localStorage.getItem(key);
			} catch {
				return null;
			}
		}
		function writeStorage(key, value) {
			try {
				window.localStorage.setItem(key, value);
			} catch {}
		}
		function removeStorage(key) {
			try {
				window.localStorage.removeItem(key);
			} catch {}
		}
		/** Which of the two dictionaries the active shell locale needs. */
		function resolveLocale(value) {
			return (typeof value === "string" && value.length > 0 ? value : typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "en").toLowerCase().startsWith("zh") ? "zh" : "en";
		}
		/** The active session's provider, read from the `modelSelection` projection. */
		function selectCurrentProvider(state) {
			const id = state?.current;
			if (typeof id !== "string" || id.length === 0) return null;
			const selection = state?.byId?.[id]?.projectionValues?.modelSelection;
			const provider = (selection?.next ?? selection?.lastUsed ?? null)?.provider;
			return typeof provider === "string" && provider.length > 0 ? provider : null;
		}
		/** One rendered line: the whole row text, left aligned, with optional hover detail. */
		function RowView({ row }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: ROW,
				title: row.title,
				children: row.text
			});
		}
		/** The bottom-right balance / quota card. */
		function BalanceCard(props) {
			const { t } = props;
			const [loaded, setLoaded] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const [mode, setMode] = (0, react.useState)(() => readStorage(MODE_STORAGE_KEY));
			const [collapsed, setCollapsed] = (0, react.useState)(() => readStorage(COLLAPSED_STORAGE_KEY) === "1");
			const [translucent, setTranslucent] = (0, react.useState)(() => readStorage(TRANSLUCENT_STORAGE_KEY) === "1");
			const [pollMs, setPollMs] = (0, react.useState)(() => parseStoredPollMs(readStorage(POLL_STORAGE_KEY)));
			const [ttlOpen, setTtlOpen] = (0, react.useState)(false);
			const [popoverSide, setPopoverSide] = (0, react.useState)("above");
			const [position, setPosition] = (0, react.useState)(() => parseStoredPosition(readStorage(POSITION_STORAGE_KEY)));
			const [dragging, setDragging] = (0, react.useState)(false);
			const [minimized, setMinimized] = (0, react.useState)(() => readStorage(MINIMIZED_STORAGE_KEY) === "1");
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const cardRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			/** Set while a pointer moved enough to be a drag; the release click must not refresh. */
			const didDragRef = (0, react.useRef)(false);
			const response = loaded?.response ?? null;
			const refreshMs = pollMs ?? response?.refreshMs ?? FALLBACK_REFRESH_MS;
			const useSessions = props.useSessions;
			const currentProvider = useSessions === void 0 ? null : useSessions(selectCurrentProvider);
			const load = (0, react.useCallback)(async () => {
				try {
					const next = await fetchState();
					setLoaded({
						response: next,
						at: Date.now()
					});
					setFailure(null);
					setNow(Date.now());
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				}
			}, []);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const run = () => {
					if (!cancelled) load();
				};
				run();
				const timer = window.setInterval(run, refreshMs);
				const onVisible = () => {
					if (document.visibilityState === "visible") run();
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [load, refreshMs]);
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
				return () => window.clearInterval(timer);
			}, []);
			(0, react.useEffect)(() => {
				if (!ttlOpen) return;
				const onPointerDown = (event) => {
					const card = cardRef.current;
					if (card !== null && event.target instanceof Node && !card.contains(event.target)) setTtlOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setTtlOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [ttlOpen]);
			(0, react.useEffect)(() => {
				const onResize = () => {
					setPosition((pos) => {
						if (pos === null) return pos;
						const card = cardRef.current;
						if (card === null) return pos;
						const rect = card.getBoundingClientRect();
						const clamped = clampPosition(dockedPosition(pos.docked, rect.width, window.innerWidth, pos.top) ?? pos, rect.width, rect.height, window.innerWidth, window.innerHeight, 8);
						const next = {
							left: clamped.left,
							top: clamped.top,
							docked: pos.docked ?? null
						};
						return next.left === pos.left && next.top === pos.top ? pos : next;
					});
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);
			const activeMode = mode ?? response?.defaultMode ?? "all";
			const locale = resolveLocale(props.locale);
			const colors = {
				...FALLBACK_COLORS,
				...response?.colors ?? {}
			};
			const model = (0, react.useMemo)(() => {
				if (response === null) return null;
				return buildCard(response, {
					mode: activeMode,
					currentProvider,
					locale,
					percentMode: response.percentMode,
					thresholds: response.thresholds,
					balanceThresholds: response.balanceThresholds ?? {},
					now,
					t
				});
			}, [
				response,
				activeMode,
				currentProvider,
				locale,
				now,
				t
			]);
			const cycleMode = () => {
				const next = nextMode(activeMode);
				setMode(next);
				writeStorage(MODE_STORAGE_KEY, next);
			};
			const surface = cardSurface(translucent);
			const levelColor = (level) => colors[level] ?? FALLBACK_COLORS[level];
			const docked = position === null ? null : position.docked ?? null;
			const bubble = (0, react.useMemo)(() => {
				if (response === null) return null;
				return compactBubble(response, {
					mode: activeMode,
					currentProvider,
					locale,
					percentMode: response.percentMode,
					thresholds: response.thresholds,
					balanceThresholds: response.balanceThresholds ?? {},
					now,
					t
				});
			}, [
				response,
				activeMode,
				currentProvider,
				locale,
				now,
				t
			]);
			const minimizeCard = (event) => {
				event.stopPropagation();
				setTtlOpen(false);
				setMinimized(true);
				writeStorage(MINIMIZED_STORAGE_KEY, "1");
			};
			const restoreCard = () => {
				setMinimized(false);
				removeStorage(MINIMIZED_STORAGE_KEY);
			};
			const onTitlePointerDown = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setTtlOpen(false);
				const card = cardRef.current;
				if (card === null) return;
				const rect = card.getBoundingClientRect();
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					originX: rect.left,
					originY: rect.top
				};
				event.currentTarget.setPointerCapture(event.pointerId);
				setDragging(true);
			};
			const onTitlePointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null || event.pointerId !== drag.pointerId) return;
				const dx = event.clientX - drag.startX;
				const dy = event.clientY - drag.startY;
				if (Math.abs(dx) + Math.abs(dy) > 4) didDragRef.current = true;
				const card = cardRef.current;
				if (card === null) return;
				const rect = card.getBoundingClientRect();
				setPosition(clampPosition({
					left: drag.originX + dx,
					top: drag.originY + dy
				}, rect.width, rect.height, window.innerWidth, window.innerHeight));
			};
			const onTitlePointerUp = (event) => {
				const drag = dragRef.current;
				if (drag === null || event.pointerId !== drag.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				const card = cardRef.current;
				if (card === null) return;
				const rect = card.getBoundingClientRect();
				const snapped = snapToHorizontalEdge({
					left: rect.left,
					top: rect.top
				}, rect.width, window.innerWidth, 48);
				const clamped = clampPosition(snapped.position, rect.width, rect.height, window.innerWidth, window.innerHeight, 8);
				const next = {
					left: clamped.left,
					top: clamped.top,
					docked: snapped.docked
				};
				setPosition(next);
				writeStorage(POSITION_STORAGE_KEY, JSON.stringify(next));
			};
			const onTitleDoubleClick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				removeStorage(POSITION_STORAGE_KEY);
				setPosition(null);
			};
			const toggleTtl = (event) => {
				event.stopPropagation();
				if (!ttlOpen) {
					const rect = cardRef.current?.getBoundingClientRect();
					setPopoverSide(popoverPlacement(rect?.top ?? 600, 124));
				}
				setTtlOpen((open) => !open);
			};
			const choosePollMs = (ms) => {
				setPollMs(ms);
				writeStorage(POLL_STORAGE_KEY, String(ms));
				setTtlOpen(false);
			};
			const cardStyle = position === null ? CARD : {
				...CARD,
				right: "auto",
				bottom: "auto",
				left: position.left,
				top: position.top,
				...dragging ? {} : { transition: "left 150ms ease, top 150ms ease" }
			};
			const headerLevel = model?.level ?? (failure === null ? "normal" : "error");
			const updated = loaded === null ? t("meta.loading") : formatRelativeTime(now - loaded.at, locale);
			const corner = minimizeCorner(docked, position?.top ?? 0, window.innerHeight);
			if (minimized && docked !== null && bubble !== null) {
				const top = clampPosition({
					left: 0,
					top: position?.top ?? 0
				}, 72, 56, window.innerWidth, window.innerHeight, 8).top;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...BUBBLE,
						top,
						...docked === "left" ? { left: 8 } : { right: 8 }
					},
					title: t("restore"),
					role: "button",
					tabIndex: 0,
					"aria-label": t("restore"),
					onClick: restoreCard,
					onKeyDown: (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						restoreCard();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						style: {
							...SURFACE,
							...translucent ? {
								opacity: surface.opacity,
								backdropFilter: `blur(${surface.blur}px)`,
								WebkitBackdropFilter: `blur(${surface.blur}px)`,
								boxShadow: "none"
							} : {}
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...CONTENT,
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 2
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...BUBBLE_INITIAL,
								color: levelColor(bubble.level)
							},
							children: bubble.initial
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: BUBBLE_VALUE,
							title: bubble.title,
							children: bubble.value
						})]
					})]
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				style: cardStyle,
				onClick: () => {
					if (didDragRef.current) {
						didDragRef.current = false;
						return;
					}
					load();
				},
				title: t("meta.clickRefresh"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						style: {
							...SURFACE,
							...translucent ? {
								opacity: surface.opacity,
								backdropFilter: `blur(${surface.blur}px)`,
								WebkitBackdropFilter: `blur(${surface.blur}px)`,
								boxShadow: "none"
							} : {}
						}
					}),
					minimized ? null : corner === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: {
							...CORNER_BUTTON,
							...cornerAnchor(corner, position?.top ?? 0, cardRef.current?.getBoundingClientRect().height ?? 0, window.innerHeight)
						},
						"aria-label": t("minimize"),
						title: t("minimize"),
						onClick: minimizeCard,
						children: docked === "left" ? "‹" : "›"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: CONTENT,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: HEADER,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										...DOT,
										background: levelColor(headerLevel)
									} }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: TITLE,
										title: t("drag"),
										onPointerDown: onTitlePointerDown,
										onPointerMove: onTitlePointerMove,
										onPointerUp: onTitlePointerUp,
										onClick: (event) => {
											event.stopPropagation();
											if (didDragRef.current) {
												didDragRef.current = false;
												return;
											}
											const next = !collapsed;
											setCollapsed(next);
											writeStorage(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
										},
										onDoubleClick: onTitleDoubleClick,
										children: t("title")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: ICON_BUTTON,
										"aria-label": t("mode", { mode: t(`mode.${activeMode}`) }),
										title: t("mode", { mode: t(`mode.${activeMode}`) }),
										onClick: (event) => {
											event.stopPropagation();
											cycleMode();
										},
										children: MODE_GLYPH[activeMode]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...ICON_BUTTON,
											color: translucent ? levelColor("normal") : ICON_BUTTON.color
										},
										"aria-label": t("transparent", { state: t(translucent ? "state.on" : "state.off") }),
										"aria-pressed": translucent,
										title: t("transparent", { state: t(translucent ? "state.on" : "state.off") }),
										onClick: (event) => {
											event.stopPropagation();
											const next = !translucent;
											setTranslucent(next);
											writeStorage(TRANSLUCENT_STORAGE_KEY, next ? "1" : "0");
										},
										children: "▦"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: ICON_BUTTON,
										"aria-label": t("refresh"),
										title: t("refresh"),
										onClick: (event) => {
											event.stopPropagation();
											load();
										},
										children: "↻"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: TTL_CHIP,
										"aria-haspopup": "listbox",
										"aria-expanded": ttlOpen,
										"aria-label": t("ttl", { interval: pollLabel(refreshMs) }),
										title: t("ttl.hint", {
											interval: pollLabel(refreshMs),
											age: updated
										}),
										onClick: toggleTtl,
										children: pollLabel(refreshMs)
									})
								]
							}),
							ttlOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								role: "listbox",
								"aria-label": t("ttl", { interval: pollLabel(refreshMs) }),
								style: {
									...POPOVER_BASE,
									...popoverSide === "above" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }
								},
								children: POLL_PRESETS.map((ms) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "option",
									"aria-selected": refreshMs === ms,
									style: {
										...POPOVER_ITEM,
										...refreshMs === ms ? {
											color: levelColor("normal"),
											fontWeight: 600
										} : {}
									},
									onClick: (event) => {
										event.stopPropagation();
										choosePollMs(ms);
									},
									children: pollLabel(ms)
								}, ms))
							}) : null,
							collapsed ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								failure !== null && response === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										...EMPTY,
										color: levelColor("error")
									},
									children: t("error.NETWORK")
								}) : null,
								response === null && failure === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: EMPTY,
									children: t("meta.loading")
								}) : null,
								model !== null && model.empty !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: EMPTY,
									children: model.empty
								}) : null,
								model?.blocks.map((block) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: BLOCK,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: BLOCK_HEAD,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														...DOT,
														background: blockDotColor(block.level, block.active, colors)
													},
													title: block.active === true ? t("active") : void 0
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: BLOCK_LABEL,
													children: block.label
												}),
												block.stale === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: CHIP,
													children: t("meta.stale")
												}) : null
											]
										}),
										block.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												...ROW,
												color: levelColor("error")
											},
											children: block.error
										}) : null,
										block.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: { color: levelColor(row.level) },
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowView, { row })
										}, row.key))
									]
								}, block.key))
							] })
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* This plugin's own dictionary. The shell merges it under the
		* `dsh-llm-balance` namespace; `{name}` placeholders are interpolated by the
		* locale service.
		*
		* @module dsh-llm-balance/client/locales
		*/
		const DICT_ZH = {
			label: "LLM 额度",
			title: "LLM 额度",
			mode: "显示范围：{mode}（点击切换）",
			"mode.current": "当前模型",
			"mode.summary": "整体汇总",
			"mode.all": "所有来源",
			refresh: "刷新",
			"meta.updated": "{age}更新",
			"meta.stale": "缓存",
			"meta.loading": "查询中…",
			"meta.clickRefresh": "点击卡片刷新",
			remaining: "（{percent}）",
			used: "（{percent}）",
			"usedOf": "已用 {used}/{limit}；剩余 {remaining}",
			reset: "{time}重置",
			"window.rolling": "频限",
			"window.week": "周",
			"window.month": "月",
			"window.day": "日",
			"summary.balance": "合计余额",
			"note.deficit": "欠费",
			"note.unavailable": "余额不可用",
			"note.noUsageApi": "无额度接口",
			transparent: "半透明背景：{state}",
			"state.on": "开",
			"state.off": "关",
			ttl: "更新间隔 {interval}",
			"ttl.hint": "间隔 {interval} · {age}更新 · 点击修改间隔",
			drag: "拖动移动 · 单击折叠 · 双击复位",
			minimize: "收缩为字母气泡",
			restore: "点击气泡任意位置恢复卡片",
			active: "当前使用中",
			empty: "暂无已接入的额度来源",
			"empty.current": "{provider} 暂无额度来源",
			"error.NO_CREDENTIAL": "未配置凭证",
			"error.UNAUTHORIZED": "密钥无效",
			"error.TOKEN_EXPIRED": "登录已过期，请用 Kimi CLI 重新登录",
			"error.RATE_LIMITED": "请求过于频繁",
			"error.TIMEOUT": "请求超时",
			"error.NETWORK": "网络错误",
			"error.HTTP_ERROR": "接口返回错误",
			"error.BAD_RESPONSE": "返回格式异常",
			"error.NOT_SUPPORTED": "不支持该接口",
			"error.UNKNOWN": "读取失败"
		};
		const DICT_EN = {
			label: "LLM usage",
			title: "LLM usage",
			mode: "Showing: {mode} (click to switch)",
			"mode.current": "current model",
			"mode.summary": "summary",
			"mode.all": "all sources",
			refresh: "Refresh",
			"meta.updated": "updated {age}",
			"meta.stale": "cached",
			"meta.loading": "loading…",
			"meta.clickRefresh": "click the card to refresh",
			remaining: " ({percent})",
			used: " ({percent})",
			"usedOf": "{used}/{limit} used · {remaining} left",
			reset: "resets in {time}",
			"window.rolling": "rolling",
			"window.week": "week",
			"window.month": "month",
			"window.day": "day",
			"summary.balance": "Total balance",
			"note.deficit": "in deficit",
			"note.unavailable": "balance unusable",
			"note.noUsageApi": "no usage API",
			transparent: "Translucent background: {state}",
			"state.on": "on",
			"state.off": "off",
			ttl: "every {interval}",
			"ttl.hint": "every {interval} · updated {age} · click to change",
			drag: "drag to move · click to collapse · double-click to reset",
			minimize: "collapse to a letter bubble",
			restore: "click anywhere on the bubble to restore the card",
			active: "in use",
			empty: "No configured usage source",
			"empty.current": "No usage source for {provider}",
			"error.NO_CREDENTIAL": "no credential",
			"error.UNAUTHORIZED": "invalid key",
			"error.TOKEN_EXPIRED": "session expired — sign in with the Kimi CLI",
			"error.RATE_LIMITED": "rate limited",
			"error.TIMEOUT": "timed out",
			"error.NETWORK": "network error",
			"error.HTTP_ERROR": "endpoint error",
			"error.BAD_RESPONSE": "unexpected response",
			"error.NOT_SUPPORTED": "not supported",
			"error.UNKNOWN": "read failed"
		};
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-llm-balance — browser half.
		*
		* Registers one occupant in the shell's `shell.overlay` seat (the frame-wide
		* floating layer the shipped UI documents as the home for "a badge, a toast
		* stack or a status pill") and its zh/en dictionary. The seat's component
		* receives this plugin's bound translator, so every string follows the active
		* locale without any global state.
		*
		* @module dsh-llm-balance/client
		*/
		/** Stable Cordis plugin name; must match the host half and the bundle id. */
		const name = "dsh-llm-balance";
		/** Services this half needs before `apply` runs. */
		const inject = ["slots", "locale"];
		/** Dictionary namespace owned by this plugin. */
		const NS = "dsh-llm-balance";
		/**
		* Mount the card.
		* @param ctx - client root context carrying the slot registry and the locale service.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh: DICT_ZH,
				en: DICT_EN
			}), "dsh-llm-balance: dictionaries");
			const t = ctx.locale.bind(NS);
			const Seat = (props) => (0, react.createElement)(BalanceCard, {
				...props,
				t
			});
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "llm-balance",
				order: 60,
				label: () => t("label")
			}, Seat));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
