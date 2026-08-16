/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
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
function buildEditorDom(opts: { expanded: boolean; modelId?: string; capacity?: [string, string] }): void {
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
  idInput.value = opts.modelId ?? 'deepseek-v4-flash'
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
    const capValues = opts.capacity ?? ['', '']
    for (const [at, label] of ['上下文窗口', '最大输出 token'].entries()) {
      const field = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = label
      const input = document.createElement('input')
      input.type = 'text'
      input.setAttribute('inputmode', 'numeric')
      input.value = capValues[at]
      field.append(span, input)
      advanced.appendChild(field)
    }
    entry.appendChild(advanced)
  }

  // The edit-existing card nests its model catalog inside the customized
  // <details> disclosure — the structural opposite of a draft card.
  catalog.appendChild(entry)
  const customized = document.createElement('details')
  customized.appendChild(catalog)
  editor.append(header, customized)
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
  const providers = [{
    provider: 'router9',
    displayName: '9router',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'router9'],
    active: true,
  }]
  const userProviders: Record<string, { models: unknown[] }> = { router9: { models } }
  const mutateCalls: { ns: string; ops: unknown[] }[] = []
  const api = {
    llm: {
      providers: async () => ({
        result: {
          ok: true as const,
          value: { providers },
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
              value: { providers: userProviders },
              user: { providers: userProviders },
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
  return { api, mutateCalls, models, providers, userProviders }
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
      // preset without touching the image / reasoning fields.
      'glm-4.6': { limit: { context: 204800, output: 131072 } },
    },
  },
}
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => SHARED_DB }) as Response)

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
    // Committed row: no pre-save banner, no pending binding.
    expect(block!.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)
    expect(block!.hasAttribute('data-mp-pending-id')).toBe(false)
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

describe('staged (unsaved) model rows — fetch-catalog adds', () => {
  const STAGED_ID = 'glm-5.5-air'

  it('injects a pending block with the pre-save banner for a staged row', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    // An id models.dev does not know: the block still appears immediately.
    buildEditorDom({ expanded: true, modelId: 'staged-unknown-model' })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.getAttribute('data-mp-pending-id')).toBe('staged-unknown-model')
    expect(block.getAttribute('data-mp-index')).toBe('-1')
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(false)
    // Nothing lands in settings while the row is still a draft.
    expect(mutateCalls.length).toBe(0)
  })

  it('auto-applies the models.dev preset, stages manual edits, and lands everything after save', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls, models } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: STAGED_ID })
    sweepOnce(controller, t)

    // The auto preset reflects in the block without any settings write.
    await vi.waitFor(() => {
      const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
      expect(imageSel.value).toBe('image')
      const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    expect(mutateCalls.length).toBe(0)

    // A manual choice on the staged row overrides the preset for that field
    // and still writes nothing until the official editor saves.
    const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'text'
    imageSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)

    // The save commits the model into settings; the next load's reconcile
    // writes the staged capabilities field by field (one whole-array set
    // per field), each fenced by the fresh revision.
    models.push({ id: STAGED_ID, contextWindow: 128000 })
    await controller.load()
    await vi.waitFor(() => expect(mutateCalls.length).toBe(2))
    const op = mutateCalls[1].ops[0] as { op: string; path: string[]; value: unknown }
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'router9', 'models'])
    expect(op.value).toEqual([
      {
        id: 'deepseek-v4-flash',
        contextWindow: 1000000,
        input: ['text', 'image'],
        reasoningEfforts: { off: null, high: 'high' },
      },
      { id: 'mimo-v2.5-free' },
      {
        id: STAGED_ID,
        contextWindow: 128000,
        input: ['text'],                       // the manual override
        reasoningEfforts: { high: 'high' },    // from the auto preset
      },
    ])

    // Landed: the block rebinds from settings, banner gone.
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block.hasAttribute('data-mp-pending-id')).toBe(false)
    expect(block.getAttribute('data-mp-index')).toBe('2')
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)
    const landedImage = block.querySelector('[data-mp-image]') as HTMLSelectElement
    expect(landedImage.value).toBe('text')
  })

  it('never writes a staged choice while the model stays out of settings', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'never-saved-model' })
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    const imageSel = block.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'image'
    imageSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)

    // Cancelled add: later loads (e.g. after some other write elsewhere) must
    // keep waiting for the save — no write while the model is absent.
    document.body.innerHTML = ''
    await controller.load()
    expect(mutateCalls.length).toBe(0)
  })
})

