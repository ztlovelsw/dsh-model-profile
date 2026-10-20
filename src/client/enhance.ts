/**
 * DOM enhancer: seats the provider-level 「同步模型能力」 button inside the
 * action group of each official Models-page provider row (the span carrying the
 * official 编辑 / 删除 buttons). The official editor declares no extension slot,
 * so the enhancer watches the document and detects those groups structurally
 * (locale-independent) instead of by hashed class names.
 *
 * Nothing is injected into the model rows themselves: the official row now owns
 * its 输入类型 (text/image) checkboxes AND its reasoning-level editor, so a
 * per-model control would duplicate — and fight — both. The plugin only *seeds*
 * those fields in bulk from models.dev.
 *
 * React owns the row markup, so the enhancer is re-runnable: every sweep
 * re-creates a button React wiped and leaves an existing one untouched.
 */

import type { ModelCapabilityController } from './controller.ts'
import type { ModelProfileKey } from './locales.ts'
import { sweepRowSyncButtons } from './controls.ts'

/** Translate one dictionary key with optional `{name}` template params. */
export type Translator = (key: ModelProfileKey, params?: Record<string, unknown>) => string

/** The running enhancer handle. */
export interface EnhancerHandle {
  /** Disconnect the observer and stop all sweeps. */
  stop(): void
}

/**
 * One synchronous detection + injection pass over the whole document.
 * Exported for testing; {@link bootEnhancer} drives it from a MutationObserver.
 * @param controller - the loaded provider/model join.
 * @param t - the plugin's translator.
 */
export function sweepOnce(controller: ModelCapabilityController, t: Translator): void {
  if (!controller.loaded) return
  // The provider-row sync button lives on the row HEAD, which is rendered for
  // every provider regardless of the model catalog's expanded state — so a page
  // whose rows are all collapsed still gets the button.
  sweepRowSyncButtons(controller, t)
}

/** Start the enhancer: mutation-driven sweeps plus a low-frequency fallback. */
export function bootEnhancer(controller: ModelCapabilityController, t: Translator): EnhancerHandle {
  let scheduled = false
  let stopped = false

  const schedule = (): void => {
    if (scheduled || stopped) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      if (!stopped) sweepOnce(controller, t)
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  const interval = setInterval(schedule, 2500)
  schedule()

  return {
    stop(): void {
      stopped = true
      observer.disconnect()
      clearInterval(interval)
    },
  }
}
