import { describe, it, expect, vi } from 'vitest'
import type {
  EngineDecision,
  EngineProgressEvent,
  RunBreakpoint,
  RunState,
  StoredCard
} from '../shared/types'
import type { DecisionInboxEntry } from '../shared/decision-inbox'
import { createDecisionInbox, type DecisionInboxDeps } from './decision-inbox'

function decision(source: string): EngineDecision {
  return {
    source,
    sourceKind: 'engine',
    titleKey: 'engineDecision.manualGate',
    titleParams: { node: '实现' },
    options: [{ id: 'pass', labelKey: 'engineDecision.pass' }]
  }
}

function bp(runId: string, over: Partial<RunBreakpoint> = {}): RunBreakpoint {
  return {
    runId,
    request: { workflowId: 'wf', repoPath: '/r', branch: 'b', baseBranch: 'main' },
    state: 'waiting-decision',
    currentNodeId: 'impl',
    phase: { kind: 'gate', index: 0 },
    pendingDecision: decision('impl:manual-gate'),
    pendingSince: 1_000,
    ...over
  }
}

function card(proposedName: string, activeRunId: string, title = proposedName): StoredCard {
  return {
    proposedName,
    title,
    description: '',
    typeId: 'feature',
    relations: [],
    status: '进行中',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: [],
    activeRunId
  }
}

/** 可控的引擎事件源 + 可换的断点/卡数据源。 */
function harness(init: {
  breakpoints?: RunBreakpoint[]
  cards?: StoredCard[] | null
  focused?: boolean
  notifyEnabled?: boolean
  fallbackSince?: (runId: string) => number | undefined
}) {
  const state = {
    breakpoints: init.breakpoints ?? [],
    cards: (init.cards === undefined ? [] : init.cards) as StoredCard[] | null,
    focused: init.focused ?? false,
    notifyEnabled: init.notifyEnabled ?? true
  }
  const handlers = new Set<(evt: EngineProgressEvent) => void>()
  const notify = vi.fn<(entry: DecisionInboxEntry) => void>()
  const onChange = vi.fn<(entries: DecisionInboxEntry[]) => void>()
  const deps: DecisionInboxDeps = {
    onEngineProgress: (h) => {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    listBreakpoints: () => state.breakpoints,
    getBreakpoint: (runId) => state.breakpoints.find((b) => b.runId === runId) ?? null,
    listCards: () => state.cards,
    fallbackSince: init.fallbackSince,
    onChange,
    isFocused: () => state.focused,
    notifyEnabled: () => state.notifyEnabled,
    notify
  }
  const inbox = createDecisionInbox(deps)
  return {
    inbox,
    state,
    notify,
    onChange,
    emit: (evt: EngineProgressEvent) => {
      for (const h of handlers) h(evt)
    },
    /** 模拟运行走到下一停点：换掉断点并发一个状态事件。 */
    settle: (runId: string, next: RunBreakpoint | null, runState: RunState) => {
      state.breakpoints = state.breakpoints.filter((b) => b.runId !== runId)
      if (next) state.breakpoints.push(next)
      for (const h of handlers) h({ kind: 'state', runId, state: runState })
    }
  }
}

describe('增量维护：由引擎事件驱动的投影', () => {
  it('decision 事件 → upsert 该运行的条目', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1', '加登录')] })
    expect(h.inbox.list()).toEqual([])
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.inbox.list()).toMatchObject([{ runId: 'r1', cardId: 'add-login', cardName: '加登录', gateKind: 'review' }])
  })

  it('决策被回应（pendingDecision 变 null）→ 条目消失', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.inbox.list()).toHaveLength(1)
    h.settle('r1', bp('r1', { pendingDecision: null, pendingSince: undefined, state: 'running' }), 'running')
    expect(h.inbox.list()).toEqual([])
  })

  it('运行转 aborted → 条目消失（不留幽灵）', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    h.settle('r1', bp('r1', { pendingDecision: null, pendingSince: undefined, state: 'aborted' }), 'aborted')
    expect(h.inbox.list()).toEqual([])
  })

  it('运行转 done → 条目消失', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    h.settle('r1', bp('r1', { pendingDecision: null, pendingSince: undefined, state: 'done' }), 'done')
    expect(h.inbox.list()).toEqual([])
  })

  it('断点整个消失（运行记录被删）→ 条目消失', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    h.settle('r1', null, 'aborted')
    expect(h.inbox.list()).toEqual([])
  })

  it('不属于本项目任何卡的运行 → 不进收件箱', () => {
    const h = harness({ breakpoints: [bp('other')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'other', decision: decision('impl:manual-gate') })
    expect(h.inbox.list()).toEqual([])
  })

  it('内容变化时回调 onChange（供推给渲染层）', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.onChange.mockClear()
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(h.onChange.mock.calls[0][0]).toHaveLength(1)
    h.settle('r1', bp('r1', { pendingDecision: null, pendingSince: undefined, state: 'done' }), 'done')
    expect(h.onChange).toHaveBeenLastCalledWith([])
  })

  it('dispose 后不再跟随引擎事件变化', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.inbox.dispose()
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.inbox.list()).toEqual([])
  })
})

