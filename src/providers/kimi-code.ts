/**
 * Kimi For Coding — a *subscription*, so the card shows the plan's quota
 * windows instead of a balance.
 *
 * `GET {baseURL}/usages` answers the plan's total pool (`usage`) plus one entry
 * per rolling rate limit (`limits[].window`), each with `limit`/`used`/
 * `remaining`/`resetTime`. A five-hour window arrives as
 * `{duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}`; the card renders it as
 * `5小时 剩余95%` plus a local countdown to `resetTime`.
 *
 * Credentials come from an API key (`KIMI_API_KEY` by default) or from the Kimi
 * Code CLI's own OAuth file, whose access token lives only ~15 minutes. An
 * expired token is refreshed through `{oauthHost}/api/oauth/token` and written
 * back **only** when the credential file is still byte-identical to what this
 * process read — so the plugin can keep the CLI working without ever fighting
 * it for the file.
 *
 * @module dsh-llm-balance/providers/kimi-code
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { remainingPercentOf } from '../format.ts'
import { HttpFailure, arrayOf, fetchJson, numberOf, recordOf } from '../http.ts'
import type { QuotaWindow, SourceSnapshot } from '../protocol.ts'
import { SkipSource, credentialCandidates, type Probe, type ProbeHost } from './types.ts'

/** Stable source id. */
export const KIMI_SOURCE_ID = 'kimi-code'

/** Refresh this long before expiry so a poll never races the deadline. */
export const REFRESH_SKEW_MS = 60_000

/** The credential reference this probe's own config defaults to. */
export const DEFAULT_KIMI_API_KEY_ENV = 'KIMI_API_KEY'

/** One credential triple read from the CLI's OAuth document. */
export interface KimiTokens {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
}

/** In-process token cache: one refresh serves every later poll. */
let cachedTokens: KimiTokens | null = null

/** Drop the cached token (tests, and a failed refresh). */
export function resetKimiTokenCache(): void {
  cachedTokens = null
}

/** Read the CLI credential document, tolerating every shape variant it has shipped. */
export function parseKimiTokens(raw: string): KimiTokens | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const record = recordOf(parsed)
  const accessToken = typeof record['access_token'] === 'string' ? record['access_token'] : null
  if (accessToken === null || accessToken.length === 0) return null
  const refreshToken = typeof record['refresh_token'] === 'string' ? record['refresh_token'] : null
  const expiresAt = numberOf(record['expires_at'])
  // The CLI stores epoch seconds; a millisecond value is recognized by magnitude.
  const expiresAtMs = expiresAt === null ? null : expiresAt > 1e11 ? expiresAt : expiresAt * 1000
  return { accessToken, refreshToken, expiresAtMs }
}

/** Parse `resetTime` (an ISO instant) into epoch milliseconds. */
export function parseKimiResetTime(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000
  }
  return undefined
}

