/** 应用外观偏好（main 与 renderer 共用，作为单一来源）。仅存储读写，不含主题渲染。 */

/** 受支持外观标识。 */
export type Appearance = 'dark' | 'light' | 'system'

/** 全部受支持外观；新增取值只改这一处，UI 由它驱动渲染。 */
export const SUPPORTED_APPEARANCES: Appearance[] = ['dark', 'light', 'system']

/** 默认外观：未初始化或非法值时的回退。 */
export const DEFAULT_APPEARANCE: Appearance = 'system'

// 外观展示名走 i18next（`settingsPanel.appearanceOption.*`）——外壳静态文案不硬编码在此。

function isSupported(value: string): value is Appearance {
  return (SUPPORTED_APPEARANCES as string[]).includes(value)
}

/** 把任意输入收敛为受支持外观；非受支持值一律回退默认。 */
export function coerceAppearance(value: unknown): Appearance {
  return typeof value === 'string' && isSupported(value) ? value : DEFAULT_APPEARANCE
}
