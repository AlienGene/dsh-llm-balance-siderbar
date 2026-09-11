/**
 * dsh-llm-balance — browser half.
 *
 * Registers one occupant in the shell's `shell.overlay` seat (the frame-wide
 * floating layer the shipped UI documents as the home for "a badge, a toast
 * stack or a status pill") and its zh/en dictionary. The seat's component
 * receives this plugin's bound translator, so every string follows the active
 * locale without any global state.
 *
 * @module dsh-llm-balance/client
 */
import { createElement } from 'react'
import { BalanceCard } from './BalanceCard.tsx'
import { DICT_EN, DICT_ZH } from './locales.ts'
import type { ClientContext, OverlayStandardProps, Translate } from './types.ts'

/** Stable Cordis plugin name; must match the host half and the bundle id. */
export const name = 'dsh-llm-balance'

/** Services this half needs before `apply` runs. */
export const inject = ['slots', 'locale']

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-llm-balance'

/**
 * Mount the card.
 * @param ctx - client root context carrying the slot registry and the locale service.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-llm-balance: dictionaries')
  const t: Translate = ctx.locale.bind(NS)

  const Seat = (props: OverlayStandardProps): ReturnType<typeof createElement> =>
    createElement(BalanceCard, { ...props, t })

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'llm-balance', order: 60, label: () => t('label') },
      Seat,
    ),
  )
}
