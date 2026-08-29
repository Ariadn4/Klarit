import { describe, it, expect } from 'vitest'
import type { EngineProgressEvent, RunJournalEntry } from './types'
import { buildRunTimeline } from './run-timeline'

let clock = 0
/** 按写入次序造条目：不传 `at` 则时刻自增，便于只关心顺序的用例。 */
function e(event: Exclude<EngineProgressEvent, { kind: 'op-chunk' }>, at?: number): RunJournalEntry {
  return { ...event, at: at ?? ++clock }
}
const enter = (nodeId: string, at?: number): RunJournalEntry => e({ kind: 'node-enter', runId: 'r1', nodeId }, at)
const exit = (nodeId: string, at?: number): RunJournalEntry => e({ kind: 'node-exit', runId: 'r1', nodeId }, at)
const phase = (nodeId: string, phase: 'executing' | 'done', at?: number): RunJournalEntry =>
  e({ kind: 'phase', runId: 'r1', nodeId, phase: phase === 'done' ? { kind: 'done' } : { kind: 'executing' } }, at)

describe('buildRunTimeline · 正常节点', () => {
  it('进入→若干阶段→退出 = 一段，含进入/退出时刻、耗时与经历的阶段', () => {
    const segs = buildRunTimeline([
      e({ kind: 'state', runId: 'r1', state: 'running' }, 100),
      enter('n1', 100),
      phase('n1', 'executing', 150),
      e({ kind: 'phase', runId: 'r1', nodeId: 'n1', phase: { kind: 'gate', index: 0 } }, 200),
      phase('n1', 'done', 250),
      exit('n1', 300)
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({
      nodeId: 'n1',
      enteredAt: 100,
      exitedAt: 300,
      durationMs: 200,
      finished: true,
      outcome: { kind: 'completed' }
    })
    expect(segs[0].phases).toEqual([{ kind: 'executing' }, { kind: 'gate', index: 0 }, { kind: 'done' }])
    // 输出桶引用：该节点的前台桶。
    expect(segs[0].buckets).toContain('node:n1')
  })

  it('跳过的节点终局为「跳过 + 原因」', () => {
    const segs = buildRunTimeline([enter('n1'), e({ kind: 'skip', runId: 'r1', nodeId: 'n1', reason: '执行器未落地,跳过' }), exit('n1')])
    expect(segs[0].outcome).toEqual({ kind: 'skipped', reason: '执行器未落地,跳过' })
    expect(segs[0].finished).toBe(true)
  })

  it('多个节点按进入次序成多段', () => {
    const segs = buildRunTimeline([enter('n1'), exit('n1'), enter('n2'), exit('n2'), enter('n3')])
    expect(segs.map((s) => s.nodeId)).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('buildRunTimeline · 回退重入', () => {
  it('同一节点被重入 → 两段，按进入次序排列，不按 nodeId 合并', () => {
    const segs = buildRunTimeline([
      enter('n1', 10),
      exit('n1', 20),
      enter('n2', 20),
      exit('n2', 30),
      enter('n1', 40),
      exit('n1', 55)
    ])
    expect(segs.map((s) => s.nodeId)).toEqual(['n1', 'n2', 'n1'])
    expect(segs[0].durationMs).toBe(10)
    expect(segs[2].durationMs).toBe(15)
    // 「这节点跑了第几遍」对用户可见。
    expect(segs.map((s) => s.entry)).toEqual([1, 1, 2])
  })

  it('内容驱动回退不重发 node-enter（直接拨回并发 phase）时，仍按节点切出新的一段', () => {
    const segs = buildRunTimeline([
      enter('n1', 10),
      exit('n1', 20),
      enter('gate', 20),
      // 回退：引擎把当前节点拨回 n1 并发 executing 阶段，没有第二个 node-enter。
      phase('n1', 'executing', 40),
      exit('n1', 60)
    ])
    expect(segs.map((s) => s.nodeId)).toEqual(['n1', 'gate', 'n1'])
    expect(segs[2]).toMatchObject({ enteredAt: 40, exitedAt: 60, durationMs: 20, entry: 2 })
  })
})

describe('buildRunTimeline · 未结束的段', () => {
  it('停在决策上（无 node-exit）→ 标记未结束、终局为「停在决策」、按最后事件时刻算耗时、不丢弃', () => {
    const segs = buildRunTimeline([
      enter('n1', 100),
      phase('n1', 'executing', 120),
      e({ kind: 'decision', runId: 'r1', decision: { source: 'n1:manual-gate', sourceKind: 'engine', titleKey: 'k', options: [] } }, 180),
      e({ kind: 'state', runId: 'r1', state: 'waiting-decision' }, 180)
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ nodeId: 'n1', enteredAt: 100, finished: false, durationMs: 80 })
    expect(segs[0].exitedAt).toBeUndefined()
    expect(segs[0].outcome).toMatchObject({ kind: 'decision' })
    expect(segs[0].decision).toMatchObject({ source: 'n1:manual-gate' })
  })

  it('进程中断（无 node-exit、无决策）→ 标记未结束、终局为「未结束」，段仍在', () => {
    const segs = buildRunTimeline([enter('n1', 100), phase('n1', 'executing', 140)])
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ finished: false, durationMs: 40, outcome: { kind: 'unfinished' } })
  })

  it('调用方传入「现在」→ 未结束段按现在算至今耗时（已结束段不受影响）', () => {
    const segs = buildRunTimeline([enter('n1', 100), exit('n1', 150), enter('n2', 150)], { now: 900 })
    expect(segs[0].durationMs).toBe(50)
    expect(segs[1].durationMs).toBe(750)
  })

  it('空日志 → 空时间线', () => {
    expect(buildRunTimeline([])).toEqual([])
  })
})

describe('buildRunTimeline · 门重试与后台任务', () => {
  it('门重试摘要含次数与各次 cause/rerun', () => {
    const segs = buildRunTimeline([
      enter('n1'),
      e({ kind: 'gate-retry', runId: 'r1', nodeId: 'n1', gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: 1 }),
      e({ kind: 'gate-retry', runId: 'r1', nodeId: 'n1', gateIndex: 0, attempt: { cause: 'timeout', rerun: 'gate' }, count: 2 }),
      exit('n1')
    ])
    expect(segs[0].gateRetries).toEqual([
      { cause: 'error', rerun: 'node' },
      { cause: 'timeout', rerun: 'gate' }
    ])
  })

  it('后台任务列表含结局（stopped/exited/timeout），未终止的仍为 started', () => {
    const segs = buildRunTimeline([
      enter('n1'),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'started' }),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b2', label: '起前端', status: 'started' }),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b3', label: '跑测试', status: 'started' }),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'stopped' }),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b2', label: '起前端', status: 'timeout' }),
      exit('n1')
    ])
    expect(segs[0].backgrounds).toEqual([
      { bgId: 'b1', label: '起后端', status: 'stopped' },
      { bgId: 'b2', label: '起前端', status: 'timeout' },
      { bgId: 'b3', label: '跑测试', status: 'started' }
    ])
    // 后台任务的输出桶也是该段的桶引用。
    expect(segs[0].buckets).toEqual(['node:n1', 'bg:b1', 'bg:b2', 'bg:b3'])
  })

  it('后台任务的结局事件在节点退出之后到达 → 仍归它所属的那一段', () => {
    const segs = buildRunTimeline([
      enter('n1'),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'started' }),
      exit('n1'),
      enter('n2'),
      e({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'exited' }),
      exit('n2')
    ])
    expect(segs.map((s) => s.nodeId)).toEqual(['n1', 'n2'])
    expect(segs[0].backgrounds).toEqual([{ bgId: 'b1', label: '起后端', status: 'exited' }])
    expect(segs[1].backgrounds).toEqual([])
  })
})