describe('全量重建：由 run-store 列表重算', () => {
  it('只取 pendingDecision !== null 的运行，且按等最久在前排序', () => {
    const h = harness({
      breakpoints: [
        bp('r1', { pendingSince: 300 }),
        bp('r2', { pendingDecision: null, pendingSince: undefined, state: 'running' }),
        bp('r3', { pendingSince: 100 })
      ],
      cards: [card('c1', 'r1'), card('c2', 'r2'), card('c3', 'r3')]
    })
    h.inbox.rebuild()
    expect(h.inbox.list().map((e) => e.runId)).toEqual(['r3', 'r1'])
  })

  it('老断点缺 pendingSince → 回落到注入的次优时刻，条目仍在', () => {
    const stale = bp('r1')
    delete stale.pendingSince
    const h = harness({
      breakpoints: [stale],
      cards: [card('c1', 'r1')],
      fallbackSince: (runId) => (runId === 'r1' ? 777 : undefined)
    })
    h.inbox.rebuild()
    expect(h.inbox.list()).toMatchObject([{ runId: 'r1', pendingSince: 777 }])
  })

  it('回落时刻也无从得知 → 条目仍在（不因缺时间被丢弃）', () => {
    const stale = bp('r1')
    delete stale.pendingSince
    const h = harness({ breakpoints: [stale], cards: [card('c1', 'r1')] })
    h.inbox.rebuild()
    expect(h.inbox.list()).toHaveLength(1)
  })
})

describe('项目范围', () => {
  it('切换项目 → 重建为新项目的条目', () => {
    const h = harness({
      breakpoints: [bp('r1'), bp('r2')],
      cards: [card('c1', 'r1')]
    })
    h.inbox.rebuild()
    expect(h.inbox.list().map((e) => e.runId)).toEqual(['r1'])
    h.state.cards = [card('c2', 'r2')]
    h.inbox.rebuild()
    expect(h.inbox.list().map((e) => e.runId)).toEqual(['r2'])
  })

  it('未绑定项目 → 收件箱为空', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: null })
    h.inbox.rebuild()
    expect(h.inbox.list()).toEqual([])
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.inbox.list()).toEqual([])
  })
})

describe('永不抛：数据源异常不拖垮投影', () => {
  it('listBreakpoints / listCards 抛异常时 rebuild 与事件处理都不抛', () => {
    const boom = (): never => {
      throw new Error('boom')
    }
    const inbox = createDecisionInbox({
      onEngineProgress: () => () => {},
      listBreakpoints: boom,
      getBreakpoint: boom,
      listCards: boom
    })
    expect(() => inbox.rebuild()).not.toThrow()
    expect(inbox.list()).toEqual([])
  })
})

describe('桌面通知：只为新增条目、且只在没盯着的时候', () => {
  it('未聚焦 + 新增条目 → 发通知（含卡名与决策标题 key）', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1', '加登录')], focused: false })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      cardName: '加登录',
      titleKey: 'engineDecision.manualGate',
      titleParams: { node: '实现' },
      cardId: 'add-login'
    })
  })

  it('应用聚焦时不打扰（条目照常进收件箱）', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')], focused: true })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.inbox.list()).toHaveLength(1)
  })

  it('条目消失不发通知', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    h.notify.mockClear()
    h.settle('r1', bp('r1', { pendingDecision: null, pendingSince: undefined, state: 'done' }), 'done')
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('同一条待决策重复收到事件 → 只通知一次', () => {
    const h = harness({ breakpoints: [bp('r1')], cards: [card('add-login', 'r1')] })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('rebuild() 重建出的存量条目不发通知（开机不糊一脸）', () => {
    const h = harness({ breakpoints: [bp('r1'), bp('r2')], cards: [card('c1', 'r1'), card('c2', 'r2')] })
    h.notify.mockClear()
    h.inbox.rebuild()
    expect(h.inbox.list()).toHaveLength(2)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('设置里关掉决策通知 → 不发通知，但条目与计数不受影响', () => {
    const h = harness({
      breakpoints: [bp('r1')],
      cards: [card('add-login', 'r1')],
      notifyEnabled: false
    })
    h.emit({ kind: 'decision', runId: 'r1', decision: decision('impl:manual-gate') })
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.inbox.list()).toHaveLength(1)
  })
})
