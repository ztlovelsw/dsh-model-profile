/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Bundle smoke test: load the built `lib/client.js` closure factory through a
 * mock window.__ModuleLoader__, stub the cordis services apply() touches, and
 * confirm it boots the enhancer without throwing. This is what the browser does
 * at runtime; the server boot alone only exercises the host half.
 */

// jsdom lacks requestAnimationFrame; the enhancer schedules sweeps with it.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0)) as never
}

const bundlePath = resolve(process.cwd(), 'lib', 'client.js')
const bundleSource = readFileSync(bundlePath, 'utf8')

function loadBundle() {
  let loaded: { id: string; factory: (require: (m: string) => unknown) => Record<string, unknown> } | undefined
  ;(globalThis as Record<string, unknown>).window = globalThis
  ;(globalThis as Record<string, unknown>).__ModuleLoader__ = {
    load(entry: { id: string; factory: (require: (m: string) => unknown) => Record<string, unknown> }) {
      loaded = entry
    },
  }
  // Evaluate the closure factory bundle.
  // eslint-disable-next-line no-new-func
  new Function(bundleSource)()
  if (loaded === undefined) throw new Error('bundle did not call __ModuleLoader__.load')
  return loaded
}

function fakeRequire(specifier: string): Record<string, unknown> {
  // The bundle's external module-table entries. apply() only needs locale +
  // connection + remote + runtime shapes; provide permissive stubs.
  if (specifier === '@deepseek-ai/dsh-client-locale/client') return {}
  if (specifier === '@deepseek-ai/dsh-client-connection/client') return {}
  if (specifier === '@deepseek-ai/dsh-client-runtime/client') {
    return {}
  }
  return {}
}

function stubCtx() {
  const mutateCalls: unknown[] = []
  const models = [{ id: 'm1', input: ['text', 'image'] }]
  const api = {
    llm: {
      providers: async () => ({ result: { ok: true, value: { providers: [{ provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'], active: true }] } } }),
    },
    settings: {
      describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: { providers: { p1: { models } } }, user: { providers: { p1: { models } } }, applies: 'live', secrets: [], revision: 1 }] } } }),
      mutate: async (req: unknown) => { mutateCalls.push(req); return { result: { ok: true, value: { revision: 2 } } } },
    },
  }
  const effects: Array<() => void> = []
  const ctx = {
    effect(fn: () => void) { effects.push(fn) },
    locale: { register: () => () => {}, bind: () => (k: string) => k },
    get: (name: string) => (name === 'connection' ? { api } : undefined),
    remote: { $on: () => () => {} },
    on: () => () => {},
  }
  return { ctx, runEffects: () => { for (const fn of effects) fn() }, mutateCalls }
}

describe('lib/client.js bundle', () => {
  it('registers a closure factory for the plugin id and boots apply()', async () => {
    const entry = loadBundle()
    // The closure id must track the package name (the shell resolves plugins by it).
    const pkgName = createRequire(import.meta.url)('../package.json').name as string
    expect(entry.id).toBe(pkgName)
    const exports = entry.factory(fakeRequire)
    expect(typeof exports.apply).toBe('function')

    document.body.innerHTML = ''
    const { ctx, runEffects } = stubCtx()
    // apply must not throw; it wires locale/invalidations and boots the enhancer.
    expect(() => (exports.apply as (c: unknown) => void)(ctx)).not.toThrow()
    // Running the registered effects boots the enhancer against jsdom's document.
    expect(() => runEffects()).not.toThrow()
  })
})
