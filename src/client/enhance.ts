/**
 * DOM enhancer: puts the image-support + reasoning-level controls INSIDE each
 * model row of the official Models settings editor (the pi-ai provider card's
 * model list). The official editor declares no extension slot, so the enhancer
 * watches the document, detects rows structurally (locale-independent), and
 * appends one capability block per row.
 *
 * React owns the row markup, so the enhancer is re-runnable: every sweep
 * (re)creates missing blocks and syncs existing ones from the committed
 * settings, never clobbering the element the user is currently editing.
 */

import type { CapabilityProvider, ModelCapabilityController } from './controller.ts'
import type { ModelProfileKey } from './locales.ts'
import { buildRowControls, syncRowControls } from './controls.ts'

/** Translate one dictionary key with optional `{name}` template params. */
export type Translator = (key: ModelProfileKey, params?: Record<string, unknown>) => string

/** The running enhancer handle. */
export interface EnhancerHandle {
  /** Disconnect the observer and stop all sweeps. */
  stop(): void
}

/** Marker attribute of one injected capability block. */
export const BLOCK_ATTR = 'data-mp-block'

/**
 * One synchronous detection + injection pass over the whole document.
 * Exported for testing; {@link bootEnhancer} drives it from a MutationObserver.
 * @param controller - the loaded provider/model join.
 * @param t - the plugin's translator.
 */
export function sweepOnce(controller: ModelCapabilityController, t: Translator): void {
  if (!controller.loaded) return
  // The per-row advanced-toggle button is the stable structural marker shared
  // by both official model editors.
  const toggles = document.querySelectorAll('button[aria-expanded]')
  toggles.forEach((toggle) => {
    const modelRow = toggle.parentElement
    if (!(modelRow instanceof HTMLElement)) return
    const modelEntry = modelRow.parentElement
    if (!(modelEntry instanceof HTMLElement)) return
    // Row signature: at least two INPUTs (model id + display name).
    let inputCount = 0
    for (const child of Array.from(modelRow.children)) {
      if (child.tagName === 'INPUT') inputCount++
    }
    if (inputCount < 2) return
    const idInput = modelRow.querySelector('input')
    if (!(idInput instanceof HTMLInputElement)) return
    const modelId = idInput.value.trim()
    if (modelId.length === 0) return
    const provider = resolveProvider(controller, modelEntry)
    if (provider === undefined) return
    const index = provider.models.findIndex((model) => String(model['id'] ?? '') === modelId)
    if (index < 0) return
    ensureBlock(controller, t, modelEntry, provider, index)
  })
}

/**
 * Resolve the provider owning a row: walk up to the nearest ancestor whose
 * header (a div whose children are all spans) names a known editable provider
 * route or display name — the provider editor card's header and the provider
 * row's head both qualify and both name the same provider.
 */
function resolveProvider(controller: ModelCapabilityController, from: HTMLElement): CapabilityProvider | undefined {
  let current: HTMLElement | null = from
  for (let depth = 0; current !== null && depth < 12; depth++) {
    const header = current.firstElementChild
    if (header instanceof HTMLElement && header.children.length > 0 && header.children.length <= 2) {
      const spans = Array.from(header.children)
      if (spans.every((child) => child.tagName === 'SPAN')) {
        for (const span of spans) {
          const text = (span.textContent ?? '').trim()
          if (text.length === 0) continue
          const provider = controller.findProvider(text)
          if (provider !== undefined) return provider
        }
      }
    }
    current = current.parentElement
  }
  return undefined
}

/** Ensure the row carries a capability block bound to this provider/index. */
function ensureBlock(controller: ModelCapabilityController, t: Translator, modelEntry: HTMLElement, provider: CapabilityProvider, index: number): void {
  let block = modelEntry.querySelector(':scope > [' + BLOCK_ATTR + ']') as HTMLElement | null
  if (block !== null) {
    const stale = block.getAttribute('data-mp-provider') !== provider.provider
      || block.getAttribute('data-mp-index') !== String(index)
    if (stale) {
      block.remove()
      block = null
    }
  }
  if (block === null) {
    block = buildRowControls(controller, t)
    modelEntry.appendChild(block)
  }
  block.setAttribute('data-mp-provider', provider.provider)
  block.setAttribute('data-mp-index', String(index))
  syncRowControls(controller, block, provider, index)
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
