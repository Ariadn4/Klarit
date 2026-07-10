import { describe, it, expect } from 'vitest'
import { zh } from './locales/zh'
import { en } from './locales/en'

/** 把嵌套词典扁平化为点分键集合，用于跨语言键集合比对。 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value !== null && typeof value === 'object'
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('locale dictionaries', () => {
  it('zh 与 en 的键集合完全一致（无缺漏）', () => {
    const zhKeys = new Set(flattenKeys(zh))
    const enKeys = new Set(flattenKeys(en))
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k))
    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k))
    expect(onlyInZh).toEqual([])
    expect(onlyInEn).toEqual([])
  })

  it('两套词典均非空', () => {
    expect(flattenKeys(zh).length).toBeGreaterThan(0)
    expect(flattenKeys(en).length).toBe(flattenKeys(zh).length)
  })
})
