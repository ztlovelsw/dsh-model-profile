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
import { autoFillCapacity, autoPresetForNewModel, buildProviderProxyControls, buildRowControls, syncPendingControls, syncProviderProxyControls, syncRowControls } from './controls.ts'

/** Translate one dictionary key with optional `{name}` template params. */
export type Translator = (key: ModelProfileKey, params?: Record<string, unknown>) => string

/** The running enhancer handle. */
export interface EnhancerHandle {
  /** Disconnect the observer and stop all sweeps. */
  stop(): void
}

/** Marker attribute of one injected capability block. */
export const BLOCK_ATTR = 'data-mp-block'

/** Marker attribute of one injected provider-level proxy block. */
export const PROXY_BLOCK_ATTR = 'data-mp-proxy-block'

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
    // Draft card ("add custom provider", catalog NOT inside the customized
    // <details>) resolves to a synthetic provider staged in byDraftRoute; the
    // "add provider" card (catalog inside <details>, route chosen by a select)
    // resolves through its own draft path; the edit card keeps the header-span
    // lookup against committed routes.
    const provider = resolveDraftProvider(controller, modelEntry)
      ?? resolveAddCardDraft(controller, modelEntry)
      ?? resolveProvider(controller, modelEntry)
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
    // Provider-level proxy control lives on the provider card, not the model
    // row — one block per provider regardless of how many rows it has.
    ensureProviderProxy(controller, t, modelEntry, provider)
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
 * Last draft route registered per "add custom provider" card, so a retyped
 * `Provider ID` evicts the choices staged under the abandoned id.
 */
const draftRoutes = new WeakMap<HTMLElement, string>()

/**
 * The draft provider of an "add custom provider" editor: rows staged before
 * the card's create action commits the route into settings. Locale-free
 * discriminator: that editor's model catalog is a DIRECT child of the card,
 * while every edit-existing-provider card nests its catalog inside the
 * customized `<details>` disclosure. The card's fields precede the catalog in
 * DOM order — the first input is the `Provider ID`, the second the display
 * name. Registers a synthetic provider (NaN revision, empty models) whose
 * rows always take the pending path; nothing is written until the save lands
 * the route, after which reconcile stages the choices in.
 */
function resolveDraftProvider(controller: ModelCapabilityController, modelEntry: HTMLElement): CapabilityProvider | undefined {
  const catalog = modelEntry.parentElement
  if (!(catalog instanceof HTMLElement)) return undefined
  if (catalog.closest('details') !== null) return undefined
  const card = catalog.parentElement
  if (!(card instanceof HTMLElement)) return undefined
  const fieldsBeforeCatalog: HTMLInputElement[] = []
  for (const element of Array.from(card.querySelectorAll('input'))) {
    if (!(element instanceof HTMLInputElement)) continue
    // Model-row inputs live inside the catalog; the provider fields precede it.
    if (catalog.contains(element)) break
    if (element.type === 'checkbox' || element.type === 'radio') continue
    fieldsBeforeCatalog.push(element)
  }
  const routeInput = fieldsBeforeCatalog[0]
  if (routeInput === undefined) return undefined
  const route = routeInput.value.trim()
  if (route.length === 0) return undefined
  const previous = draftRoutes.get(card)
  if (previous !== undefined && previous !== route) controller.evictPending(previous)
  draftRoutes.set(card, route)
  const displayName = fieldsBeforeCatalog[1]?.value.trim() ?? ''
  const info: CapabilityProvider = {
    provider: route,
    displayName: displayName.length > 0 ? displayName : route,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', route],
    revision: Number.NaN,
    models: [],
    profile: {},
  }
  controller.byDraftRoute.set(route, info)
  return info
}

/**
 * Last draft route registered per "add provider" card select, so switching
 * the select evicts the choices staged under the previous route. The select
 * (not the card element) is the key: the card's editor subtree remounts when
 * the select changes, so a card-keyed memory would forget the old route and
 * leak its staged choices to whichever future provider takes that id.
 */
const addCardRoutes = new WeakMap<HTMLSelectElement, string>()

/**
 * Find the dormant-provider select of an "add provider" card, walking up a
 * bounded ancestor chain from the model catalog's `<details>`: the first
 * level holding EXACTLY ONE `<select>` outside every `<details>` wins. The
 * edit/setup cards carry no select outside their customized `<details>` (a
 * declared route's protocol select lives inside it), so they decline; the
 * add card's chooser sits beside the editor, one level up.
 */
function selectOfAddCard(details: HTMLDetailsElement): HTMLSelectElement | undefined {
  let scope: HTMLElement | null = details.parentElement
  for (let depth = 0; scope !== null && depth < 3; depth++, scope = scope.parentElement) {
    const selects = [...scope.querySelectorAll('select')].filter(
      (element): element is HTMLSelectElement =>
        element instanceof HTMLSelectElement && element.closest('details') === null,
    )
    if (selects.length === 1) return selects[0]
    // More than one candidate means the structure is not understood; the
    // single-select invariant of every known card shape is violated.
    if (selects.length > 1) return undefined
  }
  return undefined
}