/**
 * The "add custom provider" editor: a draft card whose model catalog is a
 * DIRECT child of the card (the edit card nests its catalog inside the
 * customized <details>), with the Provider ID / 显示名称 fields preceding the
 * catalog. Rows must get capability blocks before the provider is committed,
 * staged in memory, and landed by reconcile once 创建提供方 saves the route.
 */
function buildDraftEditorDom(opts: { providerId: string; modelId: string; displayName?: string; expanded?: boolean }): void {
  const editor = document.createElement('div')
  const header = document.createElement('div')
  const title = document.createElement('span')
  title.textContent = '自定义提供方'
  header.appendChild(title)

  const field = (label: string, value: string): HTMLElement => {
    const wrap = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    wrap.append(span, input)
    return wrap
  }

  const catalog = document.createElement('section')
  const entry = document.createElement('div')
  const row = document.createElement('div')
  const idInput = document.createElement('input')
  idInput.type = 'text'
  idInput.value = opts.modelId
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', opts.expanded === false ? 'false' : 'true')
  const remove = document.createElement('button')
  remove.type = 'button'
  row.append(idInput, nameInput, toggle, remove)
  entry.appendChild(row)
  if (opts.expanded !== false) {
    const advanced = document.createElement('div')
    advanced.setAttribute('data-test-advanced', '')
    for (const label of ['上下文窗口', '最大输出 token']) {
      const capField = document.createElement('label')
      const capSpan = document.createElement('span')
      capSpan.textContent = label
      const capInput = document.createElement('input')
      capInput.type = 'text'
      capInput.setAttribute('inputmode', 'numeric')
      capField.append(capSpan, capInput)
      advanced.appendChild(capField)
    }
    entry.appendChild(advanced)
  }
  catalog.appendChild(entry)

  const actions = document.createElement('div')
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消'
  const create = document.createElement('button')
  create.type = 'button'
  create.textContent = '创建提供方'
  actions.append(cancel, create)

  editor.append(
    header,
    field('Provider ID', opts.providerId),
    field('显示名称', opts.displayName ?? ''),
    field('API 地址', ''),
    field('API 密钥', ''),
    catalog,
    actions,
  )
  document.body.appendChild(editor)
}

describe('draft provider editor (add custom provider)', () => {
  const DRAFT_ID = 'acme'
  const DB_MODEL = 'glm-5.5-air'

  it('binds a pending block to the typed Provider ID before creation', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'draft-unknown-model' })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.getAttribute('data-mp-provider')).toBe(DRAFT_ID)
    expect(block.getAttribute('data-mp-pending-id')).toBe('draft-unknown-model')
    expect(block.getAttribute('data-mp-index')).toBe('-1')
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(false)
    expect(mutateCalls.length).toBe(0)
    expect(controller.byDraftRoute.get(DRAFT_ID)).toBeDefined()
  })

  it('auto-presets, stages manual edits, and lands everything after 创建提供方', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls, providers, userProviders } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: DB_MODEL })
    sweepOnce(controller, t)

    // Auto preset from models.dev, reflected in the block without any write.
    await vi.waitFor(() => {
      const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
      expect(imageSel.value).toBe('image')
      const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    expect(mutateCalls.length).toBe(0)

    // Manual override of one field still writes nothing pre-creation.
    const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'text'
    imageSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)

    // 创建提供方 commits the route with the typed models; reconcile lands
    // both staged capabilities as whole-array writes under the new route.
    providers.push({ provider: DRAFT_ID, displayName: 'Acme', settingsNs: 'llm-pi-ai', settingsPath: ['providers', DRAFT_ID], active: true })
    userProviders[DRAFT_ID] = { models: [{ id: DB_MODEL, contextWindow: 64000 }] }
    await controller.load()
    await vi.waitFor(() => expect(mutateCalls.length).toBe(2))
    for (const call of mutateCalls) {
      const op = call.ops[0] as { op: string; path: string[] }
      expect(op.op).toBe('set')
      expect(op.path).toEqual(['providers', DRAFT_ID, 'models'])
    }
    const final = mutateCalls[1].ops[0] as { value: unknown }
    expect(final.value).toEqual([
      { id: DB_MODEL, contextWindow: 64000, input: ['text'], reasoningEfforts: { high: 'high' } },
    ])
  })

  it('evicts staged choices when the Provider ID is retyped', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm1' })
    sweepOnce(controller, t)
    const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'image'
    imageSel.dispatchEvent(new Event('change'))
    expect(controller.readIntent(DRAFT_ID, 'm1')).toBeDefined()

    // Retype the Provider ID: the old id's staged choices are disowned.
    const routeInput = document.querySelector('body > div > div > input') as HTMLInputElement
    routeInput.value = DRAFT_ID + '-2'
    routeInput.dispatchEvent(new Event('input', { bubbles: true }))
    sweepOnce(controller, t)
    expect(controller.readIntent(DRAFT_ID, 'm1')).toBeUndefined()
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block.getAttribute('data-mp-provider')).toBe(DRAFT_ID + '-2')
    expect(mutateCalls.length).toBe(0)
  })

  it('keeps a cancelled draft unwritten across later loads', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm1' })
    sweepOnce(controller, t)
    const imageSel = document.querySelector('[data-mp-image]') as HTMLSelectElement
    imageSel.value = 'image'
    imageSel.dispatchEvent(new Event('change'))

    // Cancel: the card disappears; the pending choice stays dormant (never
    // written) unless a provider with that exact id and model appears.
    document.body.innerHTML = ''
    await controller.load()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)
    expect(controller.readIntent(DRAFT_ID, 'm1')?.pending).toBe(true)
    expect(controller.byDraftRoute.size).toBe(0)
  })

  it('stages rows from two draft cards sharing one typed id without trampling', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm-a' })
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm-b' })
    sweepOnce(controller, t)

    const blocks = [...document.querySelectorAll('[data-mp-block]')] as HTMLElement[]
    expect(blocks.length).toBe(2)
    const blockA = blocks.find((b) => b.getAttribute('data-mp-pending-id') === 'm-a')!
    const blockB = blocks.find((b) => b.getAttribute('data-mp-pending-id') === 'm-b')!
    const imageA = blockA.querySelector('[data-mp-image]') as HTMLSelectElement
    imageA.value = 'image'
    imageA.dispatchEvent(new Event('change'))
    const reasonB = blockB.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonB.value = 'off'
    reasonB.dispatchEvent(new Event('change'))

    expect(controller.readIntent(DRAFT_ID, 'm-a')?.input).toEqual(['text', 'image'])
    expect(controller.readIntent(DRAFT_ID, 'm-b')?.reasoningEfforts).toBe(false)
    expect(mutateCalls.length).toBe(0)
  })
})

