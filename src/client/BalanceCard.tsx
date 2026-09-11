/**
 * The corner card.
 *
 * Rendered inside the shell's `shell.overlay` seat, which is a click-through
 * layer above every column: this component opts back into pointer events and
 * pins itself to the bottom-right corner. It polls the host route on the
 * interval the host suggests, re-reads on tab focus, and counts reset windows
 * down locally so a countdown never costs a request.
 *
 * @module dsh-llm-balance/client/BalanceCard
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { Locale } from '../format.ts'
import { formatRelativeTime } from '../format.ts'
import type { ColorKey, DisplayMode, Level, SessionListStateLike, StateResponse } from '../protocol.ts'
import { fetchState } from './api.ts'
import {
  POLL_PRESETS,
  blockDotColor,
  buildCard,
  cardSurface,
  clampPosition,
  compactBubble,
  cornerAnchor,
  dockedPosition,
  minimizeCorner,
  nextMode,
  parseStoredPollMs,
  parseStoredPosition,
  pollLabel,
  popoverPlacement,
  snapToHorizontalEdge,
  type CardPosition,
  type CardRow,
} from '../modes.ts'
import type { OverlayStandardProps, Translate, UseSessions } from './types.ts'

/** Colour tiers used before the first payload arrives. */
const FALLBACK_COLORS: Record<ColorKey, string> = {
  normal: 'var(--dsw-alias-brand-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  active: 'var(--dsw-alias-state-success-primary)',
}

const MODE_GLYPH: Record<DisplayMode, string> = {
  current: '◉',
  summary: '≣',
  all: '☰',
}

/** Poll cadence before the host has told us better. */
const FALLBACK_REFRESH_MS = 60_000

/** Local countdown tick; no network behind it. */
const TICK_MS = 30_000

const MODE_STORAGE_KEY = 'dsh-llm-balance:mode'
const COLLAPSED_STORAGE_KEY = 'dsh-llm-balance:collapsed'
const TRANSLUCENT_STORAGE_KEY = 'dsh-llm-balance:translucent'
const POLL_STORAGE_KEY = 'dsh-llm-balance:pollMs'
const POSITION_STORAGE_KEY = 'dsh-llm-balance:position'
const MINIMIZED_STORAGE_KEY = 'dsh-llm-balance:minimized'

const CARD: CSSProperties = {
  position: 'fixed',
  right: 14,
  bottom: 14,
  zIndex: 9500,
  pointerEvents: 'auto',
  minWidth: 240,
  maxWidth: 340,
  padding: '8px 10px',
  color: 'var(--dsw-alias-label-primary)',
  font: '12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  cursor: 'pointer',
  userSelect: 'none',
}

/**
 * The painted surface, in its own layer behind the text: only this dims when the
 * translucent toggle is on, so the numbers stay fully readable.
 */
const SURFACE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-overlay)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
  pointerEvents: 'none',
}

const CONTENT: CSSProperties = { position: 'relative' }

const HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const DOT: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flex: '0 0 auto',
}

/** The whole title row is the drag handle: grab cursor, and no text selection mid-drag. */
const TITLE: CSSProperties = {
  fontWeight: 600,
  flex: '1 1 auto',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
}

const ICON_BUTTON: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  padding: '0 2px',
  font: 'inherit',
  lineHeight: 1,
}

const BLOCK: CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid var(--dsw-alias-border-l1)',
}

const BLOCK_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const BLOCK_LABEL: CSSProperties = {
  fontWeight: 600,
  flex: '1 1 auto',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const CHIP: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 999,
  padding: '0 6px',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 10,
  whiteSpace: 'nowrap',
}

const ROW: CSSProperties = {
  marginTop: 3,
  // Aligns under the provider name: the status dot (6px) plus its gap (6px).
  paddingLeft: 12,
  whiteSpace: 'normal',
  wordBreak: 'break-word',
}

const EMPTY: CSSProperties = {
  marginTop: 6,
  color: 'var(--dsw-alias-label-secondary)',
}

