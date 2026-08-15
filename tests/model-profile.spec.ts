import { describe, expect, it } from 'vitest'
import { effortsValid, THINKING_LEVELS, type ThinkingLevel } from '../src/client/core.ts'

describe('effortsValid', () => {
  it('accepts a custom set with at least one non-off level and non-empty wire values', () => {
    expect(effortsValid({ off: '', high: 'high', max: 'max' })).toBe(true)
    expect(effortsValid({ high: 'high' })).toBe(true)
  })

  it('rejects a set with only off', () => {
    expect(effortsValid({ off: '' })).toBe(false)
  })

  it('rejects a set with an empty non-off wire value', () => {
    expect(effortsValid({ off: '', high: '' })).toBe(false)
  })

  it('rejects an empty set', () => {
    expect(effortsValid({})).toBe(false)
  })
})

describe('THINKING_LEVELS', () => {
  it('exposes the seven pi-ai levels in escalation order', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('covers the level-key copy namespace', () => {
    const keys: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    for (const key of keys) expect(THINKING_LEVELS).toContain(key)
  })
})
