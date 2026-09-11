/**
 * Provider parsing and probe behaviour, including the two credential paths
 * Kimi Code supports and the compare-and-swap write-back that keeps the CLI's
 * own credential file usable.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import {
  deepseekProbe,
  kimiCodeProbe,
  moonshotProbe,
  opencodeProbe,
  parseKimiResetTime,
  parseKimiTokens,
  parseKimiUsage,
  parseMoonshotBalance,
  parseOpencodeUsage,
  resetKimiTokenCache,
} from '../lib/providers.js'
import { parseDeepseekBalance } from '../lib/providers.js'

/** The real Kimi Code payload, with the account id removed. */
const KIMI_USAGE = {
  user: { userId: '<redacted>', region: 'REGION_CN', membership: { level: 'LEVEL_ADVANCED' }, businessId: '' },
  usage: { limit: '100', used: '41', remaining: '59', resetTime: '2026-09-14T02:12:02.481253Z' },
  limits: [
    {
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: { limit: '100', used: '5', remaining: '95', resetTime: '2026-09-11T13:12:02.481253Z' },
    },
  ],
  parallel: { limit: '30', details: ['<redacted>'] },
  totalQuota: {},
  authentication: { method: 'METHOD_ACCESS_TOKEN', scope: 'FEATURE_CODING' },
  subType: 'TYPE_PURCHASE',
  domain: 'DOMAIN_NEXUS',
  version: 'GOODS_VERSION_V1',
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function makeHost({ fetchImpl, secrets = {}, config, now, llmDeepseek, home = '/nonexistent' }) {
  const warnings = []
  const host = {
    config: config ?? normalizeConfig({}, { HOME: home, DSH_HOME: home }),
    timeoutMs: 5_000,
    fetchImpl,
    now: now ?? (() => Date.now()),
    resolveSecret: async (name) => secrets[name] ?? null,
    warn: (message) => warnings.push(message),
  }
  if (llmDeepseek !== undefined) host.llmDeepseek = llmDeepseek
  return Object.assign(host, { warnings })
}

test('parseDeepseekBalance reads the documented balance payload', () => {
  const parsed = parseDeepseekBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '95.30', granted_balance: '10.00', topped_up_balance: '85.30' }],
  })
  assert.equal(parsed.isAvailable, true)
  assert.deepEqual(parsed.rows, [{ currency: 'CNY', total: 95.3, granted: 10, toppedUp: 85.3 }])
  assert.deepEqual(parseDeepseekBalance({}).rows, [])
})

test('deepseek probe reports the amount alone', async () => {
  const calls = []
  const host = makeHost({
    secrets: { DEEPSEEK_API_KEY: 'sk-test' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '95.30', granted_balance: '10.00', topped_up_balance: '85.30' }],
      })
    },
  })
  const snapshot = await deepseekProbe.probe(host, new AbortController().signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.equal(snapshot.kind, 'balance')
  // An amount, and nothing appended to it: no baseline, no percentage, no
  // granted/topped-up breakdown.
  assert.deepEqual(snapshot.entries, [{ currency: 'CNY', total: 95.3 }])
  assert.equal(snapshot.note, undefined)
})

test('deepseek probe reports an unusable balance', async () => {
  const host = makeHost({
    secrets: { DEEPSEEK_API_KEY: 'sk-test' },
    fetchImpl: async () => jsonResponse({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0' }] }),
  })
  const snapshot = await deepseekProbe.probe(host, new AbortController().signal)
  assert.equal(snapshot.note, 'unavailable')
  assert.deepEqual(snapshot.entries[0], { currency: 'CNY', total: 0 })
})

test('deepseek probe follows the mounted adapter endpoint and reference', async () => {
  const calls = []
  const host = makeHost({
    secrets: { MY_DEEPSEEK: 'sk-other' },
    llmDeepseek: { baseURL: 'https://gateway.example/v1/', apiKeyEnv: 'MY_DEEPSEEK' },
    fetchImpl: async (url) => {
      calls.push(url)
      return jsonResponse({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '5' }] })
    },
  })
  await deepseekProbe.probe(host, new AbortController().signal)
  assert.equal(calls[0], 'https://gateway.example/v1/user/balance')
})

test('a probe without a credential declares itself absent', async () => {
  const host = makeHost({ fetchImpl: async () => jsonResponse({}) })
  await assert.rejects(
    () => deepseekProbe.probe(host, new AbortController().signal),
    (error) => error.name === 'SkipSource' && error.code === 'NO_CREDENTIAL',
  )
})

