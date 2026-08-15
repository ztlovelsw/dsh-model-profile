/**
 * The model-profile settings controller: joins the configurable-provider
 * directory (`llm.providers`) with the settings namespaces (`settings.describe`)
 * and lets the card edit, per configured model, two capability fields the
 * official Models page does not expose:
 *
 *  - image support  → `input: ['text'] | ['text', 'image']`
 *  - reasoning levels → `reasoningEfforts: false | Partial<Record<level, string|null>>`
 *
 * The card mirrors the Models page join: the same provider rows, the same
 * `settings.mutate` path-op writes, and the same `credentials.describe`
 * enrichment. The host stays the single fact source; every mutation writes
 * through the wire and the card re-reads from the next describe.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export { THINKING_LEVELS, type ThinkingLevel } from './core.ts'

/** A configured model row as the card renders it. */
export interface ProfileModelRow {
  /** Provider route id. */
  provider: string
  /** Provider display name. */
  providerName: string
  /** Settings namespace whose section owns this profile. */
  settingsNs: string
  /** Settings path from the section root to the provider profile object. */
  settingsPath: string[]
  /** Model id. */
  id: string
  /** Model display name (falls back to the id). */
  name: string
  /** Current stored model entry (hidden fields preserved). */
  entry: Record<string, unknown>
  /** Whether the row lives in the user layer (editable); catalog-only rows are read-only. */
  editable: boolean
  /** Index of this row inside the models array (for path-addressed writes). */
  entryIndex: number
  /** Effective context capacity, for the edit hint. */
  contextWindow?: number
  /** Effective output cap, for the edit hint. */
  maxTokens?: number
}

/** The card snapshot. */
export interface ModelProfileState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Provider-grouped model rows in directory order. */
  groups: { provider: string; name: string; rows: ProfileModelRow[] }[]
  /** Namespace views by ns, for path ops and schema reads. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
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

/** Read one model entry field, treating the entry as a structural record. */
function fieldOf(entry: unknown, key: string): unknown {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)[key]
    : undefined
}

/** The model list of one profile: the user layer `models` array when present, else the inherited. */
function modelListOf(namespace: SettingsNamespaceView, settingsPath: string[]): unknown[] {
  const userModels = getPath(namespace.user, [...settingsPath, 'models'])
  if (Array.isArray(userModels)) return userModels
  const inherited = getPath(namespace.base, [...settingsPath, 'models'])
  if (Array.isArray(inherited)) return inherited
  const resolved = getPath(namespace.value, [...settingsPath, 'models'])
  return Array.isArray(resolved) ? resolved : []
}

/** Whether the user layer owns the `models` array of a profile. */
function modelsOverridden(namespace: SettingsNamespaceView, settingsPath: string[]): boolean {
  return getPath(namespace.user, [...settingsPath, 'models']) !== undefined
}

/**
 * The model-profile settings controller. One per settings surface; loads the
 * provider/settings join on mount and re-reads on pushed invalidations.
 */
export class ModelProfileController {
  private readonly api: Pick<IApiClient, 'settings' | 'llm'>
  /** The snapshot the card renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelProfileState>
  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  constructor(api: Pick<IApiClient, 'settings' | 'llm'>) {
    this.api = api
    this.store = createSnapshotStore<ModelProfileState>({
      status: 'idle',
      error: null,
      writable: false,
      groups: [],
      namespaces: new Map(),
    })
  }

  /** Refresh the whole join: provider directory + settings namespaces in parallel. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => {
      s.status = 'loading'
      s.error = null
    })
    try {
      const [providersResponse, settingsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.settings.describe({}),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      if (generation !== this.generation) return
      const settingsValue = settingsResponse.result.value
      const namespaces = new Map(settingsValue.namespaces.map((view) => [view.ns, view]))
      const groups: ModelProfileState['groups'] = []
      for (const entry of providersResponse.result.value.providers) {
        // Only the pi-ai adapter schema exposes per-model `input` and
        // `reasoningEfforts`; other families (llm-deepseek's advisory
        // catalog) would strip or reject those fields, so they are not listed.
        if (entry.settingsNs !== 'llm-pi-ai') continue
        const namespace = namespaces.get(entry.settingsNs)
        if (namespace === undefined) continue
        const models = modelListOf(namespace, entry.settingsPath)
        if (models.length === 0) continue
        const overridden = modelsOverridden(namespace, entry.settingsPath)
        const rows: ProfileModelRow[] = models.map((raw, index) => {
          const entryRecord = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
          const id = typeof entryRecord['id'] === 'string' ? entryRecord['id'] : String(index)
          const name = typeof entryRecord['name'] === 'string' ? entryRecord['name'] : id
          const contextWindow = fieldOf(entryRecord, 'contextWindow')
          const maxTokens = fieldOf(entryRecord, 'maxTokens')
          return {
            entryIndex: index,
            provider: entry.provider,
            providerName: entry.displayName,
            settingsNs: entry.settingsNs,
            settingsPath: entry.settingsPath,
            id,
            name,
            entry: entryRecord,
            editable: overridden,
            ...typeof contextWindow === 'number' ? { contextWindow } : {},
            ...typeof maxTokens === 'number' ? { maxTokens } : {},
          }
        })
        if (rows.length === 0) continue
        groups.push({ provider: entry.provider, name: entry.displayName, rows })
      }
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.writable = settingsValue.writable
        s.groups = groups
        s.namespaces = namespaces
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }
}

/** Refetch only after the card has loaded at least once (no background fetch on open). */
export function refreshIfLoaded(controller: ModelProfileController): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
