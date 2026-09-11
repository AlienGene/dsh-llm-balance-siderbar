/**
 * The aggregator behind `GET /dsh-llm-balance/state`.
 *
 * One rule shapes everything here: a failing provider must never damage the
 * other rows, and must never cost the user the number they already had. Each
 * source therefore owns its own cache, its own in-flight promise, and its own
 * error slot; a failure keeps the last successful snapshot and marks it stale.
 *
 * A source with no credential throws {@link SkipSource} and simply disappears
 * from the payload — that is the whole auto-detection story, and it re-runs on
 * every poll so mounting a credential later lights the row up without a restart.
 *
 * @module dsh-llm-balance/state
 */
import type { ResolvedConfig } from './config.ts'
import type { FetchLike } from './http.ts'
import { HttpFailure } from './http.ts'
import type { ErrorCode, SourceSnapshot, SourceState, StateResponse } from './protocol.ts'
import { SkipSource, type Probe, type ProbeHost } from './providers/types.ts'

/** Retry cadence for a source that failed or was skipped. */
export const RETRY_MS = 15_000

/** What the aggregator needs from the host process. */
export interface AggregatorInput {
  config: ResolvedConfig
  probes: readonly Probe[]
  fetchImpl?: FetchLike
  now?: () => number
  resolveSecret: (envName: string) => Promise<string | null>
  /**
   * Live LLM routes (id plus the adapter's display name). They bind a source to
   * the models it answers for, and in auto mode they are the gate: a source
   * whose provider this harness never registered is not read at all. The name
   * labels a route no probe could read.
   */
  listRoutes?: () => { id: string; name: string | null }[]
  /** Facts the mounted `llm-deepseek` adapter resolves, when that plugin is present. */
  llmDeepseek?: () => { baseURL?: string; apiKeyEnv?: string } | null
  /**
   * The credential reference one registered route is configured with, as the
   * `llm-pi-ai` settings section declares it. A source reads the account this
   * harness actually routes to instead of guessing at an environment name.
   */
  piAiApiKeyEnv?: (routeId: string) => string | undefined
  /** The deployment's default model route. */
  defaultSelection?: () => { provider: string; model: string } | null
  warn?: (message: string) => void
}

/** One source's cached state. */
interface SourceCache {
  snapshot: SourceSnapshot | null
  fetchedAt: number | null
  error: { code: ErrorCode; message: string } | null
  /** True when this source declared itself absent (no credential/endpoint). */
  skipped: boolean
  /** Why it declared itself absent, for the placeholder that names the route. */
  skipDetail: string | null
  /** Earliest time the next attempt may run. */
  nextAttemptAt: number
  inFlight: Promise<void> | null
}

/** The state builder the HTTP route calls. */
export interface Aggregator {
  /** Refresh what is due and build the payload. Never rejects. */
  state(signal?: AbortSignal): Promise<StateResponse>
}

/** Turn any thrown value into the shared failure vocabulary. */
export function toFailure(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof HttpFailure) return { code: error.code, message: error.message }
  if (error instanceof SkipSource) return { code: error.code, message: error.message }
  return { code: 'NETWORK', message: error instanceof Error ? error.message : String(error) }
}

/**
 * Build the aggregator.
 * @param input - configuration plus the host seams every probe needs.
 * @returns the state builder used by the HTTP route and by the tests.
 */