test('parseMoonshotBalance maps the region to its billing currency', () => {
  const payload = { code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 } }
  assert.deepEqual(parseMoonshotBalance(payload, 'intl'), {
    currency: 'USD',
    available: 49.58894,
    voucher: 46.58893,
    cash: 3.00001,
  })
  assert.equal(parseMoonshotBalance(payload, 'cn').currency, 'CNY')
  assert.equal(parseMoonshotBalance({ data: {} }, 'cn'), null)
})

test('moonshot probe flags an overdrawn cash balance', async () => {
  const host = makeHost({
    secrets: { MOONSHOT_API_KEY: 'ms-test' },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.moonshot.cn/v1/users/me/balance')
      assert.equal(init.headers.authorization, 'Bearer ms-test')
      return jsonResponse({ code: 0, data: { available_balance: 10, voucher_balance: 12, cash_balance: -2 } })
    },
  })
  const snapshot = await moonshotProbe.probe(host, new AbortController().signal)
  assert.equal(snapshot.note, 'deficit')
  assert.equal(snapshot.entries[0].currency, 'CNY')
})

test('parseKimiUsage orders the windows', () => {
  const parsed = parseKimiUsage(KIMI_USAGE)
  assert.equal(parsed.windows.length, 2)
  const [rate, pool] = parsed.windows
  assert.equal(rate.kind, 'rolling')
  assert.equal(rate.duration, 300)
  assert.equal(rate.timeUnit, 'TIME_UNIT_MINUTE')
  assert.equal(rate.limit, 100)
  assert.equal(rate.used, 5)
  assert.equal(rate.remaining, 95)
  assert.equal(rate.remainingPercent, 95)
  assert.equal(parseKimiResetTime('2026-09-11T13:12:02.481253Z'), Date.parse('2026-09-11T13:12:02.481253Z'))
  assert.equal(pool.kind, 'week')
  assert.equal(pool.remainingPercent, 59)
})

test('parseKimiUsage tolerates a missing pool and bad limits', () => {
  assert.deepEqual(parseKimiUsage({ usage: {}, limits: [{ window: {}, detail: { limit: '0' } }] }), { windows: [] })
})

test('parseKimiTokens understands epoch seconds and rejects debris', () => {
  const tokens = parseKimiTokens(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1789117366 }))
  assert.equal(tokens.expiresAtMs, 1789117366000)
  assert.equal(parseKimiTokens(JSON.stringify({ access_token: 'a', expires_at: 1789117366000 })).expiresAtMs, 1789117366000)
  assert.equal(parseKimiTokens('not json'), null)
  assert.equal(parseKimiTokens(JSON.stringify({ refresh_token: 'r' })), null)
})

