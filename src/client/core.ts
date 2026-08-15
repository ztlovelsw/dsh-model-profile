/**
 * Pure model-profile vocabulary: the pi-ai thinking levels and the validity
 * rule for a custom reasoning-effort set. No runtime dependencies, so it is
 * unit-testable without a browser or the settings transport.
 */

/** The seven pi-ai thinking levels, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

/**
 * Whether a staged custom effort set is valid: at least one non-off level, and
 * no empty non-off wire values.
 */
export function effortsValid(efforts: Partial<Record<ThinkingLevel, string>>): boolean {
  const entries = Object.entries(efforts) as [ThinkingLevel, string][]
  const hasThinking = entries.some(([level, wire]) => level !== 'off' && (wire ?? '') !== '')
  if (!hasThinking) return false
  return entries.every(([level, wire]) => level === 'off' || (wire ?? '') !== '')
}
