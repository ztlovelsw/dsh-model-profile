/**
 * The model-capability settings card: for every configured model across every
 * provider, edit whether it supports images and which reasoning-effort levels
 * it offers. Writes land as minimal `settings.mutate` path ops against the
 * owning namespace (llm-pi-ai for gateway providers, llm-deepseek for the
 * direct route), preserving hidden fields the Models page keeps.
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard } from './PluginSettingsCard.tsx'
import type { ModelProfileController, ProfileModelRow } from './controller.ts'
import { effortsValid, THINKING_LEVELS, type ThinkingLevel } from './core.ts'
import type { ModelProfileKey } from './locales.ts'
import css from './settings-card.module.css'

/** The reasoning-effort control mode for one model row. */
export type ReasoningMode = 'inherit' | 'off' | 'custom'

/** One staged per-model edit. */
export interface ModelEdit {
  /** Image support: undefined = inherit, true = text+image, false = text-only. */
  image?: boolean
  /** Reasoning mode: inherit / no-reasoning / custom levels. */
  reasoning?: ReasoningMode
  /** Custom effort wire values keyed by level (absent = not offered). */
  efforts?: Partial<Record<ThinkingLevel, string>>
}

/** What the card renders. */
export interface ModelProfileCardState {
  /** False while the settings join has not loaded. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /** Whole-load failure text, when the join failed. */
  loadError: string | null
  /** Provider-grouped model rows. */
  groups: { provider: string; name: string; rows: ProfileModelRow[] }[]
  /** Staged edit for one row (undefined = untouched). */
  edit: (row: ProfileModelRow) => ModelEdit | undefined
  /** Effective reasoning mode of one row (staged or current). */
  reasoningMode: (row: ProfileModelRow) => ReasoningMode
  /** Effective image value of one row: true/false when set, undefined = inherit. */
  imageValue: (row: ProfileModelRow) => boolean | undefined
  /** Current custom efforts of one row (staged or current), as wire spellings. */
  currentEfforts: (row: ProfileModelRow) => Partial<Record<ThinkingLevel, string>>
}

/** The registration-side face the card's slot entry injects. */
export interface ModelProfileCardFace {
  /** Stage one row's image value (undefined clears the staged edit). */
  setImage: (row: ProfileModelRow, value: boolean | undefined) => void
  /** Stage one row's reasoning mode. */
  setReasoning: (row: ProfileModelRow, mode: ReasoningMode) => void
  /** Stage one row's effort wire value (empty string removes the level). */
  setEffortWire: (row: ProfileModelRow, level: ThinkingLevel, wire: string) => void
  /** Reset one row to inherited (clears every staged edit for it). */
  resetRow: (row: ProfileModelRow) => void
  /** Write every staged edit, then re-seed. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  hooks: {
    /** Card snapshot bound by the renderer as useModelProfileCard. */
    modelProfileCard: SnapshotStore<ModelProfileCardState>
  }
}

