import { normalizeConfig } from "./config.js";
import { t as PROBES } from "./providers-5LfVvpJJ.js";
import { createAggregator } from "./state.js";
//#region src/route.ts
/** Path of the state route, as the browser half resolves it against `document.baseURI`. */
const STATE_ROUTE_PATH = "/dsh-llm-balance/state";
/** Write a JSON body with no-store caching. */
function sendJson(response, status, payload) {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body))
	});
	response.end(body);
}
/**
* Register the state route.
* @param webServer - the host's browser HTTP carrier.
* @param aggregator - the state builder to call per request.
* @returns the disposer removing the route.
*/
function registerStateRoute(webServer, aggregator) {
	return webServer.register({
		kind: "exact",
		path: STATE_ROUTE_PATH,
		handler: async (request, response) => {
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405, { allow: "GET" });
				response.end();
				return;
			}
			try {
				sendJson(response, 200, await aggregator.state());
			} catch (error) {
				sendJson(response, 500, {
					ok: false,
					error: {
						code: "NETWORK",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
		}
	});
}
//#endregion
//#region src/index.ts
/**
* dsh-llm-balance — host half.
*
* Mounts one read-only HTTP route that reports what the configured LLM
* accounts still have: a balance for top-up accounts, quota windows for
* subscriptions. The browser half renders it as a card in the bottom-right
* corner; nothing here is model-facing.
*
* The plugin stays dependency-free on purpose. It consumes DSH through
* structural interfaces (the same discipline dshmarket's host half uses)
* instead of importing service packages, so the published artifact has no bare
* runtime import to resolve and cannot collide with the host's own copies.
*
* @module dsh-llm-balance
*/
/** Stable Cordis plugin name (shown in the plugin inventory). */
const name = "llm-balance";
/** Environment-variable grammar the credential seam accepts as a reference. */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* Mount the plugin.
* @param ctx - host context; `webServer` is awaited rather than injected so the
*   plugin also loads in a composition that has no browser carrier.
* @param rawConfig - the row's optional `config:` block.
*/
function apply(ctx, rawConfig) {
	const config = normalizeConfig(rawConfig);
	const warn = (message) => ctx.logger?.warn?.(`[dsh-llm-balance] ${message}`);
	for (const warning of config.warnings) warn(warning);
	ctx.inject(["webServer"], (host) => {
		host.effect(() => {
			const webServer = host.get("webServer");
			if (webServer?.register === void 0) {
				warn("webServer is not available; the balance route was not mounted");
				return () => {};
			}
			return registerStateRoute(webServer, createAggregator({
				config,
				probes: PROBES,
				resolveSecret: (envName) => resolveSecret(host, envName, warn),
				listRoutes: () => listRoutes(host),
				llmDeepseek: () => llmDeepseekFacts(host),
				piAiApiKeyEnv: piAiApiKeyEnv(host),
				defaultSelection: () => defaultSelection(host),
				warn
			}));
		}, "dsh-llm-balance: state route");
	});
}
/**
* Resolve one credential reference: the DSH credential seam first (so a key
* stored through the GUI reaches the next poll), then the process environment.
*/
async function resolveSecret(ctx, envName, warn) {
	if (!CREDENTIAL_REF.test(envName)) {
		warn(`ignoring credential reference ${JSON.stringify(envName)}: not an environment-variable name`);
		return null;
	}
	const credentials = ctx.get("credentials");
	if (credentials?.resolve !== void 0) try {
		const value = (await credentials.resolve(envName))?.value;
		if (typeof value === "string" && value.length > 0) return value;
	} catch (error) {
		warn(`credential lookup for ${envName} failed: ${String(error)}`);
	}
	const fromEnv = process.env[envName];
	return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : null;
}
/**
* Live LLM routes as `{ id, name }`, so a source can advertise the models it
* answers for and a route no probe could read still has a label.
*/
function listRoutes(ctx) {
	const routes = ctx.get("llm")?.listProviders?.();
	if (!Array.isArray(routes)) return [];
	const listed = [];
	for (const entry of routes) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		const id = record["id"];
		if (typeof id !== "string" || id.length === 0) continue;
		const name = record["name"];
		listed.push({
			id,
			name: typeof name === "string" && name.length > 0 ? name : null
		});
	}
	return listed;
}
/** Endpoint and credential facts the mounted `llm-deepseek` adapter resolves. */
function llmDeepseekFacts(ctx) {
	const section = ctx.get("settings")?.get?.("llm-deepseek");
	if (typeof section !== "object" || section === null) return null;
	const record = section;
	const facts = {};
	if (typeof record["baseURL"] === "string" && record["baseURL"].length > 0) facts.baseURL = record["baseURL"];
	if (typeof record["apiKeyEnv"] === "string" && record["apiKeyEnv"].length > 0) facts.apiKeyEnv = record["apiKeyEnv"];
	return facts.baseURL === void 0 && facts.apiKeyEnv === void 0 ? null : facts;
}
/**
* Credential reference each `llm-pi-ai` route is configured with, read live from
* that plugin's settings section: a source then reads the account this harness
* routes to rather than guessing at an environment-variable name.
*
* The section is re-read on **every call**, never captured at mount. A snapshot
* taken while this plugin mounts can see an empty settings document (the
* provider may not have published yet) or predate a provider the user adds
* afterwards, and either way it would pin every route to "no configured
* credential" for the life of the fiber — which is exactly how a configured
* provider ends up showing "no usage API".
*/
function piAiApiKeyEnv(ctx) {
	return (routeId) => {
		const section = ctx.get("settings")?.get?.("llm-pi-ai");
		if (typeof section !== "object" || section === null) return void 0;
		const providers = section["providers"];
		if (typeof providers !== "object" || providers === null) return void 0;
		const entry = providers[routeId];
		if (typeof entry !== "object" || entry === null) return void 0;
		const value = entry["apiKeyEnv"];
		return typeof value === "string" && value.length > 0 ? value : void 0;
	};
}
/** The deployment's default model route, used while no session selection exists. */
function defaultSelection(ctx) {
	const selection = ctx.get("agentDefaultModel")?.currentSelection?.();
	if (typeof selection !== "object" || selection === null) return null;
	const record = selection;
	const provider = record["provider"];
	const model = record["model"];
	if (typeof provider !== "string" || typeof model !== "string") return null;
	return {
		provider,
		model
	};
}
//#endregion
export { apply, name, piAiApiKeyEnv };