test('kimi probe prefers an API key over the CLI credential', async () => {
  resetKimiTokenCache()
  const calls = []
  const host = makeHost({
    secrets: { KIMI_API_KEY: 'kk-test' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(KIMI_USAGE)
    },
  })
  const snapshot = await kimiCodeProbe.probe(host, new AbortController().signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.kimi.com/coding/v1/usages')
  assert.equal(calls[0].init.headers.authorization, 'Bearer kk-test')
  assert.equal(snapshot.kind, 'quota')
  assert.equal(snapshot.windows.length, 2)
})

test('kimi probe uses a fresh CLI token without refreshing', async () => {
  resetKimiTokenCache()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-balance-'))
  const file = join(dir, 'kimi-code.json')
  await writeFile(
    file,
    JSON.stringify({ access_token: 'fresh-token', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    { mode: 0o600 },
  )
  const calls = []
  const config = normalizeConfig({ kimiCode: { tokenFile: file } }, { HOME: dir, DSH_HOME: dir })
  const host = makeHost({
    config,
    fetchImpl: async (url) => {
      calls.push(url)
      return jsonResponse(KIMI_USAGE)
    },
  })
  await kimiCodeProbe.probe(host, new AbortController().signal)
  assert.deepEqual(calls, ['https://api.kimi.com/coding/v1/usages'])
})

test('kimi probe refreshes an expired token and writes it back under CAS', async () => {
  resetKimiTokenCache()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-balance-'))
  const file = join(dir, 'kimi-code.json')
  await writeFile(
    file,
    JSON.stringify({
      access_token: 'stale-token',
      refresh_token: 'old-refresh',
      expires_at: Math.floor(Date.now() / 1000) - 10,
      scope: 'kimi-code',
      token_type: 'Bearer',
    }),
    { mode: 0o600 },
  )
  const calls = []
  const config = normalizeConfig({ kimiCode: { tokenFile: file } }, { HOME: dir, DSH_HOME: dir })
  const host = makeHost({
    config,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (url.includes('oauth')) {
        return jsonResponse({ access_token: 'rotated', refresh_token: 'new-refresh', expires_in: 900, token_type: 'Bearer' })
      }
      assert.equal(init.headers.authorization, 'Bearer rotated')
      return jsonResponse(KIMI_USAGE)
    },
  })

  const snapshot = await kimiCodeProbe.probe(host, new AbortController().signal)
  assert.equal(snapshot.kind, 'quota')
  assert.deepEqual(
    calls.map((call) => call.url),
    ['https://auth.kimi.com/api/oauth/token', 'https://api.kimi.com/coding/v1/usages'],
  )
  assert.equal(calls[0].init.method, 'POST')
  assert.match(calls[0].init.body, /grant_type=refresh_token/)
  assert.match(calls[0].init.body, /refresh_token=old-refresh/)

  const written = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(written.access_token, 'rotated')
  assert.equal(written.refresh_token, 'new-refresh')
  assert.equal(written.scope, 'kimi-code')
  assert.ok(written.expires_at > Math.floor(Date.now() / 1000))
  assert.equal((await stat(file)).mode & 0o777, 0o600)

  // The refresh is cached, so the next poll reuses it without another exchange.
  calls.length = 0
  await kimiCodeProbe.probe(host, new AbortController().signal)
  assert.deepEqual(calls.map((call) => call.url), ['https://api.kimi.com/coding/v1/usages'])
})

test('kimi probe keeps a refreshed token in memory when the file moved', async () => {
  resetKimiTokenCache()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-balance-'))
  const file = join(dir, 'kimi-code.json')
  const original = JSON.stringify({
    access_token: 'stale-token',
    refresh_token: 'old-refresh',
    expires_at: Math.floor(Date.now() / 1000) - 10,
  })
  await writeFile(file, original, { mode: 0o600 })
  const config = normalizeConfig({ kimiCode: { tokenFile: file } }, { HOME: dir, DSH_HOME: dir })
  const host = makeHost({
    config,
    fetchImpl: async (url) => {
      if (url.includes('oauth')) {
        // The CLI refreshed first: its document is now the newer truth.
        await writeFile(file, JSON.stringify({ access_token: 'cli-token', refresh_token: 'cli-refresh' }), { mode: 0o600 })
        return jsonResponse({ access_token: 'rotated', refresh_token: 'new-refresh', expires_in: 900 })
      }
      return jsonResponse(KIMI_USAGE)
    },
  })
  await kimiCodeProbe.probe(host, new AbortController().signal)
  const written = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(written.access_token, 'cli-token')
  assert.equal(host.warnings.length, 1)
  assert.match(host.warnings[0], /changed while refreshing/)
})

test('kimi probe reports an expired session when the refresh is rejected', async () => {
  resetKimiTokenCache()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-balance-'))
  const file = join(dir, 'kimi-code.json')
  await writeFile(
    file,
    JSON.stringify({ access_token: 'stale', refresh_token: 'dead', expires_at: Math.floor(Date.now() / 1000) - 10 }),
    { mode: 0o600 },
  )
  const config = normalizeConfig({ kimiCode: { tokenFile: file } }, { HOME: dir, DSH_HOME: dir })
  const host = makeHost({
    config,
    fetchImpl: async () => jsonResponse({ error: 'invalid_grant' }, 401),
  })
  await assert.rejects(
    () => kimiCodeProbe.probe(host, new AbortController().signal),
    (error) => error.code === 'TOKEN_EXPIRED',
  )
})

/** The live OpenCode Go payload, with the account's numbers as captured. */
const OPENCODE_USAGE = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-09-11T14:49:52.298Z' },
    weekly: { status: 'ok', percent: 47, resetsAt: '2026-09-14T00:00:00.298Z' },
    monthly: { status: 'ok', percent: 92, resetsAt: '2026-09-25T02:42:33.298Z' },
  },
}

test('parseOpencodeUsage maps the three windows to used percentages', () => {
  const windows = parseOpencodeUsage(OPENCODE_USAGE)
  assert.deepEqual(
    windows.map((window) => [window.kind, window.used, window.limit, window.remaining, window.remainingPercent]),
    [
      ['rolling', 0, 100, 100, 100],
      ['week', 47, 100, 53, 53],
      ['month', 92, 100, 8, 8],
    ],
  )
  assert.equal(windows[0].resetsAt, Date.parse('2026-09-11T14:49:52.298Z'))
  // A window the provider did not report is simply absent.
  assert.deepEqual(parseOpencodeUsage({ usage: { weekly: { status: 'ok', percent: 10 } } }).map((w) => w.kind), ['week'])
  assert.deepEqual(parseOpencodeUsage({}), [])
})

