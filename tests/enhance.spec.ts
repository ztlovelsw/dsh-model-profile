/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'
import { sweepOnce } from '../src/client/enhance.ts'
import type { Translator } from '../src/client/enhance.ts'

/**
 * A faithful slice of the official Models editor DOM (DSH 0.2.0-rc.1): one
 * provider editor card holding one model entry, whose capacity disclosure
 * (modelAdvanced) carries the numeric capacity inputs AND the official
 * 输入类型 (text/image) checkpoint fieldset bound to the same `input` field the
 * plugin seeds. The capability block is injected as a SIBLING of that
 * disclosure (inside the model entry) so it spans the full row width, and
 * mirrors the disclosure's open/closed state so the chevron collapses both.
 */
function buildEditorDom(opts: { expanded: boolean; modelId?: string; capacity?: [string, string]; inputTypes?: boolean }): void {
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
    // The official per-model input-type control (0.2.0-rc.1) — the plugin must
    // neither duplicate nor touch it.
    const inputTypes = document.createElement('fieldset')
    inputTypes.setAttribute('data-test-input-types', '')
    for (const modality of ['text', 'image']) {
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = (opts.inputTypes ?? true) && modality === 'text'
      label.append(box, document.createTextNode(modality))
      inputTypes.appendChild(label)
    }
    advanced.appendChild(inputTypes)
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

function fakeApi(opts: { dormant?: string[] } = {}) {
  const models = [
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
    // Dormant catalog routes: offered by the "add provider" card, with no
    // user-layer profile yet — directory-only entries.
    ...(opts.dormant ?? []).map((route) => ({
      provider: route,
      displayName: route,
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', route],
      active: true,
    })),
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
      // preset without touching the image / reasoning fields.
      'glm-4.6': { limit: { context: 204800, output: 131072 } },
    },
  },
}
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => SHARED_DB }) as Response)

describe('models-editor injection (capacity disclosure)', () => {
  it('injects the block as a disclosure sibling (full row width) when expanded', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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
    // Only the reasoning control is injected: 0.2.0-rc.1's official row owns
    // the image checkboxes, so the block carries no image control at all.
    expect(block!.querySelector('[data-mp-image]')).toBeNull()
    expect(block!.querySelectorAll('select')).toHaveLength(1)
    const reasonSel = block!.querySelector('[data-mp-reason]') as HTMLSelectElement
    expect(reasonSel.value).toBe('custom')
    // The official text/image checkpoint fieldset is left exactly as rendered:
    // still in the disclosure, still checked text-only, no plugin markers.
    const official = advanced.querySelector('[data-test-input-types]') as HTMLElement
    expect(official).not.toBeNull()
    expect(advanced.contains(official)).toBe(true)
    const boxes = [...official.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes.map((box) => box.checked)).toEqual([true, false])
    expect(official.querySelector('[data-mp-image]')).toBeNull()
    // Committed row: no pre-save banner, no pending binding.
    expect(block!.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)
    expect(block!.hasAttribute('data-mp-pending-id')).toBe(false)
  })

  it('does NOT inject when the capacity disclosure is collapsed (not in DOM)', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildEditorDom({ expanded: false })
    sweepOnce(controller, t)
    expect(document.querySelector('[data-mp-block]')).toBeNull()
  })

  it('hides an existing block once the disclosure is collapsed again', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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

  it('writes reasoningEfforts on select change (block beside disclosure)', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildEditorDom({ expanded: true })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]')!
    const reasonSel = block.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutateCalls.length).toBe(1)
    const op = mutateCalls[0].ops[0] as { op: string; path: string[]; value: unknown }
    // The settings walker cannot address array elements, so the write is one
    // whole-array `set` carrying the patched entry; other fields survive —
    // including the `input` the official checkbox rendered.
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'router9', 'models'])
    expect(op.value).toEqual([
      {
        id: 'deepseek-v4-flash',
        contextWindow: 1000000,
        input: ['text', 'image'],
        reasoningEfforts: false,
      },
      { id: 'mimo-v2.5-free' },
    ])
  })

  it('does not inject into an unknown provider card', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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

  it('stages the models.dev preset on a committed row and lands it on save', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-5.5-air' })
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'glm-5.5-air' })
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block).not.toBeNull()
    // A committed row starts clean: no write, no staged hint.
    expect(mutateCalls.length).toBe(0)
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)

    // The preset button shows the matched values and stages them — no write.
    // Image support has no plugin control any more, so only the reasoning
    // select reflects the staged preset.
    const presetBtn = block.querySelector('[data-mp-preset]') as HTMLButtonElement
    presetBtn.click()
    await vi.waitFor(() => {
      expect(mutateCalls.length).toBe(0)
      const reasonSel = block.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    // The staged hint marks the values as landing with the card's save.
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(false)

    // The official save lands them: the next settings reload writes the staged
    // fields one whole-array set per field, fenced by the fresh revision.
    await controller.load('settings')
    await vi.waitFor(() => expect(mutateCalls.length).toBe(2))
    // Both writes completed; the seeded image value is retired, the reasoning
    // choice stays remembered.
    await vi.waitFor(() => {
      expect(controller.readIntent('router9', 'glm-5.5-air')?.pending).toBe(false)
    })
    expect(controller.readIntent('router9', 'glm-5.5-air')?.input).toBeUndefined()
    expect(controller.readIntent('router9', 'glm-5.5-air')?.reasoningEfforts).toEqual({ high: 'high' })
    const op = mutateCalls[0].ops[0] as { op: string; path: string[]; value: unknown }
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
      { id: 'glm-5.5-air', input: ['text', 'image'] },
    ])

    // Landed: a sweep now reads the stored entry, staged hint gone.
    sweepOnce(controller, t)
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)
    const settledReason = block.querySelector('[data-mp-reason]') as HTMLSelectElement
    expect(settledReason.value).toBe('custom')
  })
})

