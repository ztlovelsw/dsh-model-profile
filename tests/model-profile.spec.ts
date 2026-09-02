import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROXY_URL,
  THINKING_LEVELS,
  buildEffortsPayload,
  buildProxyPayload,
  effortsValid,
  imageModeOf,
  imageValueOf,
  proxyEnabled,
  proxyUrlOf,
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

describe('provider proxy', () => {
  it('defaults to the local Clash-style proxy URL', () => {
    expect(DEFAULT_PROXY_URL).toBe('http://127.0.0.1:7890')
  })

  it('reads enabled/url from a stored profile', () => {
    expect(proxyEnabled({})).toBe(false)
    expect(proxyEnabled({ proxy: '' })).toBe(false)
    expect(proxyEnabled({ proxy: '   ' })).toBe(false)
    expect(proxyEnabled({ proxy: 'http://127.0.0.1:7890' })).toBe(true)
    expect(proxyUrlOf({ proxy: 'http://proxy.local:8080' })).toBe('http://proxy.local:8080')
    expect(proxyUrlOf({})).toBe('')
  })

  it('builds the stored payload (empty clears)', () => {
    expect(buildProxyPayload('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(buildProxyPayload('  http://x:1  ')).toBe('http://x:1')
    expect(buildProxyPayload('')).toBeUndefined()
    expect(buildProxyPayload('   ')).toBeUndefined()
  })
})
