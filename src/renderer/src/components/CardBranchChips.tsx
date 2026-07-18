/**
 * 逐成员仓「已建分支」条目（chip）：以「成员仓名/分支名」标识，内联平铺。
 * 门控＝该成员仓本地分支已建出（分支一建即显，不等 worktree）；有运行才探测。
 * 点某条目 → 侧栏切 git 视图并聚焦到 (该成员仓, 该分支)。卡面与详情抽屉共用同一份。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import type { CardBranch, RunBreakpoint, StoredCard } from '@shared/types'

export function CardBranchChips({
  card,
  breakpoint
}: {
  card: StoredCard
  breakpoint: RunBreakpoint | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
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

  if (branches.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
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
  )
}
