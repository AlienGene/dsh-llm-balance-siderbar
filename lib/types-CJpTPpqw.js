//#region src/http.ts
/** A provider call that failed, classified for display. */
var HttpFailure = class extends Error {
	code;
	status;
	constructor(code, message, status = null) {
		super(message);
		this.name = "HttpFailure";
		this.code = code;
		this.status = status;
	}
};
/**
* Run one request and decode a JSON body.
* @param request - url, method, headers, optional form body, and the timeout.
* @returns the decoded JSON value.
* @throws {HttpFailure} for every transport, status, or decoding problem.
*/
async function fetchJson(request) {
	const timeout = AbortSignal.timeout(request.timeoutMs);
	const signal = request.signal === void 0 ? timeout : AbortSignal.any([request.signal, timeout]);
	let response;
	try {
		response = await request.fetchImpl(request.url, {
			method: request.method ?? "GET",
			headers: {
				accept: "application/json",
				...request.headers ?? {}
			},
			...request.body === void 0 ? {} : { body: request.body },
			signal
		});
	} catch (error) {
		if (timeout.aborted) throw new HttpFailure("TIMEOUT", `no response within ${request.timeoutMs}ms`);
		if (request.signal?.aborted === true) throw new HttpFailure("NETWORK", "request aborted");
		throw new HttpFailure("NETWORK", error instanceof Error ? error.message : String(error));
	}
	if (!response.ok) {
		const detail = await readErrorDetail(response);
		throw new HttpFailure(mapStatus(response.status), detail, response.status);
	}
	try {
		return await response.json();
	} catch (error) {
		throw new HttpFailure("BAD_RESPONSE", `not JSON: ${error instanceof Error ? error.message : String(error)}`, response.status);
	}
}
/** Preview a failed response body without ever echoing more than a line. */
async function readErrorDetail(response) {
	try {
		const trimmed = (await response.text()).trim().replace(/\s+/g, " ");
		return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
	} catch {
		return `HTTP ${response.status}`;
	}
}
function mapStatus(status) {
	if (status === 401 || status === 403) return "UNAUTHORIZED";
	if (status === 429) return "RATE_LIMITED";
	return "HTTP_ERROR";
}
/** Read a finite number from either a JSON number or a numeric string. */
function numberOf(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
/** Read a nested record without assuming the provider kept its shape. */
function recordOf(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
/** Read an array of unknown entries, or an empty array. */
function arrayOf(value) {
	return Array.isArray(value) ? value : [];
}
//#endregion
//#region src/providers/types.ts
/** Thrown when a probe has nothing to read — the source stays out of the payload. */
var SkipSource = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "SkipSource";
		this.code = code;
	}
};
/**
* Credential references worth trying for one probe, in priority order.
*
* The route's own configured reference comes first (it names the account this
* harness actually spends from), then the probe's configured one, then the
* reference derived from the route id (`opencode-go` → `OPENCODE_GO_API_KEY`),
* then the probe's shipped defaults. Deriving it matters: a route configured
* under a name the probe has never heard of would otherwise fall through to a
* catalog default the user never set, and the source would look unconfigured.
*/
function credentialCandidates(host, configured, defaults) {
	const derived = host.routeId === void 0 ? null : `${host.routeId.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	for (const candidate of [
		host.routeApiKeyEnv,
		configured,
		derived,
		...defaults
	]) {
		if (typeof candidate !== "string" || candidate.length === 0) continue;
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		candidates.push(candidate);
	}
	return candidates;
}
/** The first candidate reference that resolves to a value. */
async function resolveFirstSecret(host, candidates) {
	for (const envName of candidates) {
		const secret = await host.resolveSecret(envName);
		if (secret !== null) return {
			envName,
			secret
		};
	}
	return null;
}
//#endregion
export { arrayOf as a, recordOf as c, HttpFailure as i, credentialCandidates as n, fetchJson as o, resolveFirstSecret as r, numberOf as s, SkipSource as t };
