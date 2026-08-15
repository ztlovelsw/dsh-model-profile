/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

/**
 * A faithful slice of the official Models editor DOM: one provider editor card
 * holding one model entry, whose capacity disclosure (modelAdvanced) carries
 * the numeric capacity inputs. The capability block is injected as a SIBLING of
 * that disclosure (inside the model entry) so it spans the full row width, and
 * mirrors the disclosure's open/closed state so the chevron collapses both.
 */
function buildEditorDom(opts: { expanded: boolean }): void {
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
  toggle.setAttribute('aria-expanded', opts.expanded ? 'true' : 'false')
  const remove = document.createElement('button')
  remove.type = 'button'
  row.append(idInput, nameInput, toggle, remove)
  entry.appendChild(row)

  if (opts.expanded) {
    const advanced = document.createElement('div')
    advanced.setAttribute('data-test-advanced', '')
    for (const label of ['上下文窗口', '最大输出 token']) {
      const field = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = label
      const input = document.createElement('input')
      input.type = 'text'
      input.setAttribute('inputmode', 'numeric')
      field.append(span, input)
      advanced.appendChild(field)
    }
    entry.appendChild(advanced)
  }

  catalog.appendChild(entry)
  editor.append(header, catalog)
  document.body.appendChild(editor)
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

describe('models-editor injection (capacity disclosure)', () => {
  it('injects the block as a disclosure sibling (full row width) when expanded', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true })
    sweepOnce(controller, t)

    const advanced = document.querySelector('[data-test-advanced]')!
    const block = document.querySelector('[data-mp-block]')
    expect(block).not.toBeNull()
    // The block must live in the model entry, next to the capacity disclosure.
    expect(block!.parentElement).toBe(advanced.parentElement)
    expect(advanced.parentElement!.contains(advanced)).toBe(true)
    expect(block!.hidden).toBe(false)
    expect(block!.getAttribute('data-mp-provider')).toBe('router9')
    expect(block!.getAttribute('data-mp-index')).toBe('0')
    // Values synced from the stored entry.
    const imageSel = block!.querySelector('[data-mp-image]') as HTMLSelectElement
    expect(imageSel.value).toBe('image')
    const reasonSel = block!.querySelector('[data-mp-reason]') as HTMLSelectElement
    expect(reasonSel.value).toBe('custom')
  })

  it('does NOT inject when the capacity disclosure is collapsed (not in DOM)', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: false })
    sweepOnce(controller, t)
    expect(document.querySelector('[data-mp-block]')).toBeNull()
  })

  it('hides an existing block once the disclosure is collapsed again', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true })
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]')!
    expect(block.hidden).toBe(false)

    // Collapse: React unmounts the disclosure; the next sweep mirrors that.
    document.querySelector('[data-test-advanced]')!.remove()
    sweepOnce(controller, t)
    expect(block.hidden).toBe(true)

    // Expand again: the disclosure returns and the block is restored.
    const entry = document.querySelector('section > div')!
    const advanced = document.createElement('div')
    advanced.setAttribute('data-test-advanced', '')
    const capInput = document.createElement('input')
    capInput.setAttribute('inputmode', 'numeric')
    advanced.appendChild(capInput)
    entry.appendChild(advanced)
    sweepOnce(controller, t)
    expect(block.hidden).toBe(false)
  })

  it('writes input on image select change (block beside disclosure)', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]')!
    const imageSel = block.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'text'
    imageSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutateCalls.length).toBe(1)
    const op = mutateCalls[0].ops[0] as { op: string; path: string[]; value: unknown }
    // The settings walker cannot address array elements, so the write is one
    // whole-array `set` carrying the patched entry; other fields survive.
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'router9', 'models'])
    expect(op.value).toEqual([
      {
        id: 'deepseek-v4-flash',
        contextWindow: 1000000,
        input: ['text'],
        reasoningEfforts: { off: null, high: 'high' },
      },
      { id: 'mimo-v2.5-free' },
    ])
  })

  it('does not inject into an unknown provider card', async () => {
    document.body.innerHTML = ''
    const { api } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
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
    toggle.setAttribute('aria-expanded', 'true')
    row.append(idInput, nameInput, toggle)
    const advanced = document.createElement('div')
    const capInput = document.createElement('input')
    capInput.setAttribute('inputmode', 'numeric')
    advanced.appendChild(capInput)
    entry.append(row, advanced)
    catalog.appendChild(entry)
    editor.append(header, catalog)
    document.body.appendChild(editor)

    sweepOnce(controller, t)
    expect(document.querySelector('[data-mp-block]')).toBeNull()
  })
})
