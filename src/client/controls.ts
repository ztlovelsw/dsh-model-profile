/**
 * The injected capability block: one image-support select, one reasoning-mode
 * select, and — in custom mode — the seven thinking-level checkboxes with
 * their wire-spelling inputs. Plain DOM (the official page is React-owned; the
 * enhancer re-injects this block whenever React wipes it), syncing from the
 * committed settings on every sweep and writing through the controller.
 */

import type { ModelCapabilityController, CapabilityProvider } from './controller.ts'
import { messageOf } from './controller.ts'
import type { Translator } from './enhance.ts'
import type { ModelProfileKey } from './locales.ts'
import {
  DEFAULT_PROXY_URL,
  THINKING_LEVELS,
  type ThinkingLevel,
  type UiEfforts,
  buildEffortsPayload,
  buildProxyPayload,
  effortsValid,
  imageModeOf,
  imageValueOf,
  proxyEnabled,
  proxyUrlOf,
  reasoningModeOf,
  storedEfforts,
} from './core.ts'
import { fetchModelsDevIndex, findModel, presetOf, type ModelPreset } from './presets.ts'
import css from './enhance.module.css'

/** Build one capability block. Provider/index travel via data attributes. */
export function buildRowControls(controller: ModelCapabilityController, t: Translator): HTMLElement {
  const block = document.createElement('div')
  block.className = css.block
  block.setAttribute('data-mp-block', '')

  const titleRow = document.createElement('div')
  titleRow.className = css.titleRow
  const title = document.createElement('div')
  title.className = css.title
  title.textContent = t('block.title')
  const presetBtn = document.createElement('button')
  presetBtn.type = 'button'
  presetBtn.className = css.presetBtn
  presetBtn.setAttribute('data-mp-preset', '')
  presetBtn.textContent = t('preset')
  presetBtn.title = t('preset.hint')
  titleRow.append(title, presetBtn)

  // Pre-save banner: the row is staged (fetch-catalog add) and choices land
  // only when the official editor's save commits the model.
  const pendingNote = document.createElement('p')
  pendingNote.className = css.hint
  pendingNote.setAttribute('data-mp-pending-note', '')
  pendingNote.textContent = t('pending.hint')
  pendingNote.hidden = true

  const row = document.createElement('div')
  row.className = css.row

  // ---- image support ----
  const imageField = document.createElement('div')
  imageField.className = css.field
  const imageLabel = document.createElement('span')
  imageLabel.className = css.label
  imageLabel.textContent = t('image')
  const imageSel = document.createElement('select')
  imageSel.className = css.select
  imageSel.setAttribute('data-mp-image', '')
  imageSel.title = t('image.hint')
  appendOptions(imageSel, [
    ['', t('image.inherit')],
    ['image', t('image.on')],
    ['text', t('image.off')],
  ])
  imageSel.addEventListener('change', () => {
    const mode = imageSel.value === '' ? 'inherit' : imageSel.value === 'image' ? 'on' : 'off'
    void performWrite(block, controller, t, 'input', imageValueOf(mode))
  })
  imageField.append(imageLabel, imageSel)

  // ---- reasoning mode ----
  const reasonField = document.createElement('div')
  reasonField.className = css.field
  const reasonLabel = document.createElement('span')
  reasonLabel.className = css.label
  reasonLabel.textContent = t('reasoning')
  const reasonSel = document.createElement('select')
  reasonSel.className = css.select
  reasonSel.setAttribute('data-mp-reason', '')
  reasonSel.title = t('reasoning.hint')
  appendOptions(reasonSel, [
    ['inherit', t('reasoning.inherit')],
    ['off', t('reasoning.off')],
    ['custom', t('reasoning.custom')],
  ])

  // ---- custom level grid ----
  const grid = document.createElement('div')
  grid.className = css.grid
  grid.setAttribute('data-mp-grid', '')
  grid.hidden = true
  const gridHint = document.createElement('p')
  gridHint.className = css.hint
  gridHint.textContent = t('reasoning.customHint')
  grid.appendChild(gridHint)
  for (const level of THINKING_LEVELS) {
    const levelRow = document.createElement('div')
    levelRow.className = css.level
    const check = document.createElement('label')
    check.className = css.levelCheck
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute('data-mp-level', level)
    const name = document.createElement('span')
    name.textContent = t(('effort.' + level) as ModelProfileKey)
    check.append(box, name)
    const wire = document.createElement('input')
    wire.type = 'text'
    wire.className = css.wire
    wire.placeholder = level
    wire.setAttribute('data-mp-wire', level)
    wire.setAttribute('aria-label', t('effort.wire') + ' ' + t(('effort.' + level) as ModelProfileKey))
    box.addEventListener('change', () => {
      if (box.checked && wire.value === '' && level !== 'off') wire.value = level
      wire.disabled = !box.checked
      grid.dataset.mpTouched = '1'
      void writeGrid(block, controller, t, grid)
    })
    wire.addEventListener('change', () => {
      grid.dataset.mpTouched = '1'
      void writeGrid(block, controller, t, grid)
    })
    wire.disabled = true
    levelRow.append(check, wire)
    grid.appendChild(levelRow)
  }
  const gridInvalid = document.createElement('p')
  gridInvalid.className = css.invalid
  gridInvalid.setAttribute('data-mp-invalid', '')
  gridInvalid.textContent = t('reasoning.invalid')
  gridInvalid.hidden = true
  grid.appendChild(gridInvalid)

  reasonSel.addEventListener('change', () => {
    const mode = reasonSel.value
    if (mode === 'inherit') {
      grid.hidden = true
      void performWrite(block, controller, t, 'reasoningEfforts', undefined)
    } else if (mode === 'off') {
      grid.hidden = true
      void performWrite(block, controller, t, 'reasoningEfforts', false)
    } else {
      grid.hidden = false
      delete grid.dataset.mpTouched
      // Freshly opened grid reflects the stored efforts; a switch from a
      // non-custom state starts from them too, so nothing is silently dropped.
      const provider = currentProvider(controller, block)
      const pendingId = block.getAttribute('data-mp-pending-id') ?? ''
      const index = Number(block.getAttribute('data-mp-index') ?? '-1')
      if (provider !== undefined && pendingId !== '') {
        fillGrid(grid, storedEfforts(controller.pendingModel(provider, pendingId)))
      } else if (provider !== undefined && index >= 0 && provider.models[index] !== undefined) {
        fillGrid(grid, storedEfforts(provider.models[index]))
      }
      refreshGridValidity(grid)
    }
  })
  reasonField.append(reasonLabel, reasonSel)

  const error = document.createElement('p')
  error.className = css.error
  error.setAttribute('data-mp-error', '')
  error.hidden = true

  presetBtn.addEventListener('click', () => {
    void applyPreset(block, controller, t, presetBtn)
  })

  row.append(imageField, reasonField)
  block.append(titleRow, pendingNote, row, grid, error)
  return block
}

