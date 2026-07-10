import type { Localized } from '@shared/localized'
import { resolveLocalized, setLocalized } from '@shared/localized'
import { inputClass } from './styles'

/**
 * 一个可翻字段的**单栏编辑**：只编辑当前所选语言 `lang`。该语言留空即从语言表剔除（不写空串）；
 * 留空时以其它语言的**回退值作灰色占位**（仅提示、不预填、不写入）——真值始终是 `value[lang]`，
 * 绝不把回退值当真值填进输入框，避免保存时把别的语言复制进当前语言。
 */
export function LocalizedTextInput({
  value,
  lang,
  multiline = false,
  ariaLabel,
  placeholder,
  onChange
}: {
  value: Localized | undefined
  lang: string
  multiline?: boolean
  ariaLabel: string
  placeholder?: string
  onChange: (next: Localized) => void
}): React.JSX.Element {
  const field = value ?? {}
  const current = field[lang] ?? ''
  // 当前语言为空时，用其它语言的回退值作占位（灰色提示，非真实值）。
  const fallback = current.trim() === '' ? resolveLocalized(field, lang) : ''
  const common = {
    value: current,
    'aria-label': ariaLabel,
    placeholder: fallback || placeholder || '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(setLocalized(field, lang, e.target.value))
  }
  return multiline ? (
    <textarea className={`${inputClass} min-h-16`} {...common} />
  ) : (
    <input className={inputClass} {...common} />
  )
}