const TTL_CHIP: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 999,
  padding: '0 6px',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 10,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  background: 'transparent',
  font: 'inherit',
  lineHeight: 1.5,
}

/** The interval list, anchored to the card and opening above (or below near the top edge). */
const POPOVER_BASE: CSSProperties = {
  position: 'absolute',
  right: 8,
  zIndex: 9501,
  minWidth: 72,
  padding: 4,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-overlay)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
}

const POPOVER_ITEM: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  padding: '4px 10px',
  borderRadius: 6,
  font: 'inherit',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

/** The minimize control, floating clear of the corner of a docked card. */
const CORNER_BUTTON: CSSProperties = {
  position: 'absolute',
  zIndex: 9502,
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 7,
  background: 'var(--dsw-alias-bg-overlay)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
}

/** The minimized card: a narrow pill pinned to the docked edge. */
const BUBBLE: CSSProperties = {
  position: 'fixed',
  zIndex: 9500,
  pointerEvents: 'auto',
  padding: '6px 9px',
  color: 'var(--dsw-alias-label-primary)',
  font: '12px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  userSelect: 'none',
  cursor: 'pointer',
}

/** The current provider's initial. The whole bubble is the restore target. */
const BUBBLE_INITIAL: CSSProperties = {
  font: '600 15px/1.1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  textAlign: 'center',
}

const BUBBLE_VALUE: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  textAlign: 'center',
  whiteSpace: 'nowrap',
}

/** Props handed to the seat: shell standard props plus this plugin's translator. */
export interface BalanceCardProps extends OverlayStandardProps {
  t: Translate
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode or a storage-less shell: the choice simply does not persist */
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* see writeStorage */
  }
}

