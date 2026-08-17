/**
 * Model-capability settings — browser half. Injects image-support and
 * reasoning-level controls into every model row of the official Models
 * settings editor (the place the official page does not expose), bound to the
 * same provider/settings join the Models page uses. Writes land as minimal
 * `settings.mutate` path ops against `providers.<route>.models[<i>]` in the
 * `llm-pi-ai` namespace, preserving every hidden field the editor keeps.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { ModelCapabilityController } from './controller.ts'
import { bootEnhancer } from './enhance.ts'
import { en, zh, type ModelProfileKey } from './locales.ts'

export type { CapabilityProvider, ModelCapabilityController } from './controller.ts'
export type { EnhancerHandle, Translator } from './enhance.ts'
export type { ModelProfileKey } from './locales.ts'
export {
  THINKING_LEVELS,
  type ThinkingLevel,
  type UiEfforts,
  type ImageMode,
  type ReasoningMode,
} from './core.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model-capability injected-controls copy. */
    'model-profile': ModelProfileKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model-profile'

/** Settings namespace the capability fields live in. */
const PI_AI_NS = 'llm-pi-ai'

/** Services required by this plugin. */
export const inject = ['locale', 'connection', 'remote']

/**
 * Register the dictionaries, wire the invalidation refresh, and boot the
 * Models-page enhancer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-profile: dictionaries')
  const t = ctx.locale.bind(NS)

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) return
  const controller = new ModelCapabilityController(connection.api)
  void controller.load()

  // Keep the join fresh: settings-document and provider-topology changes.
  // Only a settings write (`settings` reason) may land staged capability
  // choices — reloads for other reasons must not write behind an open card.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (String(ns) === PI_AI_NS) void controller.load('settings')
      }),
      ctx.remote.$on('llm/adapters-updated', () => {
        void controller.load('adapters')
      }),
      ctx.on('connection/reset', () => {
        void controller.load('reset')
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'model-profile: pushed invalidations')

  // The Models-page enhancer: inject capability controls into each model row.
  ctx.effect(() => {
    const handle = bootEnhancer(controller, t)
    return () => {
      handle.stop()
    }
  }, 'model-profile: models-page enhancer')
}
