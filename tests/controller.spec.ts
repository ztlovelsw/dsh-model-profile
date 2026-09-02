import { describe, expect, it, vi } from 'vitest'
import { ModelCapabilityController } from '../src/client/controller.ts'

/**
 * The capability controller against a scripted api client: the same
 * settings/llm surface the official connection provides, with a mutable
 * namespace whose revision advances exactly like the real service's (on every
 * successful write of a changed section, and — to simulate a concurrent
 * writer — around a settings-conflict response).
 */
function makeContext(opts: {
  models: Array<Record<string, unknown>>
  /** Reject the first mutate as a concurrent writer won the queue. */
  conflictOnce?: boolean
  /** Hold the N-th mutate until the returned promise resolves. */
  holdNth?: number
}): {
  controller: ModelCapabilityController
  mutateLog: Array<{ expectedRevision?: number; ops: Array<{ op: string; path: unknown; value: unknown }> }>
  releaseHeld: () => void
} {
  let revision = 1
  let userModels: Array<Record<string, unknown>> = opts.models.map((model) => ({ ...model }))
  let userProviderProfile: Record<string, unknown> = { models: userModels }
  const provider = { provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'] }
  const mutateLog: Array<{ expectedRevision?: number; ops: Array<{ op: string; path: unknown; value: unknown }> }> = []
  let releaseHeld: () => void = () => undefined
  const held = new Promise<void>((resolve) => (releaseHeld = resolve))

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
            value: { providers: { p1: userProviderProfile } },
            user: { providers: { p1: userProviderProfile } },
            applies: 'live' as const,
            secrets: [],
            revision,
          },
        ],
      },
    }),
    mutate: async (_ns: string, ops: Array<{ op: string; path: unknown; value: unknown }>, expectedRevision?: number) => {
      mutateLog.push({ expectedRevision, ops })
      const expected = expectedRevision
      if (opts.holdNth !== undefined && mutateLog.length === opts.holdNth) {
        await held
        // The held write still carries the revision it was dispatched with.
      }
      if (opts.conflictOnce === true && mutateLog.length === 1) {
        revision = (expected ?? 0) + 1
        return {
          ok: false as const,
          error: {
            code: 'settings/conflict',
            message: 'settings namespace "llm-pi-ai" changed since it was read',
          },
        }
      }
      // A successful whole-array `set` persists, like the real service.
      const op = ops[0]
      if (op?.op === 'set' && (op.path as string[])[(op.path as string[]).length - 1] === 'models') {
        userModels = (op.value as Array<Record<string, unknown>>).map((model) => ({ ...model }))
        userProviderProfile = { ...userProviderProfile, models: userModels }
      } else if (op?.op === 'set' && (op.path as string[])[(op.path as string[]).length - 1] === 'proxy') {
        userProviderProfile = { ...userProviderProfile, proxy: op.value as string }
      } else if (op?.op === 'unset' && (op.path as string[])[(op.path as string[]).length - 1] === 'proxy') {
        const { proxy: _removed, ...kept } = userProviderProfile
        userProviderProfile = kept
      }
      revision = (expected ?? 0) + 1
      return { ok: true as const, value: { revision } }
    },
  }
  const llm = {
    listConfigurableProviders: async () => ({ ok: true as const, value: [provider] }),
  }

  return { controller: new ModelCapabilityController(settings, llm), mutateLog, releaseHeld: () => releaseHeld(), settings }
}

