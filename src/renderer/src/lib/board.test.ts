import { describe, it, expect } from 'vitest'
import type {
  WorkflowDefinition,
  WorkflowNode,
  NodeExecutor,
  RunBreakpoint,
  RunState,
  NodePhase,
  CardArchetype,
  CardStatus
} from '@shared/types'
import {
  buildBoardColumns,
  cardColumn,
  nodeToStage,
  runDot,
  runStateToCardStatus,
  TODO_COLUMN_KEY,
  DONE_COLUMN_KEY
} from './board'

const LABELS = { todo: '待办', done: '已完成' }

function wf(stages: { id: string; name: string }[]): WorkflowDefinition {
  return { id: 'w', name: { zh: 'W' }, stages: stages.map((s) => ({ id: s.id, name: { zh: s.name } })), nodes: [] }
}

function node(id: string, stageId: string, executor: NodeExecutor, name = id): WorkflowNode {
  return { id, name: { zh: name }, stageId, executor, outputs: [] }
}

const engineExec: NodeExecutor = { kind: 'engine', operation: 'merge-branch' }
const commandExec: NodeExecutor = { kind: 'command', commands: [{ command: 'npm test' }] }
const agentExec: NodeExecutor = { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } }

function wfNodes(): WorkflowDefinition {
  return {
    id: 'w',
    name: { zh: 'W' },
    stages: [
      { id: 's1', name: { zh: '开发' } },
      { id: 's2', name: { zh: '合并' } }
    ],
    nodes: [node('n1', 's1', commandExec, '跑测试'), node('n2', 's2', engineExec, '合并分支')]
  }
}

function bp(over: Partial<RunBreakpoint>): RunBreakpoint {
  return {
    runId: 'r1',
    request: { workflowId: 'w', repoPath: '/repo', cardId: 'c1' },
    state: 'running' as RunState,
    currentNodeId: 'n1',
    phase: { kind: 'executing' } as NodePhase,
    pendingDecision: null,
    ...over
  }
}

function card(over: {
  archetype: CardArchetype
  status?: CardStatus
  hasActiveRun?: boolean
  currentNodeId?: string | null
  runDone?: boolean
}): Parameters<typeof cardColumn>[0] {
  return {
    archetype: over.archetype,
    status: over.status ?? '未开始',
    hasActiveRun: over.hasActiveRun ?? false,
    currentNodeId: over.currentNodeId ?? null,
    runDone: over.runDone ?? false
  }
}

describe('buildBoardColumns', () => {
  it('有激活工作流时为 [待办] + stages + [已完成]，列序与列名与 stages 一致', () => {
    const cols = buildBoardColumns(
      wf([
        { id: 's1', name: '开发' },
        { id: 's2', name: '测试' }
      ]),
      LABELS
    )
    expect(cols.map((c) => c.title)).toEqual(['待办', '开发', '测试', '已完成'])
    expect(cols.map((c) => c.key)).toEqual([TODO_COLUMN_KEY, 's1', 's2', DONE_COLUMN_KEY])
    expect(cols.map((c) => c.kind)).toEqual(['todo', 'stage', 'stage', 'done'])
  })

  it('阶段顺序即列顺序、不去重不重排（同名阶段都保留）', () => {
    const cols = buildBoardColumns(
      wf([
        { id: 'b', name: '复用' },
        { id: 'a', name: '复用' }
      ]),
      LABELS
    )
    // 顺序按声明（b 在 a 前），两个同名阶段都在、不合并。
    expect(cols.map((c) => c.key)).toEqual([TODO_COLUMN_KEY, 'b', 'a', DONE_COLUMN_KEY])
  })

  it('activeWorkflow 为 null 时只返回两列书挡', () => {
    const cols = buildBoardColumns(null, LABELS)
    expect(cols.map((c) => c.key)).toEqual([TODO_COLUMN_KEY, DONE_COLUMN_KEY])
    expect(cols.map((c) => c.kind)).toEqual(['todo', 'done'])
  })

  it('书挡用固定 sentinel key 恒在首尾；阶段名恰为「待办/已完成」仍独立成中间列、key 不冲突', () => {
    const cols = buildBoardColumns(
      wf([
        { id: 'x', name: '待办' },
        { id: 'y', name: '已完成' }
      ]),
      LABELS
    )
    expect(cols[0].key).toBe(TODO_COLUMN_KEY)
    expect(cols[cols.length - 1].key).toBe(DONE_COLUMN_KEY)
    // 同名阶段以自身 id 作 key，与 sentinel 不同。
    expect(cols.map((c) => c.key)).toEqual([TODO_COLUMN_KEY, 'x', 'y', DONE_COLUMN_KEY])
    expect(cols.filter((c) => c.kind === 'stage')).toHaveLength(2)
  })
})