/** The stored `reasoningEfforts` value of one model entry. */
function storedReasoning(entry: Record<string, unknown>): false | Record<string, unknown> | undefined {
  const value = entry['reasoningEfforts']
  if (value === false) return false
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** The stored `input` modalities of one model entry. */
function storedImage(entry: Record<string, unknown>): boolean | undefined {
  const input = entry['input']
  if (!Array.isArray(input)) return undefined
  return input.includes('image')
}

/** The current reasoning mode of a model entry (no staged edit). */
function currentReasoningMode(entry: Record<string, unknown>): ReasoningMode {
  const value = storedReasoning(entry)
  if (value === false) return 'off'
  if (typeof value === 'object') return 'custom'
  return 'inherit'
}

/** The current efforts of a model entry as wire spellings (empty string for a null wire value). */
function currentEfforts(entry: Record<string, unknown>): Partial<Record<ThinkingLevel, string>> {
  const value = storedReasoning(entry)
  if (typeof value !== 'object' || value === null) return {}
  const out: Partial<Record<ThinkingLevel, string>> = {}
  for (const level of THINKING_LEVELS) {
    const wire = value[level]
    if (wire === undefined) continue
    out[level] = typeof wire === 'string' ? wire : ''
  }
  return out
}

/** The staged write for one row, or undefined when nothing is staged. */
function planWrite(row: ProfileModelRow, edit: ModelEdit | undefined): { image?: boolean; reasoning?: false | Record<string, string> | undefined } | undefined {
  if (edit === undefined) return undefined
  const plan: { image?: boolean; reasoning?: false | Record<string, string> | undefined } = {}
  let changed = false
  if (edit.image !== undefined) {
    plan.image = edit.image
    changed = true
  }
  if (edit.reasoning !== undefined) {
    if (edit.reasoning === 'inherit') {
      if (currentReasoningMode(row.entry) !== 'inherit') { plan.reasoning = undefined; changed = true }
    } else if (edit.reasoning === 'off') {
      if (currentReasoningMode(row.entry) !== 'off') { plan.reasoning = false; changed = true }
    } else {
      const base = currentEfforts(row.entry)
      const merged: Record<string, string> = { ...base }
      for (const level of THINKING_LEVELS) {
        const wire = edit.efforts?.[level]
        if (wire === undefined) continue
        if (wire === '') delete merged[level]
        else merged[level] = wire
      }
      if (JSON.stringify(merged) !== JSON.stringify(base)) { plan.reasoning = merged; changed = true }
    }
  }
  return changed ? plan : undefined
}

/** Bridges the controller onto the card's staged form. */
export class ModelProfileCardController {
  private readonly staged = new Map<string, ModelEdit>()
  private saving = false
  private failed = false
  private readonly store: SnapshotStore<ModelProfileCardState>

  constructor(
    private readonly controller: ModelProfileController,
    private readonly api: Pick<IApiClient, 'settings'>,
  ) {
    this.store = createSnapshotStore<ModelProfileCardState>(this.projection())
    this.controller.store.subscribe(() => { this.publish() })
  }

  private rowKey(row: ProfileModelRow): string {
    return row.provider + '\u0000' + row.id
  }

  private projection(): ModelProfileCardState {
    const snapshot = this.controller.store.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0 || this.failed,
      invalid: this.invalidRows().length > 0,
      saving: this.saving,
      failed: this.failed,
      loadError: snapshot.status === 'error' ? snapshot.error : null,
      groups: snapshot.groups,
      edit: (row) => this.staged.get(this.rowKey(row)),
      reasoningMode: (row) => {
        const edit = this.staged.get(this.rowKey(row))
        return edit?.reasoning ?? currentReasoningMode(row.entry)
      },
      imageValue: (row) => {
        const edit = this.staged.get(this.rowKey(row))
        return edit?.image ?? storedImage(row.entry)
      },
      currentEfforts: (row) => {
        const edit = this.staged.get(this.rowKey(row))
        if (edit?.efforts !== undefined) return edit.efforts
        return currentEfforts(row.entry)
      },
    }
  }

  private invalidRows(): ProfileModelRow[] {
    const out: ProfileModelRow[] = []
    for (const group of this.controller.store.getSnapshot().groups) {
      for (const row of group.rows) {
        const edit = this.staged.get(this.rowKey(row))
        if (edit?.reasoning !== 'custom') continue
        if (!effortsValid(edit.efforts ?? {})) out.push(row)
      }
    }
    return out
  }

  private stage(row: ProfileModelRow, updater: (edit: ModelEdit) => ModelEdit): void {
    const key = this.rowKey(row)
    const current = this.staged.get(key)
    const next = updater(current ?? {})
    const empty = next.image === undefined && next.reasoning === undefined && (next.efforts === undefined || Object.keys(next.efforts).length === 0)
    if (empty) this.staged.delete(key)
    else this.staged.set(key, next)
    this.failed = false
    this.publish()
  }

  /** Build the face the card's slot registration injects. */
  inject(): ModelProfileCardFace {
    return {
      setImage: (row, value) => this.stage(row, (edit) => ({ ...edit, image: value })),
      setReasoning: (row, mode) => {
        this.stage(row, (edit) => {
          if (mode === 'custom') {
            const base = currentEfforts(row.entry)
            const next: Partial<Record<ThinkingLevel, string>> = { ...base }
            if (Object.keys(next).length === 0) next['off'] = ''
            return { ...edit, reasoning: mode, efforts: next }
          }
          return { ...edit, reasoning: mode, efforts: mode === 'inherit' ? undefined : {} }
        })
      },
      setEffortWire: (row, level, wire) => this.stage(row, (edit) => {
        const base = edit.efforts ?? currentEfforts(row.entry)
        const next = { ...base }
        if (wire === '') delete next[level]
        else next[level] = wire
        return { ...edit, efforts: next }
      }),
      resetRow: (row) => {
        this.staged.delete(this.rowKey(row))
        this.failed = false
        this.publish()
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      hooks: { modelProfileCard: this.store },
    }
  }

  private async save(): Promise<void> {
    const snapshot = this.controller.store.getSnapshot()
    if (this.saving || snapshot.status !== 'ready') return
    const plans: { row: ProfileModelRow; plan: NonNullable<ReturnType<typeof planWrite>> }[] = []
    for (const group of snapshot.groups) {
      for (const row of group.rows) {
        const edit = this.staged.get(this.rowKey(row))
        const plan = planWrite(row, edit)
        if (plan !== undefined) plans.push({ row, plan })
      }
    }
    if (plans.length === 0) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const { row, plan } of plans) {
      const ns = row.settingsNs
      const namespace = snapshot.namespaces.get(ns)
      if (namespace === undefined) { landed = false; continue }
      const basePath = [...row.settingsPath, 'models', String(row.entryIndex)]
      const ops: ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[] = []
      if (plan.image !== undefined) {
        ops.push({ op: 'set', path: [...basePath, 'input'], value: plan.image ? ['text', 'image'] : ['text'] })
      }
      if (plan.reasoning !== undefined) {
        ops.push({ op: 'set', path: [...basePath, 'reasoningEfforts'], value: plan.reasoning === false ? false : plan.reasoning })
      } else {
        ops.push({ op: 'unset', path: [...basePath, 'reasoningEfforts'] })
      }
      try {
        const response = await this.api.settings.mutate({
          ns,
          ops,
          expectedRevision: namespace.revision,
        })
        if (!response.result.ok) landed = false
      } catch {
        landed = false
      }
    }
    if (landed) {
      this.staged.clear()
      await this.controller.load()
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}

/** Props the renderer binds for the model-profile card. */
export type ModelProfileCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'model-profile'>
  & InjectFace<ModelProfileCardFace>

/** One model row's control panel. */
type ModelControlsFace = Omit<ModelProfileCardFace, 'hooks'>

function ModelControls(props: {
  t: (key: ModelProfileKey) => string
  row: ProfileModelRow
  state: ModelProfileCardState
  face: ModelControlsFace
  disabled: boolean
}) {
  const { t, row, state, face, disabled } = props
  const image = state.imageValue(row)
  const mode = state.reasoningMode(row)
  const efforts = state.currentEfforts(row)
  const edit = state.edit(row)
  const reasoningInvalid = mode === 'custom' && !effortsValid(efforts)
  const overridden = edit !== undefined
  const imageId = 'mp-image-' + row.provider + '-' + row.id
  const reasonId = 'mp-reason-' + row.provider + '-' + row.id
  return (
    <div className={css.controls}>
      <div className={css.control}>
        <div className={css.controlHead}>
          <label className={css.controlLabel} htmlFor={imageId}>{t('image')}</label>
        </div>
        <select
          id={imageId}
          className={css.select}
          value={image === undefined ? '' : image ? 'true' : 'false'}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value
            face.setImage(row, value === '' ? undefined : value === 'true')
          }}
        >
          <option value="">{t('image.inherit')}</option>
          <option value="true">{t('image.on')}</option>
          <option value="false">{t('image.off')}</option>
        </select>
        <p className={css.hint}>{t('image.hint')}</p>
      </div>
      <div className={css.control}>
        <div className={css.controlHead}>
          <label className={css.controlLabel} htmlFor={reasonId}>{t('reasoning')}</label>
        </div>
        <select
          id={reasonId}
          className={css.select}
          value={mode}
          disabled={disabled}
          onChange={(event) => {
            face.setReasoning(row, event.target.value as ReasoningMode)
          }}
        >
          <option value="inherit">{t('reasoning.inherit')}</option>
          <option value="off">{t('reasoning.off')}</option>
          <option value="custom">{t('reasoning.custom')}</option>
        </select>
        <p className={reasoningInvalid ? css.invalid : css.hint}>
          {reasoningInvalid ? t('reasoning.invalid') : t('reasoning.hint')}
        </p>
        {mode === 'custom' ? (
          <div className={css.effortList}>
            <p className={css.hint}>{t('reasoning.customHint')}</p>
            {THINKING_LEVELS.map((level) => {
              const wire = efforts[level]
              const enabled = wire !== undefined
              const effortLabel = t('effort.' + level as ModelProfileKey)
              return (
                <div key={level} className={css.effortRow}>
                  <label className={css.effortCheck}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={disabled}
                      onChange={(event) => {
                        if (event.target.checked) {
                          face.setEffortWire(row, level, level === 'off' ? '' : level)
                        } else {
                          face.setEffortWire(row, level, '')
                        }
                      }}
                    />
                    <span>{effortLabel}</span>
                  </label>
                  <input
                    className={css.effortWire}
                    type="text"
                    value={wire ?? ''}
                    placeholder={level}
                    aria-label={t('effort.wire') + ' ' + effortLabel}
                    disabled={disabled || !enabled}
                    onChange={(event) => { face.setEffortWire(row, level, event.target.value) }}
                  />
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      {overridden ? (
        <div className={css.badges}>
          <span className={css.badge}>{t('settings.overridden')}</span>
          <button
            type="button"
            className={css.reset}
            disabled={disabled}
            onClick={() => { face.resetRow(row) }}
          >
            {t('settings.reset')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Render the model-capability card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ModelProfileCard(props: ModelProfileCardProps) {
  const { t } = props
  const state = props.useModelProfileCard((snapshot) => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginSettingsCard
      t={t}
      titleKey="card.title"
      descriptionKey="card.description"
      dirty={state.dirty}
      invalid={state.invalid}
      saving={state.saving}
      failed={state.failed}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.intro}>{t('card.intro')}</p>
      {!state.writable ? <p className={css.readOnly}>{t('settings.readOnly')}</p> : null}
      {state.loadError !== null ? <p className={css.error}>{t('card.loadFailed', { error: state.loadError })}</p> : null}
      {state.groups.length === 0 ? (
        <p className={css.empty}>{t('card.empty')}</p>
      ) : state.groups.map((group) => (
        <div key={group.provider} className={css.providerGroup}>
          <div className={css.providerHead}>
            <span className={css.providerName}>{group.name}</span>
            <span className={css.providerRoute}>{group.provider}</span>
          </div>
          {group.rows.map((row) => (
            <div key={row.id} className={css.modelEntry}>
              <div className={css.modelRow}>
                <span className={css.modelName}>{row.name}</span>
                <span className={css.modelId}>{row.id}</span>
              </div>
              <ModelControls t={t} row={row} state={state} face={props} disabled={disabled || !row.editable} />
            </div>
          ))}
        </div>
      ))}
    </PluginSettingsCard>
  )
}
