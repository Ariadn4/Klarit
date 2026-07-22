import { useEffect, useState } from 'react'
import type { AgentModel } from '@shared/agents'
import { inputClass } from './styles'

interface ModelComboboxProps {
  id: string
  ariaLabel: string
  /** 当前已生效的模型 id（空串＝未设置）。 */
  value: string
  /** 建议清单（别名在前）；弹层聚焦即展示**全部**条目，不按输入过滤（datalist 的前缀过滤会藏掉别名）。 */
  suggestions: AgentModel[]
  disabled?: boolean
  placeholder?: string
  /** 允许清空提交（工作流节点「跟随全局」用）；设置里的全局默认不允许清空。 */
  allowEmpty?: boolean
  /** 提交回调：点选建议 / 回车 / 失焦时触发（值未变不触发）；allowEmpty 时清空提交空串。 */
  onCommit: (modelId: string) => void
}

/**
 * 模型 combobox：可输任意模型 id + 自绘建议弹层。设置「默认模型」与工作流节点「执行模型」共用。
 */
export function ModelCombobox({
  id,
  ariaLabel,
  value,
  suggestions,
  disabled,
  placeholder,
  allowEmpty,
  onCommit
}: ModelComboboxProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  useEffect(() => setDraft(value), [value])

  const commit = (next: string): void => {
    const v = next.trim()
    if (v && v !== value) onCommit(v)
    else if (!v && allowEmpty && value) onCommit('')
    else setDraft(value) // 空输入（不允许清空时）不提交，回显当前值
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-label={ariaLabel}
        className={inputClass}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
        }}
        onBlur={() => {
          setOpen(false)
          commit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(draft)
            setOpen(false)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-stone-300 bg-paper py-1"
        >
          {suggestions.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === value}
              data-model-id={m.id}
              className="flex cursor-pointer items-baseline justify-between gap-2 px-2.5 py-1.5 text-[13px] text-ink hover:bg-canvas"
              // mousedown（而非 click）提交：click 前 input 已 blur 会先关弹层，preventDefault 保住这次点选。
              onMouseDown={(e) => {
                e.preventDefault()
                if (m.id !== value) onCommit(m.id)
                setDraft(m.id)
                setOpen(false)
              }}
            >
              <span className="font-medium">{m.id}</span>
              <span className="shrink-0 text-[12px] text-stone-500">{m.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
