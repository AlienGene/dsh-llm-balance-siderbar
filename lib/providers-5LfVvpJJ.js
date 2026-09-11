import { remainingPercentOf } from "./format.js";
import { a as arrayOf, c as recordOf, i as HttpFailure, n as credentialCandidates, o as fetchJson, r as resolveFirstSecret, s as numberOf, t as SkipSource } from "./types-CJpTPpqw.js";
import { dirname } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
//#region src/providers/deepseek.ts
/**
* DeepSeek — a top-up account, so the card shows the remaining balance.
*
* `GET {baseURL}/user/balance` reports `is_available` plus one
* `balance_infos` entry per currency (`total_balance` = granted + topped up).
* The base URL and credential reference follow the same layering as the
* official `llm-deepseek` adapter, so pointing DSH at a compatible endpoint
* points the card there too.
*
* @module dsh-llm-balance/providers/deepseek
*/
/** Stable source id; also the key prefix of this source's balance thresholds. */
const DEEPSEEK_SOURCE_ID = "deepseek-balance";
/** Parse the documented balance payload without trusting its exact shape. */
function parseDeepseekBalance(payload) {
	const root = recordOf(payload);
	const isAvailable = typeof root["isAvailable"] === "boolean" ? root["isAvailable"] : null;
	const declared = root["is_available"];
	const availability = isAvailable ?? (typeof declared === "boolean" ? declared : null);
	const rows = [];
	for (const entry of arrayOf(root["balance_infos"])) {
		const record = recordOf(entry);
		const total = numberOf(record["total_balance"]);
		const currency = typeof record["currency"] === "string" ? record["currency"] : null;
		if (total === null || currency === null) continue;
		rows.push({
			currency,
			total,
			granted: numberOf(record["granted_balance"]),
			toppedUp: numberOf(record["topped_up_balance"])
		});
	}
	return {
		rows,
		isAvailable: availability
	};
}
/** Resolve the endpoint the routed adapter would use. */
function deepseekBaseURL(host) {
	return (host.config.deepseek.baseURL ?? host.llmDeepseek?.baseURL ?? process.env["DEEPSEEK_BASE_URL"] ?? null ?? "https://api.deepseek.com").replace(/\/+$/, "");
}
/**
* Resolve the credential reference the routed adapter would use: the route's own
* configured reference first, then the `llm-deepseek` settings section, then the
* plugin's default.
*/
function deepseekApiKeyEnv(host) {
	if (host.routeApiKeyEnv !== void 0) return host.routeApiKeyEnv;
	return host.config.deepseek.apiKeyEnv === "DEEPSEEK_API_KEY" && host.llmDeepseek?.apiKeyEnv !== void 0 ? host.llmDeepseek.apiKeyEnv : host.config.deepseek.apiKeyEnv;
}
/** DeepSeek balance probe. */
const deepseekProbe = {
	id: DEEPSEEK_SOURCE_ID,
	label: "DeepSeek",
	match: (routeId) => /^deepseek/i.test(routeId),
	async probe(host, signal) {
		const envName = deepseekApiKeyEnv(host);
		const secret = await host.resolveSecret(envName);
		if (secret === null) throw new SkipSource("NO_CREDENTIAL", `${envName} is not configured`);
		const { rows, isAvailable } = parseDeepseekBalance(await fetchJson({
			url: `${deepseekBaseURL(host)}/user/balance`,
			headers: { authorization: `Bearer ${secret}` },
			timeoutMs: host.timeoutMs,
			signal,
			fetchImpl: host.fetchImpl
		}));
		if (rows.length === 0) throw new HttpFailure("BAD_RESPONSE", "no balance_infos in the response");
		const entries = [];
		for (const row of rows) entries.push({
			currency: row.currency,
			total: row.total
		});
		const snapshot = {
			kind: "balance",
			entries
		};
		if (isAvailable === false) return {
			...snapshot,
			note: "unavailable"
		};
		return snapshot;
	}
};
//#endregion
//#region src/providers/kimi-code.ts
/**
* Kimi For Coding — a *subscription*, so the card shows the plan's quota
* windows instead of a balance.
*
* `GET {baseURL}/usages` answers the plan's total pool (`usage`) plus one entry
* per rolling rate limit (`limits[].window`), each with `limit`/`used`/
* `remaining`/`resetTime`. A five-hour window arrives as
* `{duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}`; the card renders it as
* `5小时 剩余95%` plus a local countdown to `resetTime`.
*
* Credentials come from an API key (`KIMI_API_KEY` by default) or from the Kimi
* Code CLI's own OAuth file, whose access token lives only ~15 minutes. An
* expired token is refreshed through `{oauthHost}/api/oauth/token` and written
* back **only** when the credential file is still byte-identical to what this
* process read — so the plugin can keep the CLI working without ever fighting
* it for the file.
*
* @module dsh-llm-balance/providers/kimi-code
*/
/** Stable source id. */
const KIMI_SOURCE_ID = "kimi-code";
/** The credential reference this probe's own config defaults to. */
const DEFAULT_KIMI_API_KEY_ENV = "KIMI_API_KEY";
/** In-process token cache: one refresh serves every later poll. */
let cachedTokens = null;
/** Drop the cached token (tests, and a failed refresh). */
function resetKimiTokenCache() {
	cachedTokens = null;
}
/** Read the CLI credential document, tolerating every shape variant it has shipped. */
function parseKimiTokens(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const record = recordOf(parsed);
	const accessToken = typeof record["access_token"] === "string" ? record["access_token"] : null;
	if (accessToken === null || accessToken.length === 0) return null;
	const refreshToken = typeof record["refresh_token"] === "string" ? record["refresh_token"] : null;
	const expiresAt = numberOf(record["expires_at"]);
	return {
		accessToken,
		refreshToken,
		expiresAtMs: expiresAt === null ? null : expiresAt > 1e11 ? expiresAt : expiresAt * 1e3
	};
}
/** Parse `resetTime` (an ISO instant) into epoch milliseconds. */
function parseKimiResetTime(value) {
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	if (typeof value === "number" && Number.isFinite(value)) return value > 1e11 ? value : value * 1e3;
}
/** One rolling rate-limit window in a normalized, locale-free shape. */
function rateWindow(record) {
	const window = recordOf(record["window"]);
	const detail = recordOf(record["detail"]);
	const limit = numberOf(detail["limit"]);
	if (limit === null || limit <= 0) return null;
	const used = numberOf(detail["used"]) ?? 0;
	const remaining = numberOf(detail["remaining"]) ?? Math.max(0, limit - used);
	const resetsAt = parseKimiResetTime(detail["resetTime"]);
	return {
		kind: "rolling",
		duration: numberOf(window["duration"]),
		timeUnit: typeof window["timeUnit"] === "string" ? window["timeUnit"] : null,
		used,
		limit,
		remaining,
		remainingPercent: remainingPercentOf(remaining, limit) ?? 0,
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
function poolWindow(record) {
	const limit = numberOf(record["limit"]);
	if (limit === null || limit <= 0) return null;
	const used = numberOf(record["used"]) ?? 0;
	const remaining = numberOf(record["remaining"]) ?? Math.max(0, limit - used);
	const resetsAt = parseKimiResetTime(record["resetTime"]);
	return {
		kind: "week",
		duration: null,
		timeUnit: null,
		used,
		limit,
		remaining,
		remainingPercent: remainingPercentOf(remaining, limit) ?? 0,
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/** Rolling windows first (narrowest first), then the plan's weekly pool. */
function windowOrderMs(window) {
	if (window.kind !== "rolling" || window.duration === null) return Number.MAX_SAFE_INTEGER;
	const unit = (window.timeUnit ?? "").replace(/^TIME_UNIT_/, "").toLowerCase();
	const factor = unit === "minute" ? 6e4 : unit === "hour" ? 36e5 : unit === "day" ? 864e5 : unit === "second" ? 1e3 : 6e4;
	return window.duration * factor;
}
/** Parse the usage payload into ordered windows (narrowest rolling window first, pool last). */
function parseKimiUsage(payload) {
	const root = recordOf(payload);
	const pool = poolWindow(recordOf(root["usage"]));
	const rates = [];
	for (const entry of arrayOf(root["limits"])) {
		const window = rateWindow(recordOf(entry));
		if (window !== null) rates.push(window);
	}
	rates.sort((left, right) => windowOrderMs(left) - windowOrderMs(right));
	return { windows: [...rates, ...pool === null ? [] : [pool]] };
}
/** First existing credential candidate. */
async function existingTokenFile(host) {
	const candidates = [...host.config.kimiCode.tokenFile === null ? [] : [host.config.kimiCode.tokenFile], ...host.config.kimiCode.tokenFileFallbacks];
	for (const candidate of candidates) try {
		if ((await readFile(candidate, "utf8")).trim().length > 0) return candidate;
	} catch {}
	return null;
}
/** Exchange the refresh token for a fresh access token. */
async function refreshTokens(host, file, rawBefore, previous, signal) {
	if (previous.refreshToken === null) throw new HttpFailure("TOKEN_EXPIRED", "the Kimi credential has no refresh token");
	const body = new URLSearchParams({
		client_id: host.config.kimiCode.clientId,
		grant_type: "refresh_token",
		refresh_token: previous.refreshToken
	});
	let payload;
	try {
		payload = await fetchJson({
			url: `${host.config.kimiCode.oauthHost.replace(/\/+$/, "")}/api/oauth/token`,
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: body.toString(),
			timeoutMs: host.timeoutMs,
			signal,
			fetchImpl: host.fetchImpl
		});
	} catch (error) {
		if (error instanceof HttpFailure && (error.status === 401 || error.status === 403)) throw new HttpFailure("TOKEN_EXPIRED", "the Kimi refresh token was rejected");
		throw error;
	}
	const record = recordOf(payload);
	const accessToken = typeof record["access_token"] === "string" ? record["access_token"] : null;
	if (accessToken === null) throw new HttpFailure("BAD_RESPONSE", "the refresh response carried no access_token");
	const expiresIn = numberOf(record["expires_in"]);
	const tokens = {
		accessToken,
		refreshToken: typeof record["refresh_token"] === "string" ? record["refresh_token"] : previous.refreshToken,
		expiresAtMs: expiresIn === null ? null : Date.now() + expiresIn * 1e3
	};
	return {
		tokens,
		persisted: await persistRefreshed(host, file, rawBefore, tokens, record)
	};
}
/**
* Write a rotated token back, but only under compare-and-swap.
*
* The credential file belongs to the Kimi Code CLI. If it moved between our
* read and our write, the CLI refreshed first and its document is the newer
* truth — overwriting it would sign the user out. A CAS miss therefore keeps
* the refreshed token in memory only.
*/
async function persistRefreshed(host, file, rawBefore, tokens, response) {
	if (!host.config.kimiCode.persistRefreshedToken) return false;
	let current = null;
	try {
		current = await readFile(file, "utf8");
	} catch {
		current = null;
	}
	if (current === null || current !== rawBefore) {
		host.warn("kimi credential changed while refreshing; the new token stays in memory");
		return false;
	}
	let document;
	try {
		document = recordOf(JSON.parse(current));
	} catch {
		document = {};
	}
	const expiresIn = numberOf(response["expires_in"]);
	const merged = {
		...document,
		access_token: tokens.accessToken,
		refresh_token: tokens.refreshToken,
		scope: typeof document["scope"] === "string" ? document["scope"] : "kimi-code",
		token_type: typeof document["token_type"] === "string" ? document["token_type"] : "Bearer",
		expires_at: Math.floor((tokens.expiresAtMs ?? Date.now() + 9e5) / 1e3)
	};
	if (expiresIn !== null) merged["expires_in"] = expiresIn;
	const temporary = `${file}.tmp-${process.pid}`;
	try {
		await mkdir(dirname(file), { recursive: true });
		await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		await rename(temporary, file);
		return true;
	} catch (error) {
		host.warn(`could not persist the refreshed Kimi token: ${String(error)}`);
		try {
			await unlink(temporary);
		} catch {}
		return false;
	}
}
/** Resolve a usable bearer token, refreshing the CLI credential when it is stale. */
async function acquireToken(host, signal) {
	const references = credentialCandidates(host, host.config.kimiCode.apiKeyEnv, [DEFAULT_KIMI_API_KEY_ENV, "KIMI_CODING_API_KEY"]);
	for (const reference of references) {
		const apiKey = await host.resolveSecret(reference);
		if (apiKey !== null) return {
			token: apiKey,
			from: `api-key:${reference}`
		};
	}
	const now = host.now();
	if (cachedTokens !== null && cachedTokens.expiresAtMs !== null && cachedTokens.expiresAtMs - now > 6e4) return {
		token: cachedTokens.accessToken,
		from: "oauth-cache"
	};
	const file = await existingTokenFile(host);
	if (file === null) throw new SkipSource("NO_CREDENTIAL", `none of ${references.join(", ")} is set and no Kimi CLI credential was found`);
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		throw new SkipSource("NO_CREDENTIAL", `Kimi credential unreadable: ${String(error)}`);
	}
	const tokens = parseKimiTokens(raw);
	if (tokens === null) throw new HttpFailure("TOKEN_EXPIRED", "the Kimi credential document is not a token record");
	if (tokens.expiresAtMs !== null && tokens.expiresAtMs - now > 6e4) {
		cachedTokens = tokens;
		return {
			token: tokens.accessToken,
			from: "oauth-file"
		};
	}
	const outcome = await refreshTokens(host, file, raw, tokens, signal);
	cachedTokens = outcome.tokens;
	return {
		token: outcome.tokens.accessToken,
		from: outcome.persisted ? "oauth-refresh" : "oauth-refresh-memory"
	};
}
/** Kimi For Coding subscription-quota probe. */
const kimiCodeProbe = {
	id: KIMI_SOURCE_ID,
	label: "Kimi For Coding",
	match: (routeId) => /^kimi/i.test(routeId),
	async probe(host, signal) {
		const { token } = await acquireToken(host, signal);
		let payload;
		try {
			payload = await fetchJson({
				url: `${host.config.kimiCode.baseURL.replace(/\/+$/, "")}/usages`,
				headers: { authorization: `Bearer ${token}` },
				timeoutMs: host.timeoutMs,
				signal,
				fetchImpl: host.fetchImpl
			});
		} catch (error) {
			if (error instanceof HttpFailure && (error.status === 401 || error.status === 403)) {
				cachedTokens = null;
				throw new HttpFailure("TOKEN_EXPIRED", "Kimi rejected the token; sign in again with the Kimi Code CLI");
			}
			throw error;
		}
		const { windows } = parseKimiUsage(payload);
		if (windows.length === 0) throw new HttpFailure("BAD_RESPONSE", "the usage response carried no windows");
		return {
			kind: "quota",
			windows
		};
	}
};
//#endregion
//#region src/providers/moonshot.ts
/**
* Moonshot / Kimi Open Platform — a top-up account, so the card shows the
* remaining balance.
*
* `GET {base}/v1/users/me/balance` answers `data.available_balance`,
* `voucher_balance`, and `cash_balance` in the region's currency: the China
* mainland host bills CNY, the international host bills USD. A negative cash
* balance means the account owes money, which the card flags rather than
* hiding.
*
* Distinct from `kimi-code`: that is the Kimi For Coding *subscription* surface,
* which this plugin reads as quota windows.
*
* @module dsh-llm-balance/providers/moonshot
*/
/** Stable source id; also the key prefix of this source's balance thresholds. */
const MOONSHOT_SOURCE_ID = "moonshot-balance";
/** Parse one balance payload, mapping the region to its billing currency. */
function parseMoonshotBalance(payload, region) {
	const data = recordOf(recordOf(payload)["data"]);
	const available = numberOf(data["available_balance"]);
	if (available === null) return null;
	return {
		currency: region === "intl" ? "USD" : "CNY",
		available,
		voucher: numberOf(data["voucher_balance"]),
		cash: numberOf(data["cash_balance"])
	};
}
/** Balance host for one region. */
function moonshotBaseURL(host) {
	const override = host.config.sourceOverrides[MOONSHOT_SOURCE_ID]?.baseURL;
	if (override !== void 0) return override.replace(/\/+$/, "");
	return host.config.moonshot.region === "intl" ? "https://api.moonshot.ai/v1" : "https://api.moonshot.cn/v1";
}
/** Moonshot / Kimi Open Platform balance probe. */
const moonshotProbe = {
	id: MOONSHOT_SOURCE_ID,
	label: "Moonshot",
	match: (routeId) => /^(moonshot|moonshotai)/i.test(routeId),
	async probe(host, signal) {
		const override = host.config.sourceOverrides[MOONSHOT_SOURCE_ID];
		const candidates = credentialCandidates(host, override?.apiKeyEnv ?? host.config.moonshot.apiKeyEnv, ["MOONSHOT_API_KEY"]);
		const resolved = await resolveFirstSecret(host, candidates);
		if (resolved === null) throw new SkipSource("NO_CREDENTIAL", `none of ${candidates.join(", ")} is set`);
		const secret = resolved.secret;
		const region = override?.region ?? host.config.moonshot.region;
		const balance = parseMoonshotBalance(await fetchJson({
			url: `${moonshotBaseURL(host)}/users/me/balance`,
			headers: { authorization: `Bearer ${secret}` },
			timeoutMs: host.timeoutMs,
			signal,
			fetchImpl: host.fetchImpl
		}), region);
		if (balance === null) throw new HttpFailure("BAD_RESPONSE", "no data.available_balance in the response");
		const snapshot = {
			kind: "balance",
			entries: [{
				currency: balance.currency,
				total: balance.available
			}]
		};
		if (balance.cash !== null && balance.cash < 0) return {
			...snapshot,
			note: "deficit"
		};
		return snapshot;
	}
};
//#endregion
//#region src/providers/opencode.ts
/**
* OpenCode Go (and its `opencode` / `opencode-zen` siblings) — a *subscription*,
* so the card shows the plan's quota windows.
*
* `GET {base}/v1/usage` with the provider's ordinary API key answers three
* rolling windows:
*
* ```jsonc
* {"usage":{"rolling":{"status":"ok","percent":0,  "resetsAt":"…"},
*           "weekly": {"status":"ok","percent":47, "resetsAt":"…"},
*           "monthly":{"status":"ok","percent":92, "resetsAt":"…"}}}
* ```
*
* `percent` is the *used* share. The endpoint is not in OpenCode's public docs
* (it was surfaced through cc-switch#6433 and adopted by OmniRoute#12124), so a
* plan that does not expose it is reported as `unsupported` rather than as an
* error: the provider is configured and working, it simply has no usage surface
* to read.
*
* @module dsh-llm-balance/providers/opencode
*/
/** Stable source id. */
const OPENCODE_SOURCE_ID = "opencode-go";
/** The catalog default credential reference; a configured route overrides it. */
const OPENCODE_DEFAULT_API_KEY_ENV = "OPENCODE_API_KEY";
/** Endpoint per pi-ai catalog route id (the catalog carries it per model, not per provider). */
const OPENCODE_BASE_URLS = {
	"opencode-go": "https://opencode.ai/zen/go",
	opencode: "https://opencode.ai/zen",
	"opencode-zen": "https://opencode.ai/zen"
};
/** The three windows OpenCode reports, in display order. */
const WINDOW_ORDER = [
	{
		key: "rolling",
		kind: "rolling"
	},
	{
		key: "weekly",
		kind: "week"
	},
	{
		key: "monthly",
		kind: "month"
	}
];
/** Which usage endpoint this route uses, or `null` when the route is not one we know. */
function opencodeBaseURL(host, routeId) {
	const override = host.config.opencode?.baseURL;
	if (override !== void 0) return override.replace(/\/+$/, "");
	if (routeId === void 0) return null;
	const known = OPENCODE_BASE_URLS[routeId];
	return known === void 0 ? null : known.replace(/\/+$/, "");
}
/**
* Parse the usage payload into ordered windows.
*
* A window is kept when it carries a finite `percent`; `status` is advisory
* (`ok` or `rate-limited`) because a limited window still has a number worth
* showing. `resetAt`/`resetsAt` are accepted as ISO strings.
*/
function parseOpencodeUsage(payload) {
	const usage = recordOf(recordOf(payload)["usage"]);
	const windows = [];
	for (const { key, kind } of WINDOW_ORDER) {
		const entry = recordOf(usage[key]);
		const percent = numberOf(entry["percent"]);
		if (percent === null) continue;
		const used = Math.max(0, Math.min(100, percent));
		const resetsAt = parseResetInstant(entry["resetsAt"] ?? entry["resetAt"]);
		windows.push({
			kind,
			duration: null,
			timeUnit: null,
			used,
			limit: 100,
			remaining: 100 - used,
			remainingPercent: 100 - used,
			...resetsAt === void 0 ? {} : { resetsAt }
		});
	}
	return windows;
}
/** Read an ISO instant (or epoch seconds/milliseconds) into epoch milliseconds. */
function parseResetInstant(value) {
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
		return;
	}
	const numeric = numberOf(value);
	if (numeric === null) return void 0;
	return numeric > 1e11 ? numeric : numeric * 1e3;
}
/** OpenCode usage probe. */
const opencodeProbe = {
	id: OPENCODE_SOURCE_ID,
	label: "OpenCode Go",
	match: (routeId) => /^opencode/i.test(routeId),
	async probe(host, signal) {
		const baseURL = opencodeBaseURL(host, host.routeId);
		if (baseURL === null) throw new SkipSource("NOT_SUPPORTED", "no known usage endpoint for this route");
		const candidates = credentialCandidates(host, host.config.opencode?.apiKeyEnv, [OPENCODE_DEFAULT_API_KEY_ENV, "OPENCODE_GO_API_KEY"]);
		const resolved = await resolveFirstSecret(host, candidates);
		if (resolved === null) throw new SkipSource("NO_CREDENTIAL", `none of ${candidates.join(", ")} is set`);
		const secret = resolved.secret;
		let payload;
		try {
			payload = await fetchJson({
				url: `${baseURL}/v1/usage`,
				headers: { authorization: `Bearer ${secret}` },
				timeoutMs: host.timeoutMs,
				signal,
				fetchImpl: host.fetchImpl
			});
		} catch (error) {
			if (error instanceof HttpFailure && (error.status === 404 || error.status === 400)) return {
				kind: "unsupported",
				reason: "no-usage-api"
			};
			throw error;
		}
		const windows = parseOpencodeUsage(payload);
		if (windows.length === 0) throw new HttpFailure("BAD_RESPONSE", "the usage response carried no windows");
		return {
			kind: "quota",
			windows
		};
	}
};
//#endregion
//#region src/providers/index.ts
/**
* The probe registry — the one line a new provider is added to.
*
* @module dsh-llm-balance/providers
*/
/**
* Every shipped source, in display order.
*
* Registration order decides the card's row order and the fallback when two
* sources could answer for one route. A new provider appends one entry here.
*/
const PROBES = [
	deepseekProbe,
	kimiCodeProbe,
	opencodeProbe,
	moonshotProbe
];
/** Look one probe up by its stable id. */
function probeById(id) {
	return PROBES.find((probe) => probe.id === id);
}
/** The probes that answer for one registered LLM route id. */
function probesForRoute(routeId) {
	return PROBES.filter((probe) => probe.match(routeId));
}
//#endregion
export { parseKimiUsage as _, OPENCODE_SOURCE_ID as a, deepseekProbe as b, parseOpencodeUsage as c, moonshotProbe as d, parseMoonshotBalance as f, parseKimiTokens as g, parseKimiResetTime as h, OPENCODE_DEFAULT_API_KEY_ENV as i, parseResetInstant as l, kimiCodeProbe as m, probeById as n, opencodeBaseURL as o, KIMI_SOURCE_ID as p, probesForRoute as r, opencodeProbe as s, PROBES as t, MOONSHOT_SOURCE_ID as u, resetKimiTokenCache as v, parseDeepseekBalance as x, DEEPSEEK_SOURCE_ID as y };