/** One rolling rate-limit window in a normalized, locale-free shape. */
function rateWindow(record: Record<string, unknown>): QuotaWindow | null {
  const window = recordOf(record['window'])
  const detail = recordOf(record['detail'])
  const limit = numberOf(detail['limit'])
  if (limit === null || limit <= 0) return null
  const used = numberOf(detail['used']) ?? 0
  const remaining = numberOf(detail['remaining']) ?? Math.max(0, limit - used)
  const resetsAt = parseKimiResetTime(detail['resetTime'])
  return {
    kind: 'rolling',
    duration: numberOf(window['duration']),
    timeUnit: typeof window['timeUnit'] === 'string' ? window['timeUnit'] : null,
    used,
    limit,
    remaining,
    remainingPercent: remainingPercentOf(remaining, limit) ?? 0,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function poolWindow(record: Record<string, unknown>): QuotaWindow | null {
  const limit = numberOf(record['limit'])
  if (limit === null || limit <= 0) return null
  const used = numberOf(record['used']) ?? 0
  const remaining = numberOf(record['remaining']) ?? Math.max(0, limit - used)
  const resetsAt = parseKimiResetTime(record['resetTime'])
  return {
    kind: 'week',
    duration: null,
    timeUnit: null,
    used,
    limit,
    remaining,
    remainingPercent: remainingPercentOf(remaining, limit) ?? 0,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** Rolling windows first (narrowest first), then the plan's weekly pool. */
function windowOrderMs(window: QuotaWindow): number {
  if (window.kind !== 'rolling' || window.duration === null) return Number.MAX_SAFE_INTEGER
  const unit = (window.timeUnit ?? '').replace(/^TIME_UNIT_/, '').toLowerCase()
  const factor =
    unit === 'minute' ? 60_000 : unit === 'hour' ? 3_600_000 : unit === 'day' ? 86_400_000 : unit === 'second' ? 1_000 : 60_000
  return window.duration * factor
}

/** Parse the usage payload into ordered windows (narrowest rolling window first, pool last). */
export function parseKimiUsage(payload: unknown): { windows: QuotaWindow[] } {
  const root = recordOf(payload)
  const pool = poolWindow(recordOf(root['usage']))
  const rates: QuotaWindow[] = []
  for (const entry of arrayOf(root['limits'])) {
    const window = rateWindow(recordOf(entry))
    if (window !== null) rates.push(window)
  }
  rates.sort((left, right) => windowOrderMs(left) - windowOrderMs(right))
  return { windows: [...rates, ...(pool === null ? [] : [pool])] }
}

/** First existing credential candidate. */
async function existingTokenFile(host: ProbeHost): Promise<string | null> {
  const candidates = [
    ...(host.config.kimiCode.tokenFile === null ? [] : [host.config.kimiCode.tokenFile]),
    ...host.config.kimiCode.tokenFileFallbacks,
  ]
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8')
      if (text.trim().length > 0) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

interface RefreshOutcome {
  tokens: KimiTokens
  /** True when the rotated token was persisted back to the CLI's document. */
  persisted: boolean
}

/** Exchange the refresh token for a fresh access token. */
async function refreshTokens(
  host: ProbeHost,
  file: string,
  rawBefore: string,
  previous: KimiTokens,
  signal: AbortSignal,
): Promise<RefreshOutcome> {
  if (previous.refreshToken === null) {
    throw new HttpFailure('TOKEN_EXPIRED', 'the Kimi credential has no refresh token')
  }
  const body = new URLSearchParams({
    client_id: host.config.kimiCode.clientId,
    grant_type: 'refresh_token',
    refresh_token: previous.refreshToken,
  })
  let payload: unknown
  try {
    payload = await fetchJson({
      url: `${host.config.kimiCode.oauthHost.replace(/\/+$/, '')}/api/oauth/token`,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeoutMs: host.timeoutMs,
      signal,
      fetchImpl: host.fetchImpl,
    })
  } catch (error) {
    if (error instanceof HttpFailure && (error.status === 401 || error.status === 403)) {
      throw new HttpFailure('TOKEN_EXPIRED', 'the Kimi refresh token was rejected')
    }
    throw error
  }
  const record = recordOf(payload)
  const accessToken = typeof record['access_token'] === 'string' ? record['access_token'] : null
  if (accessToken === null) throw new HttpFailure('BAD_RESPONSE', 'the refresh response carried no access_token')
  const expiresIn = numberOf(record['expires_in'])
  const tokens: KimiTokens = {
    accessToken,
    refreshToken: typeof record['refresh_token'] === 'string' ? record['refresh_token'] : previous.refreshToken,
    expiresAtMs: expiresIn === null ? null : Date.now() + expiresIn * 1000,
  }
  const persisted = await persistRefreshed(host, file, rawBefore, tokens, record)
  return { tokens, persisted }
}

/**
 * Write a rotated token back, but only under compare-and-swap.
 *
 * The credential file belongs to the Kimi Code CLI. If it moved between our
 * read and our write, the CLI refreshed first and its document is the newer
 * truth — overwriting it would sign the user out. A CAS miss therefore keeps
 * the refreshed token in memory only.
 */
async function persistRefreshed(
  host: ProbeHost,
  file: string,
  rawBefore: string,
  tokens: KimiTokens,
  response: Record<string, unknown>,
): Promise<boolean> {
  if (!host.config.kimiCode.persistRefreshedToken) return false
  let current: string | null = null
  try {
    current = await readFile(file, 'utf8')
  } catch {
    current = null
  }
  if (current === null || current !== rawBefore) {
    host.warn('kimi credential changed while refreshing; the new token stays in memory')
    return false
  }
  let document: Record<string, unknown>
  try {
    document = recordOf(JSON.parse(current) as unknown)
  } catch {
    document = {}
  }
  const expiresIn = numberOf(response['expires_in'])
  const merged: Record<string, unknown> = {
    ...document,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    scope: typeof document['scope'] === 'string' ? document['scope'] : 'kimi-code',
    token_type: typeof document['token_type'] === 'string' ? document['token_type'] : 'Bearer',
    expires_at: Math.floor((tokens.expiresAtMs ?? Date.now() + 900_000) / 1000),
  }
  if (expiresIn !== null) merged['expires_in'] = expiresIn
  const temporary = `${file}.tmp-${process.pid}`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file)
    return true
  } catch (error) {
    host.warn(`could not persist the refreshed Kimi token: ${String(error)}`)
    try {
      await unlink(temporary)
    } catch {
      /* nothing to clean up */
    }
    return false
  }
}

/** Resolve a usable bearer token, refreshing the CLI credential when it is stale. */
async function acquireToken(host: ProbeHost, signal: AbortSignal): Promise<{ token: string; from: string }> {
  // The route's own configured reference first (a `kimi-coding` route usually
  // names one, e.g. KIMI_CODING_API_KEY): it identifies the account this harness
  // spends from, which the CLI's OAuth file may not.
  // The same candidate chain the other probes use: the route's own reference
  // first, then the plugin's, then the one derived from the route id
  // (`kimi-coding` → `KIMI_CODING_API_KEY`), then the shipped default. Without
  // the derived name a route configured that way would silently fall through to
  // the CLI's OAuth token — possibly a different account.
  const references = credentialCandidates(host, host.config.kimiCode.apiKeyEnv, [
    DEFAULT_KIMI_API_KEY_ENV,
    'KIMI_CODING_API_KEY',
  ])
  for (const reference of references) {
    const apiKey = await host.resolveSecret(reference)
    if (apiKey !== null) return { token: apiKey, from: `api-key:${reference}` }
  }

  const now = host.now()
  if (cachedTokens !== null && cachedTokens.expiresAtMs !== null && cachedTokens.expiresAtMs - now > REFRESH_SKEW_MS) {
    return { token: cachedTokens.accessToken, from: 'oauth-cache' }
  }

  const file = await existingTokenFile(host)
  if (file === null) {
    throw new SkipSource(
      'NO_CREDENTIAL',
      `none of ${references.join(', ')} is set and no Kimi CLI credential was found`,
    )
  }

  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    throw new SkipSource('NO_CREDENTIAL', `Kimi credential unreadable: ${String(error)}`)
  }
  const tokens = parseKimiTokens(raw)
  if (tokens === null) throw new HttpFailure('TOKEN_EXPIRED', 'the Kimi credential document is not a token record')

  const fresh = tokens.expiresAtMs !== null && tokens.expiresAtMs - now > REFRESH_SKEW_MS
  if (fresh) {
    cachedTokens = tokens
    return { token: tokens.accessToken, from: 'oauth-file' }
  }

  const outcome = await refreshTokens(host, file, raw, tokens, signal)
  cachedTokens = outcome.tokens
  return { token: outcome.tokens.accessToken, from: outcome.persisted ? 'oauth-refresh' : 'oauth-refresh-memory' }
}

/** Kimi For Coding subscription-quota probe. */
export const kimiCodeProbe: Probe = {
  id: KIMI_SOURCE_ID,
  label: 'Kimi For Coding',
  match: (routeId) => /^kimi/i.test(routeId),
  async probe(host, signal) {
    const { token } = await acquireToken(host, signal)
    let payload: unknown
    try {
      payload = await fetchJson({
        url: `${host.config.kimiCode.baseURL.replace(/\/+$/, '')}/usages`,
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: host.timeoutMs,
        signal,
        fetchImpl: host.fetchImpl,
      })
    } catch (error) {
      if (error instanceof HttpFailure && (error.status === 401 || error.status === 403)) {
        cachedTokens = null
        throw new HttpFailure('TOKEN_EXPIRED', 'Kimi rejected the token; sign in again with the Kimi Code CLI')
      }
      throw error
    }

    const { windows } = parseKimiUsage(payload)
    if (windows.length === 0) throw new HttpFailure('BAD_RESPONSE', 'the usage response carried no windows')
    const snapshot: SourceSnapshot = { kind: 'quota', windows }
    return snapshot
  },
}
