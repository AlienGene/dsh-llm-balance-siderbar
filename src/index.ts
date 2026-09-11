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
import { normalizeConfig, type ResolvedConfig } from './config.ts'
import { PROBES } from './providers/index.ts'
import { registerStateRoute, type WebServerLike } from './route.ts'
import { createAggregator } from './state.ts'

/** Stable Cordis plugin name (shown in the plugin inventory). */
export const name = 'llm-balance'

/** The Cordis surface this plugin uses, declared structurally. */
export interface HostContext {
  inject(names: readonly string[], callback: (ctx: HostContext) => void): void
  effect(callback: () => (() => void) | void, label?: string): void
  get<T = unknown>(key: string): T | undefined
  logger?: { warn?(message: string, ...rest: unknown[]): void }
}

/** Environment-variable grammar the credential seam accepts as a reference. */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Mount the plugin.
 * @param ctx - host context; `webServer` is awaited rather than injected so the
 *   plugin also loads in a composition that has no browser carrier.
 * @param rawConfig - the row's optional `config:` block.
 */
export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const config = normalizeConfig(rawConfig)
  const warn = (message: string): void => ctx.logger?.warn?.(`[dsh-llm-balance] ${message}`)
  for (const warning of config.warnings) warn(warning)

  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const webServer = host.get<WebServerLike>('webServer')
      if (webServer?.register === undefined) {
        warn('webServer is not available; the balance route was not mounted')
        return () => {}
      }
      const aggregator = createAggregator({
        config,
        probes: PROBES,
        resolveSecret: (envName) => resolveSecret(host, envName, warn),
        listRoutes: () => listRoutes(host),
        llmDeepseek: () => llmDeepseekFacts(host),
        piAiApiKeyEnv: piAiApiKeyEnv(host),
        defaultSelection: () => defaultSelection(host),
        warn,
      })
      return registerStateRoute(webServer, aggregator)
    }, 'dsh-llm-balance: state route')
  })
}

/**
 * Resolve one credential reference: the DSH credential seam first (so a key
 * stored through the GUI reaches the next poll), then the process environment.
 */
async function resolveSecret(
  ctx: HostContext,
  envName: string,
  warn: (message: string) => void,
): Promise<string | null> {
  if (!CREDENTIAL_REF.test(envName)) {
    warn(`ignoring credential reference ${JSON.stringify(envName)}: not an environment-variable name`)
    return null
  }
  const credentials = ctx.get<{ resolve?(ref: string): Promise<unknown> }>('credentials')
  if (credentials?.resolve !== undefined) {
    try {
      const resolved = (await credentials.resolve(envName)) as { value?: unknown } | undefined
      const value = resolved?.value
      if (typeof value === 'string' && value.length > 0) return value
    } catch (error) {
      warn(`credential lookup for ${envName} failed: ${String(error)}`)
    }
  }
  const fromEnv = process.env[envName]
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

/**
 * Live LLM routes as `{ id, name }`, so a source can advertise the models it
 * answers for and a route no probe could read still has a label.
 */
function listRoutes(ctx: HostContext): { id: string; name: string | null }[] {
  const llm = ctx.get<{ listProviders?(): unknown }>('llm')
  const routes = llm?.listProviders?.()
  if (!Array.isArray(routes)) return []
  const listed: { id: string; name: string | null }[] = []
  for (const entry of routes) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = record['id']
    if (typeof id !== 'string' || id.length === 0) continue
    const name = record['name']
    listed.push({ id, name: typeof name === 'string' && name.length > 0 ? name : null })
  }
  return listed
}

/** Endpoint and credential facts the mounted `llm-deepseek` adapter resolves. */
function llmDeepseekFacts(ctx: HostContext): { baseURL?: string; apiKeyEnv?: string } | null {
  const settings = ctx.get<{ get?(namespace: string): unknown }>('settings')
  const section = settings?.get?.('llm-deepseek')
  if (typeof section !== 'object' || section === null) return null
  const record = section as Record<string, unknown>
  const facts: { baseURL?: string; apiKeyEnv?: string } = {}
  if (typeof record['baseURL'] === 'string' && record['baseURL'].length > 0) facts.baseURL = record['baseURL']
  if (typeof record['apiKeyEnv'] === 'string' && record['apiKeyEnv'].length > 0) facts.apiKeyEnv = record['apiKeyEnv']
  return facts.baseURL === undefined && facts.apiKeyEnv === undefined ? null : facts
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
export function piAiApiKeyEnv(ctx: HostContext): (routeId: string) => string | undefined {
  return (routeId) => {
    const settings = ctx.get<{ get?(namespace: string): unknown }>('settings')
    const section = settings?.get?.('llm-pi-ai')
    if (typeof section !== 'object' || section === null) return undefined
    const providers = (section as Record<string, unknown>)['providers']
    if (typeof providers !== 'object' || providers === null) return undefined
    const entry = (providers as Record<string, unknown>)[routeId]
    if (typeof entry !== 'object' || entry === null) return undefined
    const value = (entry as Record<string, unknown>)['apiKeyEnv']
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
}

/** The deployment's default model route, used while no session selection exists. */
function defaultSelection(ctx: HostContext): { provider: string; model: string } | null {
  const service = ctx.get<{ currentSelection?(): unknown }>('agentDefaultModel')
  const selection = service?.currentSelection?.()
  if (typeof selection !== 'object' || selection === null) return null
  const record = selection as Record<string, unknown>
  const provider = record['provider']
  const model = record['model']
  if (typeof provider !== 'string' || typeof model !== 'string') return null
  return { provider, model }
}

export type { ResolvedConfig }
