import { Plus } from 'lucide-react'

/**
 * 列表编辑器「头 + 行」容器（品牌规范第 12 章）。
 * 头：标题（一级 13/600/ink，二级 12）+ 可选描述 + 计数（仅 >0 显示）；一级头底 stone-300 线。
 * 行由调用方用 <ListRow> 组合；行间发丝线。「加」是末行小按钮（左对齐、hover 只高亮自身）。
 * 二级用于展开详情内的子列表：标题更小、头无底线，整体缩进由父详情负责。
 */
export function ListEditor({
  title,
  description,
  count,
  level = 1,
  addLabel,
  onAdd,
  headAction,
  children
}: {
  title: string
  description?: string
  count: number
  level?: 1 | 2
  addLabel?: string
  onAdd?: () => void
  /** 头部右侧的库级动作（如「导入」「预览」）；与计数并排。 */
  headAction?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <div
        className={
          level === 1
            ? 'border-b border-stone-300 px-1 pb-[7px] pt-[5px]'
            : 'border-b border-stone-100 px-1 pb-1.5 pt-0.5'
        }
      >
        <div className="flex items-center gap-2">
          <span className={`font-semibold text-ink ${level === 1 ? 'text-[13px]' : 'text-[12px]'}`}>{title}</span>
          <span className="flex-1" />
          {headAction}
          {count > 0 && (
            <span data-testid="list-count" className="rounded-pill bg-stone-100 px-1.5 py-px font-mono text-[10px] text-stone-600">
              {count}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-[12px] leading-normal text-stone-600">{description}</p>}
      </div>
      {children}
      {onAdd && addLabel && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded px-2 py-[3px] text-[13px] font-medium text-cobalt-500 hover:bg-cobalt-500/12"
        >
          <Plus size={13} />
          {addLabel}
        </button>
      )}
    </div>
  )
}

/** 列表行：仅发丝线分隔，无盒；可选序号（纯数字、不带 #）。 */
export function ListRow({
  ordinal,
  align = 'center',
  children
}: {
  ordinal?: number
  /** start 用于含 textarea 的行（序号与首行对齐）。 */
  align?: 'center' | 'start'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`flex gap-2 border-b border-stone-100 px-1 py-1.5 hover:bg-stone-100/45 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      {ordinal !== undefined && (
        <span className={`w-4 shrink-0 text-center font-mono text-[11px] text-stone-600 ${align === 'start' ? 'pt-1.5' : ''}`}>
          {ordinal}
        </span>
      )}
      {children}
    </div>
  )
}
