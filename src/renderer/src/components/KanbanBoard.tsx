import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CardTypeDef, RunBreakpoint, StoredCard, WorkflowDefinition } from '@shared/types'
import { buildBoardColumns, cardColumn } from '../lib/board'
import { BoardColumn } from './BoardColumn'
import { CreateRequirementEntry } from './CreateRequirementEntry'
import { RequirementCardView } from './RequirementCardView'

interface KanbanBoardProps {
  /** 当前项目激活工作流的定义；null＝未激活或定义缺失（只渲染两列书挡）。 */
  activeWorkflow: WorkflowDefinition | null
  /** 当前项目的需求卡。 */
  cards: StoredCard[]
  /** 项目类型集（算 archetype 与徽章）。 */
  cardTypes: CardTypeDef[]
  /** runId → 最新断点（算列定位与圆点）。 */
  runs: Record<string, RunBreakpoint>
}

/**
 * 项目窗口主面板的需求看板：列 = 「待办」书挡 + 激活工作流各阶段（按序）+「已完成」书挡。
 * 卡按 `cardColumn` 派生入列（container 停待办、leaf 按当前节点 stage 流动、完成进已完成）。仅用语义令牌。
 */
export function KanbanBoard({
  activeWorkflow,
  cards,
  cardTypes,
  runs
}: KanbanBoardProps): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const columns = buildBoardColumns(activeWorkflow, {
    todo: t('board.todo'),
    done: t('board.done')
  })

  const archetypeOf = useCallback(
    (typeId: string) => cardTypes.find((tp) => tp.id === typeId)?.archetype ?? 'leaf',
    [cardTypes]
  )

  // 每张卡 → 列 key（含 container 的「子卡全归档→已完成」判定）。
  const byColumn = useMemo(() => {
    const map: Record<string, StoredCard[]> = {}
    for (const card of cards) {
      const bp = card.activeRunId ? runs[card.activeRunId] : null
      const archetype = archetypeOf(card.typeId)
      const allChildrenDone =
        archetype === 'container'
          ? (() => {
              const kids = cards.filter((c) =>
                c.relations.some((r) => r.kind === 'parent' && r.target === card.proposedName)
              )
              return kids.length > 0 && kids.every((c) => c.status === '已完成')
            })()
          : false
      const key = cardColumn(
        {
          archetype,
          status: card.status,
          hasActiveRun: !!card.activeRunId,
          currentNodeId: bp?.currentNodeId ?? null,
          runDone: bp?.state === 'done'
        },
        activeWorkflow,
        { allChildrenDone }
      )
      ;(map[key] ??= []).push(card)
    }
    return map
  }, [cards, runs, activeWorkflow, archetypeOf])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return
    let n = e.target as HTMLElement | null
    while (n && n !== el) {
      if (n.scrollHeight > n.clientHeight) {
        const atTop = n.scrollTop <= 0
        const atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight
        if (!(e.deltaY < 0 ? atTop : atBottom)) return
      }
      n = n.parentElement
    }
    el.scrollLeft += e.deltaY
  }, [])

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      className="board-scroll absolute inset-x-0 top-0 bottom-7 overflow-x-auto overflow-y-hidden"
    >
      <div className="flex h-full w-max gap-2.5 p-2.5">
        {columns.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            createSlot={column.kind === 'todo' ? <CreateRequirementEntry /> : undefined}
          >
            {(byColumn[column.key] ?? []).map((card) => (
              <RequirementCardView
                key={card.proposedName}
                card={card}
                cardTypes={cardTypes}
                breakpoint={card.activeRunId ? (runs[card.activeRunId] ?? null) : null}
                workflow={activeWorkflow}
              />
            ))}
          </BoardColumn>
        ))}
      </div>
    </div>
  )
}
