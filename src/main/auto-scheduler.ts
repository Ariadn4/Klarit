/**
 * 待办自动排程回路（主进程常驻）：把待办列里**有资格**的 leaf 卡自动拉起运行，自动并发上限 3，槽没满贪心补满。
 * 触发点由 main 接线（运行 `done` / 卡进待办）后调 `evaluate()`。本模块只做决策与启动编排，**不碰引擎内部**：
 * 启动复用注入的 `startCard`（= 既有"派生运行请求 → engine.start → 建双向链"接缝）。
 *
 * 并发上限约束的是**一切系统自动发起的运行**：本回路拉起的 + 定时巡检拉起的（见 `scheduled-patrol`），
 * 二者共享同一上限与同一 `isRunLive` 判定（巡检运行经 `listPatrolRuns` 注入）。手动启动仍不受约束。
 *
 * 资格/粗筛/规划纯逻辑在 `shared/auto-schedule.ts`；冲突细判 agent 在 `conflict-rank-producer.ts`（可降级）。
 * `evaluate()` **串行化**：同一时刻至多一个评估在跑，评估间的新触发合并为一次补评估，防同卡双启。
 */

import type { Project, StoredCard } from '../shared/types'
import type { TypeArchetypeMap } from '../shared/card-type'
import { isAutoEligible, planFills } from '../shared/auto-schedule'

export interface AutoSchedulerDeps {
  /** 当前（绑定）项目的全部卡。 */
  listCards: () => StoredCard[]
  /** 当前绑定项目；未绑定返回 null（排程空转）。 */
  getProject: () => Project | null
  /** 当前项目的类型注册表（typeId→archetype）。 */
  getRegistry: () => TypeArchetypeMap
  /** 卡能否派生出有效运行请求（= `deriveRunRequest(card, project).ok`）。 */
  canDerive: (card: StoredCard, project: Project) => boolean
  /** 某运行是否仍活跃（running/paused/waiting-decision）；done/aborted/未知 → false。单一真相来源。 */
  isRunLive: (runId: string) => boolean
  /** 启动一张卡的运行：复用既有 `cardsRun` 接缝（派生 + engine.start + 置双向链 + 卡进「进行中」）。 */
  startCard: (card: StoredCard) => void
  /**
   * 定时巡检拉起的运行（runId + 涉及成员仓，见 `scheduled-patrol`）；缺省视为无。
   * 上限约束的是**一切系统自动发起的运行**——排程发起与巡检发起共享同一上限、同一 `isRunLive`。
   * 巡检运行不绑卡（故不在 `listCards` 里），但同样占槽、同样参与「与在跑不共享仓者优先」的选取。
   */
  listPatrolRuns?: () => Array<{ runId: string; repos: string[] }>
  /** 自动并发上限；缺省 3。 */
  maxConcurrent?: number
}

export interface AutoScheduler {
  /** 重新评估待办列并按规则填槽（活跃<上限时）。串行化、可重入合并、永不抛。 */
  evaluate: () => Promise<void>
  /** 当前还剩几个自动并发槽（既成超额时为 0，不为负）。巡检发起前查它，口径与本回路完全一致。 */
  freeSlots: () => number
}

export function createAutoScheduler(deps: AutoSchedulerDeps): AutoScheduler {
  const max = deps.maxConcurrent ?? 3
  let evaluating = false
  let pending = false

  /**
   * 当前占槽的**全部自动运行**：绑卡且运行仍活的卡 + 巡检拉起且仍活的运行。
   * 两者只看 `repos`（填槽规则的输入），故可同列。
   */
  function runningNow(cards: StoredCard[]): Array<{ repos: string[] }> {
    const byCard = cards.filter((c) => c.activeRunId && deps.isRunLive(c.activeRunId))
    const byPatrol = (deps.listPatrolRuns?.() ?? []).filter((r) => deps.isRunLive(r.runId))
    return [...byCard, ...byPatrol]
  }

  function freeSlots(): number {
    return Math.max(0, max - runningNow(deps.listCards()).length)
  }

  async function runOnce(): Promise<void> {
    const project = deps.getProject()
    if (!project) return
    const cards = deps.listCards()
    const running = runningNow(cards)
    const free = max - running.length
    if (free <= 0) return

    const registry = deps.getRegistry()
    const byId = new Map(cards.map((c) => [c.proposedName, c]))
    // 有资格候选，按入列顺序（createdAt 升序、同刻按 id）稳定排序。
    const eligible = cards
      .filter((c) => isAutoEligible(c, byId, registry, deps.canDerive(c, project)))
      .sort((a, b) => a.createdAt - b.createdAt || a.proposedName.localeCompare(b.proposedName))
    if (eligible.length === 0) return

    // 确定性即时填槽：与在跑不共享仓者优先、其余按序，填满空槽。无 agent、无 await 外部。
    const toStart = planFills(free, eligible, running)
    for (const c of toStart) {
      // 现算现防：手动启动/巡检可能在 await 期间抢了槽，逐个启动前重核上限。
      if (freeSlots() <= 0) break
      deps.startCard(c)
    }
  }

  async function evaluate(): Promise<void> {
    if (evaluating) {
      pending = true
      return
    }
    evaluating = true
    try {
      do {
        pending = false
        try {
          await runOnce()
        } catch {
          // 排程永不因单次评估异常而停摆。
        }
      } while (pending)
    } finally {
      evaluating = false
    }
  }

  return { evaluate, freeSlots }
}
