/**
 * 一键复制小按钮：把给定文本写入系统剪贴板（经 Electron clipboard 通道 `window.klarit.copyText`），
 * 点后短暂显示「已复制」再复原。空文本不渲染。定位由父组件传 `className`（如浮于输出框右上角）。
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ text, className = '' }: { text: string; className?: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  if (!text) return null

  const onCopy = async (): Promise<void> => {
    await window.klarit.copyText(text)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  const label = copied ? t('board.copied') : t('board.copy')
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={label}
      aria-label={label}
      className={`rounded border border-stone-300 bg-paper p-1 ${copied ? 'text-cobalt-600' : 'text-stone-600'} hover:bg-stone-100 hover:text-ink ${className}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}
