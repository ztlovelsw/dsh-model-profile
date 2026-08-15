/**
 * Pure model-capability vocabulary and value rules: the pi-ai thinking
 * levels, and the read/build/validate helpers for the two per-model fields
 * the official Models editor does not expose:
 *
 *  - image support   → `input: ['text'] | ['text', 'image']`
 *  - reasoning levels → `reasoningEfforts: false | Partial<Record<level, string | null>>`
 *
 * No runtime dependencies, so the rules are unit-testable without a browser,
 * the settings transport, or the official Models page DOM.
 */

/** The seven pi-ai thinking levels, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

/** UI-facing effort map: level → wire spelling ('' stands for the null wire value, valid only for off). */
export type UiEfforts = Partial<Record<ThinkingLevel, string>>

/** Image-support tri-state as the injected select shows it. */
export type ImageMode = 'inherit' | 'on' | 'off'

/** Reasoning tri-state as the injected select shows it. */
export type ReasoningMode = 'inherit' | 'off' | 'custom'

/** Read the image mode of a stored model entry. */
export function imageModeOf(entry: Record<string, unknown>): ImageMode {
  const input = entry['input']
  if (!Array.isArray(input)) return 'inherit'
  return input.includes('image') ? 'on' : 'off'
}

/** The `input` value one image mode writes (undefined clears the field). */
export function imageValueOf(mode: ImageMode): string[] | undefined {
  if (mode === 'inherit') return undefined
  return mode === 'on' ? ['text', 'image'] : ['text']
}

/** Read the reasoning mode of a stored model entry. */
export function reasoningModeOf(entry: Record<string, unknown>): ReasoningMode {
  const value = entry['reasoningEfforts']
  if (value === false) return 'off'
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return 'custom'
  return 'inherit'
}

/** The stored efforts of a custom entry as UI wire spellings (null wire → ''). */
export function storedEfforts(entry: Record<string, unknown>): UiEfforts {
  const value = entry['reasoningEfforts']
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: UiEfforts = {}
  for (const level of THINKING_LEVELS) {
    const wire = (value as Record<string, unknown>)[level]
    if (wire === undefined) continue
    out[level] = typeof wire === 'string' ? wire : ''
  }
  return out
}

/**
 * Whether a UI effort set is writable: at least one non-off level, and every
 * non-off level carries a non-empty wire spelling (mirrors the pi-ai adapter's
 * resolve-time validation).
 */
export function effortsValid(efforts: UiEfforts): boolean {
  const entries = Object.entries(efforts) as [ThinkingLevel, string][]
  const hasThinking = entries.some(([level, wire]) => level !== 'off' && wire !== '')
  if (!hasThinking) return false
  return entries.every(([level, wire]) => level === 'off' || wire !== '')
}

/**
 * Build the stored `reasoningEfforts` payload from a UI effort set ('' → null,
 * which only `off` may carry). Callers must check {@link effortsValid} first.
 */
export function buildEffortsPayload(efforts: UiEfforts): Record<string, string | null> {
  const payload: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level]
    if (wire === undefined) continue
    payload[level] = wire === '' ? null : wire
  }
  return payload
}
