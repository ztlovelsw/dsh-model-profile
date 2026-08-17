/**
 * The model-capability controller: joins the configurable-provider directory
 * (`llm.providers`) with the settings namespaces (`settings.describe`) and
 * writes the two per-model capability fields the official Models editor does
 * not expose — `input` (image support) and `reasoningEfforts` (thinking
 * levels) — as one whole-array `settings.mutate` `set` on the user-layer
 * `providers.<route>.models` list (the settings path walker cannot address
 * array elements), preserving every hidden field.
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

/**
 * What triggered a join reload. Staged (`pending`) capability choices — the
 * "Preset from models.dev" flow and pre-save rows — only land after a `settings`
 * reload, i.e. once the official editor's save actually committed. A reload
 * caused by provider topology or a connection reset must not write behind an
 * open card's back.
 */
export type LoadReason = 'boot' | 'settings' | 'adapters' | 'reset'

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
  /**
   * Draft providers for rows in the "add custom provider" editor — entries
   * the official editor has staged but not yet committed. The `provider` is
   * the user-typed `Provider ID`; the `models` array is empty (rows are read
   * from the DOM, not from settings). Cleared on every {@link load}.
   */
  readonly byDraftRoute = new Map<string, CapabilityProvider>()
  /** False until the first successful join load. */
  loaded = false
  /** Latest load trigger; staged (`pending`) choices wait for `settings`. */
  private lastLoadReason: LoadReason = 'boot'
  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  /**
   * Capability values the user explicitly chose this session, keyed by
   * `route\u0000modelId`. The official editor saves the whole `models` array
   * from a draft that predates these writes, so it can silently drop them;
   * after every reload {@link reconcile} re-applies any intended value that
   * drifted. `ABSENT` means the user chose to clear the field. A `pending`
   * choice belongs to a model the official editor staged (fetch-catalog add)
   * but has not committed yet — it is kept until the save lands the model.
   */
  private readonly intended = new Map<string, { input?: unknown; reasoningEfforts?: unknown; pending?: boolean }>()
  /** Re-entrancy guard for {@link reconcile}. */
  private reconciling = false
  /**
   * Serialized settings writes: field writes run one at a time, each reading
   * the revision only when it reaches the front of the chain. Without this,
   * two near-simultaneous writes (image then reasoning) both read the same
   * `revision`, and the service — whose conflict check runs when a write
   * reaches the front of ITS queue, not when this browser read the value —
   * rejects the second with a `settings-conflict`.
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(api: Pick<IApiClient, 'settings' | 'llm'>) {
    this.api = api
  }

  /** Refresh the join: provider directory + settings namespaces in parallel. */
  async load(reason: LoadReason = 'boot'): Promise<void> {
    // A load means settings changed; any draft route that got committed is now
    // a real byRoute entry, and uncommitted drafts re-register on their next
    // sweep, so stale synthetics never linger.
    this.byDraftRoute.clear()
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
      this.lastLoadReason = reason
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
          // A pending choice may belong to a draft provider (add-custom flow)
          // whose route is not committed yet — keep waiting for the save. A
          // committed choice whose provider vanished was removed by the user.
          if (!intent.pending) this.intended.delete(key)
          continue
        }
        // Staged (pending) choices land only after a settings write — the
        // official editor's save committing the row, or any other commit. They
        // must not write behind an open card on a provider-topology reload.
        if (intent.pending && this.lastLoadReason !== 'settings') continue
        const index = provider.models.findIndex((model) => String(model['id'] ?? '') === modelId)
        if (index < 0) {
          // A pending choice waits for the official editor's save to commit the
          // model; a committed choice whose model vanished was removed by the
          // user and must not resurrect.
          if (!intent.pending) this.intended.delete(key)
          continue
        }
        const model = provider.models[index]
        await this.enforce(provider, index, model, 'input', intent.input)
        await this.enforce(provider, index, model, 'reasoningEfforts', intent.reasoningEfforts)
        intent.pending = false
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
   * snapshot (`settings-conflict` — the official editor's save, or a previous
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
        let response: Awaited<ReturnType<IApiClient['settings']['mutate']>>
        try {
          response = await this.api.settings.mutate({
            ns: fresh.settingsNs,
            ops: [{ op: 'set', path: [...fresh.settingsPath, 'models'], value: patched }],
            expectedRevision: fresh.revision,
          })
        } catch (error) {
          return messageOf(error)
        }
        if (response.result.ok) {
          fresh.revision = response.result.value.revision
          fresh.models = patched
          this.recordIntent(fresh, freshIndex, field, value)
          return undefined
        }
        if (attempt === 0 && response.result.error.code === 'settings-conflict') {
          // The namespace advanced past this write's snapshot: refresh the
          // join and retry once. The reload also runs reconcile, which heals
          // any capability a concurrent whole-array save dropped — a conflict
          // means a write JUST happened, so staged choices may land too.
          await this.load('settings')
          continue
        }
        return response.result.error.message
      }
      return 'settings write still conflicting after refresh'
    })
    // A rejected inner write must not strand the chain; the caller still sees
    // the failure through the awaited `run`.
    this.writeChain = run.catch(() => undefined)
    return run
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

  /**
   * Record a capability choice for a model the official editor has staged but
   * not committed (a fetch-catalog add drafts the row locally and lands it on
   * save). The value rides in memory and {@link reconcile} writes it once the
   * save commits the model into settings.
   */
  recordPending(info: CapabilityProvider, modelId: string, field: 'input' | 'reasoningEfforts', value: unknown): void {
    const key = info.provider + '\u0000' + modelId
    const intent = this.intended.get(key) ?? {}
    intent[field] = value === undefined ? ABSENT : value
    intent.pending = true
    this.intended.set(key, intent)
  }

  /** Whether any capability choice (staged or landed) exists for a model id. */
  hasIntent(info: CapabilityProvider, modelId: string): boolean {
    return this.intended.has(info.provider + '\u0000' + modelId)
  }

  /** The staged capability fields of an unsaved model, shaped for UI display. */
  pendingModel(info: CapabilityProvider, modelId: string): Record<string, unknown> {
    const intent = this.intended.get(info.provider + '\u0000' + modelId)
    const model: Record<string, unknown> = {}
    if (intent === undefined) return model
    for (const field of ['input', 'reasoningEfforts'] as const) {
      const value = intent[field]
      if (value !== undefined && value !== ABSENT) model[field] = value
    }
    return model
  }

  /**
   * Drop the pending choices of one draft route — the user retyped or cleared
   * the `Provider ID`, disowning everything staged under the old id (nothing
   * must resurrect when some future provider takes that id).
   */
  evictPending(route: string): void {
    const prefix = route + '\u0000'
    for (const key of Array.from(this.intended.keys())) {
      if (!key.startsWith(prefix)) continue
      if (this.intended.get(key)?.pending) this.intended.delete(key)
    }
  }

  /** Read one staged or committed choice back — for tests and diagnostics. */
  readIntent(route: string, modelId: string): { input?: unknown; reasoningEfforts?: unknown; pending?: boolean } | undefined {
    return this.intended.get(route + '\u0000' + modelId)
  }
}

/** Sentinel: the user chose to clear the field (it must be absent). */
const ABSENT = Symbol('model-profile.absent')
