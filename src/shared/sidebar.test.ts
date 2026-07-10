import { describe, it, expect } from 'vitest'
import {
  MIN_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  clampSidebarWidth
} from './sidebar'

describe('侧边栏宽度常量', () => {
  it('默认宽度等于旧的 w-60（240px），并落在 [MIN, MAX] 内', () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(240)
    expect(MIN_SIDEBAR_WIDTH).toBe(180)
    expect(DEFAULT_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
    expect(DEFAULT_SIDEBAR_WIDTH).toBeLessThanOrEqual(MAX_SIDEBAR_WIDTH)
  })
})

describe('clampSidebarWidth', () => {
  // 用足够大的窗口宽度，使上限取绝对上限 MAX 而非窗口比例。
  const WIDE = 4000

  it('区间内的宽度原样返回', () => {
    expect(clampSidebarWidth(300, WIDE)).toBe(300)
  })

  it('低于最小值被钳到 MIN', () => {
    expect(clampSidebarWidth(50, WIDE)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('高于绝对上限被钳到 MAX', () => {
    expect(clampSidebarWidth(9999, WIDE)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('上限同时受窗口宽度 50% 约束', () => {
    // 窗口 800px → 50% = 400，但 MIN 仍兜底；这里取一个会被 400 限制的值。
    expect(clampSidebarWidth(500, 800)).toBe(400)
  })

  it('窗口极窄时不会低于 MIN（MIN 优先于比例上限）', () => {
    // 窗口 200px → 50% = 100 < MIN(180)，钳制结果不应小于 MIN。
    expect(clampSidebarWidth(150, 200)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('非有限值（NaN/缺省）回退默认宽度', () => {
    expect(clampSidebarWidth(Number.NaN, WIDE)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(undefined as unknown as number, WIDE)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
