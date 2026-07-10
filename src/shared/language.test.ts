import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  normalizeLocale,
  coerceLanguage
} from './language'

describe('language 常量', () => {
  it('受支持语言含 zh 与 en，默认是 zh', () => {
    expect(SUPPORTED_LANGUAGES).toContain('zh')
    expect(SUPPORTED_LANGUAGES).toContain('en')
    expect(DEFAULT_LANGUAGE).toBe('zh')
  })

  it('每种受支持语言都有展示名', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_LABELS[lang]).toBeTruthy()
    }
  })
})

describe('normalizeLocale', () => {
  it('英文及其地区变体归一为 en', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('en-GB')).toBe('en')
  })

  it('中文及其变体归一为 zh', () => {
    expect(normalizeLocale('zh')).toBe('zh')
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('zh-Hans')).toBe('zh')
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh')
  })

  it('不受支持的语言回退默认', () => {
    expect(normalizeLocale('fr-FR')).toBe('zh')
    expect(normalizeLocale('')).toBe('zh')
  })

  it('大小写不敏感', () => {
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('ZH')).toBe('zh')
  })
})

describe('coerceLanguage', () => {
  it('受支持值原样返回', () => {
    expect(coerceLanguage('en')).toBe('en')
    expect(coerceLanguage('zh')).toBe('zh')
  })

  it('非法或空值回退默认', () => {
    expect(coerceLanguage('xx')).toBe('zh')
    expect(coerceLanguage(undefined)).toBe('zh')
    expect(coerceLanguage(null)).toBe('zh')
    expect(coerceLanguage(123)).toBe('zh')
  })
})
