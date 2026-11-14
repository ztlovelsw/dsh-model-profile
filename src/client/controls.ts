/**
 * Provider-level actions seated in the action group of each official provider
 * row: the custom request-header editor and the models.dev capability sync.
 * Plain DOM because the official page is React-owned — the enhancer re-injects
 * them whenever React wipes the row.
 *
 * Nothing per-model lives here any more: the official model row owns its own
 * 输入类型 (text/image) checkboxes and its reasoning-level editor, so the plugin
 * only *seeds* those fields — and only when the user clicks this button.
 */

import type { ModelCapabilityController, CapabilityProvider } from './controller.ts'
import { messageOf } from './controller.ts'
import type { HeaderProvider, RequestHeaderController } from './header-controller.ts'
import { cloneHeaderPreset, type HeaderPresetId } from '../header-config.ts'
import type { Translator } from './enhance.ts'
import { fetchModelsDevIndex, findModel, presetOf } from './presets.ts'
import css from './enhance.module.css'

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
export function sweepRowControls(controller: ModelCapabilityController, headerController: RequestHeaderController | undefined, t: Translator): void {
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
    const headerProvider = headerProviderFromHead(headerController, head, group)
    if (provider === undefined && headerProvider === undefined) continue
    if (provider !== undefined) ensureRowSyncButton(group, provider, controller, t)
    if (headerController?.loaded === true && headerProvider !== undefined) {
      ensureRowHeaderButton(group, headerProvider, headerController, t)
    }
  }
}

/** Backwards-compatible capability-only scan for existing consumers. */
export function sweepRowSyncButtons(controller: ModelCapabilityController, t: Translator): void {
  sweepRowControls(controller, undefined, t)
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
  for (const text of providerTextsFromHead(head, group)) {
    const provider = controller.findProvider(text)
    if (provider !== undefined) return provider
  }
  return undefined
}

function headerProviderFromHead(controller: RequestHeaderController | undefined, head: HTMLElement, group: HTMLElement): HeaderProvider | undefined {
  if (controller === undefined) return undefined
  for (const text of providerTextsFromHead(head, group)) {
    const provider = controller.findProvider(text)
    if (provider !== undefined) return provider
  }
  return undefined
}

