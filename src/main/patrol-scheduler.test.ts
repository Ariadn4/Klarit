import { describe, it, expect, vi } from 'vitest'
import type {
  CandidateCard,
  EngineDecision,
  EngineProgressEvent,
  Project,
  RunBreakpoint,
  RunState,
  StoredCard
} from '../shared/types'
import type { Patrol, PatrolFinding } from '../shared/patrol'
import { createAutoScheduler } from './auto-scheduler'
import { createDecisionInbox } from './decision-inbox'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from '../shared/card-type'
import { createPatrolScheduler, type PatrolSchedulerDeps } from './patrol-scheduler'

const PROJECT = { id: 'p1', members: [{ id: 'web' }] } as unknown as Project
const HOUR = 3600_000
const NOW = new Date(2026, 7, 10, 12, 0, 0, 0).getTime()

function patrol(over: Partial<Patrol> = {}): Patrol {
  return {
    id: 'pt-1',
    name: '巡检',
    trigger: { kind: 'everyHours', hours: 6 },
    action: { kind: 'docScan' },
    enabled: true,
    ...over
  }
}

/** 人工评审门决策（`source` 形如 `<nodeId>:manual-gate`）。 */
function manualGate(nodeId = 'review'): EngineDecision {
  return {
    source: `${nodeId}:manual-gate`,
    sourceKind: 'engine',
    titleKey: 'engineDecision.manualGate',
    titleParams: { node: '评审' },
    options: [{ id: 'pass', labelKey: 'engineDecision.pass' }]
  }
}

/** 引擎失败决策（非人工门）。 */
function failureDecision(nodeId = 'build'): EngineDecision {
  return {
    source: `${nodeId}:command-failed`,
    sourceKind: 'engine',
    titleKey: 'engineDecision.commandFailed',
    titleParams: { node: '构建' },
    options: [{ id: 'retry', labelKey: 'engineDecision.retry' }],
    reason: 'exit 1'
  }
}

/**
 * 测试床：巡检列表可变（`markRun` 就地改 `lastRunAt`，模拟持久化），三类动作与产出去处全是间谍。
 * **注意：deps 里没有任何决策收件箱写入口**——这是本能力的硬约束，见「不自作主张」用例。
 *
 * 另带一个**极简假引擎**：`runStates` 记每个运行的状态、`emit` 推引擎进度事件、`abortRun` 落 `aborted`
 * 终局（与真 `engine.abort` 同语义）。`isRunLive` 与 main 同口径，供并发槽用例接真身 `auto-scheduler`。
 * 决策事件是异步到来的，等本轮在飞动作落定的办法是再 `await evaluate()`（它 await 全部在飞动作）。
 */