describe('staged (unsaved) model rows — fetch-catalog adds', () => {
  const STAGED_ID = 'glm-5.5-air'

  it('injects a pending block with the pre-save banner for a staged row', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, mutateCalls, models } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: STAGED_ID })
    sweepOnce(controller, t)

    // The auto preset reflects in the block without any settings write.
    await vi.waitFor(() => {
      const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    expect(mutateCalls.length).toBe(0)

    // A manual choice on the staged row overrides the preset for that field
    // and still writes nothing until the official editor saves.
    const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)

    // The save commits the model into settings; the next settings reload's
    // reconcile writes the staged capabilities field by field (one whole-array
    // set per field), each fenced by the fresh revision.
    models.push({ id: STAGED_ID, contextWindow: 128000 })
    await controller.load('settings')
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
        input: ['text', 'image'],              // from the auto preset
        reasoningEfforts: false,               // the manual override
      },
    ])

    // Landed: the block rebinds from settings, banner gone.
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block.hasAttribute('data-mp-pending-id')).toBe(false)
    expect(block.getAttribute('data-mp-index')).toBe('2')
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(true)
    const landedReason = block.querySelector('[data-mp-reason]') as HTMLSelectElement
    expect(landedReason.value).toBe('off')
  })

  it('never writes a staged choice while the model stays out of settings', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildEditorDom({ expanded: true, modelId: 'never-saved-model' })
    sweepOnce(controller, t)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    const reasonSel = block.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
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
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, mutateCalls, providers, userProviders } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: DB_MODEL })
    sweepOnce(controller, t)

    // Auto preset from models.dev, reflected in the block without any write.
    await vi.waitFor(() => {
      const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    expect(mutateCalls.length).toBe(0)

    // Manual override of the reasoning field still writes nothing pre-creation.
    const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mutateCalls.length).toBe(0)

    // 创建提供方 commits the route with the typed models; the settings reload
    // lands both staged capabilities as whole-array writes under the route.
    providers.push({ provider: DRAFT_ID, displayName: 'Acme', settingsNs: 'llm-pi-ai', settingsPath: ['providers', DRAFT_ID], active: true })
    userProviders[DRAFT_ID] = { models: [{ id: DB_MODEL, contextWindow: 64000 }] }
    await controller.load('settings')
    await vi.waitFor(() => expect(mutateCalls.length).toBe(2))
    for (const call of mutateCalls) {
      const op = call.ops[0] as { op: string; path: string[] }
      expect(op.op).toBe('set')
      expect(op.path).toEqual(['providers', DRAFT_ID, 'models'])
    }
    const final = mutateCalls[1].ops[0] as { value: unknown }
    expect(final.value).toEqual([
      { id: DB_MODEL, contextWindow: 64000, input: ['text', 'image'], reasoningEfforts: false },
    ])
  })

  it('evicts staged choices when the Provider ID is retyped', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm1' })
    sweepOnce(controller, t)
    const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
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
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm1' })
    sweepOnce(controller, t)
    const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))

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
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm-a' })
    buildDraftEditorDom({ providerId: DRAFT_ID, modelId: 'm-b' })
    sweepOnce(controller, t)

    const blocks = [...document.querySelectorAll('[data-mp-block]')] as HTMLElement[]
    expect(blocks.length).toBe(2)
    const blockA = blocks.find((b) => b.getAttribute('data-mp-pending-id') === 'm-a')!
    const blockB = blocks.find((b) => b.getAttribute('data-mp-pending-id') === 'm-b')!
    // A: no reasoning at all. B: a custom level set.
    const reasonA = blockA.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonA.value = 'off'
    reasonA.dispatchEvent(new Event('change'))
    const reasonB = blockB.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonB.value = 'custom'
    reasonB.dispatchEvent(new Event('change'))
    const highB = blockB.querySelector('[data-mp-level="high"]') as HTMLInputElement
    highB.checked = true
    highB.dispatchEvent(new Event('change'))

    expect(controller.readIntent(DRAFT_ID, 'm-a')?.reasoningEfforts).toBe(false)
    expect(controller.readIntent(DRAFT_ID, 'm-b')?.reasoningEfforts).toEqual({ high: 'high' })
    expect(mutateCalls.length).toBe(0)
  })
})