export function createAggregator(input: AggregatorInput): Aggregator {
  const now = input.now ?? (() => Date.now())
  const warn = input.warn ?? (() => {})
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const caches = new Map<string, SourceCache>()

  function cacheFor(id: string): SourceCache {
    const existing = caches.get(id)
    if (existing !== undefined) return existing
    const created: SourceCache = {
      snapshot: null,
      fetchedAt: null,
      error: null,
      skipped: false,
      skipDetail: null,
      nextAttemptAt: 0,
      inFlight: null,
    }
    caches.set(id, created)
    return created
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
  function enabledProbes(): Probe[] {
    const explicit = input.config.explicitSources
    if (explicit !== null) {
      const wanted = new Set(explicit)
      return input.probes.filter((probe) => wanted.has(probe.id))
    }
    const routes = input.listRoutes?.() ?? []
    if (routes.length === 0) return []
    return input.probes.filter((probe) => routes.some((route) => probe.match(route.id)))
  }

  function hostFor(probe: Probe, routes: readonly string[]): ProbeHost {
    const override = input.config.sourceOverrides[probe.id]
    // The first registered route this source answers for: the credential the
    // routed adapter would use belongs to that route, not to the plugin.
    const route = routes.find((candidate) => probe.match(candidate))
    const routeApiKeyEnv = route === undefined ? undefined : input.piAiApiKeyEnv?.(route)
    return {
      config: input.config,
      timeoutMs: input.config.timeoutMs,
      fetchImpl,
      ...(route === undefined ? {} : { routeId: route }),
      ...(routeApiKeyEnv === undefined ? {} : { routeApiKeyEnv }),
      ...(input.llmDeepseek === undefined ? {} : { llmDeepseek: input.llmDeepseek() }),
      now,
      resolveSecret: input.resolveSecret,
      warn,
    }
  }

  async function refresh(probe: Probe, routes: readonly string[], signal: AbortSignal | undefined): Promise<void> {
    const cache = cacheFor(probe.id)
    const current = now()
    if (cache.inFlight !== null) return cache.inFlight

    const fresh = cache.fetchedAt !== null && cache.error === null && current < cache.fetchedAt + input.config.refreshMs
    // `nextAttemptAt` carries both cadences: the TTL after a success, the shorter
    // retry delay after a failure or a skip.
    if (fresh || current < cache.nextAttemptAt) return

    cache.inFlight = (async () => {
      try {
        const snapshot = await probe.probe(hostFor(probe, routes), signal ?? new AbortController().signal)
        cache.snapshot = snapshot
        cache.fetchedAt = now()
        cache.error = null
        cache.skipped = false
        cache.skipDetail = null
        cache.nextAttemptAt = cache.fetchedAt + input.config.refreshMs
      } catch (error) {
        if (error instanceof SkipSource) {
          // A skip is silent by design, but it must still be explainable:
          // log it once per distinct reason and keep it for the placeholder.
          if (cache.skipDetail !== error.message) warn(`${probe.id}: skipped — ${error.message}`)
          cache.skipped = true
          cache.skipDetail = error.message
          cache.nextAttemptAt = now() + RETRY_MS
          return
        }
        const failure = toFailure(error)
        cache.error = failure
        cache.skipped = false
        cache.skipDetail = null
        cache.nextAttemptAt = now() + Math.min(input.config.refreshMs, RETRY_MS)
        warn(`${probe.id}: ${failure.code} ${failure.message}`)
      } finally {
        cache.inFlight = null
      }
    })()
    return cache.inFlight
  }

  return {
    async state(signal) {
      const probes = enabledProbes()
      const routes = input.listRoutes?.() ?? []
      await Promise.all(probes.map((probe) => refresh(probe, routes.map((route) => route.id), signal)))
      const at = now()
      const sources: SourceState[] = []

      for (const probe of probes) {
        const cache = cacheFor(probe.id)
        if (cache.skipped || (cache.snapshot === null && cache.error === null)) continue
        const override = input.config.sourceOverrides[probe.id]
        const providers = routes.filter((route) => probe.match(route.id)).map((route) => route.id)
        sources.push({
          id: probe.id,
          label: override?.label ?? probe.label,
          ok: cache.error === null && cache.snapshot !== null,
          providers,
          ...(cache.fetchedAt === null
            ? {}
            : { fetchedAt: cache.fetchedAt, ageMs: Math.max(0, at - cache.fetchedAt) }),
          ...(cache.error !== null && cache.snapshot !== null ? { stale: true } : {}),
          ...(cache.snapshot === null ? {} : { snapshot: cache.snapshot }),
          ...(cache.error === null ? {} : { error: cache.error }),
        })
      }

      // A configured provider must never silently disappear: any registered
      // route no source claimed gets a row that names it and says why it is
      // empty, without issuing a request of its own.
      const claimed = new Set(sources.flatMap((source) => source.providers))
      for (const route of routes) {
        if (claimed.has(route.id)) continue
        // Carry the probe's own reason onto the placeholder, so "no usage API"
        // can be told apart from "the credential it looked for is missing".
        const owner = probes.find((probe) => probe.match(route.id))
        const detail = owner === undefined ? null : cacheFor(owner.id).skipDetail
        sources.push({
          id: `route:${route.id}`,
          label: route.name === null ? route.id : route.name,
          ok: true,
          providers: [route.id],
          snapshot: { kind: 'unsupported', reason: 'no-usage-api', ...(detail === null ? {} : { detail }) },
        })
      }

      const selection = input.defaultSelection?.() ?? null
      return {
        ok: true,
        now: at,
        refreshMs: input.config.refreshMs,
        defaultMode: input.config.defaultMode,
        percentMode: input.config.percentMode,
        colors: input.config.colors,
        thresholds: input.config.thresholds,
        balanceThresholds: input.config.balanceThresholds,
        defaultProvider: selection === null ? null : { provider: selection.provider, model: selection.model },
        sources,
      }
    },
  }
}
