/**
 * The one HTTP route the browser half reads.
 *
 * A read-only GET returning balance and quota numbers. The card polls it on the
 * same origin that served it, so the browser's own request carries whatever
 * session the shell issued; the route adds no CORS header and no-store caching.
 * The API keys never leave the host process — this payload contains numbers,
 * currency codes, durations, and failure codes, nothing else.
 *
 * @module dsh-llm-balance/route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Aggregator } from './state.ts'

/** Path of the state route, as the browser half resolves it against `document.baseURI`. */
export const STATE_ROUTE_PATH = '/dsh-llm-balance/state'

/** The slice of `ctx.webServer` this route uses. */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Write a JSON body with no-store caching. */
export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

/**
 * Register the state route.
 * @param webServer - the host's browser HTTP carrier.
 * @param aggregator - the state builder to call per request.
 * @returns the disposer removing the route.
 */
export function registerStateRoute(webServer: WebServerLike, aggregator: Aggregator): () => void {
  return webServer.register({
    kind: 'exact',
    path: STATE_ROUTE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        sendJson(response, 200, await aggregator.state())
      } catch (error) {
        // `state()` is written not to reject; this is the belt to that suspenders,
        // because an unhandled rejection here would leave the socket hanging.
        sendJson(response, 500, {
          ok: false,
          error: { code: 'NETWORK', message: error instanceof Error ? error.message : String(error) },
        })
      }
    },
  })
}
