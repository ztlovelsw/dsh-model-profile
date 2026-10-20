import { describe, expect, it } from 'vitest'
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
      }
      revision = (expected ?? 0) + 1
      return { ok: true as const, value: { revision } }
    },
  }
  const llm = {
    listConfigurableProviders: async () => ({ ok: true as const, value: [provider] }),
  }

  return { controller: new ModelCapabilityController(settings, llm), mutateLog, releaseHeld: () => releaseHeld() }
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
})

describe('join', () => {
  it('skips a namespace whose user layer inherits the catalog model list', async () => {
    const settings = {
      describe: async () => ({
        ok: true as const,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [{
            ns: 'llm-pi-ai',
            schema: {},
            value: { providers: { p1: { models: [{ id: 'catalog-only' }] } } },
            // Catalog-inherited: the user layer declares no models.
            user: { providers: { p1: {} } },
            applies: 'live' as const,
            secrets: [],
            revision: 3,
          }],
        },
      }),
      mutate: async () => ({ ok: true as const, value: { revision: 4 } }),
    }
    const llm = {
      listConfigurableProviders: async () => ({
        ok: true as const,
        value: [{ provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'] }],
      }),
    }
    const controller = new ModelCapabilityController(settings, llm)
    await controller.load()
    expect(controller.loaded).toBe(true)
    expect(controller.byRoute.has('p1')).toBe(false)
    expect(controller.findProvider('P1')).toBeUndefined()
  })

  it('resolves a provider by route id or display name', async () => {
    const { controller } = makeContext({ models: [{ id: 'm1' }] })
    await controller.load()
    expect(controller.findProvider('p1')?.provider).toBe('p1')
    expect(controller.findProvider('P1')?.provider).toBe('p1')
    expect(controller.findProvider('  ')).toBeUndefined()
  })
})
