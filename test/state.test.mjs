/**
 * Aggregator behaviour: per-source caching, coalescing, failure isolation, and
 * the stale snapshot a failing source keeps serving.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import { SkipSource } from '../lib/providers.js'
import { RETRY_MS, createAggregator, toFailure } from '../lib/state.js'

const CONFIG = normalizeConfig({ refreshMs: 60_000 }, { HOME: '/nonexistent', DSH_HOME: '/nonexistent' })

/** A scripted probe: each call consumes the next step, and it answers for its own id. */
function scriptedProbe(id, steps, { match = (route) => route === id } = {}) {
  const state = { calls: 0 }
  return {
    state,
    probe: {
      id,
      label: id,
      match,
      async probe() {
        const step = steps[Math.min(state.calls, steps.length - 1)]
        state.calls += 1
        if (typeof step === 'function') return step()
        if (step instanceof Error) throw step
        return step
      },
    },
  }
}

const BALANCE = { kind: 'balance', entries: [{ currency: 'CNY', total: 50 }] }

function makeAggregator({ probes, listRoutes, now = () => 1_000_000, defaultSelection }) {
  return createAggregator({
    config: CONFIG,
    probes,
    fetchImpl: async () => new Response('{}'),
    now,
    resolveSecret: async () => null,
    // Auto mode is gated on registered routes, so every scripted probe is
    // registered unless a test says otherwise.
    listRoutes: listRoutes ?? (() => probes.map((probe) => ({ id: probe.id, name: probe.id }))),
    ...(defaultSelection === undefined ? {} : { defaultSelection }),
    warn: () => {},
  })
}

test('a fresh source is not refetched inside the TTL', async () => {
  let clock = 1_000_000
  const scripted = scriptedProbe('a', [BALANCE])
  const aggregator = makeAggregator({ probes: [scripted.probe], now: () => clock })
  await aggregator.state()
  clock += 30_000
  await aggregator.state()
  assert.equal(scripted.state.calls, 1)

  clock += 31_000
  await aggregator.state()
  assert.equal(scripted.state.calls, 2)
})

test('concurrent polls share one in-flight probe call', async () => {
  let resolveProbe
  const gate = new Promise((resolve) => {
    resolveProbe = resolve
  })
  const calls = { count: 0 }
  const probe = {
    id: 'a',
    label: 'a',
    match: (route) => route === 'a',
    async probe() {
      calls.count += 1
      await gate
      return BALANCE
    },
  }
  const aggregator = makeAggregator({ probes: [probe] })
  const both = Promise.all([aggregator.state(), aggregator.state()])
  resolveProbe()
  const [first, second] = await both
  assert.equal(calls.count, 1)
  assert.equal(first.sources.length, 1)
  assert.equal(second.sources.length, 1)
})

test('one failing source never damages another', async () => {
  const broken = scriptedProbe('broken', [new Error('boom')])
  const healthy = scriptedProbe('healthy', [BALANCE])
  const aggregator = makeAggregator({ probes: [broken.probe, healthy.probe] })
  const state = await aggregator.state()
  const byId = Object.fromEntries(state.sources.map((source) => [source.id, source]))
  assert.equal(byId.healthy.ok, true)
  assert.equal(byId.healthy.snapshot.kind, 'balance')
  assert.equal(byId.broken.ok, false)
  assert.equal(byId.broken.error.code, 'NETWORK')
  assert.equal(byId.broken.snapshot, undefined)
})

test('a later failure keeps the previous snapshot and marks it stale', async () => {
  let clock = 1_000_000
  const scripted = scriptedProbe('a', [BALANCE, new Error('down')])
  const aggregator = makeAggregator({ probes: [scripted.probe], now: () => clock })
  const first = await aggregator.state()
  assert.equal(first.sources[0].ok, true)

  clock += 61_000
  const second = await aggregator.state()
  assert.equal(scripted.state.calls, 2)
  assert.equal(second.sources[0].ok, false)
  assert.equal(second.sources[0].stale, true)
  assert.equal(second.sources[0].snapshot.kind, 'balance')
  assert.equal(second.sources[0].error.code, 'NETWORK')
})

