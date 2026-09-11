/** The poll-interval selector and the drag/dock positioning, all pure. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  POLL_PRESETS,
  clampPosition,
  cornerAnchor,
  dockedPosition,
  minimizeCorner,
  parseStoredPollMs,
  parseStoredPosition,
  pollLabel,
  popoverPlacement,
  snapToHorizontalEdge,
} from '../lib/modes.js'

test('pollLabel spells each preset', () => {
  assert.equal(pollLabel(60_000), '60s')
  assert.equal(pollLabel(300_000), '5m')
  assert.equal(pollLabel(1_800_000), '30m')
  assert.equal(pollLabel(3_600_000), '1h')
  assert.equal(pollLabel(Number.NaN), '60s')
})

test('parseStoredPollMs round-trips and rejects debris', () => {
  for (const ms of POLL_PRESETS) assert.equal(parseStoredPollMs(String(ms)), ms)
  assert.equal(parseStoredPollMs(null), null)
  assert.equal(parseStoredPollMs('nope'), null)
  assert.equal(parseStoredPollMs('500'), null)
})

test('clampPosition keeps the card fully inside the viewport', () => {
  const clamped = clampPosition({ left: -50, top: 5000 }, 240, 120, 1280, 720)
  assert.deepEqual(clamped, { left: 0, top: 600 })
  assert.deepEqual(clampPosition({ left: 400, top: 300 }, 240, 120, 1280, 720), { left: 400, top: 300 })
  // A card wider than the viewport never flips to a negative max.
  assert.deepEqual(clampPosition({ left: 100, top: 100 }, 2000, 120, 1280, 720), { left: 0, top: 100 })
})

test('snapToHorizontalEdge docks within the threshold and leaves the middle alone', () => {
  // Left edge, inside the threshold.
  const left = snapToHorizontalEdge({ left: 30, top: 200 }, 240, 1280, 48)
  assert.equal(left.docked, 'left')
  assert.equal(left.position.left, 8)
  assert.equal(left.position.top, 200)
  // Right edge, inside the threshold.
  const right = snapToHorizontalEdge({ left: 1280 - 240 - 10, top: 200 }, 240, 1280, 48)
  assert.equal(right.docked, 'right')
  assert.equal(right.position.left, 1280 - 240 - 8)
  // Exactly on the threshold stays put.
  const boundary = snapToHorizontalEdge({ left: 48, top: 200 }, 240, 1280, 48)
  assert.equal(boundary.docked, null)
  assert.equal(boundary.position.left, 48)
  // The middle of the viewport never docks.
  const free = snapToHorizontalEdge({ left: 600, top: 200 }, 240, 1280, 48)
  assert.equal(free.docked, null)
  assert.deepEqual(free.position, { left: 600, top: 200 })
})

test('parseStoredPosition round-trips and rejects anything unreadable', () => {
  assert.deepEqual(parseStoredPosition('{"left":120,"top":440}'), { left: 120, top: 440, docked: null })
  assert.deepEqual(parseStoredPosition('{"left":8,"top":100,"docked":"left"}'), {
    left: 8,
    top: 100,
    docked: 'left',
  })
  assert.deepEqual(parseStoredPosition('{"left":120,"top":440,"docked":"nonsense"}'), {
    left: 120,
    top: 440,
    docked: null,
  })
  assert.equal(parseStoredPosition(null), null)
  assert.equal(parseStoredPosition('not json'), null)
  assert.equal(parseStoredPosition('{"left":"x","top":1}'), null)
  assert.equal(parseStoredPosition('{"left":1}'), null)
  assert.equal(parseStoredPosition('[]'), null)
})

test('minimizeCorner faces the open half of the viewport', () => {
  // The control floats outward, so it belongs on the corner with room outside:
  // a lower-half card carries it on a top corner, an upper-half card on a
  // bottom corner.
  assert.equal(minimizeCorner('left', 100, 800), 'bottom-left')
  assert.equal(minimizeCorner('left', 400, 800), 'top-left')
  // The boundary counts as the lower half.
  assert.equal(minimizeCorner('left', 400, 800), 'top-left')
  assert.equal(minimizeCorner('left', 399, 800), 'bottom-left')
  // Right dock mirrors it.
  assert.equal(minimizeCorner('right', 100, 800), 'bottom-right')
  assert.equal(minimizeCorner('right', 700, 800), 'top-right')
  // A free card has no corner control.
  assert.equal(minimizeCorner(null, 100, 800), null)
  assert.equal(minimizeCorner(undefined, 100, 800), null)
  // A non-finite top falls back to the upper-half rule.
  assert.equal(minimizeCorner('left', Number.NaN, 800), 'bottom-left')
})

test('the chosen corner always has room for the outward float', () => {
  // Lower-half card -> top corner -> cornerAnchor finds room above the card.
  const lower = cornerAnchor(minimizeCorner('right', 500, 800), 500, 200, 800)
  assert.deepEqual(lower, { right: -6, top: -28 })
  // Upper-half card -> bottom corner -> room below it.
  const upper = cornerAnchor(minimizeCorner('left', 50, 800), 50, 200, 800)
  assert.deepEqual(upper, { left: -6, bottom: -28 })
})

test('cornerAnchor floats the control outward, or back inside when clipped', () => {
  // Roomy viewport: it hangs off the card's corner, clear of the title row.
  assert.deepEqual(cornerAnchor('top-left', 600, 200, 800), { left: -6, top: -28 })
  assert.deepEqual(cornerAnchor('top-right', 600, 200, 800), { right: -6, top: -28 })
  assert.deepEqual(cornerAnchor('bottom-left', 300, 200, 800), { left: -6, bottom: -28 })
  assert.deepEqual(cornerAnchor('bottom-right', 300, 200, 800), { right: -6, bottom: -28 })
  // A card at the very top has no room above it: the control tucks inside.
  assert.deepEqual(cornerAnchor('top-left', 10, 200, 800), { left: -6, top: 6 })
  // A card whose bottom is past the viewport keeps its control inside too.
  assert.deepEqual(cornerAnchor('bottom-right', 700, 200, 800), { right: -6, bottom: 6 })
  // Exactly at the edge of having room still floats outward.
  assert.deepEqual(cornerAnchor('top-left', 30, 200, 800), { left: -6, top: -28 })
  assert.deepEqual(cornerAnchor('top-left', 29, 200, 800), { left: -6, top: 6 })
  assert.deepEqual(cornerAnchor('bottom-left', 570, 200, 800), { left: -6, bottom: -28 })
  assert.deepEqual(cornerAnchor('bottom-left', 572, 200, 800), { left: -6, bottom: 6 })
})

test('cornerAnchor never emits a non-finite offset', () => {
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    for (const [top, height, viewport] of [
      [Number.NaN, 200, 800],
      [100, Number.NaN, 800],
      [100, 200, Number.NaN],
      [100, 0, 800],
    ]) {
      const anchor = cornerAnchor(corner, top, height, viewport)
      for (const value of Object.values(anchor)) assert.ok(Number.isFinite(value), `${corner} ${value}`)
    }
  }
})

test('dockedPosition flushes to the remembered edge', () => {
  assert.deepEqual(dockedPosition('left', 300, 1280, 120), { left: 8, top: 120, docked: 'left' })
  assert.deepEqual(dockedPosition('right', 300, 1280, 120), { left: 972, top: 120, docked: 'right' })
  assert.equal(dockedPosition(null, 300, 1280, 120), null)
  // A card wider than the viewport still lands at the margin, never negative.
  assert.equal(dockedPosition('right', 2000, 1280, 0)?.left, 8)
})

test('the interval list opens above the card, flipping below near the top edge', () => {
  assert.equal(popoverPlacement(600, 120), 'above')
  assert.equal(popoverPlacement(120 + 16, 120), 'above')
  assert.equal(popoverPlacement(100, 120), 'below')
  assert.equal(popoverPlacement(0, 120), 'below')
})