/**
 * Look the block's model up on models.dev and display the derived capability
 * preset. Both fields are optional: a field models.dev has no opinion on
 * (e.g. no reasoning enum) is left untouched instead of being cleared.
 * Capability values are STAGED, not written: like the capacity values (which
 * fill the official editor's own inputs and ride its save), the preset lands
 * once the official editor's save commits and the next `settings` reload's
 * reconcile writes the staged fields. An immediate write here would bump the
 * namespace revision behind the open card's snapshot and make the very next
 * save report "settings changed while this card was open".
 */
async function applyPreset(block: HTMLElement, controller: ModelCapabilityController, t: Translator, button: HTMLButtonElement): Promise<void> {
  const provider = currentProvider(controller, block)
  if (provider === undefined) return
  const pendingId = block.getAttribute('data-mp-pending-id') ?? ''
  const index = Number(block.getAttribute('data-mp-index') ?? '-1')
  const modelId = pendingId !== '' ? pendingId : String(provider.models[index]?.['id'] ?? '')
  if (modelId.length === 0) return
  const error = block.querySelector('[data-mp-error]')
  button.disabled = true
  try {
    const db = await fetchModelsDevIndex()
    const found = findModel(db, modelId)
    const preset = found === undefined ? undefined : presetOf(found)
    const empty = preset === undefined
      || (preset.input === undefined && preset.reasoningEfforts === undefined
        && preset.contextWindow === undefined && preset.maxTokens === undefined)
    if (empty) {
      if (error instanceof HTMLElement) {
        error.textContent = t('preset.none')
        error.hidden = false
      }
      return
    }
    // Stage the capability fields for both committed and pre-save rows: the
    // checkboxes show the preset immediately, and reconcile writes them after
    // the official editor's save (a `settings` reload).
    if (preset.input !== undefined) controller.recordPending(provider, modelId, 'input', preset.input)
    if (preset.reasoningEfforts !== undefined) controller.recordPending(provider, modelId, 'reasoningEfforts', preset.reasoningEfforts)
    // Capacity fields are the official editor's own inputs: fill them so the
    // editor's draft (and its save) carries the values. Unlike the auto pass,
    // an explicit preset click overwrites whatever the inputs held.
    const [contextInput, maxInput] = capacityInputsOf(block)
    if (preset.contextWindow !== undefined && contextInput !== undefined) {
      capacityFilled.add(contextInput)
      setControlledValue(contextInput, String(preset.contextWindow))
    }
    if (preset.maxTokens !== undefined && maxInput !== undefined) {
      capacityFilled.add(maxInput)
      setControlledValue(maxInput, String(preset.maxTokens))
    }
    // Mark the staged values immediately (a sweep would too); the hint names
    // the row state — pre-save or committed-but-staged.
    const note = block.querySelector('[data-mp-pending-note]')
    if (note instanceof HTMLElement) {
      note.hidden = false
      note.textContent = pendingId !== '' ? t('pending.hint') : t('staged.hint')
    }
    syncPendingControls(controller, block, provider, modelId)
  } catch (failure) {
    if (error instanceof HTMLElement) {
      error.textContent = t('preset.fetchFailed', { error: messageOf(failure) })
      error.hidden = false
    }
  } finally {
    button.disabled = false
  }
}

