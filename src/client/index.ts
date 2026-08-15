/**
 * Model-capability settings — browser half. Registers the `model-profile`
 * dictionaries and one plugin card into the Web UI plugin group
 * (`web-ui.plugin.item`), bound to the same provider/settings join the Models
 * page uses. The card lets the user set, per configured model, whether it
 * supports images and which reasoning-effort levels it offers, then writes the
 * edits as minimal `settings.mutate` path ops against the owning namespace.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the `settings.section`
// entry) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { ModelProfileCard, ModelProfileCardController } from './ModelProfileCard.tsx'
import { ModelProfileController, refreshIfLoaded } from './controller.ts'
import { en, zh, type ModelProfileKey } from './locales.ts'

export type { ModelProfileCardFace, ModelProfileCardState, ModelProfileCardProps } from './ModelProfileCard.tsx'
export type { ModelProfileController, ProfileModelRow, ModelProfileState } from './controller.ts'
export type { ModelProfileKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model-capability settings-card copy. */
    'model-profile': ModelProfileKey
  }

  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model-profile'

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Register the model-capability settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-profile: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) return
  const api = connection.api
  const controller = new ModelProfileController(api)
  const cardController = new ModelProfileCardController(controller, api)

  // Refresh on pushed invalidations (settings document, provider topology).
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshIfLoaded(controller) }),
      ctx.remote.$on('llm/adapters-updated', () => { refreshIfLoaded(controller) }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'model-profile: pushed invalidations')

  // Plugin configuration card, contributed to the Web UI plugin group.
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'model-profile',
    order: 120,
    locale: NS,
    inject: () => cardController.inject(),
  }, ModelProfileCard))
}
