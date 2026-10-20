/**
 * The provider-level 「同步模型能力」 button: one plain-DOM button seated in the
 * action group of each official provider row (i.e. immediately before 编辑),
 * plus the bulk sync it runs. Plain DOM because the official page is
 * React-owned — the enhancer re-injects the button whenever React wipes it.
 *
 * Nothing per-model lives here any more: the official model row owns its own
 * 输入类型 (text/image) checkboxes and its reasoning-level editor, so the plugin
 * only *seeds* those fields — and only when the user clicks this button.
 */

import type { ModelCapabilityController, CapabilityProvider } from './controller.ts'
import { messageOf } from './controller.ts'
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