/**
 * The official capacity inputs of the row a block lives in — contextWindow
 * first, maxTokens second (the editor renders them in that order, both as
 * `input[inputmode=numeric]` inside the expanded capacity disclosure).
 * Absent while the row is collapsed: React unmounts the disclosure content.
 */
function capacityInputsOf(block: HTMLElement): Array<HTMLInputElement | undefined> {
  const entry = block.parentElement
  if (!(entry instanceof HTMLElement)) return [undefined, undefined]
  const numeric = Array.from(entry.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]'))
  return [numeric[0], numeric[1]]
}

/**
 * Set one React-controlled input's value so the official editor's own onChange
 * stages it into its draft (the capacity fields land through the editor's
 * save, exactly as if the user had typed them). The native setter bypasses
 * React's value tracker; the bubbled `input` event triggers its listener.
 */
function setControlledValue(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter === undefined) return
  setter.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Inputs this session already auto-filled once, so a user clear stays cleared. */
const capacityFilled = new WeakSet<HTMLInputElement>()

/**
 * Fill the row's EMPTY capacity inputs from models.dev — gaps only: a value
 * the endpoint disclosed (fetch-catalog) or the user typed always wins. Runs
 * on every sweep, but only touches inputs it never filled before, so clearing
 * an auto-filled value is a deliberate choice the plugin respects. A failed
 * fetch is silent (the manual preset button still works).
 */
