
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

/** The REAL official row-card markup, transcribed from dsh-client-ui-settings-models. */
function realRowCard(displayName: string, opts: { removable?: boolean; editorOpen?: boolean } = {}): void {
  const list = document.createElement('ul')
  const card = document.createElement('li')
  card.className = 'zGbnIq_rowCard'
  const head = document.createElement('div')
  head.className = 'zGbnIq_rowHead'
  const identity = document.createElement('span')
  identity.className = 'zGbnIq_rowIdentity'
  const name = document.createElement('span')
  name.className = 'zGbnIq_rowName'
  name.textContent = displayName
  const tag = document.createElement('span')
  tag.className = 'zGbnIq_rowTag'
  tag.textContent = '自定义'
  const dot = document.createElement('span')
  dot.className = 'zGbnIq_credentialDot zGbnIq_credentialDotConfigured'
  dot.setAttribute('role', 'img')
  identity.append(name, tag, dot)
  const actions = document.createElement('span')
  actions.className = 'zGbnIq_rowActions'
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'zGbnIq_secondaryButton'
  edit.textContent = '编辑'
  actions.append(edit)
  if (opts.removable !== false) {
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'zGbnIq_dangerButton'
    del.textContent = '删除'
    actions.append(del)
  }
  head.append(identity, actions)
  card.append(head)
  if (opts.editorOpen === true) {
    const details = document.createElement('details')
    details.className = 'zGbnIq_customized'
    card.append(details)
  }
  list.append(card)
  document.body.append(list)
}

function fakeApi() {
  const models = [{ id: 'glm-5.5-air' }, { id: 'mimo-v2.5-free' }]
  const providers = [{ provider: 'router9', displayName: '9router', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'router9'], active: true }]
  const userProviders: Record<string, { models: unknown[] }> = { router9: { models } }
  const settings = {
    describe: async () => ({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: { providers: userProviders }, user: { providers: userProviders }, applies: 'live' as const, secrets: [], revision: 7 }] } }),
    mutate: async () => ({ ok: true as const, value: { revision: 8 } }),
  }
  const llm = { listConfigurableProviders: async () => ({ ok: true as const, value: providers }) }
  return { settings, llm }
}

const t: Translator = ((key: string, params?: Record<string, unknown>) => key + (params ? JSON.stringify(params) : '')) as Translator

vi.stubGlobal('fetch', async () => ({
  ok: true,
  json: async () => ({ zai: { models: { 'glm-5.5-air': { modalities: { input: ['text', 'image'] }, reasoning_options: [{ type: 'effort', values: ['high'] }] } } } }),
}) as Response)

/**
 * The REAL official provider-editor + model-row markup, transcribed from
 * dsh-client-ui-settings-models 0.2.0-rc.1 (`ProviderEditor` → `ModelListEditor`
 * → `ModelRow`): the model entry carries the id/display-name row, the capacity
 * disclosure with its numeric inputs, AND the 0.2.0-rc.1 per-model 输入类型
 * (text/image) checkpoint fieldset bound to `input`.
 */
