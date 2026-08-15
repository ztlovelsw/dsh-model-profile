/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Renders nothing while the namespace is unavailable. Mirrors the
 * official ui-plugin-config PluginCard in a self-contained slice (this package
 * must not depend on a sibling UI package).
 */

import { useState, type ReactNode } from 'react'
import type { ModelProfileKey } from './locales.ts'
import css from './settings-card.module.css'

/** Card chrome shared by every plugin settings card. */
export interface PluginSettingsCardProps {
  /** Locale reader for this card's copy. */
  t: (key: ModelProfileKey) => string
  /** Locale key of the plugin's name. */
  titleKey: ModelProfileKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: ModelProfileKey
  /** Whether a save is pending, blocked by an invalid value, or in flight. */
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card.
 */
export function PluginSettingsCard(props: PluginSettingsCardProps) {
  const [open, setOpen] = useState(false)
  const { t } = props
  const title = t(props.titleKey)
  const blocked = !props.dirty || props.invalid || props.saving
  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t(props.descriptionKey)}</span>
        </span>
        {props.dirty ? <span className={css.pending}>{t('settings.unsaved')}</span> : null}
        <span className={open ? css.chevronOpen : css.chevron}>▾</span>
      </button>
      {open
        ? (
          <div className={css.body}>
            {props.children}
            <div className={css.footer}>
              {props.failed ? <p className={css.failed} role="status">{t('settings.saveFailed')}</p> : null}
              <button
                type="button"
                className={css.discard}
                disabled={!props.dirty || props.saving}
                onClick={props.onDiscard}
              >
                {t('settings.discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={props.onSave}
              >
                {t(!props.saving ? 'settings.save' : 'settings.saving')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