describe('capacity auto-preset (contextWindow / maxTokens)', () => {
  const capInputs = (): HTMLInputElement[] =>
    [...document.querySelectorAll('[data-test-advanced] input[inputmode="numeric"]')] as HTMLInputElement[]

  it('fills the empty capacity inputs of a committed row from models.dev, without writing settings', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6' })
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-4.6' })
    sweepOnce(controller, t)

    const inputs = capInputs()
    await vi.waitFor(() => expect(inputs[0].value).toBe('204800'))
    expect(inputs[1].value).toBe('131072')
    // The values stage into the editor's own draft; nothing hits settings.
    expect(mutateCalls.length).toBe(0)
  })

  it('keeps values the endpoint disclosed or the user typed', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6', contextWindow: 999000 })
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-4.6', capacity: ['999000', ''] })
    sweepOnce(controller, t)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const inputs = capInputs()
    expect(inputs[0].value).toBe('999000')
    expect(inputs[1].value).toBe('131072')
    expect(mutateCalls.length).toBe(0)
  })

  it('does not refill an auto-filled input the user cleared', async () => {
    document.body.innerHTML = ''
    const { api, models } = fakeApi()
    models.push({ id: 'glm-4.6' })
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-4.6' })
    sweepOnce(controller, t)
    const inputs = capInputs()
    await vi.waitFor(() => expect(inputs[0].value).toBe('204800'))

    inputs[0].value = ''
    sweepOnce(controller, t)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(inputs[0].value).toBe('')
  })

  it('fills the capacity inputs of a staged (unsaved) row too', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-4.6' })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block.getAttribute('data-mp-pending-id')).toBe('glm-4.6')
    const inputs = capInputs()
    await vi.waitFor(() => expect(inputs[0].value).toBe('204800'))
    expect(inputs[1].value).toBe('131072')
    expect(mutateCalls.length).toBe(0)
  })

  it('the preset button overwrites non-empty capacity inputs', async () => {
    document.body.innerHTML = ''
    const { api, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6', contextWindow: 111000 })
    const controller = new ModelCapabilityController(api as never)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-4.6', capacity: ['111000', '222000'] })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]') as HTMLElement
    const presetBtn = block.querySelector('[data-mp-preset]') as HTMLButtonElement
    presetBtn.click()
    const inputs = capInputs()
    await vi.waitFor(() => expect(inputs[0].value).toBe('204800'))
    expect(inputs[1].value).toBe('131072')
    // Capacity-only preset: no image/reasoning opinion, so no settings write.
    expect(mutateCalls.length).toBe(0)
  })
})