function harness(patrols: Patrol[], over: Partial<PatrolSchedulerDeps> = {}) {
  const list = patrols.slice()
  const now = { value: NOW }
  const runStates = new Map<string, RunState>()
  let emit: (evt: EngineProgressEvent) => void = () => {}
  const abortRun = vi.fn<(runId: string) => Promise<void>>(
    (over.abortRun as ((runId: string) => Promise<void>) | undefined) ??
      (async (runId: string) => {
        runStates.set(runId, 'aborted')
        emit({ kind: 'state', runId, state: 'aborted' })
      })
  )
  const describeStuckRun = vi.fn<NonNullable<PatrolSchedulerDeps['describeStuckRun']>>(
    over.describeStuckRun ??
      ((input) => ({
        title: `巡检卡住 ${input.patrol.name}`,
        description: `节点 ${input.nodeId}｜${input.decision.titleKey}`
      }))
  )
  // 覆盖项包进同一个间谍，保证断言的就是真正被调的那个实现。
  const startWorkflow = vi.fn<(workflowId: string, p: Patrol) => string | null>(
    over.startWorkflow ??
      (() => {
        runStates.set('run-1', 'running')
        return 'run-1'
      })
  )
  const runCommand = vi.fn<(command: string, signal: AbortSignal) => Promise<unknown>>(
    over.runCommand ?? (async () => ({ code: 0 }))
  )
  const scanDocuments = vi.fn<() => Promise<PatrolFinding[]>>(over.scanDocuments ?? (async () => []))
  const pushCandidates = vi.fn<(cards: CandidateCard[]) => void | Promise<void>>(over.pushCandidates ?? (() => {}))
  const markRun = vi.fn<(id: string, at: number) => void>(
    over.markRun ??
      ((id, at) => {
        const idx = list.findIndex((p) => p.id === id)
        if (idx >= 0) list[idx] = { ...list[idx], lastRunAt: at }
      })
  )
  const deps: PatrolSchedulerDeps = {
    listPatrols: over.listPatrols ?? (() => list),
    getProject: over.getProject ?? (() => PROJECT),
    now: () => now.value,
    hasFreeSlot: over.hasFreeSlot ?? (() => true),
    markRun,
    startWorkflow,
    runCommand,
    scanDocuments,
    candidateTypeId: over.candidateTypeId ?? (() => 'feature'),
    pushCandidates,
    onEngineProgress:
      over.onEngineProgress ??
      ((handler) => {
        emit = handler
        return () => {
          emit = () => {}
        }
      }),
    abortRun,
    describeStuckRun
  }
  return {
    scheduler: createPatrolScheduler(deps),
    list,
    now,
    markRun,
    startWorkflow,
    runCommand,
    scanDocuments,
    pushCandidates,
    abortRun,
    describeStuckRun,
    runStates,
    isRunLive: (runId: string) => {
      const st = runStates.get(runId)
      return st === 'running' || st === 'paused' || st === 'waiting-decision'
    },
    /** 假引擎抛一个待决策：置 `waiting-decision` 并推 `decision` 事件（与真引擎同序）。 */
    throwDecision: (runId: string, decision: EngineDecision) => {
      runStates.set(runId, 'waiting-decision')
      emit({ kind: 'state', runId, state: 'waiting-decision' })
      emit({ kind: 'decision', runId, decision })
    },
    emit: (evt: EngineProgressEvent) => emit(evt)
  }
}

describe('createPatrolScheduler.evaluate —— 到期发起与记时', () => {
  it('到期 → 发起动作并把 lastRunAt 记为**发起时刻**', async () => {
    const h = harness([patrol({ lastRunAt: NOW - 7 * HOUR })])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
    expect(h.markRun).toHaveBeenCalledWith('pt-1', NOW)
  })

  it('未到期 → 不发起、不记时', async () => {
    const h = harness([patrol({ lastRunAt: NOW - 2 * HOUR })])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
    expect(h.markRun).not.toHaveBeenCalled()
  })

  it('停用的巡检永不触发（配置仍在）', async () => {
    const h = harness([patrol({ enabled: false, lastRunAt: NOW - 999 * HOUR })])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
    expect(h.markRun).not.toHaveBeenCalled()
  })

  it('零条巡检 → 完全静默（不发起任何动作、不记任何时）', async () => {
    const h = harness([])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
    expect(h.startWorkflow).not.toHaveBeenCalled()
    expect(h.runCommand).not.toHaveBeenCalled()
    expect(h.markRun).not.toHaveBeenCalled()
  })

  it('未绑定项目 → 回路空转', async () => {
    const h = harness([patrol()], { getProject: () => null })
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
  })

  it('动作失败仍更新 lastRunAt（不在本 tick 重试）', async () => {
    const h = harness([patrol({ action: { kind: 'command', command: 'boom' } })], {
      runCommand: vi.fn(async () => {
        throw new Error('炸了')
      })
    })
    await expect(h.scheduler.evaluate()).resolves.toBeUndefined()
    expect(h.markRun).toHaveBeenCalledWith('pt-1', NOW)
    // 同一 tick 内再评估：已记时 → 不重试
    await h.scheduler.evaluate()
    expect(h.markRun).toHaveBeenCalledTimes(1)
  })

  it('工作流启动接缝抛异常也不冒泡、仍记时', async () => {
    const h = harness([patrol({ action: { kind: 'workflow', workflowId: 'wf' } })], {
      startWorkflow: vi.fn(() => {
        throw new Error('起不来')
      })
    })
    await expect(h.scheduler.evaluate()).resolves.toBeUndefined()
    expect(h.markRun).toHaveBeenCalledWith('pt-1', NOW)
  })
})

