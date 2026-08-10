import { describe, it, expect } from 'vitest'
import type { EngineDecision, RunBreakpoint, StoredCard } from './types'
import { sortInbox, toInboxEntry, waitedFor } from './decision-inbox'

function decision(source: string, over: Partial<EngineDecision> = {}): EngineDecision {
  return {
    source,
    sourceKind: 'engine',
    titleKey: 'engineDecision.manualGate',
    titleParams: { node: '实现' },
    options: [{ id: 'pass', labelKey: 'engineDecision.pass' }],
    ...over
  }
}

function bp(over: Partial<RunBreakpoint> = {}): RunBreakpoint {
  return {
    runId: 'run-1',
    request: { workflowId: 'wf', repoPath: '/r', branch: 'b', baseBranch: 'main' },
    state: 'waiting-decision',
    currentNodeId: 'impl',
    phase: { kind: 'gate', index: 0 },
    pendingDecision: decision('impl:manual-gate'),
    pendingSince: 1_000,
    ...over
  }
}

function card(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'add-login',
    title: '加登录',
    description: '',
    typeId: 'feature',
    relations: [],
    status: '进行中',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

describe('toInboxEntry —— 由断点 + 卡派生一条收件箱条目', () => {
  it('条目带 runId/cardId/卡名/来源/标题 key 与参数/pendingSince', () => {
    const entry = toInboxEntry(bp(), card(), 999)
    expect(entry).toEqual({
      runId: 'run-1',
      cardId: 'add-login',
      cardName: '加登录',
      source: 'impl:manual-gate',
      titleKey: 'engineDecision.manualGate',
      titleParams: { node: '实现' },
      pendingSince: 1_000,
      gateKind: 'review'
    })
  })

  it('source 以 :manual-gate 结尾 → gateKind 为 review', () => {
    const entry = toInboxEntry(bp({ pendingDecision: decision('review:manual-gate') }), card(), 0)
    expect(entry!.gateKind).toBe('review')
  })

  it('其余 source（失败升级 / 外部门 / agent 提问）→ gateKind 为 failure', () => {
    for (const src of ['impl:command-failed', 'gated:external-gate', 'impl:agent-ask', 'impl:gate-escalated']) {
      const entry = toInboxEntry(bp({ pendingDecision: decision(src) }), card(), 0)
      expect(entry!.gateKind).toBe('failure')
    }
  })

  it('无待决策的断点 → 不产生条目（收件箱恒等于 pendingDecision !== null 的集合）', () => {
    expect(toInboxEntry(bp({ pendingDecision: null, state: 'running' }), card(), 0)).toBeNull()
  })

  it('断点缺 pendingSince（老数据）→ 用调用方传入的回落时刻，条目仍然产生', () => {
    const stale = bp()
    delete stale.pendingSince
    const entry = toInboxEntry(stale, card(), 4_242)
    expect(entry).not.toBeNull()
    expect(entry!.pendingSince).toBe(4_242)
  })

  it('决策无 titleParams 时条目也不带该字段（不塞空对象）', () => {
    const entry = toInboxEntry(bp({ pendingDecision: decision('a:manual-gate', { titleParams: undefined }) }), card(), 0)
    expect(entry).not.toHaveProperty('titleParams')
  })
})

describe('sortInbox —— 等最久的排最前', () => {
  const at = (runId: string, pendingSince: number): ReturnType<typeof toInboxEntry> =>
    toInboxEntry(bp({ runId, pendingSince }), card(), 0)

  it('按 pendingSince 升序', () => {
    const t1 = at('a', 100)!
    const t2 = at('b', 200)!
    const t3 = at('c', 300)!
    expect(sortInbox([t3, t1, t2]).map((e) => e.runId)).toEqual(['a', 'b', 'c'])
  })

  it('回落时刻参与同一排序（缺 pendingSince 者不掉队、不置底）', () => {
    const stale = bp({ runId: 'old' })
    delete stale.pendingSince
    const oldEntry = toInboxEntry(stale, card(), 50)!
    const fresh = at('new', 400)!
    expect(sortInbox([fresh, oldEntry]).map((e) => e.runId)).toEqual(['old', 'new'])
  })

  it('同刻按 runId 稳定排序（顺序不随输入抖动）', () => {
    const x = at('x', 100)!
    const y = at('y', 100)!
    expect(sortInbox([y, x]).map((e) => e.runId)).toEqual(['x', 'y'])
    expect(sortInbox([x, y]).map((e) => e.runId)).toEqual(['x', 'y'])
  })

  it('不改动传入数组', () => {
    const input = [at('b', 200)!, at('a', 100)!]
    sortInbox(input)
    expect(input.map((e) => e.runId)).toEqual(['b', 'a'])
  })
})

describe('waitedFor —— 已等待时长（「现在」由调用方传入，不依赖真实时钟）', () => {
  const MIN = 60_000
  it('不足一分钟 → justNow', () => {
    expect(waitedFor(1_000, 1_000 + 30_000)).toEqual({ unit: 'justNow', value: 0 })
  })
  it('分钟级 → minutes（向下取整）', () => {
    expect(waitedFor(0, 5 * MIN + 59_000)).toEqual({ unit: 'minutes', value: 5 })
  })
  it('小时级 → hours', () => {
    expect(waitedFor(0, 3 * 60 * MIN)).toEqual({ unit: 'hours', value: 3 })
  })
  it('超一天 → days', () => {
    expect(waitedFor(0, 50 * 60 * MIN)).toEqual({ unit: 'days', value: 2 })
  })
  it('时刻在未来（时钟回拨）→ 收敛为 justNow，不出负数', () => {
    expect(waitedFor(5_000, 1_000)).toEqual({ unit: 'justNow', value: 0 })
  })
})
