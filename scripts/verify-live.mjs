/**
 * Live read-only probe of every configured source, using the built host half.
 *
 * It performs exactly the calls the mounted plugin performs, prints the
 * normalized numbers, and never echoes a secret. Nothing is written anywhere.
 *
 * Usage: node scripts/verify-live.mjs
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig } from '../lib/config.js'
import { formatAmount, formatCountdown, formatPercent, formatWindowLabel, levelOf, levelOfBalance } from '../lib/format.js'
import { PROBES } from '../lib/providers.js'
import { createAggregator } from '../lib/state.js'

const home = homedir()
const env = process.env

/** Read `refs:` out of the DSH credential document without a YAML dependency. */
async function credentialRefs() {
  const refs = {}
  try {
    const text = await readFile(join(env['DSH_HOME'] ?? join(home, '.dsh'), '.credentials.yaml'), 'utf8')
    let inRefs = false
    for (const line of text.split(/\r?\n/)) {
      if (/^refs:\s*$/.test(line)) {
        inRefs = true
        continue
      }
      if (/^\S/.test(line)) {
        inRefs = false
        continue
      }
      if (!inRefs) continue
      const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(\S.*)$/.exec(line)
      if (match !== null) refs[match[1]] = match[2].trim()
    }
  } catch {
    /* no credential document: environment variables are the only source */
  }
  return refs
}

const refs = await credentialRefs()
const config = normalizeConfig(undefined, env)

/**
 * The credential reference each `llm-pi-ai` route declares, read from the
 * profile's settings document with the same two-line scanner the host uses for
 * the credential references. Absent keys just leave the probe on its defaults.
 */
async function routeApiKeyEnvs() {
  const table = {}
  try {
    const text = await readFile(join(env['DSH_HOME'] ?? join(home, '.dsh'), 'settings.yaml'), 'utf8')
    let inProviders = false
    let route = null
    for (const line of text.split(/\r?\n/)) {
      if (/^llm-pi-ai:\s*$/.test(line)) {
        inProviders = false
        route = null
        continue
      }
      if (/^\S/.test(line)) {
        inProviders = false
        route = null
        continue
      }
      if (/^ {2}providers:\s*$/.test(line)) {
        inProviders = true
        continue
      }
      if (!inProviders) continue
      const key = /^ {4}([A-Za-z0-9_.-]+):\s*$/.exec(line)
      if (key !== null) {
        route = key[1]
        continue
      }
      const env = /^ {6}apiKeyEnv:\s*(\S+)\s*$/.exec(line)
      if (env !== null && route !== null) table[route] = env[1]
    }
  } catch {
    /* no settings document: every route keeps the probe's own default */
  }
  return table
}

const routeRefs = await routeApiKeyEnvs()

const aggregator = createAggregator({
  config,
  probes: PROBES,
  resolveSecret: async (name) => {
    const stored = refs[name]
    if (typeof stored === 'string' && stored.length > 0) return stored
    const fromEnv = env[name]
    return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
  },
  listRoutes: () => [
    { id: 'deepseek-official', name: 'DeepSeek' },
    { id: 'kimi-coding', name: 'Kimi For Coding' },
    { id: 'opencode-go', name: 'OpenCode Go' },
  ],
  piAiApiKeyEnv: (routeId) => routeRefs[routeId],
  defaultSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  warn: (message) => console.warn(`[warn] ${message}`),
})

const state = await aggregator.state()
console.log(`fetched at ${new Date(state.now).toISOString()}`)
console.log(`sources: ${state.sources.length}`)

for (const source of state.sources) {
  const status = source.ok ? 'ok' : source.stale === true ? 'stale' : 'failed'
  console.log(`\n● ${source.label} [${source.id}] ${status}  routes=${JSON.stringify(source.providers)}`)
  if (source.error !== undefined) console.log(`  error: ${source.error.code} — ${source.error.message}`)
  const snapshot = source.snapshot
  if (snapshot === undefined) continue
  if (snapshot.kind === 'balance') {
    for (const entry of snapshot.entries) {
      const level = levelOfBalance(source.id, entry.currency, entry.total, state.balanceThresholds)
      const parts = (entry.parts ?? []).map((part) => `${part.key}=${part.amount}`).join(' ')
      console.log(`  ${formatAmount(entry.total, entry.currency)}  (${level}) ${parts}`.trimEnd())
    }
    if (snapshot.note !== undefined) console.log(`  note: ${snapshot.note}`)
  } else {
    if (snapshot.plan !== undefined) console.log(`  plan: ${snapshot.plan}`)
    for (const window of snapshot.windows) {
      const level = levelOf(window.remainingPercent)
      const reset = window.resetsAt === undefined ? '' : ` resets in ${formatCountdown(window.resetsAt - state.now, 'zh')}`
      const label =
        window.duration === null || window.timeUnit === null
          ? window.kind
          : `${window.kind}/${formatWindowLabel(window.duration, window.timeUnit, 'zh')}`
      console.log(
        `  ${label}  used=${formatPercent(window.used)}  remaining=${formatPercent(window.remainingPercent)} (${level})${reset}`,
      )
    }
  }
}

if (state.sources.length === 0) {
  console.log('\nno source reported data — check the credential references:')
  for (const name of ['DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY']) {
    console.log(`  ${name}: ${refs[name] !== undefined || env[name] !== undefined ? 'present' : 'absent'}`)
  }
  console.log(`  kimi CLI credential: ${join(home, '.kimi-code', 'credentials', 'kimi-code.json')}`)
  process.exitCode = 1
}
