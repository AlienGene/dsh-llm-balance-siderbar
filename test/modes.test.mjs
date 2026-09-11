/** The three display modes: which sources they show and what they render. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_THRESHOLDS } from '../lib/format.js'
import {
  MUTED_DOT,
  blockDotColor,
  buildCard,
  cardSurface,
  compactBubble,
  initialOf,
  effectiveProvider,
  nextMode,
  quotaRowText,
  quotaRowTitle,
  windowLabelOf,
  visibleSources,
} from '../lib/modes.js'

/** A translator stub backed by the same dictionary shape the card uses. */
const DICT = {
  'window.rolling': '频限',
  'window.week': '周',
  'window.month': '月',
  'window.day': '日',
  used: '（{percent}）',
  remaining: '（{percent}）',
  reset: '{time}重置',
  usedOf: '已用 {used}/{limit}；剩余 {remaining}',
  'summary.balance': '合计余额',
  'note.noUsageApi': '无额度接口',
  'empty.current': '{provider} 暂无额度来源',
  error: '错误',
}
const t = (key, params) => {
  const raw = DICT[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
}

const COLORS = { normal: 'blue', warn: 'yellow', error: 'red', active: 'green' }

const DEEPSEEK = {
  id: 'deepseek-balance',
  label: 'DeepSeek',
  ok: true,
  providers: ['deepseek-official'],
  fetchedAt: 1_000_000,
  ageMs: 0,
  snapshot: { kind: 'balance', entries: [{ currency: 'CNY', total: 95.3 }] },
}

const KIMI = {
  id: 'kimi-code',
  label: 'Kimi For Coding',
  ok: true,
  providers: ['kimi-coding'],
  fetchedAt: 1_000_000,
  ageMs: 0,
  snapshot: {
    kind: 'quota',
    windows: [
      { kind: 'rolling', duration: 300, timeUnit: 'TIME_UNIT_MINUTE', used: 5, limit: 100, remaining: 95, remainingPercent: 95, resetsAt: 1_000_000 + 4 * 3_600_000 },
      { kind: 'week', duration: null, timeUnit: null, used: 85, limit: 100, remaining: 15, remainingPercent: 15, resetsAt: 1_000_000 + 3 * 86_400_000 },
    ],
  },
}

/** OpenCode Go's real shape: three windows, the monthly one nearly spent. */
const OPENCODE = {
  id: 'opencode-go',
  label: 'OpenCode Go',
  ok: true,
  providers: ['opencode-go'],
  fetchedAt: 1_000_000,
  ageMs: 0,
  snapshot: {
    kind: 'quota',
    windows: [
      { kind: 'rolling', duration: null, timeUnit: null, used: 0, limit: 100, remaining: 100, remainingPercent: 100, resetsAt: 1_000_000 + 5 * 3_600_000 },
      { kind: 'week', duration: null, timeUnit: null, used: 47, limit: 100, remaining: 53, remainingPercent: 53, resetsAt: 1_000_000 + 3 * 86_400_000 },
      { kind: 'month', duration: null, timeUnit: null, used: 92, limit: 100, remaining: 8, remainingPercent: 8, resetsAt: 1_000_000 + 14 * 86_400_000 },
    ],
  },
}

const PLACEHOLDER = {
  id: 'route:some-gateway',
  label: 'Some Gateway',
  ok: true,
  providers: ['some-gateway'],
  snapshot: { kind: 'unsupported', reason: 'no-usage-api' },
}

function response(sources, extra = {}) {
  return {
    ok: true,
    now: 1_000_000,
    refreshMs: 60_000,
    defaultMode: 'all',
    percentMode: 'used',
    colors: COLORS,
    thresholds: DEFAULT_THRESHOLDS,
    balanceThresholds: {},
    defaultProvider: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    sources,
    ...extra,
  }
}

function options(overrides = {}) {
  return {
    mode: 'all',
    currentProvider: null,
    locale: 'zh',
    percentMode: 'used',
    thresholds: DEFAULT_THRESHOLDS,
    balanceThresholds: {},
    now: 1_000_000,
    t,
    ...overrides,
  }
}

test('nextMode cycles current, summary, all', () => {
  assert.equal(nextMode('current'), 'summary')
  assert.equal(nextMode('summary'), 'all')
  assert.equal(nextMode('all'), 'current')
})

test('the current mode scopes to the active provider, then the default one', () => {
  const payload = response([DEEPSEEK, KIMI])
  assert.equal(effectiveProvider(payload, 'kimi-coding'), 'kimi-coding')
  assert.equal(effectiveProvider(payload, null), 'deepseek-official')
  assert.deepEqual(visibleSources(payload, 'all', 'kimi-coding').map((s) => s.id), ['deepseek-balance', 'kimi-code'])
  assert.deepEqual(visibleSources(payload, 'current', 'kimi-coding').map((s) => s.id), ['kimi-code'])
  assert.deepEqual(visibleSources(payload, 'current', null).map((s) => s.id), ['deepseek-balance'])
})

test('without any provider the current mode shows everything rather than nothing', () => {
  const payload = response([DEEPSEEK, KIMI], { defaultProvider: null })
  assert.deepEqual(visibleSources(payload, 'current', null).map((s) => s.id), ['deepseek-balance', 'kimi-code'])
})

test('a paid source is one amount line under its name and is marked in use', () => {
  const model = buildCard(response([DEEPSEEK, KIMI]), options())
  const [deepseek, kimi] = model.blocks

  assert.equal(deepseek.label, 'DeepSeek')
  assert.equal(deepseek.rows.length, 1)
  assert.equal(deepseek.rows[0].text, '¥95.30')
  assert.equal(deepseek.rows[0].title, undefined)
  assert.equal(deepseek.active, true)
  assert.equal(kimi.active, false)
})

test('a balance block colours only when absolute boundaries are configured', () => {
  const rules = { 'deepseek-balance:CNY': { warnBelow: 200, errorBelow: 50 } }
  assert.equal(buildCard(response([DEEPSEEK]), options({ balanceThresholds: rules })).blocks[0].rows[0].level, 'warn')
  const errorCard = buildCard(
    response([DEEPSEEK]),
    options({ balanceThresholds: { 'deepseek-balance:CNY': { errorBelow: 200 } } }),
  )
  assert.equal(errorCard.blocks[0].rows[0].level, 'error')
})

test('a subscription window is one line: label, used share, reset countdown', () => {
  const model = buildCard(response([KIMI]), options())
  const rows = model.blocks[0].rows
  assert.deepEqual(rows.map((row) => row.text), ['频限（5%） 4h0m重置', '周（85%） 3d0h0m重置'])
  // The provider's own window length only shows up on hover.
  assert.equal(rows[0].title, '已用 5/100；剩余 95% · 5小时')
  assert.equal(rows[1].title, '已用 85/100；剩余 15%')
  assert.equal(rows[0].level, 'normal')
  // 85% used means 15% left: red, even though the printed number is the used share.
  assert.equal(rows[1].level, 'error')
  assert.equal(model.level, 'error')
})

test('every window a provider reports gets its own line', () => {
  const model = buildCard(response([OPENCODE]), options())
  assert.deepEqual(
    model.blocks[0].rows.map((row) => row.text),
    ['频限（0%） 5h0m重置', '周（47%） 3d0h0m重置', '月（92%） 14d0h0m重置'],
  )
  // The monthly window is 8% from exhausted.
  assert.equal(model.blocks[0].rows[2].level, 'error')
})

test('percentMode left swaps the share while the colour keeps the remaining rule', () => {
  const model = buildCard(response([KIMI]), options({ percentMode: 'left' }))
  assert.equal(model.blocks[0].rows[1].text, '周（15%） 3d0h0m重置')
  assert.equal(model.blocks[0].rows[1].level, 'error')
})

test('a window without a reset instant drops that segment', () => {
  const noReset = {
    ...KIMI,
    snapshot: {
      kind: 'quota',
      windows: [
        { kind: 'rolling', duration: 300, timeUnit: 'TIME_UNIT_MINUTE', used: 5, limit: 100, remaining: 95, remainingPercent: 95 },
      ],
    },
  }
  assert.equal(buildCard(response([noReset]), options()).blocks[0].rows[0].text, '频限（5%）')
})

test('a configured provider with no readable usage surface still gets a row', () => {
  const model = buildCard(response([PLACEHOLDER]), options())
  assert.equal(model.blocks[0].label, 'Some Gateway')
  assert.deepEqual(model.blocks[0].rows.map((row) => row.text), ['无额度接口'])
  assert.equal(model.blocks[0].rows[0].level, 'normal')
})

test('the current mode names the provider when it has no source', () => {
  const payload = response([DEEPSEEK], { defaultProvider: { provider: 'zai', model: 'glm-5' } })
  const model = buildCard(payload, options({ mode: 'current' }))
  assert.deepEqual(model.blocks, [])
  assert.equal(model.empty, 'zai 暂无额度来源')
})

test('the summary mode totals balances and shows only the tightest window', () => {
  const model = buildCard(response([DEEPSEEK, KIMI]), options({ mode: 'summary' }))
  const rows = model.blocks[0].rows
  assert.equal(rows[0].text, '合计余额 ¥95.30')
  assert.equal(rows[0].level, 'normal')
  assert.equal(rows[1].text, 'Kimi For Coding 周（85%） 3d0h0m重置')
  assert.equal(rows[1].level, 'error')
})

test('the summary mode surfaces failures and placeholders instead of hiding them', () => {
  const broken = { id: 'moonshot-balance', label: 'Moonshot', ok: false, providers: [], error: { code: 'UNAUTHORIZED', message: 'nope' } }
  const model = buildCard(response([DEEPSEEK, broken, PLACEHOLDER]), options({ mode: 'summary' }))
  const texts = model.blocks[0].rows.map((row) => row.text)
  assert.ok(texts.includes('Moonshot error.UNAUTHORIZED'))
  assert.ok(texts.includes('Some Gateway 无额度接口'))
})

test('a stale source keeps its rows and gains a chip', () => {
  const stale = { ...KIMI, ok: false, stale: true, error: { code: 'TIMEOUT', message: 'slow' } }
  const model = buildCard(response([stale]), options())
  assert.equal(model.blocks[0].stale, true)
  assert.equal(model.blocks[0].error, 'error.TIMEOUT')
  assert.equal(model.blocks[0].rows.length, 2)
})

test('quota row helpers compose the line and the hover detail on their own', () => {
  const window = { kind: 'week', duration: null, timeUnit: null, used: 47, limit: 100, remaining: 53, remainingPercent: 53 }
  assert.equal(quotaRowText(window, options()), '周（47%）')
  assert.equal(quotaRowTitle(window, options()), '已用 47/100；剩余 53%')
})

test('the dot is green while in use, alarmed while idle and unhealthy, muted otherwise', () => {
  assert.equal(blockDotColor('normal', true, COLORS), 'green')
  assert.equal(blockDotColor('error', true, COLORS), 'green')
  assert.equal(blockDotColor('warn', false, COLORS), 'yellow')
  assert.equal(blockDotColor('error', undefined, COLORS), 'red')
  assert.equal(blockDotColor('normal', false, COLORS), MUTED_DOT)
})

test('cardSurface only dims the surface when translucency is on', () => {
  assert.deepEqual(cardSurface(false), { opacity: 1, blur: 0 })
  assert.deepEqual(cardSurface(true), { opacity: 0.55, blur: 6 })
})

test('an older payload kind is still labelled instead of printing its key', () => {
  // A host that has not restarted yet sends `rate` / `pool`.
  const legacy = {
    ...KIMI,
    snapshot: {
      kind: 'quota',
      windows: [
        { kind: 'rate', duration: 300, timeUnit: 'TIME_UNIT_MINUTE', used: 11, limit: 100, remaining: 89, remainingPercent: 89 },
        { kind: 'pool', duration: null, timeUnit: null, used: 42, limit: 100, remaining: 58, remainingPercent: 58 },
      ],
    },
  }
  assert.deepEqual(
    buildCard(response([legacy]), options()).blocks[0].rows.map((row) => row.text),
    ['频限（11%）', '周（42%）'],
  )
  assert.equal(windowLabelOf({ kind: 'rate' }, options()), '频限')
  assert.equal(windowLabelOf({ kind: 'pool' }, options({ locale: 'en' })), 'week')
  assert.equal(windowLabelOf({ kind: 'quarter' }, options()), 'quarter')
})

test('initialOf takes the first letter, keeping non-Latin labels readable', () => {
  assert.equal(initialOf('DeepSeek'), 'D')
  assert.equal(initialOf('opencode go'), 'O')
  assert.equal(initialOf('  kimi for coding  '), 'K')
  assert.equal(initialOf('月额度'), '月')
  assert.equal(initialOf(''), '?')
})

test('the bubble speaks for the active source and shows its amount', () => {
  const bubble = compactBubble(response([DEEPSEEK, KIMI]), options())
  assert.equal(bubble.key, 'deepseek-balance')
  assert.equal(bubble.initial, 'D')
  assert.equal(bubble.value, '¥95.30')
  assert.equal(bubble.level, 'normal')
})

test('the bubble shows the rolling share for a subscription', () => {
  const bubble = compactBubble(response([KIMI]), options())
  assert.equal(bubble.initial, 'K')
  assert.equal(bubble.value, '5%')
  assert.equal(bubble.level, 'normal')
  assert.equal(bubble.title, '已用 5/100；剩余 95% · 5小时')
})

test('a subscription with no rolling window falls back to the tightest one', () => {
  const onlyPool = {
    ...OPENCODE,
    snapshot: {
      kind: 'quota',
      windows: [{ kind: 'month', duration: null, timeUnit: null, used: 92, limit: 100, remaining: 8, remainingPercent: 8 }],
    },
  }
  const bubble = compactBubble(response([onlyPool]), options())
  assert.equal(bubble.value, '92%')
  assert.equal(bubble.level, 'error')
})

test('the bubble mirrors the balance boundaries and the in-use preference', () => {
  const rules = { 'opencode-go:CNY': { errorBelow: 200 } }
  const balance = {
    id: 'opencode-go',
    label: 'OpenCode Go',
    ok: true,
    providers: ['opencode-go'],
    snapshot: { kind: 'balance', entries: [{ currency: 'CNY', total: 111.5 }] },
  }
  // currentProvider drives the choice, not merely the first row.
  const bubble = compactBubble(response([DEEPSEEK, balance]), options({ currentProvider: 'opencode-go', balanceThresholds: rules }))
  assert.equal(bubble.initial, 'O')
  assert.equal(bubble.value, '¥111.50')
  assert.equal(bubble.level, 'error')
})

test('the bubble degrades cleanly without sources or readable usage', () => {
  assert.equal(compactBubble(response([]), options()), null)
  const placeholder = { ...PLACEHOLDER, snapshot: { kind: 'unsupported', reason: 'no-usage-api' } }
  const bubble = compactBubble(response([placeholder]), options())
  assert.equal(bubble.value, '—')
  assert.equal(bubble.title, '无额度接口')
  assert.equal(bubble.level, 'normal')
})
