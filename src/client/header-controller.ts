import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { HEADER_SETTINGS_NS, type RequestHeaderProfile } from '../header-config.ts'
import type { LlmRemote, SettingsRemote } from './controller.ts'
import { messageOf } from './controller.ts'

export interface HeaderProvider {
  provider: string
  displayName: string
  settingsNs: string
  revision: number
  profile: RequestHeaderProfile
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function profileOf(value: unknown): RequestHeaderProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { enabled: false, headers: {} }
  }
  const raw = value as Record<string, unknown>
  const headers: Record<string, string> = {}
  if (typeof raw.headers === 'object' && raw.headers !== null && !Array.isArray(raw.headers)) {
    for (const [name, header] of Object.entries(raw.headers)) {
      if (typeof header === 'string') headers[name] = header
    }
  }
  return { enabled: raw.enabled === true, headers }
}

function namespaceValue(namespaces: SettingsNamespaceView[], ns: string): SettingsNamespaceView | undefined {
  return namespaces.find((entry) => entry.ns === ns)
}

/** Loads provider routes and revision-fenced plugin-owned header settings. */
export class RequestHeaderController {
  private readonly settings: SettingsRemote
  private readonly llm: LlmRemote
  readonly byRoute = new Map<string, HeaderProvider>()
  readonly byDisplayName = new Map<string, HeaderProvider>()
  loaded = false
  private generation = 0
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(settings: SettingsRemote, llm: LlmRemote) {
    this.settings = settings
    this.llm = llm
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    try {
      const [providersResponse, settingsResponse] = await Promise.all([
        this.llm.listConfigurableProviders(),
        this.settings.describe(),
      ])
      if (!providersResponse.ok || !settingsResponse.ok || generation !== this.generation) return
      const namespace = namespaceValue(settingsResponse.value.namespaces, HEADER_SETTINGS_NS)
      if (namespace === undefined) return
      const values = namespace.value
      const byRoute = new Map<string, HeaderProvider>()
      const byDisplayName = new Map<string, HeaderProvider>()
      for (const entry of providersResponse.value) {
        if (entry.settingsNs !== 'llm-pi-ai') continue
        const info: HeaderProvider = {
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: HEADER_SETTINGS_NS,
          revision: namespace.revision,
          profile: profileOf(getPath(values, ['providers', entry.provider])),
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
      // Keep the last good snapshot and let the next invalidation retry.
    }
  }

  findProvider(text: string): HeaderProvider | undefined {
    const trimmed = text.trim()
    if (trimmed.length === 0) return undefined
    return this.byRoute.get(trimmed) ?? this.byDisplayName.get(trimmed)
  }

  async save(info: HeaderProvider, profile: RequestHeaderProfile): Promise<string | undefined> {
    const run = this.writeChain.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = this.byRoute.get(info.provider) ?? info
        if (!Number.isFinite(fresh.revision)) return 'request-header settings are unavailable'
        let response: Awaited<ReturnType<SettingsRemote['mutate']>>
        try {
          response = await this.settings.mutate(
            HEADER_SETTINGS_NS,
            [
              { op: 'set', path: ['providers', fresh.provider, 'enabled'], value: profile.enabled },
              { op: 'set', path: ['providers', fresh.provider, 'headers'], value: { ...profile.headers } },
            ],
            fresh.revision,
          )
        } catch (error) {
          return messageOf(error)
        }
        if (response.ok) {
          fresh.profile = { enabled: profile.enabled, headers: { ...profile.headers } }
          fresh.revision = response.value.revision
          return undefined
        }
        if (attempt === 0 && response.error.code === 'settings/conflict') {
          await this.load()
          continue
        }
        return response.error.message
      }
      return 'request-header settings still conflicting after refresh'
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }
}