describe('createPatrolScheduler —— 串行化、永不抛、开机只补一次', () => {
  it('评估中再触发 → 合并为一次补评估，同一巡检不双发', async () => {
    const h = harness([patrol()])
    const p1 = h.scheduler.evaluate()
    const p2 = h.scheduler.evaluate()
    await Promise.all([p1, p2])
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
    expect(h.markRun).toHaveBeenCalledTimes(1)
  })

  it('单次评估抛异常 → 回路存活，后续 tick 照常评估', async () => {
    let broken = true
    const h = harness([patrol()], {
      listPatrols: () => {
        if (broken) throw new Error('读配置炸了')
        return [patrol()]
      }
    })
    await expect(h.scheduler.evaluate()).resolves.toBeUndefined()
    expect(h.scanDocuments).not.toHaveBeenCalled()
    broken = false
    await h.scheduler.evaluate()
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
  })

  it('一条巡检出错不拖累同轮其它巡检', async () => {
    const h = harness([patrol({ id: 'bad', action: { kind: 'workflow', workflowId: 'wf' } }), patrol({ id: 'good' })], {
      startWorkflow: vi.fn(() => {
        throw new Error('起不来')
      })
    })
    await h.scheduler.evaluate()
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
  })

  it('开机时错过 12 个窗口 → 只发起一次', async () => {
    // everyHours: 6，上次是 3 天前（错过约 12 个窗口）
    const h = harness([patrol({ lastRunAt: NOW - 72 * HOUR })])
    await h.scheduler.evaluate()
    h.now.value = NOW + 60_000 // 下一个分钟级 tick
    await h.scheduler.evaluate()
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
  })

  it('未错过窗口则不补（关机 1 小时后开机、周期 6 小时）', async () => {
    const h = harness([patrol({ lastRunAt: NOW - 1 * HOUR })])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
  })
})

describe('createPatrolScheduler —— 三类动作全部映射到既有接缝（零新执行器）', () => {
  it('工作流动作 → 走注入的运行启动接缝（与自动排程同一条路），不碰其它执行器', async () => {
    const h = harness([patrol({ action: { kind: 'workflow', workflowId: 'wf-nightly' } })])
    await h.scheduler.evaluate()
    expect(h.startWorkflow).toHaveBeenCalledTimes(1)
    expect(h.startWorkflow.mock.calls[0][0]).toBe('wf-nightly')
    expect(h.runCommand).not.toHaveBeenCalled()
    expect(h.scanDocuments).not.toHaveBeenCalled()
  })

  it('命令动作 → 走既有可取消命令运行器，带取消信号', async () => {
    const h = harness([patrol({ action: { kind: 'command', command: 'npm run lint' } })])
    await h.scheduler.evaluate()
    expect(h.runCommand).toHaveBeenCalledTimes(1)
    const [command, signal] = h.runCommand.mock.calls[0]
    expect(command).toBe('npm run lint')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(h.startWorkflow).not.toHaveBeenCalled()
  })

  it('dispose() → 在飞命令被取消（中止语义交给既有运行器）', async () => {
    let captured: AbortSignal | null = null
    const h = harness([patrol({ action: { kind: 'command', command: 'sleep 999' } })], {
      runCommand: vi.fn(
        (_cmd: string, signal: AbortSignal) =>
          new Promise((resolve) => {
            captured = signal
            signal.addEventListener('abort', () => resolve({ code: -1, killed: true }))
          })
      )
    })
    const pending = h.scheduler.evaluate()
    await Promise.resolve()
    h.scheduler.dispose()
    await pending
    expect((captured as unknown as AbortSignal).aborted).toBe(true)
  })

  it('文档扫描动作 → 调既有文档扫描接缝', async () => {
    const h = harness([patrol({ action: { kind: 'docScan' } })])
    await h.scheduler.evaluate()
    expect(h.scanDocuments).toHaveBeenCalledTimes(1)
    expect(h.startWorkflow).not.toHaveBeenCalled()
    expect(h.runCommand).not.toHaveBeenCalled()
  })
})

