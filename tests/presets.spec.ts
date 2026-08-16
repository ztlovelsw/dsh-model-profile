import { describe, expect, it } from 'vitest'
import { buildIndex, candidatesOf, findModel, presetOf, type ModelsDevDb } from '../src/client/presets.ts'

/** A minimal api.json slice exercising the matching and priority rules. */
const db: ModelsDevDb = {
  // First-party: wins over the same model id exposed by an aggregator below.
  google: {
    models: {
      'gemini-3.7-flash': {
        modalities: { input: ['text', 'image'] },
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
      },
    },
  },
  zai: {
    models: {
      'glm-5.2': {
        modalities: { input: ['text'] },
        reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
      },
    },
  },
  deepseek: {
    models: {
      'deepseek-v4-flash': {
        modalities: { input: ['text'] },
        reasoning: true,
      },
    },
  },
  'some-gateway': {
    models: {
      // Same id as the first-party entry but a narrower surface: must lose.
      'glm-5.2': {
        modalities: { input: ['text', 'image'] },
        reasoning_options: [{ type: 'effort', values: ['medium'] }],
      },
      // Alias spelling pointing at its own entry.
      'glm5-2': { modalities: { input: ['text'] }, alias: ['glm-5.2-alias'] },
    },
  },
  openai: {
    models: {
      'gpt-oss-120b': {
        modalities: { input: ['text', 'image'] },
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'banana'] }],
      },
    },
  },
  minimax: {
    models: {
      'minimax-m3': {
        modalities: { input: ['text', 'image', 'video'] },
        reasoning_options: [{ type: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }],
      },
    },
  },
}

const index = buildIndex(db)

describe('candidatesOf', () => {
  it('strips gateway prefixes and one thinking-level suffix', () => {
    expect(candidatesOf('ag/gemini-3.7-flash-high')).toEqual([
      'ag/gemini-3.7-flash-high',
      'gemini-3.7-flash-high',
      'gemini-3.7-flash',
    ])
  })

  it('keeps non-thinking suffixes and dedupes', () => {
    expect(candidatesOf('mimo-v2.5-free')).toEqual(['mimo-v2.5-free'])
    expect(candidatesOf('GLM-5.2')).toEqual(['glm-5.2'])
  })
})

describe('buildIndex / findModel', () => {
  it('prefers first-party entries over aggregator aliases with the same id', () => {
    const hit = findModel(index, 'cbcn/glm-5.2')
    expect(hit).toBeDefined()
    expect(presetOf(hit!).input).toEqual(['text'])
    expect(presetOf(hit!).reasoningEfforts).toEqual({ high: 'high', max: 'max' })
  })

  it('matches through gateway prefixes and thinking suffixes', () => {
    expect(findModel(index, 'ag/gemini-3.7-flash-high')).toBeDefined()
    expect(findModel(index, 'qd/gpt-oss-120b-medium')).toBeDefined()
  })

  it('indexes alias spellings', () => {
    expect(findModel(index, 'glm-5.2-alias')).toBeDefined()
  })

  it('returns undefined for unknown models', () => {
    expect(findModel(index, 'totally-unknown')).toBeUndefined()
  })
})

describe('presetOf', () => {
  it('maps modalities to the pi-ai input field (image on/off)', () => {
    expect(presetOf(db.google.models['gemini-3.7-flash']!).input).toEqual(['text', 'image'])
    expect(presetOf(db.zai.models['glm-5.2']!).input).toEqual(['text'])
  })

  it('maps reasoning effort values, none->off with null wire, dropping unknown levels', () => {
    const openai = presetOf(db.openai.models['gpt-oss-120b']!)
    expect(openai.reasoningEfforts).toEqual({ low: 'low', medium: 'medium', high: 'high' })
    const minimax = presetOf(db.minimax.models['minimax-m3']!)
    expect(minimax.reasoningEfforts).toEqual({
      off: null,
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('leaves reasoning untouched when models.dev has no effort enum', () => {
    const deepseek = presetOf(db.deepseek.models['deepseek-v4-flash']!)
    expect(deepseek?.reasoningEfforts).toBeUndefined()
    expect(deepseek?.input).toEqual(['text'])
  })
})
