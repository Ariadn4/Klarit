/**
 * 看板上的需求卡卡面：类型色条（标题上方，不显文案）+ 标题 + 运行圆点/状态 + 分支名。
 * 分支名**仅在引擎真正建出 worktree/分支后**才显示，且显示引擎实际用的分支名（取自运行断点，非预取名）。
 * 圆点（及后方文案）是智能入口：静止红→开详情定位决策；呼吸点→开详情定位当前命令输出。点卡其余处→开详情。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Pause } from 'lucide-react'
import type { CardBranch, CardTypeDef, RunBreakpoint, StoredCard, WorkflowDefinition } from '@shared/types'
import { runDot } from '../lib/board'
import { RunDot } from './RunDot'
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
  const { t } = useTranslation()
  const openDetail = useCardsStore((s) => s.openDetail)
  const type = cardTypes.find((tp) => tp.id === card.typeId)
  const dot = runDot(breakpoint, workflow)

  // 逐成员仓已建分支条目：门控=该成员仓本地分支已建出（分支一建即显，不等 worktree）。有运行才探测。
  const [branches, setBranches] = useState<CardBranch[]>([])
  useEffect(() => {
    if (!card.activeRunId) {
      setBranches([])
      return
    }
    let alive = true
    void window.klarit.cardBranches(card.proposedName).then((bs) => {
      if (alive) setBranches(bs)
    })
    return () => {
      alive = false
    }
  }, [card.activeRunId, card.proposedName, breakpoint?.currentNodeId, breakpoint?.phase])

  // 圆点后方括号细状态：工作中/检查中，或等待决策时取决策背景文案。
  const subLabel =
    dot?.state === 'waiting-decision'
      ? breakpoint?.pendingDecision
        ? t(breakpoint.pendingDecision.titleKey, breakpoint.pendingDecision.titleParams)
        : t('board.decisionWaiting')
      : dot?.state === 'checking'
        ? t('board.checking')
        : dot?.state === 'working'
          ? t('board.working')
          : ''

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
          className="mt-1.5 flex w-full items-center gap-1.5 rounded text-left hover:bg-stone-100"
        >
          <RunDot dot={dot} />
          {/* 暂停：单独一个暂停图标表示，不改圆点颜色/括号文案。 */}
          {dot.paused && <Pause size={11} className="shrink-0 fill-stone-600 text-stone-600" aria-label={t('board.status.已暂停')} />}
          <span className="truncate text-[11px] text-stone-600">
            {dot.nodeLabel}
            {subLabel ? `（${subLabel}）` : ''}
          </span>
        </button>
      ) : (
        <div className="mt-1.5 text-[11px] text-stone-600">{t(`board.status.${card.status}`)}</div>
      )}

      {/* 逐成员仓已建分支条目（内联平铺，标签「成员仓名/分支名」）：分支一建即显；点条目切 git 视图定位其分支 worktree（无则空态）。 */}
      {branches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
          {branches.map((b) => (
            <button
              key={b.memberId}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void window.klarit.focusCardGitView(card.proposedName, b.memberId)
              }}
              className="flex max-w-[12rem] items-center gap-0.5 truncate rounded bg-stone-100 px-1.5 py-0.5 text-cobalt-500 hover:bg-stone-200"
              title={t('board.openWorktree', { name: `${b.name}/${b.branch}` })}
            >
              <GitBranch size={11} className="shrink-0" />
              <span className="truncate">
                {b.name}/{b.branch}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
