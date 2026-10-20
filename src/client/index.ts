/**
 * Model-capability settings — browser half. Seats one 「同步模型能力」 button in
 * every editable provider row of the official Models settings editor and, on
 * click, seeds that provider's models from models.dev (thinking levels, image
 * support, and gap-filled capacity). Writes land as minimal `settings.mutate`
 * path ops against `providers.<route>.models` in the `llm-pi-ai` namespace,
 * preserving every hidden field the editor keeps.
 *
 * Nothing is injected into the model rows: the official row owns its 输入类型
 * (text/image) checkboxes and its reasoning-level editor, so the plugin only
 * seeds those fields — once, and never behind the user's back.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `connection/reset` event and the `dsh-api-remotes`
// `ctx.remote` namespace surface (remote.settings / remote.llm).
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelCapabilityController } from './controller.ts'
import { bootEnhancer } from './enhance.ts'
import { en, zh, type ModelProfileKey } from './locales.ts'

export type { CapabilityProvider, ModelCapabilityController } from './controller.ts'
export type { EnhancerHandle, Translator } from './enhance.ts'
export type { ModelProfileKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model-capability injected-button copy. */
    'model-profile': ModelProfileKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model-profile'

/** Settings namespace the capability fields live in. */
const PI_AI_NS = 'llm-pi-ai'

/**
 * Services required by this plugin. Each `remote.<namespace>` contribution is
 * itself an injectable accessor in this runtime — accessing `ctx.remote.settings`
 * / `ctx.remote.llm` requires declaring the dotted keys, not just `remote`.
 */
export const inject = ['locale', 'connection', 'remote', 'remote.settings', 'remote.llm']

/**
 * Register the dictionaries, wire the invalidation refresh, and boot the
 * Models-page enhancer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-profile: dictionaries')
  const t = ctx.locale.bind(NS)

  // The join and writes go through the typed Remote namespaces (`remote.settings`
  // / `remote.llm`) that `dsh-api-remotes` mounts — the same wire the official
  // Models page uses. DSH 0.1.2-alpha.2 removed the old `connection.api`/IApiClient.
  const controller = new ModelCapabilityController(ctx.remote.settings, ctx.remote.llm)
  void controller.load()

  // Keep the join fresh: settings-document and provider-topology changes.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: string) => {
        if (String(ns) === PI_AI_NS) void controller.load()
      }),
      ctx.remote.$on('llm/adapters-updated', () => {
        void controller.load()
      }),
      ctx.on('connection/reset', () => {
        void controller.load()
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'model-profile: pushed invalidations')

  // The Models-page enhancer: seat the provider sync button.
  ctx.effect(() => {
    const handle = bootEnhancer(controller, t)
    return () => {
      handle.stop()
    }
  }, 'model-profile: models-page enhancer')
}