export async function autoFillCapacity(block: HTMLElement, modelId: string): Promise<void> {
  if (modelId.length === 0) return
  const [contextInput, maxInput] = capacityInputsOf(block)
  const open = [contextInput, maxInput].filter(
    (input): input is HTMLInputElement => input !== undefined && input.value.trim() === '' && !capacityFilled.has(input),
  )
  if (open.length === 0) return
  let preset: ModelPreset | undefined
  try {
    const found = findModel(await fetchModelsDevIndex(), modelId)
    preset = found === undefined ? undefined : presetOf(found)
  } catch {
    return
  }
  if (preset === undefined) return
  const values = [preset.contextWindow, preset.maxTokens]
  for (let at = 0; at < 2; at++) {
    const input = at === 0 ? contextInput : maxInput
    const value = values[at]
    if (input === undefined || value === undefined || !open.includes(input)) continue
    capacityFilled.add(input)
    setControlledValue(input, String(value))
  }
}

/** Auto-applied preset ids, so each staged model id is configured once. */
const autoPresetDone = new Set<string>()

/**
 * Auto-apply the models.dev preset to a newly staged (unsaved) model row —
 * the default configuration the fetch-catalog add flow wants. Runs once per
 * provider/model id per session; a model the user already configured is left
 * alone, and a failed fetch is silent (the manual preset button still works).
 */
export async function autoPresetForNewModel(controller: ModelCapabilityController, block: HTMLElement, provider: CapabilityProvider, modelId: string): Promise<void> {
  const key = provider.provider + '\u0000' + modelId
  if (autoPresetDone.has(key)) return
  // Mark before awaiting: sweeps re-fire this while the fetch is in flight.
  autoPresetDone.add(key)
  if (controller.hasIntent(provider, modelId)) return
  let preset: ReturnType<typeof presetOf>
  try {
    const found = findModel(await fetchModelsDevIndex(), modelId)
    preset = found === undefined ? undefined : presetOf(found)
  } catch {
    return
  }
  if (preset === undefined) return
  if (preset.input !== undefined) controller.recordPending(provider, modelId, 'input', preset.input)
  if (preset.reasoningEfforts !== undefined) controller.recordPending(provider, modelId, 'reasoningEfforts', preset.reasoningEfforts)
  // The binding may have changed (saved, rebound) while awaiting; only sync
  // when the block still shows this pending row.
  if (block.isConnected && block.getAttribute('data-mp-pending-id') === modelId) {
    syncPendingControls(controller, block, provider, modelId)
  }
}

/** Sync one block's controls from the committed model entry. */
export function syncRowControls(controller: ModelCapabilityController, block: HTMLElement, provider: CapabilityProvider, index: number): void {
  const model = provider.models[index]
  if (model === undefined) return
  syncBlockFromModel(block, model)
}

/** Sync one pre-save block from its staged capability intent. */
export function syncPendingControls(controller: ModelCapabilityController, block: HTMLElement, provider: CapabilityProvider, modelId: string): void {
  syncBlockFromModel(block, controller.pendingModel(provider, modelId))
}

/** Sync the selects (and custom grid) from one capability model view. */
function syncBlockFromModel(block: HTMLElement, model: Record<string, unknown>): void {
  const imageSel = block.querySelector('[data-mp-image]')
  if (imageSel instanceof HTMLSelectElement && document.activeElement !== imageSel) {
    const mode = imageModeOf(model)
    imageSel.value = mode === 'inherit' ? '' : mode === 'on' ? 'image' : 'text'
  }
  const reasonSel = block.querySelector('[data-mp-reason]')
  if (reasonSel instanceof HTMLSelectElement && document.activeElement !== reasonSel) {
    const mode = reasoningModeOf(model)
    reasonSel.value = mode
    const grid = block.querySelector('[data-mp-grid]')
    if (grid instanceof HTMLElement) {
      grid.hidden = mode !== 'custom'
      if (mode === 'custom') {
        fillGrid(grid, storedEfforts(model))
        refreshGridValidity(grid)
      }
    }
  }
}

