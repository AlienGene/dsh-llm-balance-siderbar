import { DEFAULT_THRESHOLDS } from "./format.js";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/config.ts
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
/** `< error` red, `< warn` yellow, `active` green, else the brand accent (blue). */
const DEFAULT_COLORS = {
	normal: "var(--dsw-alias-brand-primary)",
	warn: "var(--dsw-alias-state-warn-primary)",
	error: "var(--dsw-alias-state-error-primary)",
	active: "var(--dsw-alias-state-success-primary)"
};
/** Cap a single upstream request; long enough for a slow provider, short enough to be invisible. */
const DEFAULT_TIMEOUT_MS = 8e3;
/** Both the host cache TTL and the card's poll interval. */
const DEFAULT_REFRESH_MS = 6e4;
/** Kimi Code is the only shipped source that talks to a subscription surface. */
const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
/** Where the Kimi Code CLI keeps its OAuth credential on disk. */
function kimiTokenFileCandidates(env = process.env) {
	const home = env["HOME"] ?? homedir();
	return [join(home, ".kimi-code", "credentials", "kimi-code.json"), join(home, ".kimi", "credentials", "kimi-code.json")];
}
function asString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asBoolean(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function asPositiveInt(value, fallback, min) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const rounded = Math.round(value);
	return rounded < min ? fallback : rounded;
}
function asMode(value) {
	return value === "current" || value === "summary" || value === "all" ? value : null;
}
function asPercentMode(value) {
	return value === "left" || value === "used" ? value : null;
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
/**
* Normalize one row config into a fully resolved configuration.
* @param raw - the row's `config:` value (absent when the row carries none).
* @param env - environment used to locate `$DSH_HOME` and the Kimi credential.
* @returns the resolved configuration plus human-readable warnings for anything ignored.
*/
function normalizeConfig(raw, env = process.env) {
	const input = asRecord(raw);
	const warnings = [];
	const defaultMode = asMode(input.defaultMode);
	if (input.defaultMode !== void 0 && defaultMode === null) warnings.push(`defaultMode must be current|summary|all, got ${JSON.stringify(input.defaultMode)}`);
	const percentMode = asPercentMode(input.percentMode);
	if (input.percentMode !== void 0 && percentMode === null) warnings.push(`percentMode must be left|used, got ${JSON.stringify(input.percentMode)}`);
	const thresholdInput = asRecord(input.thresholds);
	const thresholds = { ...DEFAULT_THRESHOLDS };
	for (const key of ["warn", "error"]) {
		const value = thresholdInput[key];
		if (value === void 0) continue;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) thresholds[key] = value;
		else warnings.push(`thresholds.${key} must be a number within 0..100`);
	}
	if (thresholds.error > thresholds.warn) warnings.push("thresholds.error is above thresholds.warn; the red tier will never appear");
	const colors = { ...DEFAULT_COLORS };
	const colorInput = asRecord(input.colors);
	for (const key of [
		"normal",
		"warn",
		"error",
		"active"
	]) {
		const value = asString(colorInput[key]);
		if (value !== null) colors[key] = value;
	}
	const { explicitSources, sourceOverrides, sourceWarnings } = parseSources(input.sources);
	warnings.push(...sourceWarnings);
	const balanceThresholds = parseBalanceThresholds(input.balanceThresholds, warnings);
	const deepseek = asRecord(input.deepseek);
	const moonshot = asRecord(input.moonshot);
	const kimi = asRecord(input.kimiCode);
	const opencodeInput = asRecord(input.opencode);
	const opencodeBaseURL = asString(opencodeInput["baseURL"]);
	const opencodeApiKeyEnv = asString(opencodeInput["apiKeyEnv"]);
	const opencode = opencodeBaseURL === null && opencodeApiKeyEnv === null ? void 0 : {
		...opencodeApiKeyEnv === null ? {} : { apiKeyEnv: opencodeApiKeyEnv },
		...opencodeBaseURL === null ? {} : { baseURL: opencodeBaseURL }
	};
	const tokenFile = asString(kimi["tokenFile"]);
	const candidates = kimiTokenFileCandidates(env);
	const regionValue = moonshot["region"];
	const region = regionValue === "intl" ? "intl" : "cn";
	if (regionValue !== void 0 && regionValue !== "cn" && regionValue !== "intl") warnings.push(`moonshot.region must be cn|intl, got ${JSON.stringify(regionValue)}`);
	return {
		defaultMode: defaultMode ?? "all",
		percentMode: percentMode ?? "used",
		refreshMs: asPositiveInt(input.refreshMs, DEFAULT_REFRESH_MS, 5e3),
		timeoutMs: asPositiveInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1e3),
		thresholds,
		colors,
		explicitSources,
		sourceOverrides,
		balanceThresholds,
		deepseek: {
			apiKeyEnv: asString(deepseek["apiKeyEnv"]) ?? "DEEPSEEK_API_KEY",
			baseURL: asString(deepseek["baseURL"])
		},
		moonshot: {
			apiKeyEnv: asString(moonshot["apiKeyEnv"]) ?? "MOONSHOT_API_KEY",
			region
		},
		...opencode === void 0 ? {} : { opencode },
		kimiCode: {
			apiKeyEnv: asString(kimi["apiKeyEnv"]) ?? "KIMI_API_KEY",
			tokenFile: tokenFile ?? candidates[0] ?? null,
			tokenFileFallbacks: candidates.filter((candidate) => candidate !== tokenFile),
			oauthHost: asString(kimi["oauthHost"]) ?? "https://auth.kimi.com",
			baseURL: asString(kimi["baseURL"]) ?? "https://api.kimi.com/coding/v1",
			clientId: asString(kimi["clientId"]) ?? "17e5f671-d194-4dfb-9706-5516cb48c098",
			persistRefreshedToken: asBoolean(kimi["persistRefreshedToken"], true)
		},
		warnings
	};
}
function parseSources(value) {
	const sourceWarnings = [];
	const sourceOverrides = {};
	if (value === void 0 || value === "auto") return {
		explicitSources: null,
		sourceOverrides,
		sourceWarnings
	};
	if (!Array.isArray(value)) {
		sourceWarnings.push("sources must be \"auto\" or an array of source entries; using auto");
		return {
			explicitSources: null,
			sourceOverrides,
			sourceWarnings
		};
	}
	const ids = [];
	for (const entry of value) {
		const record = asRecord(entry);
		if (typeof entry === "string") {
			ids.push(entry);
			continue;
		}
		const id = asString(record["id"]);
		if (id === null) {
			sourceWarnings.push("each sources entry needs a string id; entry ignored");
			continue;
		}
		const override = {};
		if (record["enabled"] !== void 0) override.enabled = record["enabled"] === true;
		const label = asString(record["label"]);
		if (label !== null) override.label = label;
		const apiKeyEnv = asString(record["apiKeyEnv"]);
		if (apiKeyEnv !== null) override.apiKeyEnv = apiKeyEnv;
		const baseURL = asString(record["baseURL"]);
		if (baseURL !== null) override.baseURL = baseURL;
		if (record["region"] === "cn" || record["region"] === "intl") override.region = record["region"];
		sourceOverrides[id] = override;
		if (override.enabled !== false) ids.push(id);
	}
	return {
		explicitSources: ids,
		sourceOverrides,
		sourceWarnings
	};
}
/**
* Read the optional absolute balance boundaries.
*
* Shape: `{ '<sourceId>:<CURRENCY>': { warnBelow?, errorBelow? }, '<sourceId>:*': … }`.
* A rule without any usable number is dropped, and an unreadable value is
* reported rather than silently ignored — the row simply keeps its normal
* colour, which is the safe default for a status display.
*/
function parseBalanceThresholds(value, warnings) {
	const rules = {};
	for (const [key, raw] of Object.entries(asRecord(value))) {
		const record = asRecord(raw);
		const rule = {};
		for (const field of ["warnBelow", "errorBelow"]) {
			const candidate = record[field];
			if (candidate === void 0) continue;
			if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) rule[field] = candidate;
			else warnings.push(`balanceThresholds.${key}.${field} must be a non-negative number`);
		}
		if (rule.warnBelow === void 0 && rule.errorBelow === void 0) {
			warnings.push(`balanceThresholds.${key} carries no usable boundary; entry ignored`);
			continue;
		}
		if (rule.warnBelow !== void 0 && rule.errorBelow !== void 0 && rule.errorBelow > rule.warnBelow) warnings.push(`balanceThresholds.${key}.errorBelow is above warnBelow; the red tier will never appear`);
		rules[key] = rule;
	}
	return rules;
}
//#endregion
export { DEFAULT_COLORS, DEFAULT_REFRESH_MS, DEFAULT_TIMEOUT_MS, KIMI_CLIENT_ID, kimiTokenFileCandidates, normalizeConfig };
