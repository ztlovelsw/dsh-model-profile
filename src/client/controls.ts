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
  THINKING_LEVELS,
  type ThinkingLevel,
  type UiEfforts,
  buildEffortsPayload,
  effortsValid,
  imageModeOf,
  imageValueOf,
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
 * Look the block's model up on models.dev and write the derived capability
 * preset. Both fields are optional: a field models.dev has no opinion on
 * (e.g. no reasoning enum) is left untouched instead of being cleared.
 * Works both for committed rows (direct write) and staged rows (pending
 * choice, landed by reconcile after the official editor's save).
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
    if (preset.input !== undefined) await performWrite(block, controller, t, 'input', preset.input)
    if (preset.reasoningEfforts !== undefined) await performWrite(block, controller, t, 'reasoningEfforts', preset.reasoningEfforts)
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
    if (pendingId !== '') syncPendingControls(controller, block, provider, pendingId)
    else syncRowControls(controller, block, provider, index)
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