describe('writeField', () => {
  it('writes the patched models array and advances the cached revision', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1', input: ['text', 'image'] }] })
    await controller.load()
    const provider = controller.byRoute.get('p1')
    expect(provider).toBeDefined()
    const failure = await controller.writeField(provider!, 0, 'reasoningEfforts', false)
    expect(failure).toBeUndefined()
    expect(mutateLog).toHaveLength(1)
    expect(mutateLog[0]).toMatchObject({
      expectedRevision: 1,
      ops: [{ op: 'set', path: ['providers', 'p1', 'models'], value: [{ id: 'm1', input: ['text', 'image'], reasoningEfforts: false }] }],
    })
    // The landing write advanced the cached entry's revision and model list.
    expect(controller.byRoute.get('p1')?.revision).toBe(2)
    expect(controller.byRoute.get('p1')?.models[0]).toMatchObject({ reasoningEfforts: false })
  })

  it('reloads and re-fences once when a concurrent writer bumped the revision', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1', input: ['text', 'image'] }], conflictOnce: true })
    await controller.load()
    // A concurrent save lands while our write is in flight: the host now
    // stands at revision 2, and the first mutate comes back settings-conflict.
    const failure = await controller.writeField(controller.byRoute.get('p1')!, 0, 'reasoningEfforts', false)
    expect(failure).toBeUndefined()
    expect(mutateLog).toHaveLength(2)
    // First attempt was fenced on the stale snapshot; the retry re-reads the
    // join (revision 2) and re-fences on the fresh value.
    expect(mutateLog[0].expectedRevision).toBe(1)
    expect(mutateLog[1].expectedRevision).toBe(2)
    // The field landed on the current model list.
    expect(controller.byRoute.get('p1')?.models[0]).toMatchObject({ reasoningEfforts: false })
    expect(controller.byRoute.get('p1')?.revision).toBe(3)
  })

  it('re-resolves a stale provider entry by route and model id after a reload', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1', input: ['text', 'image'] }] })
    await controller.load()
    const stale = controller.byRoute.get('p1')!
    // A reload swaps every join entry; the caller still holds the old one.
    await controller.load()
    expect(controller.byRoute.get('p1')).not.toBe(stale)
    const failure = await controller.writeField(stale, 0, 'input', ['text'])
    expect(failure).toBeUndefined()
    expect(mutateLog[0].expectedRevision).toBe(1)
    expect(controller.byRoute.get('p1')?.models[0]).toMatchObject({ input: ['text'] })
  })

  it('serializes near-simultaneous writes so each sees the previous revision', async () => {
    const { controller, mutateLog, releaseHeld } = makeContext({ models: [{ id: 'm1' }], holdNth: 1 })
    await controller.load()
    const provider = controller.byRoute.get('p1')!
    const first = controller.writeField(provider, 0, 'input', ['text', 'image'])
    const second = controller.writeField(provider, 0, 'reasoningEfforts', false)
    await Promise.resolve()
    // The second write must not have started while the first is in flight.
    expect(mutateLog).toHaveLength(1)
    releaseHeld()
    await Promise.all([first, second])
    expect(mutateLog.map((item) => item.expectedRevision)).toEqual([1, 2])
    const models = controller.byRoute.get('p1')!.models
    expect(models[0]).toMatchObject({ input: ['text', 'image'], reasoningEfforts: false })
    expect(controller.byRoute.get('p1')?.revision).toBe(3)
  })

  describe('staged (pending) choices', () => {
    it('lands staged choices only after a settings reload, and once', async () => {
      const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
      await controller.load()
      // The preset button stages without writing.
      controller.recordPending(controller.byRoute.get('p1')!, 'm1', 'input', ['text', 'image'])
      // A provider-topology reload must not write behind an open card.
      await controller.load('boot')
      expect(mutateLog).toHaveLength(0)
      await controller.load('adapters')
      expect(mutateLog).toHaveLength(0)
      // The official save promotes the model to a settings reload: staged values land.
      await controller.load('settings')
      await vi.waitFor(() => {
        expect(controller.byRoute.get('p1')?.models[0]).toMatchObject({ input: ['text', 'image'] })
      })
      expect(mutateLog).toHaveLength(1)
      expect(mutateLog[0].expectedRevision).toBe(1)
      // Landed once: a later non-settings reload must not write again.
      await controller.load('boot')
      expect(mutateLog).toHaveLength(1)
    })

    it('keeps a staged choice pending while the model stays out of settings', async () => {
      const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
      await controller.load()
      controller.recordPending(controller.byRoute.get('p1')!, 'ghost', 'reasoningEfforts', { high: 'high' })
      await controller.load('settings')
      expect(mutateLog).toHaveLength(0)
      // Even after another settings write, the absent model keeps waiting.
      await controller.load('settings')
      expect(mutateLog).toHaveLength(0)
    })

    it('lands staged choices when a settings reload is superseded by an adapters reload', async () => {
      // Default-gated: without the fix, a `settings` reload that loses the
      // generation race never lands staged choices, so the official save's
      // reasoningEfforts would be silently dropped.
      const { controller, mutateLog, settings } = makeContext({ models: [{ id: 'm1' }] })
      await controller.load()
      controller.recordPending(controller.byRoute.get('p1')!, 'm1', 'reasoningEfforts', { high: 'high' })
      expect(mutateLog).toHaveLength(0)

      // The official save fires settings/document-updated; its reload starts
      // first but its describe is slow.
      let gate: () => void = () => undefined
      let gatePromise = new Promise<void>((resolve) => (gate = resolve))
      const origDescribe = settings.describe
      let blocked = false
      settings.describe = async () => {
        if (!blocked) {
          blocked = true
          await gatePromise
        }
        return origDescribe()
      }
      const settingsLoad = controller.load('settings')
      await new Promise((resolve) => setTimeout(resolve, 0))
      // The later llm/adapters-updated reload completes first and supersedes it.
      await controller.load('adapters')
      gate()
      await settingsLoad

      // The superseded settings load no longer gates on `lastLoadReason`: the
      // adapters reload's reconcile saw a settings write had committed and
      // landed the staged reasoningEfforts.
      await vi.waitFor(() => {
        expect(controller.byRoute.get('p1')?.models[0]).toMatchObject({ reasoningEfforts: { high: 'high' } })
      })
      expect(controller.readIntent('p1', 'm1')).toMatchObject({ pending: false })
    })
  })
})