describe('nodeToStage', () => {
  it('建 nodeId → stageId 索引', () => {
    expect(nodeToStage(wfNodes())).toEqual({ n1: 's1', n2: 's2' })
  })
  it('工作流为 null 返回空索引', () => {
    expect(nodeToStage(null)).toEqual({})
  })
})

describe('cardColumn', () => {
  const w = wfNodes()

  it('container 恒在待办（子卡未全归档）', () => {
    expect(cardColumn(card({ archetype: 'container' }), w, { allChildrenDone: false })).toBe(
      TODO_COLUMN_KEY
    )
  })

  it('container 子卡全归档进已完成', () => {
    expect(cardColumn(card({ archetype: 'container' }), w, { allChildrenDone: true })).toBe(
      DONE_COLUMN_KEY
    )
  })

  it('leaf 未开始 / 无运行 → 待办', () => {
    expect(cardColumn(card({ archetype: 'leaf', status: '未开始' }), w)).toBe(TODO_COLUMN_KEY)
    expect(
      cardColumn(card({ archetype: 'leaf', status: '进行中', hasActiveRun: false }), w)
    ).toBe(TODO_COLUMN_KEY)
  })

  it('leaf 已完成 → 已完成', () => {
    expect(cardColumn(card({ archetype: 'leaf', status: '已完成', hasActiveRun: true }), w)).toBe(
      DONE_COLUMN_KEY
    )
  })

  it('leaf 进行中 → 当前节点所属 stage 列', () => {
    expect(
      cardColumn(
        card({ archetype: 'leaf', status: '进行中', hasActiveRun: true, currentNodeId: 'n2' }),
        w
      )
    ).toBe('s2')
  })

  it('leaf 等待决策仍按当前节点入列（列与状态正交）', () => {
    expect(
      cardColumn(
        card({ archetype: 'leaf', status: '等待决策', hasActiveRun: true, currentNodeId: 'n1' }),
        w
      )
    ).toBe('s1')
  })

  it('currentNodeId 无法映射到 stage 列时回落待办', () => {
    expect(
      cardColumn(
        card({ archetype: 'leaf', status: '进行中', hasActiveRun: true, currentNodeId: 'ghost' }),
        w
      )
    ).toBe(TODO_COLUMN_KEY)
  })

  it('leaf 运行已 done 但卡状态尚未跟上（currentNodeId=null）→ 仍归已完成、不闪待办', () => {
    // 完成瞬间的竞态：断点已 done（currentNodeId 归 null），卡状态还停在进行中/等待决策。
    expect(
      cardColumn(
        card({
          archetype: 'leaf',
          status: '进行中',
          hasActiveRun: true,
          currentNodeId: null,
          runDone: true
        }),
        w
      )
    ).toBe(DONE_COLUMN_KEY)
    expect(
      cardColumn(
        card({
          archetype: 'leaf',
          status: '等待决策',
          hasActiveRun: true,
          currentNodeId: null,
          runDone: true
        }),
        w
      )
    ).toBe(DONE_COLUMN_KEY)
  })
})

describe('runStateToCardStatus — 活跃运行态 → 卡状态（实时显示，不读陈旧 card.status）', () => {
  it('running→进行中、waiting-decision→等待决策、paused→已暂停、done→已完成、aborted→null', () => {
    expect(runStateToCardStatus('running')).toBe('进行中')
    expect(runStateToCardStatus('waiting-decision')).toBe('等待决策')
    expect(runStateToCardStatus('paused')).toBe('已暂停')
    expect(runStateToCardStatus('done')).toBe('已完成')
    expect(runStateToCardStatus('aborted')).toBeNull()
  })
})

