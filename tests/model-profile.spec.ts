import { describe, expect, it } from 'vitest'
import {
  THINKING_LEVELS,
  buildEffortsPayload,
  effortsValid,
  imageModeOf,
  imageValueOf,
  reasoningModeOf,
  storedEfforts,
} from '../src/client/core.ts'

describe('image capability', () => {
  it('reads inherit/on/off from the stored input field', () => {
    expect(imageModeOf({})).toBe('inherit')
    expect(imageModeOf({ input: ['text', 'image'] })).toBe('on')
    expect(imageModeOf({ input: ['text'] })).toBe('off')
    expect(imageModeOf({ input: 'weird' })).toBe('inherit')
  })

  it('maps a mode back to the input value (inherit clears)', () => {
    expect(imageValueOf('inherit')).toBeUndefined()
    expect(imageValueOf('on')).toEqual(['text', 'image'])
    expect(imageValueOf('off')).toEqual(['text'])
  })
})

describe('reasoning capability', () => {
  it('reads inherit/off/custom from the stored reasoningEfforts field', () => {
    expect(reasoningModeOf({})).toBe('inherit')
    expect(reasoningModeOf({ reasoningEfforts: false })).toBe('off')
    expect(reasoningModeOf({ reasoningEfforts: { high: 'high' } })).toBe('custom')
    expect(reasoningModeOf({ reasoningEfforts: [] })).toBe('inherit')
  })

  it('reads stored efforts as UI wire spellings (null wire -> empty)', () => {
    expect(storedEfforts({ reasoningEfforts: { off: null, high: 'high' } })).toEqual({ off: '', high: 'high' })
    expect(storedEfforts({})).toEqual({})
  })
})

describe('effortsValid', () => {
  it('accepts a set with at least one non-off level and non-empty wires', () => {
    expect(effortsValid({ off: '', high: 'high', max: 'max' })).toBe(true)
    expect(effortsValid({ high: 'high' })).toBe(true)
  })

  it('rejects a set with only off', () => {
    expect(effortsValid({ off: '' })).toBe(false)
  })

  it('rejects a set with an empty non-off wire', () => {
    expect(effortsValid({ off: '', high: '' })).toBe(false)
  })

  it('rejects an empty set', () => {
    expect(effortsValid({})).toBe(false)
  })
})

describe('buildEffortsPayload', () => {
  it('turns empty off wire into null and keeps other spellings', () => {
    expect(buildEffortsPayload({ off: '', high: 'high' })).toEqual({ off: null, high: 'high' })
  })

  it('exposes the seven pi-ai levels in escalation order', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})
