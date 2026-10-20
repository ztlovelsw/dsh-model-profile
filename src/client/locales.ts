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
}
