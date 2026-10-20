/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

function fakeApi() {
  const models: Array<Record<string, unknown>> = [
    {
      id: 'deepseek-v4-flash',
      contextWindow: 1000000,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, high: 'high' },
    },
    { id: 'mimo-v2.5-free' },
  ]
  const providers = [
    {
      provider: 'router9',
      displayName: '9router',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'router9'],
      active: true,
    },
  ]
  const userProviders: Record<string, { models: unknown[] }> = {
    router9: { models },
  }
  const mutateCalls: { ns: string; ops: unknown[] }[] = []
  const settings = {
    describe: async () => ({
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'llm-pi-ai',
          schema: {},
          value: { providers: userProviders },
          user: { providers: userProviders },
          applies: 'live' as const,
          secrets: [],
          revision: 7,
        }],
      },
    }),
    mutate: async (ns: string, ops: unknown[]) => {
      mutateCalls.push({ ns, ops })
      return { ok: true as const, value: { revision: 8 } }
    },
  }
  const llm = {
    listConfigurableProviders: async () => ({ ok: true as const, value: providers }),
  }
  return { settings, llm, mutateCalls, models, providers, userProviders }
}

const t: Translator = ((key: string) => key) as Translator

/**
 * The stubbed models.dev database for the whole file. The preset module caches
 * its index after the first fetch, so every test must see the same db — the
 * stub is installed once at module scope, before any sweep can fetch.
 */
const SHARED_DB = {
  zai: {
    models: {
      'glm-5.5-air': {
        modalities: { input: ['text', 'image'] },
        reasoning_options: [{ type: 'effort', values: ['high'] }],
      },
      // A capacity-only entry: exercises the limit.context / limit.output
      // sync without touching the image / reasoning fields.
      'glm-4.6': { limit: { context: 204800, output: 131072 } },
    },
  },
  deepseek: {
    models: {
      // Reachable through a `cn:`-prefixed catalog route.
      'deepseek-v4.1-flash': {
        modalities: { input: ['text', 'image'] },
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
      },
    },
  },
}
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => SHARED_DB }) as Response)

/**
 * A faithful slice of one provider ROW CARD (the collapsed Models-page row):
 * an <li> whose head is a div carrying the identity span (display name +
 * 「自定义」 tag) and the action group span (the official 编辑 / 删除 buttons).
 * This is the seat the sync button must take — no expansion required.
 */
function buildRowCardDom(opts: { displayName?: string; removable?: boolean; expanded?: boolean } = {}): {
  card: HTMLElement
  actions: HTMLElement
  edit: HTMLButtonElement
} {
  const list = document.createElement('ul')
  const card = document.createElement('li')
  const head = document.createElement('div')
  const identity = document.createElement('span')
  const name = document.createElement('span')
  name.textContent = opts.displayName ?? '9router'
  const tag = document.createElement('span')
  tag.textContent = '自定义'
  // The real row also carries a credential dot (role=img, no text) — the scan
  // must tolerate it between the name and the action group.
  const dot = document.createElement('span')
  dot.setAttribute('role', 'img')
  dot.setAttribute('aria-label', '已配置')
  identity.append(name, tag, dot)
  const actions = document.createElement('span')
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'official-secondary'
  edit.textContent = '编辑'
  actions.append(edit)
  if (opts.removable !== false) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'official-danger'
    remove.textContent = '删除'
    actions.append(remove)
  }
  head.append(identity, actions)
  card.append(head)
  if (opts.expanded === true) {
    // An open editor card adds the customized <details> below the head.
    const details = document.createElement('details')
    details.append(document.createElement('div'))
    card.append(details)
  }
  list.append(card)
  document.body.append(list)
  return { card, actions, edit }
}