/** Resolve the block's current provider from the controller (survives reloads). */
function currentProvider(controller: ModelCapabilityController, block: HTMLElement): CapabilityProvider | undefined {
  const route = block.getAttribute('data-mp-provider') ?? ''
  return controller.byRoute.get(route) ?? controller.byDraftRoute.get(route)
}

/** Fill the level grid from a UI effort map. */
function fillGrid(grid: HTMLElement, efforts: UiEfforts): void {
  for (const level of THINKING_LEVELS) {
    const box = grid.querySelector('[data-mp-level="' + level + '"]')
    const wire = grid.querySelector('[data-mp-wire="' + level + '"]')
    if (!(box instanceof HTMLInputElement) || !(wire instanceof HTMLInputElement)) continue
    const value = efforts[level]
    const enabled = value !== undefined
    box.checked = enabled
    wire.value = value ?? ''
    wire.disabled = !enabled
  }
}

/** Read the level grid into a UI effort map. */
function readGrid(grid: HTMLElement): UiEfforts {
  const efforts: UiEfforts = {}
  for (const level of THINKING_LEVELS) {
    const box = grid.querySelector('[data-mp-level="' + level + '"]')
    const wire = grid.querySelector('[data-mp-wire="' + level + '"]')
    if (!(box instanceof HTMLInputElement) || !(wire instanceof HTMLInputElement)) continue
    if (!box.checked) continue
    efforts[level] = wire.value
  }
  return efforts
}

/** Show/hide the grid validity hint (only after the user touched the grid). */
function refreshGridValidity(grid: HTMLElement): void {
  const invalid = grid.querySelector('[data-mp-invalid]')
  if (!(invalid instanceof HTMLElement)) return
  const touched = grid.dataset.mpTouched === '1'
  invalid.hidden = !touched || effortsValid(readGrid(grid))
}

/** Validate and write the grid as the model's reasoningEfforts. */
async function writeGrid(block: HTMLElement, controller: ModelCapabilityController, t: Translator, grid: HTMLElement): Promise<void> {
  refreshGridValidity(grid)
  const efforts = readGrid(grid)
  if (!effortsValid(efforts)) return
  await performWrite(block, controller, t, 'reasoningEfforts', buildEffortsPayload(efforts))
}

/** One field write through the controller, surfacing failures inside the block. */
async function performWrite(block: HTMLElement, controller: ModelCapabilityController, t: Translator, field: string, value: unknown): Promise<void> {
  const provider = currentProvider(controller, block)
  const error = block.querySelector('[data-mp-error]')
  if (provider === undefined) return
  const pendingId = block.getAttribute('data-mp-pending-id') ?? ''
  if (pendingId !== '') {
    // Pre-save row: the model is not in settings yet, so the choice is staged
    // in memory; reconcile writes it once the save commits the model.
    controller.recordPending(provider, pendingId, field as 'input' | 'reasoningEfforts', value)
    return
  }
  const index = Number(block.getAttribute('data-mp-index') ?? '-1')
  if (index < 0) return
  const failure = await controller.writeField(provider, index, field, value)
  if (error instanceof HTMLElement) {
    if (failure === undefined) {
      error.hidden = true
    } else {
      error.textContent = t('write.failed', { error: failure })
      error.hidden = false
    }
  }
}

/** Append value/text pairs as options of a select. */
function appendOptions(select: HTMLSelectElement, options: [string, string][]): void {
  for (const [value, label] of options) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.appendChild(option)
  }
}

/**
 * Build one provider-level proxy block: a checkbox ("enable proxy") and a URL
 * input that appears once the checkbox is checked. Unlike the per-model
 * capability block, this is appended to the PROVIDER editor card (not a model
 * row) and writes the provider-scoped `providers.<route>.proxy` field. The
 * provider travels via `data-mp-provider`; there is no per-row index.
 */