function realModelEditor(modelId: string): void {
  const editor = document.createElement('div')
  editor.className = 'zGbnIq_editor'
  const header = document.createElement('div')
  header.className = 'zGbnIq_editorHeader'
  const title = document.createElement('span')
  title.className = 'zGbnIq_editorTitle'
  title.textContent = '9router'
  const route = document.createElement('span')
  route.className = 'zGbnIq_editorRoute'
  route.textContent = 'router9'
  header.append(title, route)

  const entry = document.createElement('div')
  entry.className = 'zGbnIq_modelEntry'
  const row = document.createElement('div')
  row.className = 'zGbnIq_modelRow'
  const idInput = document.createElement('input')
  idInput.className = 'zGbnIq_input'
  idInput.type = 'text'
  idInput.value = modelId
  idInput.setAttribute('aria-label', '模型 ID 1')
  const nameInput = document.createElement('input')
  nameInput.className = 'zGbnIq_input'
  nameInput.type = 'text'
  nameInput.setAttribute('aria-label', '显示名称 1')
  const chevron = document.createElement('button')
  chevron.type = 'button'
  chevron.className = 'zGbnIq_iconButton'
  chevron.setAttribute('aria-expanded', 'true')
  chevron.setAttribute('aria-label', '高级设置 1')
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'zGbnIq_iconButton zGbnIq_iconButtonDanger'
  row.append(idInput, nameInput, chevron, remove)
  entry.appendChild(row)

  const advanced = document.createElement('div')
  advanced.className = 'zGbnIq_modelAdvanced'
  for (const label of ['上下文窗口', '最大输出 token']) {
    const field = document.createElement('label')
    field.className = 'zGbnIq_modelField'
    const caption = document.createElement('span')
    caption.className = 'zGbnIq_modelFieldLabel'
    caption.textContent = label
    const input = document.createElement('input')
    input.className = 'zGbnIq_input'
    input.type = 'text'
    input.setAttribute('inputmode', 'numeric')
    field.append(caption, input)
    advanced.appendChild(field)
  }
  const inputTypes = document.createElement('fieldset')
  inputTypes.className = 'zGbnIq_modelInputTypes'
  inputTypes.setAttribute('aria-label', '输入类型 1')
  const legend = document.createElement('legend')
  legend.className = 'zGbnIq_modelFieldLabel'
  legend.textContent = '输入类型'
  const choices = document.createElement('div')
  choices.className = 'zGbnIq_modelInputChoices'
  for (const [modality, checked] of [['文本', true], ['图像', false]] as [string, boolean][]) {
    const label = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    label.append(box, document.createTextNode(modality))
    choices.appendChild(label)
  }
  inputTypes.append(legend, choices)
  advanced.appendChild(inputTypes)
  entry.appendChild(advanced)

  const catalog = document.createElement('section')
  catalog.className = 'zGbnIq_modelCatalog'
  const listHead = document.createElement('div')
  listHead.className = 'zGbnIq_modelListHead'
  const list = document.createElement('div')
  list.className = 'zGbnIq_modelList'
  list.appendChild(entry)
  catalog.append(listHead, list)
  const body = document.createElement('div')
  body.className = 'zGbnIq_customizedBody'
  body.appendChild(catalog)
  const details = document.createElement('details')
  details.className = 'zGbnIq_customized'
  details.appendChild(body)
  editor.append(header, details)
  document.body.appendChild(editor)
}

describe('real official model-row markup (0.2.0-rc.1)', () => {
  it('injects the reasoning block beside the capacity disclosure and never touches the official input types', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    realModelEditor('glm-5.5-air')
    sweepOnce(controller, t)

    const entry = document.querySelector('.zGbnIq_modelEntry')!
    const advanced = document.querySelector('.zGbnIq_modelAdvanced')!
    const block = entry.querySelector(':scope > [data-mp-block]') as HTMLElement
    expect(block).not.toBeNull()
    // Sibling of the disclosure, inside the model entry (full row width).
    expect(block.parentElement).toBe(entry)
    expect(advanced.parentElement).toBe(entry)
    expect(block.getAttribute('data-mp-provider')).toBe('router9')
    expect(block.getAttribute('data-mp-index')).toBe('0')

    // The plugin's block owns the reasoning control only: 0.2.0-rc.1's official
    // row owns `input`, so no image control is injected anywhere.
    expect(block.querySelectorAll('select')).toHaveLength(1)
    expect(document.querySelector('[data-mp-image]')).toBeNull()

    // The official text/image checkboxes survive untouched: same nodes, same
    // checked state, no plugin attribute in their subtree.
    const official = document.querySelector('.zGbnIq_modelInputTypes') as HTMLElement
    expect(advanced.contains(official)).toBe(true)
    const boxes = [...official.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, false])
    expect(official.querySelector('[data-mp-block], [data-mp-image]')).toBeNull()
  })
})

describe('real official markup end-to-end', () => {
  it('injects beside 编辑 on a collapsed row (no expansion, no editor)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    realRowCard('9router')
    sweepOnce(controller, t)

    const actions = document.querySelector('.zGbnIq_rowActions')!
    const buttons = Array.from(actions.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons[0]).toBe('sync')          // our button sits FIRST, before 编辑
    expect(buttons).toContain('编辑')
    expect(buttons).toContain('删除')
    const ours = actions.querySelector('[data-mp-sync]') as HTMLButtonElement
    expect(ours.className).toBe('zGbnIq_secondaryButton') // identical styling → identical size
  })

  it('still injects when the editor card is open (details present)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    realRowCard('9router', { editorOpen: true })
    sweepOnce(controller, t)
    expect(document.querySelectorAll('[data-mp-sync]').length).toBe(1)
  })

  it('skips a row whose provider the controller does not own (built-in DeepSeek)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    realRowCard('DeepSeek')
    sweepOnce(controller, t)
    expect(document.querySelectorAll('[data-mp-sync]').length).toBe(0)
  })
})
