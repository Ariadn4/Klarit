import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { Save } from 'lucide-react'
import { BackButton, IconButton } from './controls'

/**
 * 设置面板顶栏插槽：让内部视图（工作流编辑器、各详情页）把「返回 / 保存」渲染到与「关闭(X)」同一行。
 * 值是设置面板顶栏里预留的 DOM 容器；为 null 时（如单元测试里独立渲染）回退为自带顶栏。
 */
export const SettingsHeaderSlotContext = createContext<HTMLElement | null>(null)

/**
 * 顶栏操作条：有插槽时把 children 传送进设置面板顶栏（与 X 同行）；无插槽时自带一条贴顶的 bar。
 * children 约定为「左侧返回 + 右侧操作」两组，靠 justify-between 分列。
 */
export function HeaderActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  const slot = useContext(SettingsHeaderSlotContext)
  if (slot) return <>{createPortal(children, slot)}</>
  return <div className="flex items-center justify-between border-b border-stone-100 px-2 py-1.5">{children}</div>
}

/**
 * 详情/编辑视图统一顶栏（品牌规范第 12 章「详情返回」）：左 chevron 返回、右 保存。
 * 通过 HeaderActions 渲染到设置面板顶栏（与关闭 X 同行）；标签由调用方传入（i18n）。
 * 保存统一为图标按钮（IconButton：原生 title 悬浮提示 + aria-label，无任何装饰小箭头/caret，
 * 读屏只念「保存」），整套设置界面复用，禁止各处自画。
 */
export function DetailHeader({
  backLabel,
  onBack,
  onSave,
  saved = false,
  saveLabel,
  savedLabel,
  extraActions
}: {
  backLabel: string
  onBack: () => void
  /** 省略则只有返回（无保存按钮）。 */
  onSave?: () => void
  saved?: boolean
  saveLabel?: string
  savedLabel?: string
  /** 右侧附加操作（渲染在保存按钮左侧、同一行）；按需由具体详情页传入（如 agent 节点的「查看完整 prompt」）。 */
  extraActions?: React.ReactNode
}): React.JSX.Element {
  return (
    <HeaderActions>
      <BackButton label={backLabel} onClick={onBack} />
      {(onSave || extraActions) && (
        <div className="flex items-center gap-2">
          {extraActions}
          {saved && savedLabel && <span className="text-[12px] font-medium text-success">{savedLabel}</span>}
          {onSave && (
            <IconButton label={saveLabel ?? '保存'} tooltip={saveLabel} onClick={onSave}>
              <Save size={16} />
            </IconButton>
          )}
        </div>
      )}
    </HeaderActions>
  )
}
