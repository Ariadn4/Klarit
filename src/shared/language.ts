/** 受支持的界面语言（main 与 renderer 共用，作为单一来源）。 */

/** 受支持语言标识（基础语言段，不含地区/书写系统后缀）。 */
export type SupportedLanguage = 'zh' | 'en'

/** 全部受支持语言；新增语言只改这一处，UI 由它驱动渲染。 */
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['zh', 'en']

/** 默认语言：受支持列表未命中时的回退。 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh'

/** 各语言的展示名（用于设置面板）。 */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  zh: '中文',
  en: 'English'
}

function isSupported(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as string[]).includes(value)
}

/**
 * 把操作系统 locale（如 `zh-CN`、`en-US`、`zh-Hant-TW`）归一化为受支持语言；
 * 只取基础语言段，未命中回退默认语言。大小写不敏感。
 */
export function normalizeLocale(locale: string): SupportedLanguage {
  const base = locale.trim().toLowerCase().split(/[-_]/)[0]
  return isSupported(base) ? base : DEFAULT_LANGUAGE
}

/** 把任意输入收敛为受支持语言；非受支持值一律回退默认。 */
export function coerceLanguage(value: unknown): SupportedLanguage {
  return typeof value === 'string' && isSupported(value) ? value : DEFAULT_LANGUAGE
}
