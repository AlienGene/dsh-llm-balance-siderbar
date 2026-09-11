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
import { HttpFailure, fetchJson, numberOf, recordOf } from '../http.ts'
import type { QuotaWindow, SourceSnapshot } from '../protocol.ts'
import { SkipSource, credentialCandidates, resolveFirstSecret, type Probe, type ProbeHost } from './types.ts'

/** Stable source id. */
export const OPENCODE_SOURCE_ID = 'opencode-go'

/** The catalog default credential reference; a configured route overrides it. */
export const OPENCODE_DEFAULT_API_KEY_ENV = 'OPENCODE_API_KEY'

/** Endpoint per pi-ai catalog route id (the catalog carries it per model, not per provider). */
const OPENCODE_BASE_URLS: Readonly<Record<string, string>> = {
  'opencode-go': 'https://opencode.ai/zen/go',
  opencode: 'https://opencode.ai/zen',
  'opencode-zen': 'https://opencode.ai/zen',
}

/** The three windows OpenCode reports, in display order. */
const WINDOW_ORDER: ReadonlyArray<{ key: string; kind: QuotaWindow['kind'] }> = [
  { key: 'rolling', kind: 'rolling' },
  { key: 'weekly', kind: 'week' },
  { key: 'monthly', kind: 'month' },
]

/** Which usage endpoint this route uses, or `null` when the route is not one we know. */
export function opencodeBaseURL(host: ProbeHost, routeId: string | undefined): string | null {
  const override = host.config.opencode?.baseURL
  if (override !== undefined) return override.replace(/\/+$/, '')
  if (routeId === undefined) return null
  const known = OPENCODE_BASE_URLS[routeId]
  return known === undefined ? null : known.replace(/\/+$/, '')
}

/**
 * Parse the usage payload into ordered windows.
 *
 * A window is kept when it carries a finite `percent`; `status` is advisory
 * (`ok` or `rate-limited`) because a limited window still has a number worth
 * showing. `resetAt`/`resetsAt` are accepted as ISO strings.
 */
export function parseOpencodeUsage(payload: unknown): QuotaWindow[] {
  const usage = recordOf(recordOf(payload)['usage'])
  const windows: QuotaWindow[] = []
  for (const { key, kind } of WINDOW_ORDER) {
    const entry = recordOf(usage[key])
    const percent = numberOf(entry['percent'])
    if (percent === null) continue
    const used = Math.max(0, Math.min(100, percent))
    const resetsAt = parseResetInstant(entry['resetsAt'] ?? entry['resetAt'])
    windows.push({
      kind,
      duration: null,
      timeUnit: null,
      used,
      limit: 100,
      remaining: 100 - used,
      remainingPercent: 100 - used,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }
  return windows
}

/** Read an ISO instant (or epoch seconds/milliseconds) into epoch milliseconds. */
export function parseResetInstant(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    return undefined
  }
  const numeric = numberOf(value)
  if (numeric === null) return undefined
  return numeric > 1e11 ? numeric : numeric * 1000
}

/** OpenCode usage probe. */
export const opencodeProbe: Probe = {
  id: OPENCODE_SOURCE_ID,
  label: 'OpenCode Go',
  match: (routeId) => /^opencode/i.test(routeId),
  async probe(host, signal): Promise<SourceSnapshot> {
    const baseURL = opencodeBaseURL(host, host.routeId)
    // An `opencode*` route we have no endpoint for stays out of the payload, so
    // the aggregator's placeholder names it instead of guessing at a URL.
    if (baseURL === null) throw new SkipSource('NOT_SUPPORTED', 'no known usage endpoint for this route')

    // Try every reference this route could plausibly be configured under, not
    // just the catalog default: a route configured as `OPENCODE_GO_API_KEY`
    // must never be read as "no credential".
    const candidates = credentialCandidates(host, host.config.opencode?.apiKeyEnv, [
      OPENCODE_DEFAULT_API_KEY_ENV,
      'OPENCODE_GO_API_KEY',
    ])
    const resolved = await resolveFirstSecret(host, candidates)
    if (resolved === null) {
      throw new SkipSource('NO_CREDENTIAL', `none of ${candidates.join(', ')} is set`)
    }
    const secret = resolved.secret

    let payload: unknown
    try {
      payload = await fetchJson({
        url: `${baseURL}/v1/usage`,
        headers: { authorization: `Bearer ${secret}` },
        timeoutMs: host.timeoutMs,
        signal,
        fetchImpl: host.fetchImpl,
      })
    } catch (error) {
      // A plan without the usage surface answers 404 (sometimes 400). That is
      // "nothing to read here", not a failure to report as an error.
      if (error instanceof HttpFailure && (error.status === 404 || error.status === 400)) {
        return { kind: 'unsupported', reason: 'no-usage-api' }
      }
      throw error
    }

    const windows = parseOpencodeUsage(payload)
    if (windows.length === 0) throw new HttpFailure('BAD_RESPONSE', 'the usage response carried no windows')
    return { kind: 'quota', windows }
  },
}
