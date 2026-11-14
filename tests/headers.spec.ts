/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'
import { HEADER_SETTINGS_NS, REQUEST_HEADER_PRESETS } from '../src/header-config.ts'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { RequestHeaderController } from '../src/client/header-controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

describe('host request-header hook', () => {
  it('adds only the enabled provider headers and leaves the original chain intact', () => {
    let listener: ((request: { provider: string }, headers: Headers, next: () => Headers) => Headers) | undefined
    const ctx = {
      on: (_name: string, callback: typeof listener) => {
        listener = callback
        return () => true
      },
    }
    const config = Config({
      providers: {
        codex: { enabled: true, headers: { originator: 'codex_cli_rs', 'x-route': 'one' } },
        off: { enabled: false, headers: { 'x-route': 'two' } },
      },
    })
    apply(ctx as never, config as never)
    expect(listener).toBeDefined()

    const headers = new Headers({ 'x-before': 'yes' })
    const result = listener!({ provider: 'codex' }, headers, () => headers)
    expect(result).toBe(headers)
    expect(result.get('originator')).toBe('codex_cli_rs')
    expect(result.get('x-route')).toBe('one')
    expect(result.get('x-before')).toBe('yes')

    const disabled = new Headers()
    listener!({ provider: 'off' }, disabled, () => disabled)
    expect(disabled.has('x-route')).toBe(false)
  })
})

function fakeSettings() {
  let revision = 4
  const writes: unknown[] = []
  const provider = { provider: 'gateway', displayName: 'Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gateway'] }
  const settings = {
    describe: async () => ({
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [
          {
            ns: 'llm-pi-ai',
            schema: {},
            value: { providers: { gateway: { models: [{ id: 'm1' }] } } },
            user: { providers: { gateway: { models: [{ id: 'm1' }] } } },
            applies: 'live' as const,
            secrets: [],
            revision: 1,
          },
          {
            ns: HEADER_SETTINGS_NS,
            schema: {},
            value: { providers: { gateway: { enabled: false, headers: {} } } },
            user: { providers: {} },
            applies: 'live' as const,
            secrets: [],
            revision,
          },
        ],
      },
    }),
    mutate: async (ns: string, ops: unknown[], expectedRevision?: number) => {
      writes.push({ ns, ops, expectedRevision })
      revision = (expectedRevision ?? revision) + 1
      return { ok: true as const, value: { revision } }
    },
  }
  const llm = {
    listConfigurableProviders: async () => ({ ok: true as const, value: [provider] }),
  }
  return { settings, llm, writes }
}

describe('request-header settings', () => {
  it('loads every pi-ai route and saves one provider without changing llm-pi-ai', async () => {
    const { settings, llm, writes } = fakeSettings()
    const controller = new RequestHeaderController(settings, llm)
    await controller.load()
    const provider = controller.findProvider('Gateway')!
    expect(provider.profile).toEqual({ enabled: false, headers: {} })

    const failure = await controller.save(provider, { enabled: true, headers: { originator: 'codex_cli_rs' } })
    expect(failure).toBeUndefined()
    expect(writes[0]).toMatchObject({
      ns: HEADER_SETTINGS_NS,
      expectedRevision: 4,
      ops: [
        { op: 'set', path: ['providers', 'gateway', 'enabled'], value: true },
        { op: 'set', path: ['providers', 'gateway', 'headers'], value: { originator: 'codex_cli_rs' } },
      ],
    })
    expect(provider.profile).toEqual({ enabled: true, headers: { originator: 'codex_cli_rs' } })
  })
})

describe('provider advanced header editor', () => {
  it('shows both presets and saves the edited JSON', async () => {
    document.body.innerHTML = ''
    const { settings, llm, writes } = fakeSettings()
    const capabilities = new ModelCapabilityController(settings, llm)
    const headers = new RequestHeaderController(settings, llm)
    await Promise.all([capabilities.load(), headers.load()])

    const list = document.createElement('ul')
    const card = document.createElement('li')
    const head = document.createElement('div')
    const identity = document.createElement('span')
    const name = document.createElement('span')
    name.textContent = 'Gateway'
    identity.append(name)
    const actions = document.createElement('span')
    const edit = document.createElement('button')
    edit.textContent = '编辑'
    actions.append(edit)
    head.append(identity, actions)
    card.append(head)
    list.append(card)
    document.body.append(list)

    const t: Translator = ((key: string) => key) as Translator
    sweepOnce(capabilities, t, headers)
    const advanced = actions.querySelector('[data-mp-headers-button]') as HTMLButtonElement
    expect(advanced).toBeTruthy()
    expect(card.querySelectorAll('[data-mp-headers]')).toHaveLength(1)

    advanced.click()
    const panel = card.querySelector('[data-mp-headers]') as HTMLDetailsElement
    const presetButtons = panel.querySelectorAll('button')
    expect([...presetButtons].map((button) => button.textContent)).toEqual(['headers.codex', 'headers.claude', 'headers.save'])
    ;(presetButtons[0] as HTMLButtonElement).click()
    const input = panel.querySelector('textarea') as HTMLTextAreaElement
    expect(JSON.parse(input.value)).toEqual(REQUEST_HEADER_PRESETS.codex)
    input.value = JSON.stringify({ 'x-custom': 'value' })
    ;(panel.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true
    ;(presetButtons[2] as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes[writes.length - 1]).toMatchObject({ ns: HEADER_SETTINGS_NS })
    expect((writes[writes.length - 1] as { ops: Array<{ value: unknown }> }).ops[1]?.value).toEqual({ 'x-custom': 'value' })
  })
})
