/**
 * 运行日志 → 时间线分段（run-timeline「时间线按节点分段，回退产生多段」）。
 *
 * 原始日志是一条平坦的事件流；直接摊成流水账对不读代码的用户毫无用处（他看到的是 200 行 `phase: executing`）。
 * 这里做唯一一层加工：**按进入次序**切成「一个节点一段」，每段自带耗时、经历的阶段、终局、门重试、
 * 后台任务与输出桶引用。
 *
 * 两条容易做错的规则：
 * - **不按 nodeId 合并**：内容驱动回退后重入同一节点必须呈现为两段（合并掉就把「这节点跑了两遍」藏起来了）。
 *   回退时引擎是「拨回当前节点 + 发 phase」而**不重发 `node-enter`**，故换节点的 `phase` 同样切段。
 * - **缺 `node-exit` 的段不丢弃**：运行停在决策上、或进程被中断时该段就是没有退出事件，标记「未结束」
 *   并按最后一个事件的时刻算至今耗时（调用方传 `now` 则按「现在」算）。
 *
 * 纯函数、零时钟——「现在」由调用方传入，故同一份日志永远分出同一条时间线。
 */

import type { EngineDecision, GateAttempt, NodePhase, RunJournalEntry } from './types'

/** 段内一个后台任务及其结局（同一 `bgId` 的后续事件覆盖前一个状态）。 */
export interface TimelineBackground {
  bgId: string
  label: string
  status: 'started' | 'stopped' | 'exited' | 'timeout'
}

/** 段的终局。 */
export type TimelineOutcome =
  | { kind: 'completed' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'decision' }
  | { kind: 'unfinished' }

/** 时间线上的一段 = 某节点的一次进入。 */
export interface TimelineSegment {
  nodeId: string
  /** 该节点第几次进入（从 1 起）；>1 即回退重入。 */
  entry: number
  enteredAt: number
  /** 退出时刻；未结束的段缺省。 */
  exitedAt?: number
  /** 耗时（毫秒）：已结束＝退出−进入；未结束＝（`now` 或最后事件时刻）−进入。 */
  durationMs: number
  /** 是否已结束（有 `node-exit`）。 */
  finished: boolean
  /** 经历的阶段（按次序）。 */
  phases: NodePhase[]
  outcome: TimelineOutcome
  /** 门重试的各次原因与重跑粒度；条数即重试次数。 */
  gateRetries: GateAttempt[]
  backgrounds: TimelineBackground[]
  /** 该段抛出的决策（停在决策上时即它把段挂住了）。 */
  decision?: EngineDecision
  /** 该段的输出桶引用：前台节点桶 + 各后台任务桶（多命令节点的 `node:<id>:<i>` 由消费方按实际存在的桶展开）。 */
  buckets: string[]
}

interface Building extends TimelineSegment {
  /** 段内见过的最后事件时刻（未结束段据它算至今耗时）。 */
  lastAt: number
  skipReason?: string
}

export function buildRunTimeline(entries: RunJournalEntry[], opts: { now?: number } = {}): TimelineSegment[] {
  const segs: Building[] = []
  /** 每个节点已进入过几次（切段时给 `entry` 编号）。 */
  const entryCount = new Map<string, number>()

  const open = (nodeId: string, at: number): Building => {
    const entry = (entryCount.get(nodeId) ?? 0) + 1
    entryCount.set(nodeId, entry)
    const seg: Building = {
      nodeId,
      entry,
      enteredAt: at,
      durationMs: 0,
      finished: false,
      phases: [],
      outcome: { kind: 'unfinished' },
      gateRetries: [],
      backgrounds: [],
      buckets: [`node:${nodeId}`],
      lastAt: at
    }
    segs.push(seg)
    return seg
  }
  /** 非切段事件落到哪一段：优先该节点最近的一段（后台结局可能在节点退出后才到），否则当前末段。 */
  const target = (nodeId: string, at: number): Building => {
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].nodeId === nodeId) return segs[i]
    return segs[segs.length - 1] ?? open(nodeId, at)
  }

  for (const entry of entries) {
    const last = segs[segs.length - 1]
    if (entry.kind === 'node-enter') {
      open(entry.nodeId, entry.at).lastAt = entry.at
      continue
    }
    if (entry.kind === 'phase') {
      // 换了节点却没有 node-enter＝回退重入（引擎只拨回当前节点并发阶段）：照样切新的一段。
      const seg = !last || last.nodeId !== entry.nodeId ? open(entry.nodeId, entry.at) : last
      seg.phases.push(entry.phase)
      seg.lastAt = entry.at
      continue
    }
    if (entry.kind === 'state') {
      if (last) last.lastAt = Math.max(last.lastAt, entry.at)
      continue
    }
    if (entry.kind === 'decision') {
      if (!last) continue
      last.decision = entry.decision
      last.lastAt = entry.at
      continue
    }
    if (!('nodeId' in entry)) continue
    const seg = target(entry.nodeId, entry.at)
    seg.lastAt = Math.max(seg.lastAt, entry.at)
    if (entry.kind === 'node-exit') {
      seg.exitedAt = entry.at
      seg.finished = true
    } else if (entry.kind === 'skip') {
      seg.skipReason = entry.reason
    } else if (entry.kind === 'gate-retry') {
      seg.gateRetries.push(entry.attempt)
    } else if (entry.kind === 'background') {
      const known = seg.backgrounds.find((b) => b.bgId === entry.bgId)
      if (known) {
        known.status = entry.status
        known.label = entry.label
      } else {
        seg.backgrounds.push({ bgId: entry.bgId, label: entry.label, status: entry.status })
        seg.buckets.push(`bg:${entry.bgId}`)
      }
    }
  }

  return segs.map(({ lastAt, skipReason, ...seg }) => ({
    ...seg,
    durationMs: (seg.exitedAt ?? opts.now ?? lastAt) - seg.enteredAt,
    outcome: skipReason !== undefined
      ? { kind: 'skipped', reason: skipReason }
      : seg.finished
        ? { kind: 'completed' }
        : seg.decision
          ? { kind: 'decision' }
          : { kind: 'unfinished' }
  }))
}
