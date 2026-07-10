import { describe, it, expect } from 'vitest'
import { resolveEffectiveTheme } from './theme'

describe('resolveEffectiveTheme', () => {
  it('深色偏好恒为 dark（不看系统）', () => {
    expect(resolveEffectiveTheme('dark', false)).toBe('dark')
    expect(resolveEffectiveTheme('dark', true)).toBe('dark')
  })

  it('浅色偏好恒为 light（不看系统）', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light')
    expect(resolveEffectiveTheme('light', false)).toBe('light')
  })

  it('跟随系统：系统深色→dark', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark')
  })

  it('跟随系统：系统浅色→light', () => {
    expect(resolveEffectiveTheme('system', false)).toBe('light')
  })
})
