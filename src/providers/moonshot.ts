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
import { HttpFailure, fetchJson, numberOf, recordOf } from '../http.ts'
import type { BalanceEntry, SourceSnapshot } from '../protocol.ts'
import { SkipSource, credentialCandidates, resolveFirstSecret, type Probe, type ProbeHost } from './types.ts'

/** Stable source id; also the key prefix of this source's balance thresholds. */
export const MOONSHOT_SOURCE_ID = 'moonshot-balance'

/** One parsed balance payload. */
export interface MoonshotBalance {
  currency: string
  available: number
  voucher: number | null
  cash: number | null
}

/** Parse one balance payload, mapping the region to its billing currency. */
export function parseMoonshotBalance(payload: unknown, region: 'cn' | 'intl'): MoonshotBalance | null {
  const data = recordOf(recordOf(payload)['data'])
  const available = numberOf(data['available_balance'])
  if (available === null) return null
  return {
    currency: region === 'intl' ? 'USD' : 'CNY',
    available,
    voucher: numberOf(data['voucher_balance']),
    cash: numberOf(data['cash_balance']),
  }
}

/** Balance host for one region. */
export function moonshotBaseURL(host: ProbeHost): string {
  const override = host.config.sourceOverrides[MOONSHOT_SOURCE_ID]?.baseURL
  if (override !== undefined) return override.replace(/\/+$/, '')
  return host.config.moonshot.region === 'intl' ? 'https://api.moonshot.ai/v1' : 'https://api.moonshot.cn/v1'
}

/** Moonshot / Kimi Open Platform balance probe. */
export const moonshotProbe: Probe = {
  id: MOONSHOT_SOURCE_ID,
  label: 'Moonshot',
  match: (routeId) => /^(moonshot|moonshotai)/i.test(routeId),
  async probe(host, signal) {
    const override = host.config.sourceOverrides[MOONSHOT_SOURCE_ID]
    const candidates = credentialCandidates(host, override?.apiKeyEnv ?? host.config.moonshot.apiKeyEnv, [
      'MOONSHOT_API_KEY',
    ])
    const resolved = await resolveFirstSecret(host, candidates)
    if (resolved === null) throw new SkipSource('NO_CREDENTIAL', `none of ${candidates.join(', ')} is set`)
    const secret = resolved.secret

    const region = override?.region ?? host.config.moonshot.region
    const payload = await fetchJson({
      url: `${moonshotBaseURL(host)}/users/me/balance`,
      headers: { authorization: `Bearer ${secret}` },
      timeoutMs: host.timeoutMs,
      signal,
      fetchImpl: host.fetchImpl,
    })

    const balance = parseMoonshotBalance(payload, region)
    if (balance === null) throw new HttpFailure('BAD_RESPONSE', 'no data.available_balance in the response')

    const entry: BalanceEntry = { currency: balance.currency, total: balance.available }
    const snapshot: SourceSnapshot = { kind: 'balance', entries: [entry] }
    if (balance.cash !== null && balance.cash < 0) return { ...snapshot, note: 'deficit' }
    return snapshot
  },
}
