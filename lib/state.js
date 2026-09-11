import { i as HttpFailure, t as SkipSource } from "./types-CJpTPpqw.js";
//#region src/state.ts
/** Retry cadence for a source that failed or was skipped. */
const RETRY_MS = 15e3;
/** Turn any thrown value into the shared failure vocabulary. */
function toFailure(error) {
	if (error instanceof HttpFailure) return {
		code: error.code,
		message: error.message
	};
	if (error instanceof SkipSource) return {
		code: error.code,
		message: error.message
	};
	return {
		code: "NETWORK",
		message: error instanceof Error ? error.message : String(error)
	};
}
/**
* Build the aggregator.
* @param input - configuration plus the host seams every probe needs.
* @returns the state builder used by the HTTP route and by the tests.
*/
function createAggregator(input) {
	const now = input.now ?? (() => Date.now());
	const warn = input.warn ?? (() => {});
	const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
	const caches = /* @__PURE__ */ new Map();
	function cacheFor(id) {
		const existing = caches.get(id);
		if (existing !== void 0) return existing;
		const created = {
			snapshot: null,
			fetchedAt: null,
			error: null,
			skipped: false,
			skipDetail: null,
			nextAttemptAt: 0,
			inFlight: null
		};
		caches.set(id, created);
		return created;
	}
	/**
	* The probes this payload may contain.
	*
	* Auto mode is gated on the harness's own configuration: only a source
	* answering for a registered LLM route is read, so the card describes the
	* models this deployment actually reaches rather than every credential lying
	* around on the machine. An explicit `sources` list is the escape hatch that
	* bypasses the gate.
	*/
	function enabledProbes() {
		const explicit = input.config.explicitSources;
		if (explicit !== null) {
			const wanted = new Set(explicit);
			return input.probes.filter((probe) => wanted.has(probe.id));
		}
		const routes = input.listRoutes?.() ?? [];
		if (routes.length === 0) return [];
		return input.probes.filter((probe) => routes.some((route) => probe.match(route.id)));
	}
	function hostFor(probe, routes) {
		input.config.sourceOverrides[probe.id];
		const route = routes.find((candidate) => probe.match(candidate));
		const routeApiKeyEnv = route === void 0 ? void 0 : input.piAiApiKeyEnv?.(route);
		return {
			config: input.config,
			timeoutMs: input.config.timeoutMs,
			fetchImpl,
			...route === void 0 ? {} : { routeId: route },
			...routeApiKeyEnv === void 0 ? {} : { routeApiKeyEnv },
			...input.llmDeepseek === void 0 ? {} : { llmDeepseek: input.llmDeepseek() },
			now,
			resolveSecret: input.resolveSecret,
			warn
		};
	}
	async function refresh(probe, routes, signal) {
		const cache = cacheFor(probe.id);
		const current = now();
		if (cache.inFlight !== null) return cache.inFlight;
		if (cache.fetchedAt !== null && cache.error === null && current < cache.fetchedAt + input.config.refreshMs || current < cache.nextAttemptAt) return;
		cache.inFlight = (async () => {
			try {
				const snapshot = await probe.probe(hostFor(probe, routes), signal ?? new AbortController().signal);
				cache.snapshot = snapshot;
				cache.fetchedAt = now();
				cache.error = null;
				cache.skipped = false;
				cache.skipDetail = null;
				cache.nextAttemptAt = cache.fetchedAt + input.config.refreshMs;
			} catch (error) {
				if (error instanceof SkipSource) {
					if (cache.skipDetail !== error.message) warn(`${probe.id}: skipped — ${error.message}`);
					cache.skipped = true;
					cache.skipDetail = error.message;
					cache.nextAttemptAt = now() + RETRY_MS;
					return;
				}
				const failure = toFailure(error);
				cache.error = failure;
				cache.skipped = false;
				cache.skipDetail = null;
				cache.nextAttemptAt = now() + Math.min(input.config.refreshMs, RETRY_MS);
				warn(`${probe.id}: ${failure.code} ${failure.message}`);
			} finally {
				cache.inFlight = null;
			}
		})();
		return cache.inFlight;
	}
	return { async state(signal) {
		const probes = enabledProbes();
		const routes = input.listRoutes?.() ?? [];
		await Promise.all(probes.map((probe) => refresh(probe, routes.map((route) => route.id), signal)));
		const at = now();
		const sources = [];
		for (const probe of probes) {
			const cache = cacheFor(probe.id);
			if (cache.skipped || cache.snapshot === null && cache.error === null) continue;
			const override = input.config.sourceOverrides[probe.id];
			const providers = routes.filter((route) => probe.match(route.id)).map((route) => route.id);
			sources.push({
				id: probe.id,
				label: override?.label ?? probe.label,
				ok: cache.error === null && cache.snapshot !== null,
				providers,
				...cache.fetchedAt === null ? {} : {
					fetchedAt: cache.fetchedAt,
					ageMs: Math.max(0, at - cache.fetchedAt)
				},
				...cache.error !== null && cache.snapshot !== null ? { stale: true } : {},
				...cache.snapshot === null ? {} : { snapshot: cache.snapshot },
				...cache.error === null ? {} : { error: cache.error }
			});
		}
		const claimed = new Set(sources.flatMap((source) => source.providers));
		for (const route of routes) {
			if (claimed.has(route.id)) continue;
			const owner = probes.find((probe) => probe.match(route.id));
			const detail = owner === void 0 ? null : cacheFor(owner.id).skipDetail;
			sources.push({
				id: `route:${route.id}`,
				label: route.name === null ? route.id : route.name,
				ok: true,
				providers: [route.id],
				snapshot: {
					kind: "unsupported",
					reason: "no-usage-api",
					...detail === null ? {} : { detail }
				}
			});
		}
		const selection = input.defaultSelection?.() ?? null;
		return {
			ok: true,
			now: at,
			refreshMs: input.config.refreshMs,
			defaultMode: input.config.defaultMode,
			percentMode: input.config.percentMode,
			colors: input.config.colors,
			thresholds: input.config.thresholds,
			balanceThresholds: input.config.balanceThresholds,
			defaultProvider: selection === null ? null : {
				provider: selection.provider,
				model: selection.model
			},
			sources
		};
	} };
}
//#endregion
export { RETRY_MS, createAggregator, toFailure };