function providerTextsFromHead(head: HTMLElement, group: HTMLElement): string[] {
  const texts: string[] = []
  for (const child of Array.from(head.children)) {
    if (!(child instanceof HTMLElement) || child === group) continue
    texts.push((child.textContent ?? '').trim())
    for (const span of Array.from(child.querySelectorAll('span'))) {
      texts.push((span.textContent ?? '').trim())
    }
  }
  texts.sort((left, right) => left.length - right.length)
  return texts.filter((text) => text.length > 0 && text.length <= 64)
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

function ensureRowHeaderButton(group: HTMLElement, provider: HeaderProvider, controller: RequestHeaderController, t: Translator): void {
  if (group.querySelector('[data-mp-headers-button]') !== null) {
    ensureHeaderPanel(group, provider, controller, t)
    return
  }
  const template = group.querySelector('button')
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('data-mp-headers-button', '')
  button.setAttribute('data-mp-provider', provider.provider)
  button.textContent = t('headers')
  button.title = t('headers.hint')
  button.className = template instanceof HTMLButtonElement && template.className.length > 0 ? template.className : css.presetBtn
  button.addEventListener('click', () => {
    const panel = panelFor(group)
    if (panel !== undefined) panel.open = !panel.open
  })
  // Keep the existing sync action first, then place the advanced action before
  // the official edit/delete buttons.
  group.insertBefore(button, group.children[1] ?? null)
  ensureHeaderPanel(group, provider, controller, t)
}

function panelFor(group: HTMLElement): HTMLDetailsElement | undefined {
  const card = group.parentElement?.parentElement
  if (!(card instanceof HTMLElement)) return undefined
  return Array.from(card.children).find((child) => child instanceof HTMLDetailsElement && child.hasAttribute('data-mp-headers')) as HTMLDetailsElement | undefined
}

function ensureHeaderPanel(group: HTMLElement, provider: HeaderProvider, controller: RequestHeaderController, t: Translator): void {
  const card = group.parentElement?.parentElement
  if (!(card instanceof HTMLElement) || panelFor(group) !== undefined) return
  const details = document.createElement('details')
  details.setAttribute('data-mp-headers', '')
  details.className = css.headerPanel
  const summary = document.createElement('summary')
  summary.textContent = t('headers.title')
  details.append(summary)

  const body = document.createElement('div')
  body.className = css.headerBody
  const enabledLabel = document.createElement('label')
  enabledLabel.className = css.headerEnabled
  const enabled = document.createElement('input')
  enabled.type = 'checkbox'
  enabled.checked = provider.profile.enabled
  enabledLabel.append(enabled, document.createTextNode(t('headers.enabled')))
  body.append(enabledLabel)

  const help = document.createElement('div')
  help.className = css.headerHelp
  help.textContent = t('headers.help')
  body.append(help)

  const textarea = document.createElement('textarea')
  textarea.className = css.headerInput
  textarea.spellcheck = false
  textarea.value = JSON.stringify(provider.profile.headers, null, 2)
  textarea.setAttribute('aria-label', t('headers.input'))
  body.append(textarea)

  const status = document.createElement('span')
  status.className = css.headerStatus

  const presets = document.createElement('div')
  presets.className = css.headerPresets
  for (const [id, label] of [['codex', t('headers.codex')], ['claude', t('headers.claude')]] as [HeaderPresetId, string][]) {
    const preset = document.createElement('button')
    preset.type = 'button'
    preset.className = css.presetBtn
    preset.textContent = label
    preset.addEventListener('click', () => {
      textarea.value = JSON.stringify(cloneHeaderPreset(id), null, 2)
      enabled.checked = true
      status.textContent = t('headers.presetLoaded')
    })
    presets.append(preset)
  }
  body.append(presets)

  const footer = document.createElement('div')
  footer.className = css.headerFooter
  const save = document.createElement('button')
  save.type = 'button'
  save.className = css.presetBtn
  save.textContent = t('headers.save')
  save.addEventListener('click', () => {
    void saveHeaders(provider, controller, enabled, textarea, save, status, t)
  })
  footer.append(save, status)
  body.append(footer)
  details.append(body)
  card.append(details)
}

async function saveHeaders(
  provider: HeaderProvider,
  controller: RequestHeaderController,
  enabled: HTMLInputElement,
  textarea: HTMLTextAreaElement,
  save: HTMLButtonElement,
  status: HTMLElement,
  t: Translator,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(textarea.value)
  } catch {
    status.textContent = t('headers.invalidJson')
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) {
    status.textContent = t('headers.invalidShape')
    return
  }
  try {
    const checked = new Headers()
    for (const [name, value] of Object.entries(parsed)) checked.set(name, value)
  } catch {
    status.textContent = t('headers.invalidShape')
    return
  }
  save.disabled = true
  status.textContent = t('headers.saving')
  try {
    const failure = await controller.save(provider, { enabled: enabled.checked, headers: parsed as Record<string, string> })
    status.textContent = failure === undefined ? t('headers.saved') : t('headers.failed', { error: failure })
  } finally {
    save.disabled = false
  }
}

/**
 * Run one provider sync. Every model of the provider is matched on models.dev;
 * the capability fields (image support, reasoning efforts) are written through
 * the controller, and the capacity fields are gap-filled when absent.
 *
 * Every write is a one-shot seed: the official row's own 输入类型 checkboxes and
 * reasoning-level editor own those fields from then on, so a later official edit
 * is never reverted. The button reports the outcome in place and restores its
 * label afterwards, so a collapsed row needs no extra surface.
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
