import { useEffect, useRef, useState } from 'react'
import { Pencil, ChevronDown } from 'lucide-react'
import { inputClass } from './styles'

/**
 * 逐块行内编辑（品牌规范第 12 章「逐块行内编辑」）。
 * 静息显示只读文本；hover 末尾浮现 ✏（文本）/ ▾（下拉）；点击或键盘 Enter/Space 就地变控件并聚焦；
 * 失焦或回车提交、Esc 取消。每个 cell 独立，互不影响同行其它块。
 */
export function InlineCell({
  value,
  display,
  variant = 'text',
  ariaLabel,
  mono = false,
  placeholder,
  options,
  grow = false,
  autoEditEmpty = false,
  validate,
  onCommit
}: {
  value: string
  /** 只读态显示文本（默认 = value）；select 用来显示选项 label。 */
  display?: string
  variant?: 'text' | 'select'
  ariaLabel: string
  mono?: boolean
  placeholder?: string
  /** variant=select 时的选项。 */
  options?: { value: string; label: string }[]
  /** flex-1 撑满（如名称/路径列）。 */
  grow?: boolean
  /** 新增的空行直接进入编辑态（可立即输入，无需先点一下）。 */
  autoEditEmpty?: boolean
  /** 校验当前草稿：返回 false 时输入框标 aria-invalid 并描红（如路径必须相对）。 */
  validate?: (v: string) => boolean
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(autoEditEmpty && value === '')
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const invalid = validate ? !validate(draft) : false
  // 编辑控件直接复用全局 inputClass（h-8），与节点名/下拉等所有输入框完全等高；只读块也是 h-8，切换不撑高行。
  const editCls = inputClass

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      if (ref.current instanceof HTMLInputElement) ref.current.select()
    }
  }, [editing])

  const start = (): void => {
    setDraft(value)
    setEditing(true)
  }
  const commit = (): void => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  const cancel = (): void => {
    setEditing(false)
    setDraft(value)
  }

  if (!editing) {
    return (
      <span className={`inline-flex min-w-0 items-center ${grow ? 'flex-1' : ''}`}>
        <span
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          onClick={start}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              start()
            }
          }}
          className={`group inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded px-2 hover:bg-stone-100/55 ${grow ? 'flex-1' : ''}`}
        >
          <span
            className={`truncate ${mono ? 'font-mono text-[12px]' : 'text-[13px]'} ${variant === 'select' ? 'text-stone-600' : 'text-ink'}`}
          >
            {display ?? value}
          </span>
          {variant === 'select' ? (
            <ChevronDown size={13} className="hidden shrink-0 text-stone-600 group-hover:block" aria-hidden="true" />
          ) : (
            <Pencil size={12} className="hidden shrink-0 text-stone-600 group-hover:block" aria-hidden="true" />
          )}
        </span>
      </span>
    )
  }

  if (variant === 'select') {
    return (
      <span className={`inline-flex min-w-0 ${grow ? 'flex-1' : ''}`}>
        <select
          ref={ref as React.RefObject<HTMLSelectElement>}
          aria-label={ariaLabel}
          className={`${editCls} cursor-pointer`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    )
  }

  return (
    <span className={`inline-flex min-w-0 ${grow ? 'flex-1' : ''}`}>
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        aria-label={ariaLabel}
        aria-invalid={validate ? invalid : undefined}
        placeholder={placeholder}
        className={`${editCls} ${mono ? 'font-mono text-[12px]' : ''} ${invalid ? 'border-danger focus:border-danger' : ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
      />
    </span>
  )
}
