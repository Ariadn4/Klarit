/**
 * 多语言文本原语（`Localized`）：面向用户的文本字段承载「语言码→文本」的逐字段语言表，
 * 消费时按当前语言解析为单语言（回退：当前语言→英语→仅有的语言）。main 与 renderer 共享，无 fs 依赖。
 * 供规则包（rule-pack）与工作流（workflow）等复用；单独成模块以避免类型间循环依赖。
 */

import { coerceLanguage } from './language'

/** 逐字段语言表：语言码（开放字符串，如 zh/en/fr）→ 文本。可只含一种、可部分翻译。 */
export type Localized = Record<string, string>

/** 取语言表里第一个非空值（按插入顺序，确定性），无则 undefined。 */
function firstNonEmpty(field: Localized): string | undefined {
  for (const k of Object.keys(field)) {
    const v = field[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

/** 语言表是否至少含一种非空语言条目（校验"有内容"用）。 */
export function hasAnyLanguage(field: Localized | undefined): boolean {
  return !!field && firstNonEmpty(field) !== undefined
}

/**
 * 按当前语言把一个语言表解析为**单一语言**文本。回退链：当前语言 → 英语 `en` → 按顺序第一个非空。
 * `language` 先经 `coerceLanguage` 归一（不支持的语言回退默认）。逐字段独立调用；空表/缺省返回空串。
 */
export function resolveLocalized(field: Localized | undefined, language: string): string {
  if (!field) return ''
  const lang = coerceLanguage(language)
  const pick = (k: string): string | undefined => {
    const v = field[k]
    return typeof v === 'string' && v.trim() !== '' ? v : undefined
  }
  return pick(lang) ?? pick('en') ?? firstNonEmpty(field) ?? ''
}

/** 在语言表里设/删某语言的值：留空（trim 后为空）即剔除该键，不写空串。编辑器写回用。 */
export function setLocalized(field: Localized | undefined, lang: string, value: string): Localized {
  const next: Localized = { ...(field ?? {}) }
  if (value.trim() === '') delete next[lang]
  else next[lang] = value
  return next
}
