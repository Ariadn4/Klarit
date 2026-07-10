import { GripVertical, ChevronUp, ChevronDown, ChevronLeft } from 'lucide-react'

// hover 提示用简洁动作（「删除」「编辑」），不带对象名。中文动作与对象名连写、无空格分隔，
// 故先按已知动作词前缀取；英文动作是独立单词，回退取首个空格前。aria-label 仍是完整具体名。
const ACTION_VERBS = ['删除', '编辑', '克隆', '复制', '导出', '导入', '预览', '查看', '移除', '重命名', '新建', '添加']
function conciseAction(label: string): string {
  return ACTION_VERBS.find((v) => label.startsWith(v)) ?? label.split(' ')[0]
}

/** 详情视图返回：统一的返回 chevron 图标按钮（无文字）。置于详情视图顶部、与「关闭」同行。 */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
    >
      <ChevronLeft size={18} />
    </button>
  )
}

/** 图标按钮（品牌规范第 06/08 章）：26×26、hover 底色、danger 变体；纯图标必须给 label。 */
export function IconButton({
  label,
  tooltip,
  onClick,
  danger = false,
  disabled = false,
  children
}: {
  /** 完整具体名（如「删除 Epic」），用作 aria-label 给读屏。 */
  label: string
  /** hover 文字提示（title）。缺省取 label 的简洁动作部分（首个空格前，即去掉对象名）。 */
  tooltip?: string
  onClick?: (e: React.MouseEvent) => void
  danger?: boolean
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  // hover 用简洁动作（删除/编辑/克隆…），不带对象名；可达性靠完整 aria-label。
  const tip = tooltip ?? conciseAction(label)
  return (
    <button
      type="button"
      aria-label={label}
      title={tip}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded text-stone-600 disabled:cursor-default disabled:opacity-35 ${
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-stone-100 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** 拖拽柄：grip 点阵、stone-300、cursor grab。把 dnd-kit 的 attributes/listeners 透传进来。 */
export function DragHandle({
  label = '拖拽排序',
  attributes,
  listeners,
  onMouseDown
}: {
  label?: string
  attributes?: Record<string, unknown>
  listeners?: Record<string, unknown>
  onMouseDown?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className="grid h-[26px] w-[26px] shrink-0 cursor-grab place-items-center text-stone-300 hover:text-stone-600"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} />
    </button>
  )
}

/** 上下箭头排序（次选；与拖拽柄择一）。首行 ▲ / 末行 ▼ 置灰。 */
export function ReorderArrows({
  onUp,
  onDown,
  canUp,
  canDown,
  labelUp = '上移',
  labelDown = '下移'
}: {
  onUp: () => void
  onDown: () => void
  canUp: boolean
  canDown: boolean
  labelUp?: string
  labelDown?: string
}): React.JSX.Element {
  const btn = 'grid h-[13px] w-[18px] place-items-center rounded-[3px] text-stone-600 hover:bg-stone-100 hover:text-ink disabled:cursor-default disabled:opacity-30'
  return (
    <span className="inline-flex shrink-0 flex-col">
      <button type="button" aria-label={labelUp} title={labelUp} className={btn} disabled={!canUp} onClick={onUp}>
        <ChevronUp size={11} />
      </button>
      <button type="button" aria-label={labelDown} title={labelDown} className={btn} disabled={!canDown} onClick={onDown}>
        <ChevronDown size={11} />
      </button>
    </span>
  )
}