describe('createPatrolScheduler —— 产出只进候选卡，绝不自作主张', () => {
  const drift: PatrolFinding[] = [
    { title: '文档漂移 web', description: '- docs/a.md 已不存在' },
    { title: '文档漂移 api', description: '- docs/b.md 未登记' }
  ]

  it('扫出问题 → 经候选提交接缝推候选卡（止于审阅）', async () => {
    const h = harness([patrol()], { scanDocuments: vi.fn(async () => drift) })
    await h.scheduler.evaluate()
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    const cards = h.pushCandidates.mock.calls[0][0]
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ title: '文档漂移 web', typeId: 'feature', relations: [] })
    expect(cards[0].proposedName).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('没扫出问题 → 不推空候选（不制造噪声）', async () => {
    const h = harness([patrol()])
    await h.scheduler.evaluate()
    expect(h.pushCandidates).not.toHaveBeenCalled()
  })

  it('巡检跑完：只记时 + 推候选，没有任何别的写侧动作（不改代码/不合并/不落库/不排程）', async () => {
    const h = harness([patrol()], { scanDocuments: vi.fn(async () => drift) })
    await h.scheduler.evaluate()
    // 全部注入口只有这几个；工作流/命令没被碰，产出唯一去处是候选卡。
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    expect(h.markRun).toHaveBeenCalledTimes(1)
    expect(h.startWorkflow).not.toHaveBeenCalled()
    expect(h.runCommand).not.toHaveBeenCalled()
  })

  it('巡检不向决策收件箱写任何独立条目（收件箱仍是断点的纯投影）', async () => {
    // 真身收件箱：断点源为空 → 无论巡检干了什么，条目必须恒为空。
    const inbox = createDecisionInbox({
      onEngineProgress: () => () => {},
      listBreakpoints: () => [],
      getBreakpoint: () => null,
      listCards: () => []
    })
    inbox.rebuild()
    const h = harness([patrol()], { scanDocuments: vi.fn(async () => drift) })
    await h.scheduler.evaluate()
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    expect(inbox.list()).toEqual([]) // 巡检推了候选，收件箱一条没多
    inbox.dispose()
  })

  it('巡检推出的未审阅候选 → 自动排程不拉起（候选不是落库卡）', async () => {
    const store: StoredCard[] = []
    const h = harness([patrol()], { scanDocuments: vi.fn(async () => drift) })
    await h.scheduler.evaluate()
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    const started: string[] = []
    const auto = createAutoScheduler({
      listCards: () => store, // 候选未审阅 → 一张都没进卡库
      getProject: () => PROJECT,
      getRegistry: () => typeArchetypeMap(DEFAULT_CARD_TYPES),
      canDerive: () => true,
      isRunLive: () => false,
      startCard: (c) => started.push(c.proposedName)
    })
    await auto.evaluate()
    expect(started).toEqual([])
  })
})