/**
 * The draft provider of an "add provider" card: a catalog route being
 * customized for the first time. Locale-free discriminators, all required:
 * the model catalog sits INSIDE the customized `<details>` disclosure (the
 * opposite of the custom-provider create card), no committed header resolves
 * along the ancestor chain, and the card carries exactly one `<select>`
 * outside that details whose value names a pi-ai directory route. A route
 * that got committed meanwhile resolves to its real join entry instead of a
 * synthetic; an unknown or foreign-namespace route declines. Nothing is
 * written while the route is uncommitted — choices stage in memory and
 * reconcile lands them once the card's save commits the profile.
 */
function resolveAddCardDraft(controller: ModelCapabilityController, modelEntry: HTMLElement): CapabilityProvider | undefined {
  const catalog = modelEntry.parentElement
  if (!(catalog instanceof HTMLElement)) return undefined
  const details = catalog.closest('details')
  if (!(details instanceof HTMLDetailsElement)) return undefined
  const select = selectOfAddCard(details)
  if (select === undefined) return undefined
  const route = select.value.trim()
  const entry = route.length > 0 ? controller.directoryByRoute.get(route) : undefined
  if (entry === undefined) return undefined
  const previous = addCardRoutes.get(select)
  if (previous !== undefined && previous !== route) {
    controller.evictPending(previous)
    controller.byDraftRoute.delete(previous)
  }
  addCardRoutes.set(select, route)
  const committed = controller.byRoute.get(route)
  if (committed !== undefined) return committed
  const info: CapabilityProvider = {
    provider: route,
    displayName: entry.displayName,
    settingsNs: 'llm-pi-ai',
    settingsPath: [...entry.settingsPath],
    revision: Number.NaN,
    models: [],
    profile: {},
  }
  controller.byDraftRoute.set(route, info)
  return info
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
  const modelId = pendingId !== '' ? pendingId : String(provider.models[index]?.['id'] ?? '')
  const staged = pendingId !== '' || controller.readIntent(provider.provider, modelId)?.pending === true
  if (note instanceof HTMLElement) {
    // The note covers both not-yet-saved rows and committed rows whose preset
    // is staged: values are visible but land only with the official save.
    note.hidden = !staged
    if (staged) note.textContent = pendingId !== '' ? t('pending.hint') : t('staged.hint')
  }
  // A committed row whose preset is staged (clicked but not saved yet) keeps
  // showing the staged values until the save's reconcile lands them; committed
  // rows without a staged intent sync from the stored model entry.
  if (staged) {
    syncPendingControls(controller, block, provider, modelId)
  } else {
    syncRowControls(controller, block, provider, index)
  }
  // The expanded disclosure is where the official capacity inputs live; fill
  // empty ones from models.dev so the editor's save carries the preset too.
  void autoFillCapacity(block, pendingId !== '' ? pendingId : String(provider.models[index]?.['id'] ?? ''))
}


/**
 * The provider editor card owning a model entry — the ancestor whose header
 * (a div whose children are all spans) names a known editable provider route
 * or display name. Same structural walk as {@link resolveProvider}, but returns
 * the card element too so the provider-level proxy block can be appended to it.
 */
function findProviderCard(controller: ModelCapabilityController, from: HTMLElement): { card: HTMLElement; provider: CapabilityProvider } | undefined {
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
          if (provider !== undefined) return { card: current, provider }
        }
      }
    }
    current = current.parentElement
  }
  return undefined
}

/**
 * Ensure the provider editor card carries one provider-level proxy block.
 * Idempotent: a card already carrying one is only re-synced. The block is a
 * sibling of the card's details (after it), so it spans the card width and
 * stays visible regardless of any per-row disclosure state.
 */
function ensureProviderProxy(controller: ModelCapabilityController, t: Translator, from: HTMLElement, provider: CapabilityProvider): void {
  const found = findProviderCard(controller, from)
  if (found === undefined) return
  const { card } = found
  let block = card.querySelector(':scope > [' + PROXY_BLOCK_ATTR + ']') as HTMLElement | null
  if (block !== null) {
    // Rebind when the card moved to another provider (a route selector switch).
    if (block.getAttribute('data-mp-provider') !== provider.provider) {
      block.remove()
      block = null
    }
  }
  if (block === null) {
    block = buildProviderProxyControls(controller, t)
    card.appendChild(block)
  }
  block.setAttribute('data-mp-provider', provider.provider)
  syncProviderProxyControls(controller, block, provider)
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
