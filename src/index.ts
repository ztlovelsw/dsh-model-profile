import { Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HEADER_SETTINGS_NS, type RequestHeaderProfile } from './header-config.ts'

export { HEADER_SETTINGS_NS, REQUEST_HEADER_PRESETS, cloneHeaderPreset } from './header-config.ts'
export type { HeaderPresetId, RequestHeaderProfile } from './header-config.ts'

/** The plugin id used by the bundle patch and the live settings namespace. */
export const name = HEADER_SETTINGS_NS

/** One provider route's user-editable request-header fields. */
const headerProfile = z.object({
  enabled: z.boolean().default(false),
  headers: z.dict(z.string()).default({}),
})

/** Live configuration. Volatile updates are applied to the next request. */
export interface Config {
  providers: Volatile<Record<string, RequestHeaderProfile>>
}

/** Settings form schema for the provider header profiles. */
export const Config: z<any, Config> = z.object({
  providers: z.dict(headerProfile).default({}).volatile(),
})

/** The header context emitted by dsh-llm-pi-ai for one prepared inference call. */
export interface PiAiRequestHeaderContext {
  readonly provider: string
  readonly model: string
  readonly sessionId?: string
  readonly purpose?: string
  readonly baseURL: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** dsh-llm-pi-ai's synchronous request-header waterfall. */
    'llm-pi-ai/request-headers'(
      request: PiAiRequestHeaderContext,
      headers: Headers,
      next: () => Headers,
    ): Headers
  }
}

/**
 * Attach configured headers to the request-owned header copy. Cordis owns the
 * listener lifetime, so unloading this plugin removes the behavior without
 * modifying llm-pi-ai or leaving a process-global patch behind.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('llm-pi-ai/request-headers', (request, headers, next) => {
    const profile = config.providers.get()[request.provider]
    const prepared = next()
    if (profile?.enabled !== true) return prepared
    for (const [name, value] of Object.entries(profile.headers)) prepared.set(name, value)
    return prepared
  })
}