test('a failing source retries on the short cadence, not the poll cadence', async () => {
  let clock = 1_000_000
  const scripted = scriptedProbe('a', [new Error('down')])
  const aggregator = makeAggregator({ probes: [scripted.probe], now: () => clock })
  await aggregator.state()
  clock += RETRY_MS - 1
  await aggregator.state()
  assert.equal(scripted.state.calls, 1)
  clock += 2
  await aggregator.state()
  assert.equal(scripted.state.calls, 2)
})

test('a source without credentials falls back to a named placeholder, not silence', async () => {
  const skipped = scriptedProbe('skipped', [new SkipSource('NO_CREDENTIAL', 'none')])
  const healthy = scriptedProbe('healthy', [BALANCE])
  const aggregator = makeAggregator({ probes: [skipped.probe, healthy.probe] })
  const state = await aggregator.state()
  assert.deepEqual(state.sources.map((source) => source.id), ['healthy', 'route:skipped'])
  // The placeholder carries the probe's own reason, not just the generic note.
  assert.deepEqual(state.sources[1].snapshot, {
    kind: 'unsupported',
    reason: 'no-usage-api',
    detail: 'none',
  })
})

test('an explicit source list replaces auto-detection', async () => {
  const first = scriptedProbe('first', [BALANCE])
  const second = scriptedProbe('second', [BALANCE])
  const config = normalizeConfig({ sources: ['second'] }, { HOME: '/nonexistent', DSH_HOME: '/nonexistent' })
  const aggregator = createAggregator({
    config,
    probes: [first.probe, second.probe],
    now: () => 1_000_000,
    resolveSecret: async () => null,
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources.map((source) => source.id), ['second'])
  assert.equal(first.state.calls, 0)
})

test('auto mode ignores a source whose provider this harness never registered', async () => {
  const deepseek = scriptedProbe('deepseek-balance', [BALANCE], { match: (route) => route.startsWith('deepseek') })
  const kimi = scriptedProbe('kimi-code', [BALANCE], { match: (route) => route.startsWith('kimi') })
  const aggregator = makeAggregator({
    probes: [deepseek.probe, kimi.probe],
    listRoutes: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources.map((source) => source.id), ['deepseek-balance'])
  // The unregistered source is not even probed: no credential is read for it.
  assert.equal(kimi.state.calls, 0)
})

test('an explicit source list bypasses the route gate', async () => {
  const kimi = scriptedProbe('kimi-code', [BALANCE], { match: () => false })
  const config = normalizeConfig({ sources: ['kimi-code'] }, { HOME: '/nonexistent', DSH_HOME: '/nonexistent' })
  const aggregator = createAggregator({
    config,
    probes: [kimi.probe],
    now: () => 1_000_000,
    resolveSecret: async () => null,
    listRoutes: () => [],
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources.map((source) => source.id), ['kimi-code'])
  assert.deepEqual(state.sources[0].providers, [])
})

test('a registered source still hides itself without credentials', async () => {
  const scripted = scriptedProbe('deepseek-balance', [new SkipSource('NO_CREDENTIAL', 'none')], {
    match: (route) => route.startsWith('deepseek'),
  })
  const aggregator = makeAggregator({
    probes: [scripted.probe],
    listRoutes: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  })
  const state = await aggregator.state()
  // The route is registered but unreadable, so it is named rather than dropped.
  assert.deepEqual(state.sources.map((source) => source.id), ['route:deepseek-official'])
  assert.deepEqual(state.sources[0].snapshot, {
    kind: 'unsupported',
    reason: 'no-usage-api',
    detail: 'none',
  })
  assert.equal(state.sources[0].label, 'DeepSeek')
})

test('sources advertise the live routes they answer for', async () => {
  const scripted = scriptedProbe('kimi-code', [BALANCE], { match: (route) => route.startsWith('kimi') })
  const aggregator = makeAggregator({
    probes: [scripted.probe],
    listRoutes: () => [
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'kimi-coding', name: 'Kimi For Coding' },
      { id: 'moonshotai', name: 'Moonshot' },
    ],
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources[0].providers, ['kimi-coding'])
})

test('the payload carries the display configuration and default provider', async () => {
  const scripted = scriptedProbe('a', [BALANCE])
  const aggregator = makeAggregator({
    probes: [scripted.probe],
    defaultSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  })
  const state = await aggregator.state()
  assert.equal(state.ok, true)
  assert.equal(state.refreshMs, 60_000)
  assert.equal(state.defaultMode, 'all')
  assert.equal(state.percentMode, 'used')
  assert.equal(state.thresholds.error, 20)
  assert.deepEqual(state.balanceThresholds, {})
  assert.match(state.colors.error, /--dsw-alias-state-error-primary/)
  assert.match(state.colors.active, /--dsw-alias-state-success-primary/)
  assert.deepEqual(state.defaultProvider, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
})

test('toFailure classifies transport and credential failures', () => {
  const timeout = new Error('slow')
  timeout.name = 'TimeoutError'
  assert.deepEqual(toFailure(timeout), { code: 'NETWORK', message: 'slow' })
  assert.deepEqual(toFailure(new SkipSource('NO_CREDENTIAL', 'none')), {
    code: 'NO_CREDENTIAL',
    message: 'none',
  })
})

test('a source receives the credential reference its registered route is configured with', async () => {
  const seen = []
  const probe = {
    id: 'kimi-code',
    label: 'kimi-code',
    match: (route) => route === 'kimi-coding',
    async probe(host) {
      seen.push(host.routeApiKeyEnv)
      return BALANCE
    },
  }
  const aggregator = createAggregator({
    config: CONFIG,
    probes: [probe],
    now: () => 1_000_000,
    resolveSecret: async () => null,
    listRoutes: () => [{ id: 'kimi-coding', name: 'Kimi For Coding' }],
    piAiApiKeyEnv: (routeId) => (routeId === 'kimi-coding' ? 'KIMI_CODING_API_KEY' : undefined),
  })
  await aggregator.state()
  assert.deepEqual(seen, ['KIMI_CODING_API_KEY'])
})

test('a source without a configured route reference passes nothing on', async () => {
  const seen = []
  const probe = {
    id: 'deepseek-balance',
    label: 'deepseek-balance',
    match: (route) => route === 'deepseek-official',
    async probe(host) {
      seen.push(host.routeApiKeyEnv)
      return BALANCE
    },
  }
  const aggregator = createAggregator({
    config: CONFIG,
    probes: [probe],
    now: () => 1_000_000,
    resolveSecret: async () => null,
    listRoutes: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    piAiApiKeyEnv: () => undefined,
  })
  await aggregator.state()
  assert.deepEqual(seen, [undefined])
})

test('a registered route no source claimed is named instead of dropped', async () => {
  const scripted = scriptedProbe('deepseek-balance', [BALANCE], { match: (route) => route === 'deepseek-official' })
  const aggregator = makeAggregator({
    probes: [scripted.probe],
    listRoutes: () => [
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'some-gateway', name: 'Some Gateway' },
      { id: 'unnamed-route', name: null },
    ],
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources.map((source) => source.id), [
    'deepseek-balance',
    'route:some-gateway',
    'route:unnamed-route',
  ])
  assert.equal(state.sources[1].label, 'Some Gateway')
  // A route the adapter never named falls back to its id.
  assert.equal(state.sources[2].label, 'unnamed-route')
  assert.deepEqual(state.sources[1].providers, ['some-gateway'])
  assert.deepEqual(state.sources[1].snapshot, { kind: 'unsupported', reason: 'no-usage-api' })
})

test('a claimed route is not duplicated by a placeholder', async () => {
  const scripted = scriptedProbe('kimi-code', [BALANCE], { match: (route) => route === 'kimi-coding' })
  const aggregator = makeAggregator({
    probes: [scripted.probe],
    listRoutes: () => [{ id: 'kimi-coding', name: 'Kimi For Coding' }],
  })
  const state = await aggregator.state()
  assert.equal(state.sources.length, 1)
  assert.equal(state.sources[0].id, 'kimi-code')
})

test('the placeholder explains why the probe skipped', async () => {
  const skipped = scriptedProbe('opencode-go', [new SkipSource('NO_CREDENTIAL', 'none of OPENCODE_API_KEY is set')], {
    match: (route) => route === 'opencode-go',
  })
  const aggregator = makeAggregator({
    probes: [skipped.probe],
    listRoutes: () => [{ id: 'opencode-go', name: 'OpenCode Go' }],
  })
  const state = await aggregator.state()
  assert.deepEqual(state.sources[0].snapshot, {
    kind: 'unsupported',
    reason: 'no-usage-api',
    detail: 'none of OPENCODE_API_KEY is set',
  })
})
