
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
