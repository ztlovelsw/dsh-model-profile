/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

/**
 * A faithful slice of the official Models editor DOM: one provider editor card
 * holding one model row. The detection must resolve the provider from the card
 * header and inject a capability block into the row, then keep it in sync.
 */
function buildEditorDom(): { idInput: HTMLInputElement } {
  const editor = document.createElement('div')
  const header = document.createElement('div')
  const title = document.createElement('span')
  title.textContent = '9router'
  const route = document.createElement('span')
  route.textContent = 'router9'
  header.append(title, route)

  const catalog = document.createElement('section')
  const entry = document.createElement('div')
  const row = document.createElement('div')
  const idInput = document.createElement('input')
  idInput.type = 'text'
  idInput.value = 'deepseek-v4-flash'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.value = ''
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', 'false')
  const remove = document.createElement('button')
  remove.type = 'button'
  row.append(idInput, nameInput, toggle, remove)
  entry.appendChild(row)
  catalog.appendChild(entry)
  editor.append(header, catalog)
  document.body.appendChild(editor)
  return { idInput }
}

function fakeApi() {
  const models = [
    {
      id: 'deepseek-v4-flash',
      contextWindow: 1000000,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, high: 'high' },
    },
    { id: 'mimo-v2.5-free' },
  ]
  const mutateCalls: { ns: string; ops: unknown[] }[] = []
  const api = {
    llm: {
      providers: async () => ({
        result: {
          ok: true as const,
          value: {
            providers: [{
              provider: 'router9',
              displayName: '9router',
              settingsNs: 'llm-pi-ai',
              settingsPath: ['providers', 'router9'],
              active: true,
            }],
          },
        },
      }),
    },
    settings: {
      describe: async () => ({
        result: {
          ok: true as const,
          value: {
            writable: true,
            hasDocument: true,
            namespaces: [{
              ns: 'llm-pi-ai',
              schema: {},
              value: { providers: { router9: { models } } },
              user: { providers: { router9: { models } } },
              applies: 'live' as const,
              secrets: [],
              revision: 7,
            }],
          },
        },
      }),
      mutate: async (request: { ns: string; ops: unknown[] }) => {
        mutateCalls.push(request)
        return { result: { ok: true as const, value: { revision: 8 } } }
      },
    },
  }
  return { api, mutateCalls, models }
}

const t: Translator = ((key: string) => key) as Translator

describe('models-editor injection', () => {
  it('injects a capability block into a pi-ai model row and syncs values', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    expect(controller.loaded).toBe(true)

    buildEditorDom()
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]')
    expect(block).not.toBeNull()
    expect(block!.getAttribute('data-mp-provider')).toBe('router9')
    expect(block!.getAttribute('data-mp-index')).toBe('0')

    // Image select reflects stored input: ['text','image'] -> 'image' (supports).
    const imageSel = block!.querySelector('[data-mp-image]') as HTMLSelectElement
    expect(imageSel.value).toBe('image')

    // Reasoning select reflects stored reasoningEfforts object -> 'custom'.
    const reasonSel = block!.querySelector('[data-mp-reason]') as HTMLSelectElement
    expect(reasonSel.value).toBe('custom')

    // Custom grid is visible with off + high checked.
    const grid = block!.querySelector('[data-mp-grid]') as HTMLElement
    expect(grid.hidden).toBe(false)
    const highBox = grid.querySelector('[data-mp-level="high"]') as HTMLInputElement
    const offBox = grid.querySelector('[data-mp-level="off"]') as HTMLInputElement
    const highWire = grid.querySelector('[data-mp-wire="high"]') as HTMLInputElement
    expect(highBox.checked).toBe(true)
    expect(offBox.checked).toBe(true)
    expect(highWire.value).toBe('high')
  })

  it('writes input on image select change', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom()
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]')!
    const imageSel = block.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'text'
    imageSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutateCalls.length).toBe(1)
    expect(mutateCalls[0].ns).toBe('llm-pi-ai')
    const op = mutateCalls[0].ops[0] as { op: string; path: string[]; value: unknown }
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'router9', 'models', '0', 'input'])
    expect(op.value).toEqual(['text'])
  })

  it('does not inject into a deepseek-only or unknown provider card', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    // A card whose header names no editable provider.
    const editor = document.createElement('div')
    const header = document.createElement('div')
    const title = document.createElement('span')
    title.textContent = 'SomeOtherProvider'
    header.appendChild(title)
    const catalog = document.createElement('section')
    const entry = document.createElement('div')
    const row = document.createElement('div')
    const idInput = document.createElement('input')
    idInput.type = 'text'
    idInput.value = 'unknown-model'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    const toggle = document.createElement('button')
    toggle.setAttribute('aria-expanded', 'false')
    row.append(idInput, nameInput, toggle)
    entry.appendChild(row)
    catalog.appendChild(entry)
    editor.append(header, catalog)
    document.body.appendChild(editor)

    sweepOnce(controller, t)
    expect(document.querySelector('[data-mp-block]')).toBeNull()
  })
})
