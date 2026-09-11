/**
 * The provider seam: one probe per credential surface this card can read.
 *
 * A probe answers "what does this account still have?" for exactly one source
 * id. Adding a provider (Z.AI, Qwen, Codex, …) means one file exporting a
 * {@link Probe} plus one line in `registry.ts` — no other module changes.
 *
 * A probe that finds no credential throws {@link SkipSource}: the source is
 * simply absent from the payload, which is how auto-detection works without a
 * separate discovery pass.
 *
 * @module dsh-llm-balance/providers/types
 */
import type { ResolvedConfig } from '../config.ts'
import type { FetchLike } from '../http.ts'
import type { ErrorCode, SourceSnapshot } from '../protocol.ts'

/** Everything a probe may use from the host. */
export interface ProbeHost {
  config: ResolvedConfig
  timeoutMs: number
  fetchImpl: FetchLike
  /**
   * Facts the mounted `llm-deepseek` adapter resolves per request, read from its
   * user-settings section. Present so this card follows the same endpoint and
   * credential reference the routed model actually uses.
   */
  llmDeepseek?: { baseURL?: string; apiKeyEnv?: string } | null
  /**
   * Credential reference configured for the registered route this probe answers
   * for (e.g. `KIMI_CODING_API_KEY` for a `kimi-coding` route). Present only
   * when the host could read it, and preferred over the plugin's own default:
   * the route names the account the harness actually spends from.
   */
  routeApiKeyEnv?: string
  /**
   * The registered route id that selected this probe, when there is one. A
   * probe whose endpoint varies by route (the `opencode*` family) reads it;
   * everything else ignores it.
   */
  routeId?: string
  now(): number
  /** Resolve one credential reference (the DSH credential seam, then the process environment). */
  resolveSecret(envName: string): Promise<string | null>
  warn(message: string): void
}

/** One readable account surface. */
export interface Probe {
  id: string
  /** Product name shown on the card; not translated. */
  label: string
  /** Whether this probe answers for one registered LLM route id. */
  match(routeId: string): boolean
  probe(host: ProbeHost, signal: AbortSignal): Promise<SourceSnapshot>
}

/** Thrown when a probe has nothing to read — the source stays out of the payload. */
export class SkipSource extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'SkipSource'
    this.code = code
  }
}

/**
 * Credential references worth trying for one probe, in priority order.
 *
 * The route's own configured reference comes first (it names the account this
 * harness actually spends from), then the probe's configured one, then the
 * reference derived from the route id (`opencode-go` → `OPENCODE_GO_API_KEY`),
 * then the probe's shipped defaults. Deriving it matters: a route configured
 * under a name the probe has never heard of would otherwise fall through to a
 * catalog default the user never set, and the source would look unconfigured.
 */
export function credentialCandidates(
  host: ProbeHost,
  configured: string | null | undefined,
  defaults: readonly string[],
): string[] {
  const derived =
    host.routeId === undefined ? null : `${host.routeId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_API_KEY`
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const candidate of [host.routeApiKeyEnv, configured, derived, ...defaults]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    candidates.push(candidate)
  }
  return candidates
}

/** The first candidate reference that resolves to a value. */
export async function resolveFirstSecret(
  host: ProbeHost,
  candidates: readonly string[],
): Promise<{ envName: string; secret: string } | null> {
  for (const envName of candidates) {
    const secret = await host.resolveSecret(envName)
    if (secret !== null) return { envName, secret }
  }
  return null
}
