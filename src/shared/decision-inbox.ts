/**
 * 决策收件箱的**纯逻辑**：由运行断点 + 其所属需求卡派生一条条目、按「等最久在前」排序、算已等待时长。
 *
 * 收件箱是 `RunBreakpoint.pendingDecision` 的**投影**——这里不存东西、不碰 fs、不读时钟：
 * 「现在」与「回落时刻」一律由调用方传入，使排序与时长在测试与真实运行下行为一致。
 */

import type { RunBreakpoint, StoredCard } from './types'

/**
 * 条目「大概等你干什么」的两类（不细分到具体 outcome——更细的进卡详情看）：
 * - `review` 流程正常走到你面前，等你验收
 * - `failure` 出岔子了要你选怎么办
 */
export type DecisionGateKind = 'review' | 'failure'

/** 一条收件箱条目 = 一个正等待用户拍板的运行（自带跳到该卡所需的定位信息）。 */
export interface DecisionInboxEntry {
  runId: string
  /** 所属需求卡的 id（= 预取名 slug，卡详情按它定位）。 */
  cardId: string
  /** 卡名（通知与列表直接展示）。 */
  cardName: string
  /** 决策来源 `<nodeId>:<outcome>`；`gateKind` 由它派生。 */
  source: string
  /** 决策标题的 i18n key（复用既有决策文案，收件箱不另立一套）。 */
  titleKey: string
  titleParams?: Record<string, string | number>
  /** 决策产生时刻；断点缺 `pendingSince` 时为调用方给的回落时刻。 */
  pendingSince: number
  gateKind: DecisionGateKind
}

/** 已等待时长的粗粒度桶（渲染层按 unit 选 i18n key、按 value 插值）。 */
export interface WaitedDuration {
  unit: 'justNow' | 'minutes' | 'hours' | 'days'
  value: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 由断点 + 其所属卡派生一条条目；断点没在等决策则返回 null（收件箱恒等于 `pendingDecision !== null` 的集合）。
 * `fallbackSince` 是断点缺 `pendingSince`（老数据）时的次优时间来源，由调用方给（如 run-store 文件 mtime）。
 */
export function toInboxEntry(
  bp: RunBreakpoint,
  card: Pick<StoredCard, 'proposedName' | 'title'>,
  fallbackSince: number
): DecisionInboxEntry | null {
  const d = bp.pendingDecision
  if (!d) return null
  return {
    runId: bp.runId,
    cardId: card.proposedName,
    cardName: card.title,
    source: d.source,
    titleKey: d.titleKey,
    ...(d.titleParams ? { titleParams: d.titleParams } : {}),
    pendingSince: bp.pendingSince ?? fallbackSince,
    gateKind: d.source.endsWith(':manual-gate') ? 'review' : 'failure'
  }
}

/** 按 `pendingSince` 升序（等最久的在最上）；同刻按 runId 稳定收敛。返回新数组，不改动入参。 */
export function sortInbox(entries: DecisionInboxEntry[]): DecisionInboxEntry[] {
  return [...entries].sort(
    (a, b) => a.pendingSince - b.pendingSince || a.runId.localeCompare(b.runId)
  )
}

/** 已等待多久（「现在」由调用方传入）；时钟回拨等导致的负值收敛为「刚刚」。 */
export function waitedFor(pendingSince: number, now: number): WaitedDuration {
  const ms = Math.max(0, now - pendingSince)
  if (ms >= DAY) return { unit: 'days', value: Math.floor(ms / DAY) }
  if (ms >= HOUR) return { unit: 'hours', value: Math.floor(ms / HOUR) }
  if (ms >= MINUTE) return { unit: 'minutes', value: Math.floor(ms / MINUTE) }
  return { unit: 'justNow', value: 0 }
}
