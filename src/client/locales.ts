/**
 * `model-profile` namespace dictionaries: copy for the capability controls
 * injected into the official Models settings editor's per-model rows.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'block.title': '图像与思考',
  'image': '是否支持图像',
  'image.inherit': '继承默认',
  'image.on': '支持图像',
  'image.off': '仅文本',
  'image.hint': '写入该模型的 input 能力：支持图像 = text+image；仅文本 = text；继承 = 沿用目录或提供方默认。',
  'reasoning': '思考等级',
  'reasoning.inherit': '继承默认',
  'reasoning.off': '不支持思考',
  'reasoning.custom': '自定义等级',
  'reasoning.hint': '不支持思考 = reasoningEfforts: false；自定义 = 按等级声明发送给接口的取值。',
  'reasoning.customHint': '勾选该模型提供的思考等级并填写接口取值（默认与等级同名）；off 的取值可留空，表示不发送任何参数。',
  'reasoning.invalid': '至少勾选一个非 off 的等级，且非 off 等级必须填写接口取值。',
  'effort.off': 'off（不思考）',
  'effort.minimal': 'minimal（极低）',
  'effort.low': 'low（低）',
  'effort.medium': 'medium（中）',
  'effort.high': 'high（高）',
  'effort.xhigh': 'xhigh（极高）',
  'effort.max': 'max（最高）',
  'effort.wire': '接口取值',
  'write.failed': '写入失败：{error}',
} satisfies Record<string, string>

/** The model-profile namespace key union. */
export type ModelProfileKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ModelProfileKey, string> = {
  'block.title': 'Image & reasoning',
  'image': 'Image support',
  'image.inherit': 'Inherit',
  'image.on': 'Supports images',
  'image.off': 'Text only',
  'image.hint': 'Writes this model\'s input capability: supports images = text+image; text only = text; inherit keeps the catalog or provider default.',
  'reasoning': 'Reasoning levels',
  'reasoning.inherit': 'Inherit',
  'reasoning.off': 'No reasoning',
  'reasoning.custom': 'Custom levels',
  'reasoning.hint': 'No reasoning = reasoningEfforts: false; custom declares the wire value sent per level.',
  'reasoning.customHint': 'Check the reasoning levels this model offers and fill in the wire value sent to the endpoint (defaults to the level id). The off value may be left empty to send nothing.',
  'reasoning.invalid': 'Check at least one non-off level, and every non-off level needs a wire value.',
  'effort.off': 'off',
  'effort.minimal': 'minimal',
  'effort.low': 'low',
  'effort.medium': 'medium',
  'effort.high': 'high',
  'effort.xhigh': 'xhigh',
  'effort.max': 'max',
  'effort.wire': 'Wire value',
  'write.failed': 'Write failed: {error}',
}
