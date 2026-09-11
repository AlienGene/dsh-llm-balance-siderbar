/**
 * The card's one network call.
 *
 * Resolved against `document.baseURI` rather than the origin, because a
 * deployment behind a reverse proxy mounts the harness under a path prefix and
 * a root-absolute URL would leave that prefix behind.
 *
 * @module dsh-llm-balance/client/api
 */
import type { StateResponse } from '../protocol.ts'

/** Path of the host route this card reads. */
export const STATE_PATH = 'dsh-llm-balance/state'

/** Resolve the state URL against the directory the shell served this bundle from. */
export function stateUrl(): string {
  if (typeof document === 'undefined') return `/${STATE_PATH}`
  return new URL(STATE_PATH, document.baseURI).pathname
}

/** Read one state payload. */
export async function fetchState(signal?: AbortSignal): Promise<StateResponse> {
  const response = await fetch(stateUrl(), {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as Partial<StateResponse>
  if (payload.ok !== true || !Array.isArray(payload.sources)) throw new Error('unexpected payload')
  return payload as StateResponse
}