export function buildProviderProxyControls(controller: ModelCapabilityController, t: Translator): HTMLElement {
  const block = document.createElement('div')
  block.className = css.proxyBlock
  block.setAttribute('data-mp-proxy-block', '')

  const row = document.createElement('div')
  row.className = css.proxyRow

  const check = document.createElement('label')
  check.className = css.proxyCheck
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.setAttribute('data-mp-proxy-enabled', '')
  const name = document.createElement('span')
  name.textContent = t('proxy.enable')
  check.append(box, name)

  const url = document.createElement('input')
  url.type = 'text'
  url.className = css.proxyUrl
  url.setAttribute('data-mp-proxy-url', '')
  url.placeholder = t('proxy.urlPlaceholder')
  url.title = t('proxy.hint')
  url.disabled = true
  url.hidden = true

  const error = document.createElement('p')
  error.className = css.error
  error.setAttribute('data-mp-proxy-error', '')
  error.hidden = true

  // Enabling proxy pre-fills the default URL once (unless a custom URL is
  // already typed); disabling clears the stored field and hides the input.
  box.addEventListener('change', () => {
    const provider = currentProvider(controller, block)
    if (provider === undefined) return
    if (box.checked) {
      if (url.value.trim().length === 0) url.value = DEFAULT_PROXY_URL
      url.disabled = false
      url.hidden = false
      void performProxyWrite(block, controller, t, url)
    } else {
      url.disabled = true
      url.hidden = true
      void performProxyWrite(block, controller, t, url)
    }
  })
  url.addEventListener('change', () => {
    void performProxyWrite(block, controller, t, url)
  })

  row.append(check, url)
  block.append(row, error)
  return block
}

/** Sync one provider proxy block from the committed/staged provider profile. */
export function syncProviderProxyControls(controller: ModelCapabilityController, block: HTMLElement, provider: CapabilityProvider): void {
  const box = block.querySelector('[data-mp-proxy-enabled]')
  const url = block.querySelector('[data-mp-proxy-url]')
  if (!(box instanceof HTMLInputElement) || !(url instanceof HTMLInputElement)) return
  // The controller resolves the effective state: a staged (pending) intent
  // wins over the committed profile until reconcile lands it, and it owns
  // the "user chose to clear" sentinel.
  const proxy = controller.effectiveProviderProxy(provider)
  if (document.activeElement !== box) box.checked = proxy.enabled
  if (document.activeElement !== url) url.value = proxy.enabled ? proxy.url : ''
  url.disabled = !proxy.enabled
  url.hidden = !proxy.enabled
}

/**
 * Write the provider proxy state through the controller, surfacing failures
 * inside the block.
 */
async function performProxyWrite(block: HTMLElement, controller: ModelCapabilityController, t: Translator, url: HTMLInputElement): Promise<void> {
  const provider = currentProvider(controller, block)
  const error = block.querySelector('[data-mp-proxy-error]')
  if (provider === undefined) return
  const box = block.querySelector('[data-mp-proxy-enabled]')
  const enabled = box instanceof HTMLInputElement && box.checked
  const value = enabled ? buildProxyPayload(url.value) : undefined
  const failure = await controller.writeProviderField(provider, 'proxy', value)
  if (error instanceof HTMLElement) {
    if (failure === undefined) {
      error.hidden = true
    } else {
      error.textContent = t('write.failed', { error: failure })
      error.hidden = false
    }
  }
}


