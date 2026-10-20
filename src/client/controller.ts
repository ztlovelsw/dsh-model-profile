/**
 * The model-capability controller: joins the configurable-provider directory
 * (`remote.llm.listConfigurableProviders`) with the settings namespaces
 * (`remote.settings.describe`) and writes the per-model capability fields
 * through one whole-array `remote.settings.mutate` `set` on the user-layer
 * `providers.<route>.models` list (the settings path walker cannot address
 * array elements), preserving every hidden field.
 *
 * Every write is a one-shot SEED. Since DSH 0.2.1 the official model row owns
 * both capability fields the plugin used to inject controls for — its 输入类型
 * (text/image) checkboxes own `input`, and its reasoning-level editor owns
 * `reasoningEfforts` — so nothing here re-applies a value afterwards: a later
 * official edit always wins, and the plugin never fights the official card.
 *
 * Only pi-ai provider routes whose model list the USER owns are surfaced:
 * the pi-ai schema alone declares those fields, and a catalog-inherited model
 * list must not be silently materialized into the user layer.
 */

import type { LlmConfigurableProvider, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * The subset of the typed Client Remote (`ctx.remote`) this controller calls.
 * `ctx.remote.settings` / `ctx.remote.llm` (mounted by `dsh-api-remotes`) are
 * structurally assignable to these narrow faces; they no longer route through
 * the old `connection.api`/`IApiClient` that DSH 0.1.2-alpha.2 removed.
 */

/** One unary Remote RPC result: success value or a `{code,message}` failure. */
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

/** The `remote.settings` methods the controller calls. */
export interface SettingsRemote {
  describe(): Promise<RemoteResult<{ writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }>>
  mutate(
    ns: string,
    ops: readonly (SettingsPathOpView | { op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] })[],
    expectedRevision?: number,
  ): Promise<RemoteResult<{ revision: number }>>
}

/** The `remote.llm` methods the controller calls. */
export interface LlmRemote {
  listConfigurableProviders(): Promise<RemoteResult<LlmConfigurableProvider[]>>
}

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
  private readonly settings: SettingsRemote
  private readonly llm: LlmRemote
  /** Editable providers by route id. */
  readonly byRoute = new Map<string, CapabilityProvider>()
  /** Editable providers by display name (a card header shows either). */
  readonly byDisplayName = new Map<string, CapabilityProvider>()
  /** False until the first successful join load. */
  loaded = false
  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  /**
   * Serialized settings writes: field writes run one at a time, each reading
   * the revision only when it reaches the front of the chain. Without this,
   * two near-simultaneous writes both read the same `revision`, and the
   * service — whose conflict check runs when a write reaches the front of ITS
   * queue, not when this browser read the value — rejects the second with a
   * `settings/conflict`.
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(settings: SettingsRemote, llm: LlmRemote) {
    this.settings = settings
    this.llm = llm
  }

  /** Refresh the join: provider directory + settings namespaces in parallel. */
  async load(): Promise<void> {
    const generation = ++this.generation
    try {
      const [providersResponse, settingsResponse] = await Promise.all([
        this.llm.listConfigurableProviders(),
        this.settings.describe(),
      ])
      if (!providersResponse.ok) return
      if (!settingsResponse.ok) return
      if (generation !== this.generation) return
      const namespaces = new Map(settingsResponse.value.namespaces.map((view) => [view.ns, view]))
      const byRoute = new Map<string, CapabilityProvider>()
      const byDisplayName = new Map<string, CapabilityProvider>()
      for (const entry of providersResponse.value) {
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
    } catch {
      // A failed join leaves the previous state; the next invalidation retries.
    }
  }

  /** Resolve a card header's route or display-name text to an editable provider. */
  findProvider(headerText: string): CapabilityProvider | undefined {
    const trimmed = headerText.trim()
    if (trimmed.length === 0) return undefined
    return this.byRoute.get(trimmed) ?? this.byDisplayName.get(trimmed)
  }

  /**
   * Write one model field, fenced by the latest known revision. `undefined`
   * unsets the field (re-inherit). The settings service's path walker cannot
   * descend into arrays — an op like `…models.0.input` would replace the array
   * with an object and fail schema validation — so the write is one `set` of
   * the whole `models` array with this field patched in. Returns the failure
   * message, or undefined once the write landed.
   *
   * Writes serialize on one chain and re-resolve the provider and model index
   * from the freshest join when the write actually runs: a reload that swapped
   * the entries (or shifted the rows) must not make a pending write clobber the
   * wrong slot. When the service reports the namespace moved past the write's
   * snapshot (`settings/conflict` — the official editor's save, or a previous
   * write of ours, landed between this browser's read and the write's turn in
   * the service queue), the join is reloaded and the write retried once against
   * the fresh revision, instead of surfacing a raw conflict the user cannot act
   * on.
   */
  async writeField(info: CapabilityProvider, index: number, field: string, value: unknown): Promise<string | undefined> {
    const model = info.models[index]
    if (model === undefined) return 'unknown model'
    const modelId = String(model['id'] ?? '')
    if (modelId.length === 0) return 'unknown model'
    const run = this.writeChain.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Re-resolve against the newest join: `info` may predate a reload
        // that swapped every entry, and the model index may have shifted.
        const fresh = this.byRoute.get(info.provider) ?? info
        if (Number.isNaN(fresh.revision)) return 'provider not saved yet'
        const freshIndex = fresh.models.findIndex((entry) => String(entry['id'] ?? '') === modelId)
        if (freshIndex < 0) return 'model no longer exists'
        const patched = fresh.models.map((entry, at) => {
          if (at !== freshIndex) return entry
          const next = { ...entry }
          if (value === undefined) delete next[field]
          else next[field] = value
          return next
        })
        let response: Awaited<ReturnType<SettingsRemote['mutate']>>
        try {
          response = await this.settings.mutate(
            fresh.settingsNs,
            [{ op: 'set', path: [...fresh.settingsPath, 'models'], value: patched }],
            fresh.revision,
          )
        } catch (error) {
          return messageOf(error)
        }
        if (response.ok) {
          fresh.revision = response.value.revision
          fresh.models = patched
          return undefined
        }
        if (attempt === 0 && response.error.code === 'settings/conflict') {
          // The namespace advanced past this write's snapshot: refresh the
          // join and retry once against the fresh revision.
          await this.load()
          continue
        }
        return response.error.message
      }
      return 'settings write still conflicting after refresh'
    })
    // A rejected inner write must not strand the chain; the caller still sees
    // the failure through the awaited `run`.
    this.writeChain = run.catch(() => undefined)
    return run
  }
}
