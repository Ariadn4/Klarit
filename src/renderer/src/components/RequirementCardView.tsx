/**
 * 看板上的需求卡卡面：类型色条（标题上方，不显文案）+ 标题 + 运行圆点/状态 + 分支名。
 * 分支名**仅在引擎真正建出 worktree/分支后**才显示，且显示引擎实际用的分支名（取自运行断点，非预取名）。
 * 圆点（及后方文案）是智能入口：静止红→开详情定位决策；呼吸点→开详情定位当前命令输出。点卡其余处→开详情。
 */

import type { CardTypeDef, RunBreakpoint, StoredCard, WorkflowDefinition } from '@shared/types'
import { runDot } from '../lib/board'
import { RunStatusLine } from './RunStatusLine'
import { CardBranchChips } from './CardBranchChips'
import { cardDotClass } from './cardTypeColors'
import { useCardsStore } from '../stores/cards'

export function RequirementCardView({
  card,
  cardTypes,
  breakpoint,
  workflow
}: {
  card: StoredCard
  cardTypes: CardTypeDef[]
  breakpoint: RunBreakpoint | null
  workflow: WorkflowDefinition | null
}): React.JSX.Element {
  const openDetail = useCardsStore((s) => s.openDetail)
  const type = cardTypes.find((tp) => tp.id === card.typeId)
  const dot = runDot(breakpoint, workflow)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openDetail(card.proposedName)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openDetail(card.proposedName)
      }}
      className="shrink-0 cursor-pointer rounded-card border border-stone-300 bg-paper p-2.5 text-[12px] hover:border-cobalt-300"
    >
      {/* 类型色条（标题上方，不显文案，仅以颜色表达类型）。 */}
      {type && (
        <span
          aria-label={type.name}
          title={type.name}
          className={`mb-1.5 block h-1.5 w-8 rounded-full ${cardDotClass(type.color)}`}
        />
      )}

      <div className="truncate font-medium text-ink">{card.title}</div>

      {/* 运行圆点 + 当前节点 + (细状态)；点击定位详情对应区域。无运行时显示生命周期状态。 */}
      {dot ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openDetail(card.proposedName, dot.state === 'waiting-decision' ? 'decision' : 'output')
          }}
          className="mt-1.5 flex w-full items-center rounded text-left hover:bg-stone-100"
        >
          <RunStatusLine breakpoint={breakpoint} workflow={workflow} fallbackStatus={card.status} />
        </button>
      ) : (
        <div className="mt-1.5 text-[11px] text-stone-600">
          <RunStatusLine breakpoint={breakpoint} workflow={workflow} fallbackStatus={card.status} />
        </div>
      )}

      {/* 逐成员仓已建分支条目（内联平铺，标签「成员仓名/分支名」）：分支一建即显；点条目切 git 视图定位其分支 worktree（无则空态）。 */}
      <div className="mt-1.5 empty:mt-0">
        <CardBranchChips card={card} breakpoint={breakpoint} />
      </div>
    </div>
  )
}