/**
 * 同步模型能力（sync capabilities from models.dev）— the provider-level flow.
 *
 * The official Models page renders one provider row card per route, whose head
 * carries an action group (the official 编辑 / 删除 buttons). That group is the
 * seat this button takes: the enhancer scans the document for action groups
 * structurally (a span whose parent head names a provider the controller can
 * edit) and injects one button per provider, independent of whether the model
 * catalog is expanded — so the button is visible the moment the Models page
 * renders, exactly beside 编辑.
 *
 * Click behaviour: every model of the provider is looked up on models.dev by
 * id; the two capability fields this plugin owns (image support and reasoning
 * efforts) are written straight through the controller (revision-fenced,
 * whole-array set), and the capacity fields (context window / max output) are
 * gap-filled only when the entry does not declare them. Fields models.dev has
 * no opinion on, and models it does not list, are left untouched.
 */
/** One button's in-flight state, keyed by the action group it lives in. */
const syncBusy = new WeakMap<HTMLElement, boolean>()

/**
 * The pure-button action group of one provider row: a span whose children
 * include at least one BUTTON and whose parent head resolves a provider the
 * controller can edit. Scanning starts from buttons (the sparse element) and
 * dedupes by parent, so a sweep costs one pass over the rendered buttons.
 * @param controller - the loaded provider/model join.
 * @param t - the plugin's translator.
 */
export function sweepRowSyncButtons(controller: ModelCapabilityController, t: Translator): void {
  if (!controller.loaded) return
  const seen = new Set<HTMLElement>()
  for (const button of Array.from(document.querySelectorAll('button'))) {
    const group = button.parentElement
    if (!(group instanceof HTMLSpanElement) || seen.has(group)) continue
    if (group.querySelector('button') === null) continue
    seen.add(group)
    const head = group.parentElement
    if (!(head instanceof HTMLElement)) continue
    // The official provider row is an <li> whose head is its first child — the
    // tightest structural anchor available without the hashed class names, and
    // it keeps stray button groups elsewhere in the shell out of the scan.
    const card = head.parentElement
    if (!(card instanceof HTMLLIElement) || card.firstElementChild !== head) continue
    const provider = providerFromHead(controller, head, group)
    if (provider === undefined) continue
    ensureRowSyncButton(group, provider, controller, t)
  }
}

/**
 * Resolve the provider a row head names: every text span outside the action
 * group is a candidate (the identity span carries the display name, the tag
 * span carries 「自定义」, and either may be nested), matched through the
 * controller's route/display-name join. Candidate texts are tried shortest
 * first so a nested name wins over a container's concatenated text.
 * @param controller - the loaded provider/model join.
 * @param head - the row head element owning the action group.
 * @param group - the action group span to exclude from the candidate texts.
 * @returns the editable provider, or undefined when the head names none.
 */
function providerFromHead(controller: ModelCapabilityController, head: HTMLElement, group: HTMLElement): CapabilityProvider | undefined {
  const texts: string[] = []
  for (const child of Array.from(head.children)) {
    if (!(child instanceof HTMLElement) || child === group) continue
    texts.push((child.textContent ?? '').trim())
    for (const span of Array.from(child.querySelectorAll('span'))) {
      texts.push((span.textContent ?? '').trim())
    }
  }
  texts.sort((left, right) => left.length - right.length)
  for (const text of texts) {
    if (text.length === 0 || text.length > 64) continue
    const provider = controller.findProvider(text)
    if (provider !== undefined) return provider
  }
  return undefined
}

/**
 * Ensure one provider row carries the sync button inside its action group.
 * The button copies the neighbouring official button's class, so it renders at
 * exactly the same size; it is inserted as the group's first child, i.e. the
 * seat immediately before 编辑. Re-runnable: React wiping the group removes
 * the button and the next sweep re-creates it.
 * @param group - the row action group span.
 * @param provider - the provider the row names.
 * @param controller - the loaded provider/model join.
 * @param t - the plugin's translator.
 */
