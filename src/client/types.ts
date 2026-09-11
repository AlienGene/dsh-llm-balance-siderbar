/**
 * The browser half's structural view of its host environment.
 *
 * Declared locally rather than imported from `@deepseek-ai/dsh-client-*`: the
 * runtime contract is what the shell injects (verified against the shipped
 * `dshmarket` client bundle), and keeping it structural means this package
 * installs with no type dependency on a specific harness release.
 *
 * @module dsh-llm-balance/client/types
 */
import type { SessionListStateLike, TranslateFn } from '../protocol.ts'

/** Translator bound to this plugin's dictionary namespace. */
export type Translate = TranslateFn

/** Snapshot selector hook over the session list and current selection. */
export type UseSessions = <T>(selector: (state: SessionListStateLike | undefined) => T) => T

/** Slot registration contract used by the overlay seat. */
export interface SlotRegistration {
  name: string
  id: string
  order?: number
  label?: string | (() => string)
}

/** The Cordis client surface this plugin uses. */
export interface ClientContext {
  effect(callback: () => (() => void) | void, label?: string): void
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): Translate
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(registration: SlotRegistration, component: unknown): unknown
  }
}

/** Props the shell injects into every root-scoped seat occupant. */
export interface OverlayStandardProps {
  t?: Translate
  useSessions?: UseSessions
  /** The shell's active locale id (`zh`/`en`, possibly region-tagged). */
  locale?: string
}
