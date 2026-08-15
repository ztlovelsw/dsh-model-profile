/**
 * The model-capability controller: joins the configurable-provider directory
 * (`llm.providers`) with the settings namespaces (`settings.describe`) and
 * writes the two per-model capability fields the official Models editor does
 * not expose — `input` (image support) and `reasoningEfforts` (thinking
 * levels) — as minimal path-addressed `settings.mutate` ops against the
 * user-layer `providers.<route>.models` array, preserving every hidden field.
 *
 * Only pi-ai provider routes whose model list the USER owns are surfaced:
 * the pi-ai schema alone declares the two fields, and a catalog-inherited
 * model list must not be silently materialized into the user layer.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'

/** One editable pi-ai provider and its user-owned model list. */
export interface CapabilityProvider {
  /** Provider route id. */
  provider: string
  /** Provider display name. */
  displayName: string
  /** Settings namespace owning the profile (always `llm-pi-ai` here). */
  settingsNs: string
  /** Path from the section root to the provider profile object. */
  settingsPath: string[]
  /** Latest known user-section revision fencing the next write. */
  revision: number
  /** The user-layer model entries, in stored order. */
  models: Record<string, unknown>[]
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read a nested value by path. */
function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Loads and caches the editable provider/model join, and performs the
 * revision-fenced field writes. One instance per browser half.
 */
export class ModelCapabilityController {
  private readonly api: Pick<IApiClient, 'settings' | 'llm'>
  /** Editable providers by route id. */
  readonly byRoute = new Map<string, CapabilityProvider>()
  /** Editable providers by display name (a card header shows either). */
  readonly byDisplayName = new Map<string, CapabilityProvider>()
  /** False until the first successful join load. */
  loaded = false
  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  /**
   * Capability values the user explicitly chose this session, keyed by
   * `route\u0000modelId`. The official editor saves the whole `models` array
   * from a draft that predates these writes, so it can silently drop them;
   * after every reload {@link reconcile} re-applies any intended value that
   * drifted. `ABSENT` means the user chose to clear the field.
   */
  private readonly intended = new Map<string, { input?: unknown; reasoningEfforts?: unknown }>()
  /** Re-entrancy guard for {@link reconcile}. */
  private reconciling = false

  constructor(api: Pick<IApiClient, 'settings' | 'llm'>) {
    this.api = api
  }

  /** Refresh the join: provider directory + settings namespaces in parallel. */
  async load(): Promise<void> {
    const generation = ++this.generation
    try {
      const [providersResponse, settingsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.settings.describe({}),
      ])
      if (!providersResponse.result.ok) return
      if (!settingsResponse.result.ok) return
      if (generation !== this.generation) return
      const namespaces = new Map(settingsResponse.result.value.namespaces.map((view) => [view.ns, view]))
      const byRoute = new Map<string, CapabilityProvider>()
      const byDisplayName = new Map<string, CapabilityProvider>()
      for (const entry of providersResponse.result.value.providers) {
        // Only the pi-ai schema declares per-model `input`/`reasoningEfforts`.
        if (entry.settingsNs !== 'llm-pi-ai') continue
        const namespace = namespaces.get(entry.settingsNs)
        if (namespace === undefined) continue
        const userModels = getPath(namespace.user, [...entry.settingsPath, 'models'])
        // A catalog-inherited list is not user-owned; materializing it would
        // freeze the catalog, so such routes stay unenhanced.
        if (!Array.isArray(userModels)) continue
        const models = userModels.map((raw) => {
          return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
        })
        const info: CapabilityProvider = {
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: entry.settingsNs,
          settingsPath: [...entry.settingsPath],
          revision: namespace.revision,
          models,
        }
        byRoute.set(entry.provider, info)
        byDisplayName.set(entry.displayName, info)
      }
      this.byRoute.clear()
      this.byDisplayName.clear()
      for (const [key, value] of byRoute) this.byRoute.set(key, value)
      for (const [key, value] of byDisplayName) this.byDisplayName.set(key, value)
      this.loaded = true
      void this.reconcile()
    } catch {
      // A failed join leaves the previous state; the next invalidation retries.
    }
  }

  /**
   * Re-apply the user's explicit capability choices that a concurrent whole-array
   * `models` write (the official editor's save) dropped. Runs after every load;
   * a no-op when nothing drifted.
   */
  private async reconcile(): Promise<void> {
    if (this.reconciling || this.intended.size === 0) return
    this.reconciling = true
    try {
      for (const [key, intent] of Array.from(this.intended.entries())) {
        const sep = key.indexOf('\u0000')
        const route = key.slice(0, sep)
        const modelId = key.slice(sep + 1)
        const provider = this.byRoute.get(route)
        if (provider === undefined) {
          this.intended.delete(key)
          continue
        }
        const index = provider.models.findIndex((model) => String(model['id'] ?? '') === modelId)
        if (index < 0) {
          this.intended.delete(key)
          continue
        }
        const model = provider.models[index]
        await this.enforce(provider, index, model, 'input', intent.input)
        await this.enforce(provider, index, model, 'reasoningEfforts', intent.reasoningEfforts)
      }
    } finally {
      this.reconciling = false
    }
  }

  /** Write one intended field back when the committed value drifted from it. */
  private async enforce(provider: CapabilityProvider, index: number, model: Record<string, unknown>, field: 'input' | 'reasoningEfforts', want: unknown): Promise<void> {
    if (want === undefined) return
    const current = model[field]
    const drifted = want === ABSENT
      ? current !== undefined
      : JSON.stringify(current) !== JSON.stringify(want)
    if (!drifted) return
    await this.writeField(provider, index, field, want === ABSENT ? undefined : want)
  }

  /** Resolve a card header's route or display-name text to an editable provider. */
  findProvider(headerText: string): CapabilityProvider | undefined {
    const trimmed = headerText.trim()
    if (trimmed.length === 0) return undefined
    return this.byRoute.get(trimmed) ?? this.byDisplayName.get(trimmed)
  }

  /**
   * Write one model field as a single path op, fenced by the latest known
   * revision. `undefined` unsets the field (re-inherit). Returns the failure
   * message, or undefined once the write landed; a landed write advances the
   * cached revision and patches the cached model optimistically.
   */
  async writeField(info: CapabilityProvider, index: number, field: string, value: unknown): Promise<string | undefined> {
    const model = info.models[index]
    if (model === undefined) return 'unknown model'
    const opPath = [...info.settingsPath, 'models', String(index), field]
    try {
      const response = await this.api.settings.mutate({
        ns: info.settingsNs,
        ops: value === undefined
          ? [{ op: 'unset', path: opPath }]
          : [{ op: 'set', path: opPath, value }],
        expectedRevision: info.revision,
      })
      if (!response.result.ok) return response.result.error.message
      info.revision = response.result.value.revision
      if (value === undefined) delete model[field]
      else model[field] = value
      this.recordIntent(info, index, field, value)
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Remember an explicit user choice so {@link reconcile} can defend it. */
  private recordIntent(info: CapabilityProvider, index: number, field: string, value: unknown): void {
    const model = info.models[index]
    if (model === undefined) return
    const modelId = String(model['id'] ?? '')
    if (modelId.length === 0) return
    if (field !== 'input' && field !== 'reasoningEfforts') return
    const key = info.provider + '\u0000' + modelId
    const intent = this.intended.get(key) ?? {}
    intent[field] = value === undefined ? ABSENT : value
    this.intended.set(key, intent)
  }
}

/** Sentinel: the user chose to clear the field (it must be absent). */
const ABSENT = Symbol('model-profile.absent')