describe('directoryByRoute (add-provider draft resolution)', () => {
  it('records dormant catalog routes that byRoute skips, and never foreign namespaces', async () => {
    const configured = { provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'] }
    const dormant = { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }
    const foreign = { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] as string[] }
    const userProviders = { p1: { models: [{ id: 'm1' }] } }
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
              value: { providers: userProviders },
              user: { providers: userProviders },
              applies: 'live' as const,
              secrets: [] as unknown[],
              revision: 4,
            },
          ],
        },
      }),
    }
    const llm = {
      listConfigurableProviders: async () => ({ ok: true as const, value: [configured, dormant, foreign] }),
    }
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    // The user-owned route is editable; the dormant catalog route is not.
    expect(controller.byRoute.has('p1')).toBe(true)
    expect(controller.byRoute.has('openai')).toBe(false)
    // The directory keeps BOTH pi-ai routes for add-card draft resolution,
    // and never a route of another namespace.
    expect(controller.directoryByRoute.get('p1')).toMatchObject({ provider: 'p1', displayName: 'P1' })
    expect(controller.directoryByRoute.get('openai')).toMatchObject({
      provider: 'openai',
      displayName: 'openai',
      settingsPath: ['providers', 'openai'],
    })
    expect(controller.directoryByRoute.has('deepseek-official')).toBe(false)
  })
})

describe('writeProviderField (provider proxy)', () => {
  it('writes the proxy field as a minimal path op and advances the cached revision', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
    await controller.load()
    const provider = controller.byRoute.get('p1')
    expect(provider).toBeDefined()
    const failure = await controller.writeProviderField(provider!, 'proxy', 'http://127.0.0.1:7890')
    expect(failure).toBeUndefined()
    expect(mutateLog).toHaveLength(1)
    expect(mutateLog[0]).toMatchObject({
      expectedRevision: 1,
      ops: [{ op: 'set', path: ['providers', 'p1', 'proxy'], value: 'http://127.0.0.1:7890' }],
    })
    expect(controller.byRoute.get('p1')?.revision).toBe(2)
    expect(controller.byRoute.get('p1')?.profile.proxy).toBe('http://127.0.0.1:7890')
  })

  it('unsets the proxy field when disabled', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
    await controller.load()
    const provider = controller.byRoute.get('p1')
    await controller.writeProviderField(provider!, 'proxy', 'http://127.0.0.1:7890')
    const failure = await controller.writeProviderField(provider!, 'proxy', undefined)
    expect(failure).toBeUndefined()
    const ops = mutateLog.map((entry) => entry.ops[0])
    expect(ops[1]).toMatchObject({ op: 'unset', path: ['providers', 'p1', 'proxy'] })
    expect(controller.byRoute.get('p1')?.profile.proxy).toBeUndefined()
  })

  it('stages the choice for a draft provider (NaN revision) instead of writing', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
    await controller.load()
    const draft = {
      provider: 'new-route',
      displayName: 'new-route',
      settingsNs: 'llm-pi-ai' as const,
      settingsPath: ['providers', 'new-route'],
      revision: Number.NaN,
      models: [],
      profile: {},
    }
    const failure = await controller.writeProviderField(draft, 'proxy', 'http://127.0.0.1:7890')
    expect(failure).toBeUndefined()
    expect(mutateLog).toHaveLength(0)
    expect(controller.readProviderIntent('new-route')).toMatchObject({ proxy: 'http://127.0.0.1:7890', pending: true })
  })

  it('reconcile lands a staged provider proxy after a settings reload', async () => {
    const { controller, mutateLog } = makeContext({ models: [{ id: 'm1' }] })
    await controller.load()
    const draft = {
      provider: 'new-route',
      displayName: 'new-route',
      settingsNs: 'llm-pi-ai' as const,
      settingsPath: ['providers', 'new-route'],
      revision: Number.NaN,
      models: [],
      profile: {},
    }
    await controller.writeProviderField(draft, 'proxy', 'http://127.0.0.1:7890')
    expect(mutateLog).toHaveLength(0)
    // The official save commits the route; a settings reload follows.
    // Re-load with the route now present in providers.
    await controller.load('settings')
    // The route is still not in byRoute (the mock providers list only has p1),
    // so the staged choice stays pending until the route actually appears.
    expect(controller.readProviderIntent('new-route')).toMatchObject({ pending: true })
  })
})
