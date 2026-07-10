import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * 可展开行（品牌规范第 12 章）：摘要行（前导槽·折叠箭头·标题·尾随槽）+ 缩进详情。
 * 受控：open / onToggle 由父用 useSingleOpen 协调，保证同列表最多展开一行。
 * 详情缩进 28px、各块靠 24px 间距分组（不画块间线）；展开时摘要行去掉下边线，与详情连成一体。
 * leading（拖拽柄）/ trailing（删除）在 toggle 按钮之外，点它们不会展开/收起。
 */
export function ExpandableRow({
  open,
  onToggle,
  summaryLabel,
  title,
  leading,
  trailing,
  children
}: {
  open: boolean
  onToggle: () => void
  /** 摘要切换按钮的可访问名（如「节点 写代码」）。 */
  summaryLabel: string
  title: React.ReactNode
  leading?: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    // hover 高亮整块（摘要 + 展开详情），而非只单行；底线在外层，展开时摘要与详情连成一体。
    <div className="border-b border-stone-100 hover:bg-stone-100/45">
      <div className="flex items-center gap-2 px-1 py-1.5">
        {leading}
        <button
          type="button"
          aria-expanded={open}
          aria-label={summaryLabel}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight size={14} className={`shrink-0 text-stone-600 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="flex-1 truncate text-[13px] font-medium text-ink">{title}</span>
        </button>
        {trailing}
      </div>
      {/* 块级流（非 flex）：字段自身 mb-4 与 space-y 折叠为 16px；flex+gap 会叠加成 32px */}
      {open && <div className="space-y-4 pb-3.5 pl-7 pr-1.5 pt-1">{children}</div>}
    </div>
  )
}

/** 手风琴协调：同一列表最多展开一行；再点已开行则收起。 */
export function useSingleOpen(): {
  openId: string | null
  toggle: (id: string) => void
  close: () => void
  isOpen: (id: string) => boolean
} {
  const [openId, setOpenId] = useState<string | null>(null)
  return {
    openId,
    toggle: (id) => setOpenId((cur) => (cur === id ? null : id)),
    close: () => setOpenId(null),
    isOpen: (id) => openId === id
  }
}
