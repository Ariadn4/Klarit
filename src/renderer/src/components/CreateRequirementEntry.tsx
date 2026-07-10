import { Loader2, Pencil, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNewRequirementStore } from '../stores/newRequirement'

// 所有相位共用同一外框（虚线 stone 边、cobalt 文字、不变底色）——活动态只换图标+文案，保持低调。
const btnCls =
  'flex shrink-0 items-center justify-center gap-1.5 rounded border border-dashed border-stone-300 p-2 text-[12px] font-medium text-cobalt-500 hover:border-cobalt-500 hover:bg-cobalt-500/12'

/**
 * 「待办」列底部的新建需求入口——承载流程全程状态,是新建需求的唯一把手:
 * idle=「+ 创建」/ processing=转圈「建卡中」/ reviewing(收起)=「N 张候选待审阅」/ describing(收起)=「编辑中」。
 * 外框恒定、不变底色,仅图标+文案随相位变。任一非 idle 相点击都经 `openEntry` 重开对应浮窗(不另起分解)。
 */
export function CreateRequirementEntry(): React.JSX.Element {
  const { t } = useTranslation()
  const phase = useNewRequirementStore((s) => s.phase)
  const windowOpen = useNewRequirementStore((s) => s.windowOpen)
  const count = useNewRequirementStore((s) => s.reviewCards.length)
  const openEntry = useNewRequirementStore((s) => s.openEntry)

  // 相位 → 图标+文案。processing 无论浮窗开合都显「建卡中」;describing/reviewing 仅在收起时反映状态;其余回落 idle「+ 创建」。
  const { icon, label } =
    phase === 'processing'
      ? { icon: <Loader2 size={13} className="animate-spin" />, label: t('newRequirement.creatingCards') }
      : phase === 'reviewing' && !windowOpen
        ? {
            icon: <span className="h-1.5 w-1.5 rounded-full bg-cobalt-500" />,
            label: t('newRequirement.reviewPending', { count })
          }
        : phase === 'describing' && !windowOpen
          ? { icon: <Pencil size={13} />, label: t('newRequirement.editing') }
          : { icon: <Plus size={13} />, label: t('board.create') }

  // idle 的可读名沿用「新建需求」；活动态以其文案作可读名。
  const ariaLabel = phase === 'idle' || windowOpen ? t('newRequirement.entry') : label

  return (
    <button type="button" aria-label={ariaLabel} onClick={() => void openEntry()} className={btnCls}>
      {icon}
      {label}
    </button>
  )
}
