/**
 * `model-profile` namespace dictionaries: copy for the provider-level
 * 「同步模型能力」 button injected into the official Models settings page.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'sync': '同步模型能力',
  'sync.hint': '按 models.dev 批量同步当前提供方所有模型的能力：思考等级与图像支持直接写入（之后以官方行内的推理等级与输入类型控件为准），上下文窗口/最大输出仅在未填写时补全。',
  'sync.busy': '同步中…',
  'sync.applied': '已同步 {n} 项',
  'sync.none': '该提供方还没有模型，无需同步。',
  'sync.noMatch': '{n} 个模型均未在 models.dev 收录，未做更改。',
  'sync.done': '同步完成：{matched}/{total} 个模型命中 models.dev。',
  'sync.unknown': '未收录：{ids}',
  'sync.failed': '部分写入失败：{error}',
  'sync.fetchFailed': '获取 models.dev 数据失败：{error}',
  'headers': '高级设置',
  'headers.hint': '编辑当前提供方的请求头；保存后只影响新的请求。',
  'headers.title': '请求头高级设置',
  'headers.enabled': '启用自定义请求头',
  'headers.help': '使用 JSON 对象填写 Header 名称和值。认证、User-Agent 和会话头仍由 DSH/pi-ai 管理。',
  'headers.input': '请求头 JSON',
  'headers.codex': '套用 Codex 模板',
  'headers.claude': '套用 Claude 模板',
  'headers.presetLoaded': '模板已填入，可继续编辑后保存。',
  'headers.save': '保存请求头',
  'headers.saving': '保存中…',
  'headers.saved': '已保存，新请求生效。',
  'headers.invalidJson': 'JSON 格式不正确。',
  'headers.invalidShape': '请求头必须是“名称: 字符串值”的 JSON 对象。',
  'headers.failed': '保存失败：{error}',
} satisfies Record<string, string>

/** The model-profile namespace key union. */
export type ModelProfileKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ModelProfileKey, string> = {
  'sync': 'Sync model capabilities',
  'sync.hint': 'Bulk-sync every model of this provider from models.dev: reasoning levels and image support are written directly (the official row\'s reasoning-level and input-type controls own them afterwards), and context window / max output are filled in only when absent.',
  'sync.busy': 'Syncing…',
  'sync.applied': 'Synced {n} fields',
  'sync.none': 'This provider has no models to sync.',
  'sync.noMatch': 'None of the {n} models are listed on models.dev; nothing changed.',
  'sync.done': 'Sync finished: {matched}/{total} models matched on models.dev.',
  'sync.unknown': 'Not listed: {ids}',
  'sync.failed': 'Some writes failed: {error}',
  'sync.fetchFailed': 'Failed to fetch models.dev data: {error}',
  'headers': 'Advanced settings',
  'headers.hint': 'Edit request headers for this provider; changes apply to new requests.',
  'headers.title': 'Advanced request headers',
  'headers.enabled': 'Enable custom request headers',
  'headers.help': 'Enter a JSON object of header names and string values. DSH/pi-ai still owns authentication, User-Agent, and session headers.',
  'headers.input': 'Request headers JSON',
  'headers.codex': 'Use Codex template',
  'headers.claude': 'Use Claude template',
  'headers.presetLoaded': 'Template loaded. Edit it if needed, then save.',
  'headers.save': 'Save headers',
  'headers.saving': 'Saving…',
  'headers.saved': 'Saved; new requests use it.',
  'headers.invalidJson': 'The JSON is invalid.',
  'headers.invalidShape': 'Headers must be a JSON object with string values.',
  'headers.failed': 'Save failed: {error}',
}
