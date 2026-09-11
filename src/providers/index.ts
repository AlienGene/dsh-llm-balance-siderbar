/**
 * The probe registry — the one line a new provider is added to.
 *
 * @module dsh-llm-balance/providers
 */
import { deepseekProbe } from './deepseek.ts'
import { kimiCodeProbe } from './kimi-code.ts'
import { moonshotProbe } from './moonshot.ts'
import { opencodeProbe } from './opencode.ts'
import type { Probe } from './types.ts'

export { deepseekProbe, DEEPSEEK_SOURCE_ID, parseDeepseekBalance } from './deepseek.ts'
export {
  kimiCodeProbe,
  KIMI_SOURCE_ID,
  parseKimiResetTime,
  parseKimiTokens,
  parseKimiUsage,
  resetKimiTokenCache,
} from './kimi-code.ts'
export { moonshotProbe, MOONSHOT_SOURCE_ID, parseMoonshotBalance } from './moonshot.ts'
export {
  OPENCODE_DEFAULT_API_KEY_ENV,
  OPENCODE_SOURCE_ID,
  opencodeBaseURL,
  opencodeProbe,
  parseOpencodeUsage,
  parseResetInstant,
} from './opencode.ts'
export { SkipSource, type Probe, type ProbeHost } from './types.ts'

/**
 * Every shipped source, in display order.
 *
 * Registration order decides the card's row order and the fallback when two
 * sources could answer for one route. A new provider appends one entry here.
 */
export const PROBES: readonly Probe[] = [deepseekProbe, kimiCodeProbe, opencodeProbe, moonshotProbe]

/** Look one probe up by its stable id. */
export function probeById(id: string): Probe | undefined {
  return PROBES.find((probe) => probe.id === id)
}

/** The probes that answer for one registered LLM route id. */
export function probesForRoute(routeId: string): Probe[] {
  return PROBES.filter((probe) => probe.match(routeId))
}