/** Let the click handler's awaits settle (the fetch stub resolves immediately). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

describe('provider-level sync button (同步模型能力)', () => {
  it('mounts the button in the collapsed row action group, styled like 编辑', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions, edit } = buildRowCardDom()
    sweepOnce(controller, t)

    const buttons = actions.querySelectorAll('[data-mp-sync]')
    expect(buttons.length).toBe(1)
    const button = buttons[0] as HTMLButtonElement
    expect(button.textContent).toBe('sync')
    // Same class as the neighbouring official button → same size/appearance.
    expect(button.className).toBe(edit.className)
    // Seated immediately before 编辑 (the group's first child).
    expect(actions.firstElementChild).toBe(button)
  })

  it('mounts on a row card with no open editor and no expanded model rows', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    // No model entry in the DOM at all — the collapsed page the user sees.
    const { actions } = buildRowCardDom()
    expect(document.querySelectorAll('button[aria-expanded]').length).toBe(0)
    sweepOnce(controller, t)
    expect(actions.querySelectorAll('[data-mp-sync]').length).toBe(1)
  })

  it('click writes the models.dev capabilities for every matched model', async () => {
    document.body.innerHTML = ''
    // The presets module caches its index after the first fetch (module scope,
    // whole file), so this test uses the SHARED_DB entries.
    const { settings, llm, userProviders, mutateCalls } = fakeApi()
    userProviders.router9.models = [
      { id: 'glm-5.5-air' },
      { id: 'mimo-v2.5-free' },
    ]
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom()
    sweepOnce(controller, t)

    const button = actions.querySelector('[data-mp-sync]') as HTMLButtonElement
    button.click()
    await settle()

    // Image support and reasoning levels land as whole-array writes.
    const last = mutateCalls[mutateCalls.length - 1] as { ops: { value: Record<string, unknown>[] }[] }
    const written = last.ops[0].value
    expect(written[0]).toMatchObject({ id: 'glm-5.5-air', input: ['text', 'image'] })
    expect(written[0].reasoningEfforts).toMatchObject({ high: 'high' })
    // The unknown model is untouched.
    expect(written[1]).toEqual({ id: 'mimo-v2.5-free' })
    // Button reports the outcome then restores its label.
    expect(button.textContent).toContain('sync.applied')
    expect(button.disabled).toBe(false)
  })

  it('resolves a cn:-prefixed model id', async () => {
    document.body.innerHTML = ''
    const { settings, llm, userProviders, mutateCalls } = fakeApi()
    userProviders.router9.models = [{ id: 'cn:deepseek-v4.1-flash' }]
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom()
    sweepOnce(controller, t)
    ;(actions.querySelector('[data-mp-sync]') as HTMLButtonElement).click()
    await settle()

    const last = mutateCalls[mutateCalls.length - 1] as { ops: { value: Record<string, unknown>[] }[] }
    expect(last.ops[0].value[0]).toMatchObject({
      id: 'cn:deepseek-v4.1-flash',
      input: ['text', 'image'],
      reasoningEfforts: { low: 'low', high: 'high' },
    })
  })

  it('gap-fills capacity only when the entry does not declare it', async () => {
    document.body.innerHTML = ''
    const { settings, llm, userProviders, mutateCalls } = fakeApi()
    userProviders.router9.models = [
      // SHARED_DB glm-4.6 carries limit.context/output; this row declares one.
      { id: 'glm-4.6', contextWindow: 12345 },
    ]
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom()
    sweepOnce(controller, t)
    ;(actions.querySelector('[data-mp-sync]') as HTMLButtonElement).click()
    await settle()

    const last = mutateCalls[mutateCalls.length - 1] as { ops: { value: Record<string, unknown>[] }[] }
    const entry = last.ops[0].value[0]
    expect(entry.contextWindow).toBe(12345)
    expect(entry.maxTokens).toBe(131072)
  })

  it('keeps exactly one button across repeated sweeps (no duplicates)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom()
    sweepOnce(controller, t)
    sweepOnce(controller, t)
    sweepOnce(controller, t)
    expect(actions.querySelectorAll('[data-mp-sync]').length).toBe(1)
  })

  it('mounts nothing on a row card naming an unknown provider', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom({ displayName: 'not-a-provider' })
    sweepOnce(controller, t)
    expect(actions.querySelectorAll('[data-mp-sync]').length).toBe(0)
  })

  it('injects nothing besides the button (no per-model controls any more)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildRowCardDom({ expanded: true })
    sweepOnce(controller, t)
    expect(document.querySelectorAll('[data-mp-block]').length).toBe(0)
    expect(document.querySelectorAll('select').length).toBe(0)
  })
})

describe('one-shot seeding (the official row owns the fields afterwards)', () => {
  it('never re-applies a synced reasoning level the official editor changed', async () => {
    document.body.innerHTML = ''
    const { settings, llm, userProviders, mutateCalls } = fakeApi()
    userProviders.router9.models = [{ id: 'glm-5.5-air' }]
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const { actions } = buildRowCardDom()
    sweepOnce(controller, t)
    ;(actions.querySelector('[data-mp-sync]') as HTMLButtonElement).click()
    await settle()
    const writesAfterSync = mutateCalls.length
    expect(writesAfterSync).toBeGreaterThan(0)

    // The official row's reasoning editor saves a different level set, then the
    // settings push triggers a join reload.
    userProviders.router9.models = [{ id: 'glm-5.5-air', input: ['text'], reasoningEfforts: { high: 'max' } }]
    await controller.load()
    expect(mutateCalls.length).toBe(writesAfterSync)
    expect(controller.byRoute.get('router9')?.models[0]).toMatchObject({
      input: ['text'],
      reasoningEfforts: { high: 'max' },
    })
  })
})
