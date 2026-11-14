/** Settings namespace owned by this plugin. */
export const HEADER_SETTINGS_NS = 'ui-model-profile'

/** One provider's live request-header configuration. */
export interface RequestHeaderProfile {
  enabled: boolean
  headers: Record<string, string>
}

export type HeaderPresetId = 'codex' | 'claude'

/**
 * Safe, editable starting points for the two common gateway contracts.
 * Authentication, User-Agent, and session headers remain owned by DSH/pi-ai.
 * The Codex value follows codex-proxy-rs' public client identity vocabulary.
 */
export const REQUEST_HEADER_PRESETS: Record<HeaderPresetId, Readonly<Record<string, string>>> = {
  codex: {
    originator: 'codex_cli_rs',
  },
  claude: {
    'anthropic-version': '2023-06-01',
  },
}

export function cloneHeaderPreset(id: HeaderPresetId): Record<string, string> {
  return { ...REQUEST_HEADER_PRESETS[id] }
}