/**
 * The "add provider" editor: a DORMANT catalog route being customized for the
 * first time. Faithful slice of the official card: the route comes from a
 * single `<select>` OUTSIDE the customized `<details>` (the custom-provider
 * create card has a typed Provider ID instead, and edit cards carry no select
 * outside their details), and the ProviderEditor renders titleless under it.
 */
function buildAddCardDom(opts: { route: string; routes?: string[]; modelId: string }): HTMLSelectElement {
  const addBlock = document.createElement('div')
  const addCard = document.createElement('div')

  const selectField = document.createElement('div')
  const selectLabel = document.createElement('span')
  selectLabel.textContent = 'Provider'
  const select = document.createElement('select')
  for (const route of opts.routes ?? [opts.route]) {
    const option = document.createElement('option')
    option.value = route
    option.textContent = route
    select.appendChild(option)
  }
  select.value = opts.route
  selectField.append(selectLabel, select)

  const editor = document.createElement('div')
  const keyField = document.createElement('div')
  const keyLabel = document.createElement('span')
  keyLabel.textContent = 'API Key'
  const keyInput = document.createElement('input')
  keyInput.type = 'password'
  keyField.append(keyLabel, keyInput)

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
  toggle.setAttribute('aria-expanded', 'true')
  row.append(idInput, nameInput, toggle)
  entry.appendChild(row)
  const advanced = document.createElement('div')
  advanced.setAttribute('data-test-advanced', '')
  for (const label of ['Context Window', 'Max Output Tokens']) {
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
  catalog.appendChild(entry)

  const customized = document.createElement('details')
  const body = document.createElement('div')
  const urlField = document.createElement('div')
  const urlLabel = document.createElement('span')
  urlLabel.textContent = 'Base URL'
  const urlInput = document.createElement('input')
  urlInput.type = 'text'
  urlField.append(urlLabel, urlInput)
  body.append(urlField, catalog)
  customized.appendChild(body)

  // The editor carries NO header (hideTitle) — resolution cannot use one.
  editor.append(keyField, customized)
  addCard.append(selectField, editor)
  addBlock.appendChild(addCard)
  document.body.appendChild(addBlock)
  return select
}

describe('add-provider card (dormant catalog route draft)', () => {
  const ROUTE = 'openai'
  const DB_MODEL = 'glm-5.5-air'

  it('binds a pending block to the selected catalog route before creation', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls } = fakeApi({ dormant: [ROUTE] })
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildAddCardDom({ route: ROUTE, modelId: 'draft-unknown-model' })
    sweepOnce(controller, t)

    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.getAttribute('data-mp-provider')).toBe(ROUTE)
    expect(block.getAttribute('data-mp-pending-id')).toBe('draft-unknown-model')
    expect(block.getAttribute('data-mp-index')).toBe('-1')
    expect(block.querySelector('[data-mp-pending-note]')!.hidden).toBe(false)
    expect(mutateCalls.length).toBe(0)
    expect(controller.byDraftRoute.get(ROUTE)).toBeDefined()
  })

  it('auto-presets, stages edits, and lands everything after the card saves', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls, userProviders } = fakeApi({ dormant: [ROUTE] })
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    buildAddCardDom({ route: ROUTE, modelId: DB_MODEL })
    sweepOnce(controller, t)

    await vi.waitFor(() => {
      const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
      expect(reasonSel.value).toBe('custom')
    })
    expect(mutateCalls.length).toBe(0)

    // The card's save commits the profile; the settings reload lands both
    // staged capabilities as whole-array writes under the route.
    userProviders[ROUTE] = { models: [{ id: DB_MODEL, contextWindow: 64000 }] }
    await controller.load('settings')
    await vi.waitFor(() => expect(mutateCalls.length).toBe(2))
    for (const call of mutateCalls) {
      const op = call.ops[0] as { op: string; path: string[] }
      expect(op.op).toBe('set')
      expect(op.path).toEqual(['providers', ROUTE, 'models'])
    }

    // A later sweep rebinds the row to the now-committed join entry.
    sweepOnce(controller, t)
    const rebound = document.querySelector('[data-mp-block]') as HTMLElement
    expect(rebound.getAttribute('data-mp-provider')).toBe(ROUTE)
    expect(rebound.hasAttribute('data-mp-pending-id')).toBe(false)
    expect(rebound.getAttribute('data-mp-index')).toBe('0')
  })

  it('evicts staged choices when the select switches to another route', async () => {
    document.body.innerHTML = ''
    const other = 'groq'
    const { settings, llm, mutateCalls } = fakeApi({ dormant: [ROUTE, other] })
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const select = buildAddCardDom({ route: ROUTE, routes: [ROUTE, other], modelId: 'm1' })
    sweepOnce(controller, t)
    const reasonSel = document.querySelector('[data-mp-reason]') as HTMLSelectElement
    reasonSel.value = 'off'
    reasonSel.dispatchEvent(new Event('change'))
    expect(controller.readIntent(ROUTE, 'm1')).toBeDefined()

    // Switch the dormant-route chooser: the old route's staged choices are
    // disowned and nothing may resurrect under it.
    select.value = other
    sweepOnce(controller, t)
    expect(controller.readIntent(ROUTE, 'm1')).toBeUndefined()
    expect(controller.byDraftRoute.has(ROUTE)).toBe(false)
    const block = document.querySelector('[data-mp-block]') as HTMLElement
    expect(block.getAttribute('data-mp-provider')).toBe(other)
    expect(mutateCalls.length).toBe(0)
  })

  it('declines a route the pi-ai directory does not know', async () => {
    document.body.innerHTML = ''
    const { settings, llm } = fakeApi({ dormant: [ROUTE] })
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    const select = buildAddCardDom({ route: ROUTE, routes: [ROUTE], modelId: 'm1' })
    select.innerHTML = ''
    const option = document.createElement('option')
    option.value = 'not-a-directory-route'
    select.appendChild(option)
    select.value = 'not-a-directory-route'
    sweepOnce(controller, t)
    expect(document.querySelector('[data-mp-block]')).toBeNull()
  })
})

describe('capacity auto-preset (contextWindow / maxTokens)', () => {
  const capInputs = (): HTMLInputElement[] =>
    [...document.querySelectorAll('[data-test-advanced] input[inputmode="numeric"]')] as HTMLInputElement[]

  it('fills the empty capacity inputs of a committed row from models.dev, without writing settings', async () => {
    document.body.innerHTML = ''
    const { settings, llm, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6' })
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6', contextWindow: 999000 })
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, models } = fakeApi()
    models.push({ id: 'glm-4.6' })
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, mutateCalls } = fakeApi()
    const controller = new ModelCapabilityController(settings, llm)
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
    const { settings, llm, mutateCalls, models } = fakeApi()
    models.push({ id: 'glm-4.6', contextWindow: 111000 })
    const controller = new ModelCapabilityController(settings, llm)
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
    await new Promise((resolve) => setTimeout(resolve, 30))

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
    await new Promise((resolve) => setTimeout(resolve, 30))

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
})
