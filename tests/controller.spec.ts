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
  const provider = { provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'], active: true }
  const mutateLog: Array<{ expectedRevision?: number; ops: Array<{ op: string; path: unknown; value: unknown }> }> = []
  let releaseHeld: () => void = () => undefined
  const held = new Promise<void>((resolve) => (releaseHeld = resolve))

  const api = {
    llm: {
      providers: async () => ({ result: { ok: true, value: { providers: [provider] } } }),
    },
    settings: {
      describe: async () => ({
        result: {
          ok: true,
          value: {
            writable: true,
            hasDocument: true,
            namespaces: [
              {
                ns: 'llm-pi-ai',
                schema: {},
                value: { providers: { p1: { models: userModels } } },
                user: { providers: { p1: { models: userModels } } },
                applies: 'live',
                secrets: [],
                revision,
              },
            ],
          },
        },
      }),
      mutate: async (request: { expectedRevision?: number; ops: Array<{ op: string; path: unknown; value: unknown }> }) => {
        mutateLog.push(request)
        const expected = request.expectedRevision
        if (opts.holdNth !== undefined && mutateLog.length === opts.holdNth) {
          await held
          // The held write still carries the revision it was dispatched with.
        }
        if (opts.conflictOnce === true && mutateLog.length === 1) {
          revision = (expected ?? 0) + 1
          return {
            result: {
              ok: false,
              error: {
                code: 'settings-conflict',
                message: 'settings namespace "llm-pi-ai" changed since it was read',
                details: { ns: 'llm-pi-ai', expected, actual: revision },
              },
            },
          }
        }
        // A successful whole-array `set` persists, like the real service.
        const op = request.ops[0]
        if (op?.op === 'set' && op.path[op.path.length - 1] === 'models') {
          userModels = (op.value as Array<Record<string, unknown>>).map((model) => ({ ...model }))
        }
        revision = (expected ?? 0) + 1
        return { result: { ok: true, value: { revision } } }
      },
    },
  } as const

  return { controller: new ModelCapabilityController(api), mutateLog, releaseHeld: () => releaseHeld() }
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
  })
})