/** Which of the two dictionaries the active shell locale needs. */
export function resolveLocale(value: unknown): Locale {
  const raw =
    typeof value === 'string' && value.length > 0
      ? value
      : typeof navigator !== 'undefined' && typeof navigator.language === 'string'
        ? navigator.language
        : 'en'
  return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** The active session's provider, read from the `modelSelection` projection. */
export function selectCurrentProvider(state: SessionListStateLike | undefined): string | null {
  const id = state?.current
  if (typeof id !== 'string' || id.length === 0) return null
  const selection = state?.byId?.[id]?.projectionValues?.modelSelection
  const chosen = selection?.next ?? selection?.lastUsed ?? null
  const provider = chosen?.provider
  return typeof provider === 'string' && provider.length > 0 ? provider : null
}

/** One rendered line: the whole row text, left aligned, with optional hover detail. */
function RowView({ row }: { row: CardRow }): ReactElement {
  return (
    <div style={ROW} title={row.title}>
      {row.text}
    </div>
  )
}

/** The bottom-right balance / quota card. */
export function BalanceCard(props: BalanceCardProps): ReactElement {
  const { t } = props
  const [loaded, setLoaded] = useState<{ response: StateResponse; at: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [mode, setMode] = useState<DisplayMode | null>(() => readStorage(MODE_STORAGE_KEY) as DisplayMode | null)
  const [collapsed, setCollapsed] = useState<boolean>(() => readStorage(COLLAPSED_STORAGE_KEY) === '1')
  const [translucent, setTranslucent] = useState<boolean>(() => readStorage(TRANSLUCENT_STORAGE_KEY) === '1')
  const [pollMs, setPollMs] = useState<number | null>(() => parseStoredPollMs(readStorage(POLL_STORAGE_KEY)))
  const [ttlOpen, setTtlOpen] = useState<boolean>(false)
  const [popoverSide, setPopoverSide] = useState<'above' | 'below'>('above')
  const [position, setPosition] = useState<CardPosition | null>(() => parseStoredPosition(readStorage(POSITION_STORAGE_KEY)))
  const [dragging, setDragging] = useState<boolean>(false)
  const [minimized, setMinimized] = useState<boolean>(() => readStorage(MINIMIZED_STORAGE_KEY) === '1')
  const [now, setNow] = useState<number>(() => Date.now())

  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  /** Set while a pointer moved enough to be a drag; the release click must not refresh. */
  const didDragRef = useRef<boolean>(false)

  const response = loaded?.response ?? null
  const refreshMs = pollMs ?? response?.refreshMs ?? FALLBACK_REFRESH_MS
  const useSessions: UseSessions | undefined = props.useSessions
  // The shell's standard prop is stable for the lifetime of the mount, so this
  // stays a legal unconditional hook call.
  const currentProvider = useSessions === undefined ? null : useSessions(selectCurrentProvider)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchState()
      setLoaded({ response: next, at: Date.now() })
      setFailure(null)
      setNow(Date.now())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = (): void => {
      if (!cancelled) void load()
    }
    run()
    const timer = window.setInterval(run, refreshMs)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, refreshMs])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!ttlOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const card = cardRef.current
      if (card !== null && event.target instanceof Node && !card.contains(event.target)) setTtlOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTtlOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ttlOpen])

  // A stored position must survive the viewport changing shape around it.
  useEffect(() => {
    const onResize = (): void => {
      setPosition((pos) => {
        if (pos === null) return pos
        const card = cardRef.current
        if (card === null) return pos
        const rect = card.getBoundingClientRect()
        // A docked card keeps its edge: re-flush it before clamping the top.
        const base = dockedPosition(pos.docked, rect.width, window.innerWidth, pos.top) ?? pos
        const clamped = clampPosition(base, rect.width, rect.height, window.innerWidth, window.innerHeight, 8)
        const next: CardPosition = { left: clamped.left, top: clamped.top, docked: pos.docked ?? null }
        return next.left === pos.left && next.top === pos.top ? pos : next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const activeMode: DisplayMode = mode ?? response?.defaultMode ?? 'all'
  const locale = resolveLocale(props.locale)
  // Merged over the fallbacks: a host built before the palette grew still gets a
  // resolvable colour for every key this bundle asks for.
  const colors: Record<ColorKey, string> = { ...FALLBACK_COLORS, ...(response?.colors ?? {}) }

  const model = useMemo(() => {
    if (response === null) return null
    return buildCard(response, {
      mode: activeMode,
      currentProvider,
      locale,
      percentMode: response.percentMode,
      thresholds: response.thresholds,
      balanceThresholds: response.balanceThresholds ?? {},
      now,
      t,
    })
  }, [response, activeMode, currentProvider, locale, now, t])

  const cycleMode = (): void => {
    const next = nextMode(activeMode)
    setMode(next)
    writeStorage(MODE_STORAGE_KEY, next)
  }

  const surface = cardSurface(translucent)
  const levelColor = (level: Level): string => colors[level] ?? FALLBACK_COLORS[level]

  const docked = position === null ? null : position.docked ?? null
  const bubble = useMemo(() => {
    if (response === null) return null
    return compactBubble(response, {
      mode: activeMode,
      currentProvider,
      locale,
      percentMode: response.percentMode,
      thresholds: response.thresholds,
      balanceThresholds: response.balanceThresholds ?? {},
      now,
      t,
    })
  }, [response, activeMode, currentProvider, locale, now, t])

  const minimizeCard = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    setTtlOpen(false)
    setMinimized(true)
    writeStorage(MINIMIZED_STORAGE_KEY, '1')
  }
  const restoreCard = (): void => {
    setMinimized(false)
    removeStorage(MINIMIZED_STORAGE_KEY)
  }

  const onTitlePointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setTtlOpen(false)
    const card = cardRef.current
    if (card === null) return
    const rect = card.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onTitlePointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) didDragRef.current = true
    const card = cardRef.current
    if (card === null) return
    const rect = card.getBoundingClientRect()
    setPosition(clampPosition(
      { left: drag.originX + dx, top: drag.originY + dy },
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    ))
  }
  const onTitlePointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    setDragging(false)
    const card = cardRef.current
    if (card === null) return
    const rect = card.getBoundingClientRect()
    const snapped = snapToHorizontalEdge({ left: rect.left, top: rect.top }, rect.width, window.innerWidth, 48)
    const clamped = clampPosition(snapped.position, rect.width, rect.height, window.innerWidth, window.innerHeight, 8)
    // Remember which edge it parked against: the corner control and the bubble
    // both need to know, and so does the next resize.
    const next: CardPosition = { left: clamped.left, top: clamped.top, docked: snapped.docked }
    setPosition(next)
    writeStorage(POSITION_STORAGE_KEY, JSON.stringify(next))
  }
  const onTitleDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    removeStorage(POSITION_STORAGE_KEY)
    setPosition(null)
  }

  const toggleTtl = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (!ttlOpen) {
      const rect = cardRef.current?.getBoundingClientRect()
      setPopoverSide(popoverPlacement(rect?.top ?? 600, 124))
    }
    setTtlOpen((open) => !open)
  }
  const choosePollMs = (ms: number): void => {
    setPollMs(ms)
    writeStorage(POLL_STORAGE_KEY, String(ms))
    setTtlOpen(false)
  }

  // The card is fixed to the corner until the user moves it; then it lives at
  // an explicit left/top and gets its snap transition back once the drag ends.
  const cardStyle: CSSProperties =
    position === null
      ? CARD
      : {
          ...CARD,
          right: 'auto',
          bottom: 'auto',
          left: position.left,
          top: position.top,
          ...(dragging ? {} : { transition: 'left 150ms ease, top 150ms ease' }),
        }
  const headerLevel: Level = model?.level ?? (failure === null ? 'normal' : 'error')
  const updated = loaded === null ? t('meta.loading') : formatRelativeTime(now - loaded.at, locale)
  const corner = minimizeCorner(docked, position?.top ?? 0, window.innerHeight)

  // The bubble is the whole card while minimized; a state that cannot be shown
  // as a bubble (no dock remembered, or nothing to report) falls back to it.
  if (minimized && docked !== null && bubble !== null) {
    const top = clampPosition(
      { left: 0, top: position?.top ?? 0 },
      72,
      56,
      window.innerWidth,
      window.innerHeight,
      8,
    ).top
    return (
      <div
        style={{ ...BUBBLE, top, ...(docked === 'left' ? { left: 8 } : { right: 8 }) }}
        title={t('restore')}
        role="button"
        tabIndex={0}
        aria-label={t('restore')}
        onClick={restoreCard}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          restoreCard()
        }}
      >
        <div
          aria-hidden="true"
          style={{
            ...SURFACE,
            ...(translucent
              ? {
                  opacity: surface.opacity,
                  backdropFilter: `blur(${surface.blur}px)`,
                  WebkitBackdropFilter: `blur(${surface.blur}px)`,
                  boxShadow: 'none',
                }
              : {}),
          }}
        />
        <div style={{ ...CONTENT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ ...BUBBLE_INITIAL, color: levelColor(bubble.level) }}>{bubble.initial}</div>
          <div style={BUBBLE_VALUE} title={bubble.title}>
            {bubble.value}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      onClick={() => {
        if (didDragRef.current) {
          didDragRef.current = false
          return
        }
        void load()
      }}
      title={t('meta.clickRefresh')}
    >
      <div
        aria-hidden="true"
        style={{
          ...SURFACE,
          ...(translucent
            ? {
                opacity: surface.opacity,
                backdropFilter: `blur(${surface.blur}px)`,
                WebkitBackdropFilter: `blur(${surface.blur}px)`,
                boxShadow: 'none',
              }
            : {}),
        }}
      />
      {minimized ? null : corner === null ? null : (
        <button
          type="button"
          style={{
            ...CORNER_BUTTON,
            ...cornerAnchor(
              corner,
              position?.top ?? 0,
              cardRef.current?.getBoundingClientRect().height ?? 0,
              window.innerHeight,
            ),
          }}
          aria-label={t('minimize')}
          title={t('minimize')}
          onClick={minimizeCard}
        >
          {docked === 'left' ? '‹' : '›'}
        </button>
      )}
      <div style={CONTENT}>
      <div style={HEADER}>
        <span style={{ ...DOT, background: levelColor(headerLevel) }} />
        <span
          style={TITLE}
          title={t('drag')}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onClick={(event) => {
            event.stopPropagation()
            if (didDragRef.current) {
              didDragRef.current = false
              return
            }
            const next = !collapsed
            setCollapsed(next)
            writeStorage(COLLAPSED_STORAGE_KEY, next ? '1' : '0')
          }}
          onDoubleClick={onTitleDoubleClick}
        >
          {t('title')}
        </span>
        <button
          type="button"
          style={ICON_BUTTON}
          aria-label={t('mode', { mode: t(`mode.${activeMode}`) })}
          title={t('mode', { mode: t(`mode.${activeMode}`) })}
          onClick={(event) => {
            event.stopPropagation()
            cycleMode()
          }}
        >
          {MODE_GLYPH[activeMode]}
        </button>
        <button
          type="button"
          style={{
            ...ICON_BUTTON,
            color: translucent ? levelColor('normal') : ICON_BUTTON.color,
          }}
          aria-label={t('transparent', { state: t(translucent ? 'state.on' : 'state.off') })}
          aria-pressed={translucent}
          title={t('transparent', { state: t(translucent ? 'state.on' : 'state.off') })}
          onClick={(event) => {
            event.stopPropagation()
            const next = !translucent
            setTranslucent(next)
            writeStorage(TRANSLUCENT_STORAGE_KEY, next ? '1' : '0')
          }}
        >
          ▦
        </button>
        <button
          type="button"
          style={ICON_BUTTON}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={(event) => {
            event.stopPropagation()
            void load()
          }}
        >
          ↻
        </button>
        <button
          type="button"
          style={TTL_CHIP}
          aria-haspopup="listbox"
          aria-expanded={ttlOpen}
          aria-label={t('ttl', { interval: pollLabel(refreshMs) })}
          title={t('ttl.hint', { interval: pollLabel(refreshMs), age: updated })}
          onClick={toggleTtl}
        >
          {pollLabel(refreshMs)}
        </button>
      </div>

      {ttlOpen ? (
        <div
          role="listbox"
          aria-label={t('ttl', { interval: pollLabel(refreshMs) })}
          style={{
            ...POPOVER_BASE,
            ...(popoverSide === 'above' ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
          }}
        >
          {POLL_PRESETS.map((ms) => (
            <button
              key={ms}
              type="button"
              role="option"
              aria-selected={refreshMs === ms}
              style={{
                ...POPOVER_ITEM,
                ...(refreshMs === ms ? { color: levelColor('normal'), fontWeight: 600 } : {}),
              }}
              onClick={(event) => {
                event.stopPropagation()
                choosePollMs(ms)
              }}
            >
              {pollLabel(ms)}
            </button>
          ))}
        </div>
      ) : null}

      {collapsed ? null : (
        <>
          {failure !== null && response === null ? (
            <div style={{ ...EMPTY, color: levelColor('error') }}>{t('error.NETWORK')}</div>
          ) : null}
          {response === null && failure === null ? <div style={EMPTY}>{t('meta.loading')}</div> : null}
          {model !== null && model.empty !== undefined ? <div style={EMPTY}>{model.empty}</div> : null}
          {model?.blocks.map((block) => (
            <div key={block.key} style={BLOCK}>
              <div style={BLOCK_HEAD}>
                <span
                  style={{ ...DOT, background: blockDotColor(block.level, block.active, colors) }}
                  title={block.active === true ? t('active') : undefined}
                />
                <span style={BLOCK_LABEL}>{block.label}</span>
                {block.stale === true ? <span style={CHIP}>{t('meta.stale')}</span> : null}
              </div>
              {block.error !== undefined ? (
                <div style={{ ...ROW, color: levelColor('error') }}>{block.error}</div>
              ) : null}
              {block.rows.map((row) => (
                <div key={row.key} style={{ color: levelColor(row.level) }}>
                  <RowView row={row} />
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      </div>
    </div>
  )
}