test('a rate-limited window still reports its number', () => {
  const windows = parseOpencodeUsage({ usage: { rolling: { status: 'rate-limited', percent: 100 } } })
  assert.equal(windows[0].remainingPercent, 0)
})

test('the opencode probe calls /v1/usage with the route credential', async () => {
  const calls = []
  const host = makeHost({
    secrets: { OPENCODE_GO_API_KEY: 'oc-test' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(OPENCODE_USAGE)
    },
  })
  host.routeId = 'opencode-go'
  host.routeApiKeyEnv = 'OPENCODE_GO_API_KEY'
  const snapshot = await opencodeProbe.probe(host, new AbortController().signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/usage')
  assert.equal(calls[0].init.headers.authorization, 'Bearer oc-test')
  assert.equal(snapshot.kind, 'quota')
  assert.deepEqual(snapshot.windows.map((window) => window.kind), ['rolling', 'week', 'month'])
})

test('the opencode probe skips a route it has no endpoint for', async () => {
  const host = makeHost({ fetchImpl: async () => jsonResponse({}) })
  await assert.rejects(
    () => opencodeProbe.probe(host, new AbortController().signal),
    (error) => error.name === 'SkipSource',
  )
})

test('the opencode probe skips when no credential is configured', async () => {
  const host = makeHost({ fetchImpl: async () => jsonResponse({}) })
  host.routeId = 'opencode-go'
  await assert.rejects(
    () => opencodeProbe.probe(host, new AbortController().signal),
    (error) => error.name === 'SkipSource' && error.code === 'NO_CREDENTIAL',
  )
})

test('an opencode plan without the usage endpoint reads as unsupported', async () => {
  const host = makeHost({
    secrets: { OPENCODE_GO_API_KEY: 'oc-test' },
    fetchImpl: async () => jsonResponse({ error: 'not found' }, 404),
  })
  host.routeId = 'opencode-go'
  host.routeApiKeyEnv = 'OPENCODE_GO_API_KEY'
  const snapshot = await opencodeProbe.probe(host, new AbortController().signal)
  assert.deepEqual(snapshot, { kind: 'unsupported', reason: 'no-usage-api' })
})

test('an opencode payload without windows is a bad response', async () => {
  const host = makeHost({
    secrets: { OPENCODE_GO_API_KEY: 'oc-test' },
    fetchImpl: async () => jsonResponse({ usage: {} }),
  })
  host.routeId = 'opencode-go'
  host.routeApiKeyEnv = 'OPENCODE_GO_API_KEY'
  await assert.rejects(
    () => opencodeProbe.probe(host, new AbortController().signal),
    (error) => error.code === 'BAD_RESPONSE',
  )
})

test('the opencode probe finds a credential named after the route', async () => {
  // The live failure: the route is configured as OPENCODE_GO_API_KEY, while the
  // catalog default is OPENCODE_API_KEY and the host passed no route reference.
  const calls = []
  const host = makeHost({
    secrets: { OPENCODE_GO_API_KEY: 'oc-route-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(OPENCODE_USAGE)
    },
  })
  host.routeId = 'opencode-go'
  const snapshot = await opencodeProbe.probe(host, new AbortController().signal)
  assert.equal(snapshot.kind, 'quota')
  assert.equal(calls[0].init.headers.authorization, 'Bearer oc-route-key')
})

test('a route reference still wins over the derived name', async () => {
  const calls = []
  const host = makeHost({
    secrets: { OPENCODE_GO_API_KEY: 'derived', MY_OPENCODE_KEY: 'configured' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(OPENCODE_USAGE)
    },
  })
  host.routeId = 'opencode-go'
  host.routeApiKeyEnv = 'MY_OPENCODE_KEY'
  const snapshot = await opencodeProbe.probe(host, new AbortController().signal)
  assert.equal(snapshot.kind, 'quota')
  assert.equal(calls[0].init.headers.authorization, 'Bearer configured')
})

test('the skip message names every credential reference it tried', async () => {
  const host = makeHost({ fetchImpl: async () => jsonResponse({}) })
  host.routeId = 'opencode-go'
  await assert.rejects(
    () => opencodeProbe.probe(host, new AbortController().signal),
    (error) =>
      error.name === 'SkipSource' &&
      error.message.includes('OPENCODE_GO_API_KEY') &&
      error.message.includes('OPENCODE_API_KEY'),
  )
})