describe('createPatrolScheduler —— 巡检运行抛决策即中止转候选，绝不静默停等', () => {
  const workflowPatrol = patrol({ name: '夜间巡检', action: { kind: 'workflow', workflowId: 'wf-nightly' } })

  it('撞上人工门 → 中止该运行 + 推出载明巡检名/节点/决策说明的候选卡', async () => {
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.throwDecision('run-1', manualGate('review'))
    await h.scheduler.evaluate() // 等本轮在飞动作落定（本次不再发起：已记时）

    expect(h.abortRun).toHaveBeenCalledWith('run-1')
    // 交给文案层的上下文：哪条巡检、哪个节点（由 `<nodeId>:<outcome>` 界定）、决策本体
    expect(h.describeStuckRun).toHaveBeenCalledTimes(1)
    expect(h.describeStuckRun.mock.calls[0][0]).toMatchObject({
      patrol: { id: 'pt-1', name: '夜间巡检' },
      runId: 'run-1',
      nodeId: 'review',
      decision: { source: 'review:manual-gate', titleKey: 'engineDecision.manualGate' }
    })
    // 产出唯一去处仍是候选卡（止于审阅），载明上述三件事
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    const cards = h.pushCandidates.mock.calls[0][0]
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toContain('夜间巡检')
    expect(cards[0].description).toContain('review')
    expect(cards[0].description).toContain('engineDecision.manualGate')
    expect(cards[0].typeId).toBe('feature')
  })

  it('撞上引擎失败决策（非人工门）→ 同样中止并转候选（不分决策来源）', async () => {
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.throwDecision('run-1', failureDecision('build'))
    await h.scheduler.evaluate()

    expect(h.abortRun).toHaveBeenCalledWith('run-1')
    expect(h.describeStuckRun.mock.calls[0][0]).toMatchObject({
      nodeId: 'build',
      decision: { source: 'build:command-failed' }
    })
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
  })

  it('只管自己拉起的运行：别人的运行抛决策 → 巡检不插手', async () => {
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.throwDecision('run-of-some-card', manualGate())
    await h.scheduler.evaluate()

    expect(h.abortRun).not.toHaveBeenCalled()
    expect(h.pushCandidates).not.toHaveBeenCalled()
  })

  it('中止后该运行不再计入活跃数，槽位可被自动排程或后续巡检使用', async () => {
    const todo: StoredCard = {
      proposedName: 'c1',
      title: 'c1',
      description: '',
      typeId: 'feature',
      relations: [],
      status: '未开始',
      createdAt: 0,
      updatedAt: 0,
      projectId: 'p1',
      repos: []
    }
    const h = harness([workflowPatrol])
    const started: string[] = []
    // 真身自动排程，上限 1：巡检运行经 listPatrolRuns 计入活跃，与排程共享同一上限、同一 isRunLive。
    const auto = createAutoScheduler({
      listCards: () => [todo],
      getProject: () => PROJECT,
      getRegistry: () => typeArchetypeMap(DEFAULT_CARD_TYPES),
      canDerive: () => true,
      isRunLive: h.isRunLive,
      startCard: (c) => started.push(c.proposedName),
      listPatrolRuns: () => [{ runId: 'run-1', repos: ['web'] }],
      maxConcurrent: 1
    })

    await h.scheduler.evaluate()
    expect(auto.freeSlots()).toBe(0) // 巡检运行占住唯一的槽
    await auto.evaluate()
    expect(started).toEqual([])

    h.throwDecision('run-1', manualGate())
    await h.scheduler.evaluate()

    expect(h.isRunLive('run-1')).toBe(false) // 已被中止到终局
    expect(auto.freeSlots()).toBe(1) // 槽位释放
    await auto.evaluate()
    expect(started).toEqual(['c1']) // 排程补位
  })

  it('巡检运行绝不停在 waiting-decision 上（推候选那侧炸了也照样已中止）', async () => {
    const h = harness([workflowPatrol], {
      pushCandidates: () => {
        throw new Error('推候选炸了')
      }
    })
    await h.scheduler.evaluate()
    h.throwDecision('run-1', manualGate())
    await h.scheduler.evaluate()

    // 中止在推候选之前发生，故产出侧炸了也不会把运行晾在待决策上。
    expect(h.runStates.get('run-1')).toBe('aborted')
    expect(h.isRunLive('run-1')).toBe(false)
  })

  it('中止接缝自己抛 → 情形照样转成候选卡（不把问题咽掉）', async () => {
    const h = harness([workflowPatrol], {
      abortRun: async () => {
        throw new Error('中止失败')
      }
    })
    await h.scheduler.evaluate()
    h.throwDecision('run-1', manualGate())
    await h.scheduler.evaluate()
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
  })

  it('同一运行的重复决策事件 → 只中止一次、只推一张候选', async () => {
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.throwDecision('run-1', manualGate())
    h.throwDecision('run-1', manualGate())
    await h.scheduler.evaluate()
    expect(h.abortRun).toHaveBeenCalledTimes(1)
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
  })

  it('dispose() → 退订引擎事件，此后不再插手任何运行', async () => {
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.scheduler.dispose()
    h.throwDecision('run-1', manualGate())
    await Promise.resolve()
    expect(h.abortRun).not.toHaveBeenCalled()
  })

  it('巡检运行抛决策后仍不进决策收件箱（它不绑卡，收件箱不投影它）', async () => {
    const runId = 'run-1'
    const breakpoint: RunBreakpoint = {
      runId,
      request: { workflowId: 'wf-nightly', repoPath: '/r', branch: 'b' },
      state: 'waiting-decision',
      currentNodeId: 'review',
      phase: { kind: 'gate', index: 0 },
      pendingDecision: manualGate('review'),
      pendingSince: 1_000
    }
    let toInbox: (evt: EngineProgressEvent) => void = () => {}
    const inbox = createDecisionInbox({
      onEngineProgress: (handler) => {
        toInbox = handler
        return () => {}
      },
      listBreakpoints: () => [breakpoint],
      getBreakpoint: (id) => (id === runId ? breakpoint : null),
      listCards: () => [] // 巡检运行不绑卡 → 收件箱按 activeRunId 反查不到它
    })
    inbox.rebuild()
    const h = harness([workflowPatrol])
    await h.scheduler.evaluate()
    h.throwDecision(runId, manualGate('review'))
    toInbox({ kind: 'decision', runId, decision: manualGate('review') })
    await h.scheduler.evaluate()

    expect(inbox.list()).toEqual([]) // 收件箱一条没有——正因如此才必须中止转候选
    expect(h.abortRun).toHaveBeenCalledWith(runId)
    expect(h.pushCandidates).toHaveBeenCalledTimes(1)
    inbox.dispose()
  })
})

