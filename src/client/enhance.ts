/**
 * DOM enhancer: puts the image-support + reasoning-level controls INSIDE each
 * model entry in the official Models settings editor (the pi-ai provider card's
 * model list), as a sibling of the capacity disclosure so the block spans the
 * full row width (matching the model's id + display-name row above) instead of
 * being constrained to the disclosure's half-width grid. The official editor
 * declares no extension slot, so the enhancer watches the document, detects
 * rows structurally (locale-independent), and appends one capability block to
 * each model entry.
 *
 * Because the block lives inside the same modelEntry as the capacity
 * disclosure, and the enhancer mirrors the disclosure's open/closed state on
 * the block, the row's chevron button collapses/expands capacity fields AND
 * the capability controls together as one region, and the region is collapsed
 * by default (the official disclosure starts collapsed). While collapsed the
 * disclosure's content is not in the DOM, so the block is hidden until the
 * user expands it.
 *
 * React owns the row markup, so the enhancer is re-runnable: every sweep
 * (re)creates missing blocks and syncs existing ones from the committed
 * settings, never clobbering the element the user is currently editing.
 */

import type { CapabilityProvider, ModelCapabilityController } from './controller.ts'
import type { ModelProfileKey } from './locales.ts'
import { autoPresetForNewModel, buildRowControls, syncPendingControls, syncRowControls } from './controls.ts'

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
    // The capability block lives inside modelEntry — a sibling of modelAdvanced —
    // so it spans the full row width (matching the model's id + display-name row
    // above) instead of being constrained to the disclosure's half-width grid.
    // When collapsed, modelAdvanced is not in the DOM; mirror that on any
    // existing block so the chevron keeps hiding both regions together.
    const advanced = findAdvanced(modelEntry, modelRow)
    const block = modelEntry.querySelector(':scope > [' + BLOCK_ATTR + ']') as HTMLElement | null
    if (advanced === undefined) {
      if (block !== null) block.hidden = true
      return
    }
    // A row whose id is not in settings yet is a staged add (the fetch-catalog
    // flow drafts the row locally and lands it only on save). Bind it as
    // pending — controls visible immediately, choices staged in memory and
    // written by reconcile once the save commits the model.
    ensureBlock(controller, t, modelEntry, advanced, provider, index, index < 0 ? modelId : '')
  })
}

/**
 * The capacity disclosure of a row: the modelEntry child that holds the numeric
 * capacity inputs (context window / max tokens). Present only while expanded.
 * The injected capability block is skipped: it carries checkbox labels that
 * would otherwise satisfy the label fallback.
 */
function findAdvanced(modelEntry: HTMLElement, modelRow: HTMLElement): HTMLElement | undefined {
  for (const child of Array.from(modelEntry.children)) {
    if (!(child instanceof HTMLElement) || child === modelRow) continue
    if (child.hasAttribute(BLOCK_ATTR)) continue
    // The disclosure holds the numeric capacity inputs; a label fallback covers
    // builds that structure the capacity fields as labeled fields.
    if (child.querySelector('input[inputmode="numeric"]') !== null) return child
    if (child.querySelector('label') !== null) return child
  }
  return undefined
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

/**
 * Ensure the model entry carries a capability block for this provider/index.
 * A pending row (model not in settings yet, `pendingId` non-empty) gets the
 * same block plus a pre-save banner, staged writes instead of direct ones,
 * and the automatic models.dev preset applied once on creation.
 */
function ensureBlock(controller: ModelCapabilityController, t: Translator, modelEntry: HTMLElement, advanced: HTMLElement, provider: CapabilityProvider, index: number, pendingId = ''): void {
  let block = modelEntry.querySelector(':scope > [' + BLOCK_ATTR + ']') as HTMLElement | null
  if (block !== null) {
    const stale = block.getAttribute('data-mp-provider') !== provider.provider
      || block.getAttribute('data-mp-index') !== String(index)
      || (block.getAttribute('data-mp-pending-id') ?? '') !== pendingId
    if (stale) {
      block.remove()
      block = null
    }
  }
  if (block === null) {
    block = buildRowControls(controller, t)
    modelEntry.appendChild(block)
    if (pendingId !== '') void autoPresetForNewModel(controller, block, provider, pendingId)
  }
  // In-DOM disclosure means expanded (collapsed content is unmounted), so the
  // block mirrors the disclosure's visibility: the chevron hides both together.
  block.hidden = advanced.hidden
  block.setAttribute('data-mp-provider', provider.provider)
  block.setAttribute('data-mp-index', String(index))
  if (pendingId === '') block.removeAttribute('data-mp-pending-id')
  else block.setAttribute('data-mp-pending-id', pendingId)
  const note = block.querySelector('[data-mp-pending-note]')
  if (note instanceof HTMLElement) note.hidden = pendingId === ''
  if (pendingId === '') syncRowControls(controller, block, provider, index)
  else syncPendingControls(controller, block, provider, pendingId)
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
