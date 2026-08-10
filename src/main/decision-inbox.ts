/**
 * 决策收件箱（主进程投影，**不落盘、不双写**）：条目 = 一个正等待用户拍板的运行。
 *
 * 唯一真相源仍是 `RunBreakpoint.pendingDecision`——本模块只是它的索引：
 * - **增量**：订阅既有 `onEngineProgress`。`decision` 事件 upsert；其余事件校核该运行的断点，
 *   决策已被回应 / 运行终局 / 断点消失 → 移除。任何让 `pendingDecision` 变化的路径都自动反映到这里，
 *   不需要在那些路径上加同步代码。
 * - **重建**：进程启动、切换项目时由注入的断点全量列表重算，只取 `pendingDecision !== null` 者。
 *
 * 项目范围由注入的 `listCards` 界定：条目必须能对应到当前项目某张卡（按 `activeRunId` 反查），
 * 未绑定项目（`listCards()` 返回 null）时恒空。
 *
 * 通知只为**新增**条目发，且只在应用未聚焦、设置开关未关时发；`rebuild()` 出来的存量条目不发。
 * 真正发通知的动作由 `notify` 注入（本模块只做门控与判新）。
 *
 * 本模块**永不抛**：任一数据源异常都退化为「这次不更新」，绝不拖垮引擎事件回路。
 */

import type { EngineProgressEvent, RunBreakpoint, StoredCard } from '../shared/types'
import { sortInbox, toInboxEntry, type DecisionInboxEntry } from '../shared/decision-inbox'

export interface DecisionInboxDeps {
  /** 订阅引擎进度事件；返回取消订阅函数。 */
  onEngineProgress: (handler: (evt: EngineProgressEvent) => void) => () => void
  /** 全量列出运行断点（= `run-store.list()`）——重建用。 */
  listBreakpoints: () => RunBreakpoint[]
  /** 取某运行的最新断点（增量校核用）；未知返回 null。 */
  getBreakpoint: (runId: string) => RunBreakpoint | null
  /** 当前项目的全部需求卡；窗口未绑定项目时返回 null（收件箱恒空）。 */
  listCards: () => StoredCard[] | null
  /** 断点缺 `pendingSince`（老数据）时的次优时刻，如该运行 run-store 文件的 mtime。 */
  fallbackSince?: (runId: string) => number | undefined
  /** 收件箱内容变化后回调（推给渲染层刷新列表与徽标）。 */
  onChange?: (entries: DecisionInboxEntry[]) => void
  /** 应用窗口当前是否聚焦；聚焦时不发通知。缺省视为未聚焦。 */
  isFocused?: () => boolean
  /** 决策通知开关（设置项）；缺省视为开。 */
  notifyEnabled?: () => boolean
  /** 真正发一条桌面通知（注入式，测试可桩）。 */
  notify?: (entry: DecisionInboxEntry) => void
}

export interface DecisionInbox {
  /** 当前条目（按等最久在前排序）。 */
  list: () => DecisionInboxEntry[]
  /**
   * 由断点全量列表重算（进程启动 / 切项目 / 卡链变化）；**不发通知**。
   * 新建的收件箱是空的——建好后由调用方显式 `rebuild()` 装填，生命周期不隐式起步。
   */
  rebuild: () => void
  /** 取消订阅引擎事件。 */
  dispose: () => void
}

export function createDecisionInbox(deps: DecisionInboxDeps): DecisionInbox {
  /** runId → 条目。收件箱的全部状态，仅此一份，纯内存。 */
  const entries = new Map<string, DecisionInboxEntry>()

  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }

  const snapshot = (): DecisionInboxEntry[] => sortInbox([...entries.values()])

  const since = (runId: string): number =>
    safe(() => deps.fallbackSince?.(runId), undefined) ?? 0

  /** 当前项目里绑定该运行的卡；未绑定项目 / 该运行不属本项目 → null。 */
  function cardOf(runId: string): StoredCard | null {
    const cards = safe(() => deps.listCards(), null)
    return cards?.find((c) => c.activeRunId === runId) ?? null
  }

  function emitChange(): void {
    safe(() => deps.onChange?.(snapshot()), undefined)
  }

  /** 未聚焦 + 开关开 → 发一条通知。永不抛。 */
  function maybeNotify(entry: DecisionInboxEntry): void {
    if (safe(() => deps.isFocused?.() ?? false, false)) return
    if (!safe(() => deps.notifyEnabled?.() ?? true, true)) return
    safe(() => deps.notify?.(entry), undefined)
  }

  /**
   * 按最新断点校核某运行：仍在等决策则 upsert，否则移除。`announce` 为真时，新出现的条目会触发通知。
   * 已有条目走「按 runId 直查断点」的廉价路径；未见过的条目才去卡列表里反查归属。
   */
  function refresh(runId: string, announce: boolean): void {
    const known = entries.get(runId)
    const bp = safe(() => deps.getBreakpoint(runId), null)
    if (!bp || !bp.pendingDecision) {
      if (known) {
        entries.delete(runId)
        emitChange()
      }
      return
    }
    const card = known
      ? { proposedName: known.cardId, title: known.cardName }
      : cardOf(runId)
    if (!card) return // 不属当前项目任何卡 → 不进收件箱
    const next = toInboxEntry(bp, card, since(runId))
    if (!next) return
    entries.set(runId, next)
    if (!known && announce) maybeNotify(next)
    if (!known || known.source !== next.source || known.pendingSince !== next.pendingSince) emitChange()
  }

  function rebuild(): void {
    const cards = safe(() => deps.listCards(), null)
    const next = new Map<string, DecisionInboxEntry>()
    if (cards) {
      const byRun = new Map<string, StoredCard>()
      for (const c of cards) if (c.activeRunId) byRun.set(c.activeRunId, c)
      for (const bp of safe(() => deps.listBreakpoints(), [] as RunBreakpoint[])) {
        const card = byRun.get(bp.runId)
        if (!card) continue
        const entry = toInboxEntry(bp, card, since(bp.runId))
        if (entry) next.set(bp.runId, entry)
      }
    }
    entries.clear()
    for (const [k, v] of next) entries.set(k, v) // 重建静默：绝不为存量条目发通知
    emitChange()
  }

  const off = deps.onEngineProgress((evt) => {
    // 流式输出量大且与决策无关，直接略过；其余事件都可能意味着决策的产生或消失。
    if (evt.kind === 'op-chunk' || evt.kind === 'op-output') return
    refresh(evt.runId, evt.kind === 'decision')
  })

  return {
    list: snapshot,
    rebuild,
    dispose: () => off()
  }
}