describe('createPatrolScheduler —— 并发槽共享：槽满跳过不排队', () => {
  it('槽满时到期 → 本次不发起，但 lastRunAt 照常更新（不排队）', async () => {
    const h = harness([patrol()], { hasFreeSlot: () => false })
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
    expect(h.markRun).toHaveBeenCalledWith('pt-1', NOW)
    // 不排队：空槽出来后也不会补跑本次，等下个周期。
    await h.scheduler.evaluate()
    expect(h.scanDocuments).not.toHaveBeenCalled()
  })

  it('本轮先起的运行占掉最后一个槽 → 同轮后续巡检跳过', async () => {
    let free = 1
    const h = harness(
      [
        patrol({ id: 'a', action: { kind: 'workflow', workflowId: 'wf-a' } }),
        patrol({ id: 'b', action: { kind: 'workflow', workflowId: 'wf-b' } })
      ],
      {
        hasFreeSlot: () => free > 0,
        startWorkflow: vi.fn(() => {
          free -= 1
          return 'run-x'
        })
      }
    )
    await h.scheduler.evaluate()
    expect(h.startWorkflow).toHaveBeenCalledTimes(1)
    expect(h.startWorkflow.mock.calls[0][0]).toBe('wf-a')
    // 两条都记了时：跳过的那条等下个周期，不排队。
    expect(h.markRun).toHaveBeenCalledTimes(2)
  })
})
