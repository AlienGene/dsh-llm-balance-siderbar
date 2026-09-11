/** Colour rule, formatting, and cross-source aggregation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampPercent,
  displayPercent,
  formatAmount,
  formatCountdown,
  formatPercent,
  formatRelativeTime,
  formatWindowLabel,
  levelOf,
  levelOfBalance,
  remainingPercentOf,
  ruleForBalance,
  sumBalances,
  tightestWindow,
  worstLevel,
} from '../lib/format.js'

test('levelOf honours the 20/40 boundaries', () => {
  assert.equal(levelOf(19.9), 'error')
  assert.equal(levelOf(20), 'warn')
  assert.equal(levelOf(39.9), 'warn')
  assert.equal(levelOf(40), 'normal')
  assert.equal(levelOf(100), 'normal')
  assert.equal(levelOf(null), 'normal')
  assert.equal(levelOf(undefined), 'normal')
  assert.equal(levelOf(Number.NaN), 'normal')
})

test('levelOf takes custom thresholds', () => {
  assert.equal(levelOf(30, { warn: 50, error: 35 }), 'error')
  assert.equal(levelOf(40, { warn: 50, error: 35 }), 'warn')
  assert.equal(levelOf(60, { warn: 50, error: 35 }), 'normal')
})

test('worstLevel picks the most severe tier', () => {
  assert.equal(worstLevel(['normal', 'warn']), 'warn')
  assert.equal(worstLevel(['normal', 'error', 'warn']), 'error')
  assert.equal(worstLevel([]), 'normal')
})

test('remainingPercentOf guards a degenerate limit', () => {
  assert.equal(remainingPercentOf(95, 100), 95)
  assert.equal(remainingPercentOf(1, 0), null)
  assert.equal(remainingPercentOf(Number.NaN, 10), null)
  assert.equal(clampPercent(120), 100)
  assert.equal(clampPercent(-5), 0)
})

test('formatCountdown prints compact units down to minutes', () => {
  const day = 86_400_000
  assert.equal(formatCountdown(3 * day + 0 * 3_600_000 + 0 * 60_000), '3d0h0m')
  assert.equal(formatCountdown(5 * 3_600_000 + 0 * 60_000), '5h0m')
  assert.equal(formatCountdown(3 * 3_600_000 + 51 * 60_000), '3h51m')
  assert.equal(formatCountdown(45 * 60_000), '45m')
  assert.equal(formatCountdown(30_000), '<1m')
  assert.equal(formatCountdown(0), '已到期')
  assert.equal(formatCountdown(-1), '已到期')
  assert.equal(formatCountdown(0, 'en'), 'due now')
})

test('formatWindowLabel reads the provider window units', () => {
  assert.equal(formatWindowLabel(300, 'TIME_UNIT_MINUTE'), '5小时')
  assert.equal(formatWindowLabel(60, 'TIME_UNIT_MINUTE'), '1小时')
  assert.equal(formatWindowLabel(30, 'TIME_UNIT_MINUTE'), '30分钟')
  assert.equal(formatWindowLabel(1440, 'TIME_UNIT_MINUTE'), '1天')
  assert.equal(formatWindowLabel(10080, 'TIME_UNIT_MINUTE'), '7天')
  assert.equal(formatWindowLabel(2, 'TIME_UNIT_HOUR'), '2小时')
  assert.equal(formatWindowLabel(7, 'TIME_UNIT_DAY'), '7天')
  assert.equal(formatWindowLabel(300, 'TIME_UNIT_MINUTE', 'en'), '5h')
  assert.equal(formatWindowLabel(0, 'TIME_UNIT_MINUTE'), '窗口')
})

test('formatAmount resolves symbols and falls back to the code', () => {
  assert.equal(formatAmount(95.3, 'CNY'), '¥95.30')
  assert.equal(formatAmount(1024.5, 'USD'), '$1,024.50')
  assert.equal(formatAmount(12, 'XYZ'), '12.00 XYZ')
  assert.equal(formatAmount(Number.NaN, 'CNY'), '—')
})

test('formatPercent trims float noise', () => {
  assert.equal(formatPercent(95), '95%')
  assert.equal(formatPercent(95.34), '95.3%')
  assert.equal(formatPercent(94.999999), '95%')
  assert.equal(formatPercent(null), '—')
})

test('formatRelativeTime answers in the reader language', () => {
  assert.equal(formatRelativeTime(10_000), '刚刚')
  assert.equal(formatRelativeTime(120_000), '2分钟前')
  assert.equal(formatRelativeTime(3 * 3_600_000), '3小时前')
  assert.equal(formatRelativeTime(-1), '—')
})

test('displayPercent follows percentMode while the colour stays on remaining', () => {
  const window = { kind: 'rolling', duration: 300, timeUnit: 'TIME_UNIT_MINUTE', used: 5, limit: 100, remaining: 95, remainingPercent: 95 }
  assert.equal(displayPercent(window, 'left'), 95)
  assert.equal(displayPercent(window, 'used'), 5)
  assert.equal(levelOf(window.remainingPercent), 'normal')
})

test('sumBalances adds each currency', () => {
  const sources = [
    {
      id: 'a',
      label: 'A',
      ok: true,
      providers: [],
      snapshot: { kind: 'balance', entries: [{ currency: 'CNY', total: 40 }] },
    },
    {
      id: 'b',
      label: 'B',
      ok: true,
      providers: [],
      snapshot: {
        kind: 'balance',
        entries: [
          { currency: 'CNY', total: 20 },
          { currency: 'USD', total: 5 },
        ],
      },
    },
  ]
  assert.deepEqual(
    sumBalances(sources).map((total) => [total.currency, total.total]),
    [
      ['CNY', 60],
      ['USD', 5],
    ],
  )
})

test('a balance tier comes from the configured absolute boundaries', () => {
  const rules = { 'deepseek-balance:CNY': { warnBelow: 40, errorBelow: 20 } }
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', 19.99, rules), 'error')
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', 20, rules), 'warn')
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', 39.99, rules), 'warn')
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', 40, rules), 'normal')
  // No rule for this source/currency: an amount is reported, not judged.
  assert.equal(levelOfBalance('deepseek-balance', 'USD', 0.5, rules), 'normal')
  assert.equal(levelOfBalance('moonshot-balance', 'CNY', 0, rules), 'normal')
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', 100, {}), 'normal')
  // An overdraft is an error regardless of configuration.
  assert.equal(levelOfBalance('moonshot-balance', 'CNY', -3, {}), 'error')
  assert.equal(levelOfBalance('deepseek-balance', 'CNY', Number.NaN, rules), 'normal')
})

test('a wildcard boundary covers every currency of one source', () => {
  const rules = { 'moonshot-balance:*': { warnBelow: 5 } }
  assert.deepEqual(ruleForBalance('moonshot-balance', 'USD', rules), { warnBelow: 5 })
  assert.equal(levelOfBalance('moonshot-balance', 'USD', 4, rules), 'warn')
  // An exact key wins over the wildcard for that currency.
  const both = { 'moonshot-balance:*': { warnBelow: 5 }, 'moonshot-balance:USD': { warnBelow: 1 } }
  assert.equal(levelOfBalance('moonshot-balance', 'USD', 4, both), 'normal')
  assert.equal(levelOfBalance('moonshot-balance', 'CNY', 4, both), 'warn')
  assert.equal(ruleForBalance('deepseek-balance', 'CNY', rules), null)
})

test('tightestWindow returns the most constrained window', () => {
  const windows = [
    { kind: 'rolling', duration: 300, timeUnit: 'TIME_UNIT_MINUTE', used: 5, limit: 100, remaining: 95, remainingPercent: 95 },
    { kind: 'week', duration: null, timeUnit: null, used: 41, limit: 100, remaining: 59, remainingPercent: 59 },
  ]
  assert.equal(tightestWindow({ kind: 'quota', windows }).remainingPercent, 59)
  assert.equal(tightestWindow({ kind: 'balance', entries: [] }), null)
  assert.equal(tightestWindow(undefined), null)
})