describe('runDot', () => {
  const w = wfNodes()

  it('waiting-decision → 静止红', () => {
    const d = runDot(bp({ state: 'waiting-decision', currentNodeId: 'n2' }), w)
    expect(d).toMatchObject({ shape: 'static', color: 'red', state: 'waiting-decision' })
    expect(d?.nodeLabel).toBe('合并分支')
  })

  it('gate 阶段 → 呼吸黄（检查中）', () => {
    const d = runDot(bp({ phase: { kind: 'gate', index: 0 }, currentNodeId: 'n1' }), w)
    expect(d).toMatchObject({ shape: 'breathing', color: 'amber', state: 'checking' })
  })

  it('executing 引擎/命令节点 → 呼吸蓝（工作中）', () => {
    const d = runDot(bp({ phase: { kind: 'executing' }, currentNodeId: 'n2' }), w)
    expect(d).toMatchObject({ shape: 'breathing', color: 'blue', state: 'working' })
    expect(d?.nodeLabel).toBe('合并分支')
  })

  it('executing agent 节点 → 呼吸紫（留口，构造断点断言）', () => {
    const wAgent: WorkflowDefinition = {
      ...w,
      nodes: [node('a1', 's1', agentExec, '思考')]
    }
    const d = runDot(bp({ phase: { kind: 'executing' }, currentNodeId: 'a1' }), wAgent)
    expect(d).toMatchObject({ shape: 'breathing', color: 'violet', state: 'working' })
  })

  it('nodePath 末项作当前节点名（子工作流穿透留口）', () => {
    const d = runDot(bp({ phase: { kind: 'executing' }, currentNodeId: 'n1', nodePath: ['n2'] }), w)
    expect(d?.nodeLabel).toBe('合并分支')
  })

  it('done / aborted / 无运行 → 无圆点', () => {
    expect(runDot(bp({ phase: { kind: 'done' } }), w)).toBeNull()
    expect(runDot(null, w)).toBeNull()
    expect(runDot(bp({ state: 'aborted' }), w)).toBeNull()
  })

  it('paused（已暂停）→ 呼吸变静止 + paused:true，颜色/state 语义不变（暂停不塞进括号文案）', () => {
    // 暂停在命令节点执行 → 静止蓝点、state 仍 working、paused:true。
    const d = runDot(bp({ state: 'paused', phase: { kind: 'executing' }, currentNodeId: 'n2' }), w)
    expect(d).toMatchObject({ shape: 'static', color: 'blue', state: 'working', paused: true })
    expect(d?.nodeLabel).toBe('合并分支')
    // 暂停在过门 → 静止黄点、state 仍 checking、paused:true。
    const g = runDot(bp({ state: 'paused', phase: { kind: 'gate', index: 0 }, currentNodeId: 'n1' }), w)
    expect(g).toMatchObject({ shape: 'static', color: 'amber', state: 'checking', paused: true })
  })

  it('运行中 paused:false', () => {
    const d = runDot(bp({ phase: { kind: 'executing' }, currentNodeId: 'n2' }), w)
    expect(d).toMatchObject({ shape: 'breathing', paused: false })
  })

  it('暂停一个"待决策"的运行 → 仍是红点(不因阶段变蓝)、state 仍 waiting-decision、paused:true', () => {
    const dec = {
      source: 'n1:cmd',
      sourceKind: 'engine' as const,
      titleKey: 'engineDecision.commandFailed',
      options: [{ id: 'retry', labelKey: 'x' }]
    }
    // 命令失败抛决策后被暂停:state=paused 但仍带 pendingDecision、phase 仍 executing。
    const d = runDot(
      bp({ state: 'paused', phase: { kind: 'executing' }, currentNodeId: 'n1', pendingDecision: dec }),
      w
    )
    expect(d).toMatchObject({ shape: 'static', color: 'red', state: 'waiting-decision', paused: true })
  })
})
