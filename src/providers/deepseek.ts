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
import { HttpFailure, arrayOf, fetchJson, numberOf, recordOf } from '../http.ts'
import type { BalanceEntry, SourceSnapshot } from '../protocol.ts'
import { SkipSource, type Probe, type ProbeHost } from './types.ts'

/** Stable source id; also the key prefix of this source's balance thresholds. */
export const DEEPSEEK_SOURCE_ID = 'deepseek-balance'

/** One currency row as the provider sends it. */
export interface DeepseekBalanceRow {
  currency: string
  total: number
  granted: number | null
  toppedUp: number | null
}

/** Parse the documented balance payload without trusting its exact shape. */
export function parseDeepseekBalance(payload: unknown): {
  rows: DeepseekBalanceRow[]
  isAvailable: boolean | null
} {
  const root = recordOf(payload)
  const isAvailable = typeof root['isAvailable'] === 'boolean' ? root['isAvailable'] : null
  const declared = root['is_available']
  const availability = isAvailable ?? (typeof declared === 'boolean' ? declared : null)
  const rows: DeepseekBalanceRow[] = []
  for (const entry of arrayOf(root['balance_infos'])) {
    const record = recordOf(entry)
    const total = numberOf(record['total_balance'])
    const currency = typeof record['currency'] === 'string' ? record['currency'] : null
    if (total === null || currency === null) continue
    rows.push({
      currency,
      total,
      granted: numberOf(record['granted_balance']),
      toppedUp: numberOf(record['topped_up_balance']),
    })
  }
  return { rows, isAvailable: availability }
}

/** Resolve the endpoint the routed adapter would use. */
export function deepseekBaseURL(host: ProbeHost): string {
  const configured = host.config.deepseek.baseURL ?? host.llmDeepseek?.baseURL ?? process.env['DEEPSEEK_BASE_URL'] ?? null
  return (configured ?? 'https://api.deepseek.com').replace(/\/+$/, '')
}

/**
 * Resolve the credential reference the routed adapter would use: the route's own
 * configured reference first, then the `llm-deepseek` settings section, then the
 * plugin's default.
 */
export function deepseekApiKeyEnv(host: ProbeHost): string {
  if (host.routeApiKeyEnv !== undefined) return host.routeApiKeyEnv
  return host.config.deepseek.apiKeyEnv === 'DEEPSEEK_API_KEY' && host.llmDeepseek?.apiKeyEnv !== undefined
    ? host.llmDeepseek.apiKeyEnv
    : host.config.deepseek.apiKeyEnv
}

/** DeepSeek balance probe. */
export const deepseekProbe: Probe = {
  id: DEEPSEEK_SOURCE_ID,
  label: 'DeepSeek',
  match: (routeId) => /^deepseek/i.test(routeId),
  async probe(host, signal) {
    const envName = deepseekApiKeyEnv(host)
    const secret = await host.resolveSecret(envName)
    if (secret === null) throw new SkipSource('NO_CREDENTIAL', `${envName} is not configured`)

    const payload = await fetchJson({
      url: `${deepseekBaseURL(host)}/user/balance`,
      headers: { authorization: `Bearer ${secret}` },
      timeoutMs: host.timeoutMs,
      signal,
      fetchImpl: host.fetchImpl,
    })

    const { rows, isAvailable } = parseDeepseekBalance(payload)
    if (rows.length === 0) throw new HttpFailure('BAD_RESPONSE', 'no balance_infos in the response')

    const entries: BalanceEntry[] = []
    for (const row of rows) {
      // The amount alone: the granted/topped-up split is shown nowhere, so it is
      // carried nowhere either.
      entries.push({ currency: row.currency, total: row.total })
    }

    const snapshot: SourceSnapshot = { kind: 'balance', entries }
    if (isAvailable === false) return { ...snapshot, note: 'unavailable' }
    return snapshot
  },
}
