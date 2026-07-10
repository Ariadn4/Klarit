import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { CardColorKey } from '@shared/types'
import { CARD_COLOR_KEYS } from '@shared/card-type'
import { cardDotClass } from './cardTypeColors'

/** 专门的颜色选择器：触发器显示当前色圆点，点开弹出圆形色板选择。CardTypeLibrary 与 WorkflowEditor 共用。 */
export function CardColorPicker({
  value,
  onChange
}: {
  value: CardColorKey
  onChange: (c: CardColorKey) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('cardTypeLibrary.colorLabel')}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded border border-stone-300 bg-canvas px-2 hover:border-cobalt-500"
      >
        <span className={`h-4 w-4 rounded-full ${cardDotClass(value)}`} />
        <ChevronDown size={14} className="text-stone-600" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('cardTypeLibrary.colorLabel')}
          className="absolute left-0 top-full z-10 mt-1 flex w-max max-w-[200px] flex-wrap gap-2 rounded-card border border-stone-100 bg-paper p-2"
        >
          {CARD_COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={value === c}
              aria-label={t('cardTypeLibrary.colorSwatchAria', { color: c })}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className={`h-6 w-6 rounded-full ${cardDotClass(c)} ${value === c ? 'ring-2 ring-cobalt-500 ring-offset-2 ring-offset-paper' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
