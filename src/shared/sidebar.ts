/** 侧边栏宽度相关常量与钳制逻辑（main 与 renderer 共用，避免漂移）。 */

/** 最小宽度（px）：能容纳项目切换器与文件树缩进的经验下限。 */
export const MIN_SIDEBAR_WIDTH = 180
/** 默认宽度（px）：与旧的固定 `w-60`（15rem）等值，保证既有观感不变。 */
export const DEFAULT_SIDEBAR_WIDTH = 240
/** 绝对上限（px）：避免侧边栏在超宽窗口下喧宾夺主。 */
export const MAX_SIDEBAR_WIDTH = 560

/**
 * 把宽度钳制到 [MIN, min(MAX, 窗口宽度 × 50%)]。
 * - MIN 始终优先：窗口极窄时不会让侧边栏低于可用下限。
 * - 非有限值（NaN / 缺省）回退默认宽度。
 */
export function clampSidebarWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  const upper = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, windowWidth * 0.5))
  return Math.min(upper, Math.max(MIN_SIDEBAR_WIDTH, width))
}
