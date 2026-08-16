/**
 * models.dev 预设：按需拉取 https://models.dev/api.json（公开、CORS 全开），
 * 以模型 ID 匹配出该模型的图像支持（modalities.input）与思考等级枚举
 * （reasoning_options.values），换算成 llm-pi-ai 的 `input` 与
 * `reasoningEfforts` 两个能力字段的取值。
 *
 * 匹配策略面向网关路由的模型 ID（如 `ag/gemini-3.7-flash-high`）：
 *  1. 去 `/` 前缀后再匹配；
 *  2. 容忍网关附加的思考档后缀（`-high` / `-medium` / `-low` 等），剥一层再匹配；
 *  3. 同名条目一方厂商（zai / google / deepseek…）优先于聚合网关的别名条目。
 */

import { THINKING_LEVELS } from './core.ts'

/** One models.dev model entry, restricted to the fields the preset needs. */
export interface ModelsDevModel {
  reasoning?: boolean
  reasoning_options?: Array<{ type?: string; values?: string[] } | undefined>
  modalities?: { input?: string[] }
}

/** The shapes of api.json the index builder walks. */
export type ModelsDevDb = Record<string, { models?: Record<string, ModelsDevModel> }>

/**
 * The preset fields derived from one models.dev entry. Either side may be
 * undefined — meaning models.dev has no opinion and that field is left as-is.
 */
export interface ModelPreset {
  /** llm-pi-ai `input` value: ['text','image'] or ['text']. */
  input?: string[]
  /** llm-pi-ai `reasoningEfforts` value: level -> wire spelling (null = send nothing). */
  reasoningEfforts?: Record<string, string | null>
}

/**
 * Providers whose own entries win over aggregator aliases carrying the same
 * model id (gateways sometimes proxy a narrower capability surface).
 */
const FIRST_PARTY = new Set([
  'deepseek', 'google', 'google-vertex', 'openai', 'anthropic', 'zai', 'zhipuai',
  'moonshotai', 'moonshotai-cn', 'minimax', 'minimax-cn', 'xai', 'meta',
  'mistral', 'cohere', 'alibaba', 'alibaba-cn', 'tencent', 'baidu', 'stepfun', 'xiaomi',
])

/** Gateway suffixes that pin a thinking level onto a base model id. */
const THINKING_SUFFIX = /-(high|medium|low|extra-low|thinking|none)$/

/** Model-id candidates for one catalog id, most specific first. */
export function candidatesOf(modelId: string): string[] {
  const raw = modelId.trim().toLowerCase()
  if (raw.length === 0) return []
  const afterSlash = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  const stripped = afterSlash.replace(THINKING_SUFFIX, '')
  return Array.from(new Set([raw, afterSlash, stripped].filter((c) => c.length > 0)))
}

/**
 * Build the id -> model index. First-party providers are indexed first and
 * never overwritten, so an aggregator alias with the same id cannot beat them.
 */
export function buildIndex(db: ModelsDevDb): Map<string, ModelsDevModel> {
  const index = new Map<string, ModelsDevModel>()
  const add = (providerFirstParty: boolean, key: string, model: ModelsDevModel): void => {
    const k = key.trim().toLowerCase()
    if (k.length === 0) return
    if (!providerFirstParty && index.has(k)) return
    index.set(k, model)
  }
  const addProvider = (key: string, provider: { models?: Record<string, ModelsDevModel> }, firstParty: boolean): void => {
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      add(firstParty, id, model)
      if (Array.isArray((model as { alias?: unknown }).alias)) {
        for (const alias of (model as { alias: string[] }).alias) add(firstParty, alias, model)
      }
    }
  }
  for (const [key, provider] of Object.entries(db)) {
    if (FIRST_PARTY.has(key)) addProvider(key, provider, true)
  }
  for (const [key, provider] of Object.entries(db)) {
    if (!FIRST_PARTY.has(key)) addProvider(key, provider, false)
  }
  return index
}

/** Find one catalog model id in the index, or undefined. */
export function findModel(index: Map<string, ModelsDevModel>, modelId: string): ModelsDevModel | undefined {
  for (const candidate of candidatesOf(modelId)) {
    const hit = index.get(candidate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Derive the llm-pi-ai capability values from one models.dev entry. */
export function presetOf(model: ModelsDevModel): ModelPreset | undefined {
  const inputs = model.modalities?.input
  const input = inputs?.includes('image') ? ['text', 'image'] : inputs?.includes('text') ? ['text'] : undefined
  const options = model.reasoning_options?.find((option) => (option?.values?.length ?? 0) > 0)
  const efforts: Record<string, string | null> = {}
  for (const raw of options?.values ?? []) {
    const level = raw === 'none' ? 'off' : raw
    // Unknown level spellings (new gateways, typos) are dropped rather than
    // written, so a bad entry never poisons the model's request surface.
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) continue
    efforts[level] = level === 'off' ? null : level
  }
  const reasoningEfforts = Object.keys(efforts).length > 0 ? efforts : undefined
  if (input === undefined && reasoningEfforts === undefined) return undefined
  return { input, reasoningEfforts }
}

/** In-session cache so one click per page load pays the download once. */
let cachedIndex: Promise<Map<string, ModelsDevModel>> | undefined

/** Fetch (once per session) and index the models.dev database. */
export function fetchModelsDevIndex(): Promise<Map<string, ModelsDevModel>> {
  cachedIndex ??= fetch('https://models.dev/api.json')
    .then((response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json() as Promise<ModelsDevDb>
    })
    .then((db) => buildIndex(db))
    .catch((error: unknown) => {
      // A failed fetch must not poison the cache; the next click retries.
      cachedIndex = undefined
      throw error
    })
  return cachedIndex
}
