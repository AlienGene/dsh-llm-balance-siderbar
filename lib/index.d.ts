import { o as ResolvedConfig } from "./config-Bp7K9jAZ.js";
//#region src/index.d.ts
/** Stable Cordis plugin name (shown in the plugin inventory). */
declare const name = "llm-balance";
/** The Cordis surface this plugin uses, declared structurally. */
interface HostContext {
  inject(names: readonly string[], callback: (ctx: HostContext) => void): void;
  effect(callback: () => (() => void) | void, label?: string): void;
  get<T = unknown>(key: string): T | undefined;
  logger?: {
    warn?(message: string, ...rest: unknown[]): void;
  };
}
/**
 * Mount the plugin.
 * @param ctx - host context; `webServer` is awaited rather than injected so the
 *   plugin also loads in a composition that has no browser carrier.
 * @param rawConfig - the row's optional `config:` block.
 */
declare function apply(ctx: HostContext, rawConfig?: unknown): void;
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
declare function piAiApiKeyEnv(ctx: HostContext): (routeId: string) => string | undefined;
//#endregion
export { HostContext, type ResolvedConfig, apply, name, piAiApiKeyEnv };