function ensureRowSyncButton(group: HTMLElement, provider: CapabilityProvider, controller: ModelCapabilityController, t: Translator): void {
  if (group.querySelector('[data-mp-sync]') !== null) return
  const template = group.querySelector('button')
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('data-mp-sync', '')
  button.setAttribute('data-mp-provider', provider.provider)
  button.textContent = t('sync')
  button.title = t('sync.hint')
  button.className = template instanceof HTMLButtonElement && template.className.length > 0 ? template.className : css.presetBtn
  button.addEventListener('click', () => {
    void runSync(provider, button, controller, t)
  })
  group.insertBefore(button, group.firstElementChild)
}

/**
 * Run one provider sync. Every model of the provider is matched on models.dev;
 * capability fields (image support, reasoning efforts) are written through the
 * controller, and capacity fields are gap-filled when absent. The button
 * reports the outcome in place and restores its label afterwards, so a
 * collapsed row needs no extra surface.
 * @param provider - the provider to sync.
 * @param button - the button that triggered the run (its label carries status).
 * @param controller - the loaded provider/model join.
 * @param t - the plugin's translator.
 */
async function runSync(provider: CapabilityProvider, button: HTMLButtonElement, controller: ModelCapabilityController, t: Translator): Promise<void> {
  if (syncBusy.get(button.parentElement ?? button) === true) return
  syncBusy.set(button.parentElement ?? button, true)
  const label = button.textContent ?? t('sync')
  button.disabled = true
  button.textContent = t('sync.busy')
  const unknown: string[] = []
  const failures: string[] = []
  let matched = 0
  let written = 0
  const total = provider.models.filter((model) => String(model['id'] ?? '').length > 0).length
  try {
    const index = await fetchModelsDevIndex()
    for (const model of provider.models) {
      const id = String(model['id'] ?? '')
      if (id.length === 0) continue
      const found = findModel(index, id)
      if (found === undefined) {
        unknown.push(id)
        continue
      }
      const preset = presetOf(found)
      if (preset === undefined) continue
      matched += 1
      const at = provider.models.findIndex((entry) => String(entry['id'] ?? '') === id)
      if (at < 0) continue
      const fields: [string, unknown][] = []
      if (preset.input !== undefined) fields.push(['input', preset.input])
      if (preset.reasoningEfforts !== undefined) fields.push(['reasoningEfforts', preset.reasoningEfforts])
      // Capacity is gap-filled, never overwritten: a stored value is a user or
      // endpoint choice this button must not silently replace.
      if (preset.contextWindow !== undefined && provider.models[at]?.['contextWindow'] === undefined) fields.push(['contextWindow', preset.contextWindow])
      if (preset.maxTokens !== undefined && provider.models[at]?.['maxTokens'] === undefined) fields.push(['maxTokens', preset.maxTokens])
      for (const [field, value] of fields) {
        if (JSON.stringify(provider.models[at]?.[field]) === JSON.stringify(value)) continue
        const failure = await controller.writeField(provider, at, field, value)
        if (failure === undefined) written += 1
        else failures.push(id + '.' + field + ': ' + failure)
      }
    }
    const summary = total === 0
      ? t('sync.none')
      : matched === 0
        ? t('sync.noMatch', { n: String(total) })
        : t('sync.done', { matched: String(matched), total: String(total) })
    button.textContent = written > 0 ? t('sync.applied', { n: String(written) }) : label
    button.title = [
      summary,
      unknown.length > 0 ? t('sync.unknown', { ids: unknown.join(', ') }) : '',
      failures.length > 0 ? t('sync.failed', { error: failures.join('; ') }) : '',
    ].filter((part) => part.length > 0).join(' ')
  } catch (error) {
    button.title = t('sync.fetchFailed', { error: messageOf(error) })
    button.textContent = t('sync.failed', { error: '' }).trim()
  } finally {
    syncBusy.set(button.parentElement ?? button, false)
    button.disabled = false
    const restore = (): void => {
      if (!button.isConnected) return
      button.textContent = label
      button.title = t('sync.hint')
    }
    window.setTimeout(restore, 4000)
  }
}
