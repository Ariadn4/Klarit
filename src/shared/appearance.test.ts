import { describe, it, expect } from 'vitest'
import { SUPPORTED_APPEARANCES, DEFAULT_APPEARANCE, coerceAppearance } from './appearance'

describe('appearance 受支持值与默认', () => {
  it('受支持值恰为 dark/light/system 三种', () => {
    expect(SUPPORTED_APPEARANCES).toEqual(['dark', 'light', 'system'])
  })

  it('默认外观为 system（跟随系统）', () => {
    expect(DEFAULT_APPEARANCE).toBe('system')
  })
})

describe('coerceAppearance 收敛兜底', () => {
  it('合法值原样返回', () => {
    expect(coerceAppearance('dark')).toBe('dark')
    expect(coerceAppearance('light')).toBe('light')
    expect(coerceAppearance('system')).toBe('system')
  })

  it('非法字符串回退默认 system', () => {
    expect(coerceAppearance('blue')).toBe('system')
  })

  it('undefined / 非字符串回退默认 system', () => {
    expect(coerceAppearance(undefined)).toBe('system')
    expect(coerceAppearance(null)).toBe('system')
    expect(coerceAppearance(42)).toBe('system')
    expect(coerceAppearance({})).toBe('system')
  })
})
