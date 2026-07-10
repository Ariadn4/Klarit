/** 生效主题：由「外观」偏好 + 操作系统明暗解析而来（main 与 renderer 共用）。 */

import type { Appearance } from './appearance'

/** 实际渲染用的主题，只有深/浅两态（不存在 system 生效态）。 */
export type EffectiveTheme = 'dark' | 'light'

/**
 * 把外观偏好解析为生效主题：
 * - `dark` / `light` 直接对应，不看系统；
 * - `system` 取操作系统当前明暗（`systemDark` 为 true 则 dark，否则 light）。
 */
export function resolveEffectiveTheme(appearance: Appearance, systemDark: boolean): EffectiveTheme {
  if (appearance === 'dark') return 'dark'
  if (appearance === 'light') return 'light'
  return systemDark ? 'dark' : 'light'
}
