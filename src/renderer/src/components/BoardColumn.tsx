import type { BoardColumn as BoardColumnModel } from '../lib/board'

interface BoardColumnProps {
  column: BoardColumnModel
  /** 列体底部槽位：「待办」列由此承载新建需求入口（CreateRequirementEntry）；仅在传入时渲染。 */
  createSlot?: React.ReactNode
  /** 列体顶部额外内容（如需求卡）。 */
  children?: React.ReactNode
}

/**
 * 看板的一列：列头（列名）+ 列体。列体顶部承载需求卡（children），底部承载注入的 createSlot。
 * 本组件保持纯展示——不感知新建需求流程状态。仅用语义令牌、深浅双主题。
 */
export function BoardColumn({ column, createSlot, children }: BoardColumnProps): React.JSX.Element {
  return (
    <section
      aria-label={column.title}
      className="flex w-72 shrink-0 flex-col rounded-card border border-stone-100 bg-canvas"
    >
      <header className="border-b border-stone-100 px-3 py-2.5">
        <h2 className="truncate text-[12px] font-semibold text-ink">{column.title}</h2>
      </header>

      {/* 列体：顶部挂需求卡（children），底部挂注入槽位（createSlot，如「待办」列的新建入口）。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5">
        {children}
        <div className="min-h-0 flex-1" />
        {createSlot}
      </div>
    </section>
  )
}
