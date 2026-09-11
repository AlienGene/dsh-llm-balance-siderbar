/**
 * The one HTTP door every probe uses: JSON in, typed failure out.
 *
 * Providers differ in payloads, not in transport, so timeout, abort, status
 * mapping, and JSON decoding live here once. A failure carries the shared
 * {@link ErrorCode} vocabulary the card renders.
 *
 * @module dsh-llm-balance/http
 */
import type { ErrorCode } from './protocol.ts'

/** Injected fetch shape (globals are not assumed: the tests pass a stub). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** A provider call that failed, classified for display. */
export class HttpFailure extends Error {
  readonly code: ErrorCode
  readonly status: number | null

  constructor(code: ErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'HttpFailure'
    this.code = code
    this.status = status
  }
}

/** One JSON request. */
export interface JsonRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs: number
  signal?: AbortSignal
  fetchImpl: FetchLike
}

/**
 * Run one request and decode a JSON body.
 * @param request - url, method, headers, optional form body, and the timeout.
 * @returns the decoded JSON value.
 * @throws {HttpFailure} for every transport, status, or decoding problem.
 */
export async function fetchJson(request: JsonRequest): Promise<unknown> {
  const timeout = AbortSignal.timeout(request.timeoutMs)
  const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])
  let response: Response
  try {
    response = await request.fetchImpl(request.url, {
      method: request.method ?? 'GET',
      headers: { accept: 'application/json', ...(request.headers ?? {}) },
      ...(request.body === undefined ? {} : { body: request.body }),
      signal,
    })
  } catch (error) {
    if (timeout.aborted) throw new HttpFailure('TIMEOUT', `no response within ${request.timeoutMs}ms`)
    if (request.signal?.aborted === true) throw new HttpFailure('NETWORK', 'request aborted')
    throw new HttpFailure('NETWORK', error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new HttpFailure(mapStatus(response.status), detail, response.status)
  }

  try {
    return (await response.json()) as unknown
  } catch (error) {
    throw new HttpFailure('BAD_RESPONSE', `not JSON: ${error instanceof Error ? error.message : String(error)}`, response.status)
  }
}

/** Preview a failed response body without ever echoing more than a line. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const trimmed = text.trim().replace(/\s+/g, ' ')
    return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed
  } catch {
    return `HTTP ${response.status}`
  }
}

function mapStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'UNAUTHORIZED'
  if (status === 429) return 'RATE_LIMITED'
  return 'HTTP_ERROR'
}

/** Read a finite number from either a JSON number or a numeric string. */
export function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Read a nested record without assuming the provider kept its shape. */
export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Read an array of unknown entries, or an empty array. */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
