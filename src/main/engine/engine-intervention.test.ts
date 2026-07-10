import { describe, it, expect } from 'vitest'
import type { RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import type { AgentRunner } from '../agent/runner'

function agentNode(id: string, name: string, gate?: WorkflowNode['gate']): WorkflowNode {
  return {
    id,
    name: { zh: name },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: name } },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}
const nodePrep: AgentPrep = { prompt: 'NODE', toolId: 'claude-code' }
const MANUAL: WorkflowNode['gate'] = [{ kind: 'manual' }]

function recordingRunner(): AgentRunner & { prompts: string[]; injects: string[] } {
  const r = {
    prompts: [] as string[],
    injects: [] as string[],
    supportsResume: () => true,
    start(spec: Parameters<AgentRunner['start']>[0]): ReturnType<AgentRunner['start']> {
      r.prompts.push(spec.prompt)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    },
    resume(spec: Parameters<AgentRunner['resume']>[0]): ReturnType<AgentRunner['resume']> {
      r.injects.push(spec.inject)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    }
  }
  return r
}

function engineAt(def: WorkflowDefinition, runner: AgentRunner) {
  return createEngine({
    getWorkflow: () => def,
    store: createMemoryRunStore(),
    runAgent: runner,
    prepareAgent: () => nodePrep,
    readHandshake: () => ({ status: 'done' })
  })
}
const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'card-x', worktreePath: '/no/wt', baseBranch: 'main' }

describe('engine.reenter —— 用户可发起的本卡干预入口', () => {
  it('倒回到目标节点并注入指令 → 前向重流回评审门（重入不重置）', async () => {
    const def = wf([agentNode('impl', '实现'), agentNode('review', '验收', MANUAL)])
    const runner = recordingRunner()
    const engine = engineAt(def, runner)
    const atGate = await engine.start(req).settled
    expect(atGate.pendingDecision?.source).toBe('review:manual-gate')
    expect(atGate.furthestNodeId).toBe('review')

    // 用户经单卡 agent 提议「倒回到 impl 并注入新指令」
    const back = await engine.reenter(atGate.runId, 'impl', '改用方案 B 实现').settled
    expect(back.state).toBe('waiting-decision')
    expect(back.pendingDecision?.source).toBe('review:manual-gate') // 前向重流回评审门
    expect(back.furthestNodeId).toBe('review') // 最远进展保留
    const injected = [...runner.prompts, ...runner.injects].join('\n')
    expect(injected).toContain('改用方案 B 实现')
    expect(injected).toContain('前向修复')
  })

  it('目标节点不存在 → 拒绝、不改动运行', async () => {
    const def = wf([agentNode('impl', '实现', MANUAL)])
    const engine = engineAt(def, recordingRunner())
    const atGate = await engine.start(req).settled
    const after = await engine.reenter(atGate.runId, 'ghost-node', 'x').settled
    expect(after.state).toBe('waiting-decision')
    expect(after.pendingDecision?.source).toBe('impl:manual-gate') // 门未动
    expect(after.currentNodeId).toBe('impl')
  })

  it('已完成运行 → reenter 优雅无操作', async () => {
    const def = wf([agentNode('impl', '实现')]) // 无门 → 直接跑完
    const engine = engineAt(def, recordingRunner())
    const done = await engine.start(req).settled
    expect(done.state).toBe('done')
    const after = await engine.reenter(done.runId, 'impl', 'x').settled
    expect(after.state).toBe('done')
  })
})

describe('engine.inject —— 就地向当前执行节点注入', () => {
  it('注入当前节点新指令 → 重跑 executing（指令经续接带入）', async () => {
    const def = wf([agentNode('impl', '实现', MANUAL)])
    const runner = recordingRunner()
    const engine = engineAt(def, runner)
    const atGate = await engine.start(req).settled
    expect(atGate.pendingDecision?.source).toBe('impl:manual-gate')

    const back = await engine.inject(atGate.runId, '补一个边界用例').settled
    // 当前节点重跑后回到门
    expect(back.pendingDecision?.source).toBe('impl:manual-gate')
    // 指令经续接注入（无 session 时走 rebuild prompt，有 session 走 resume inject）
    expect([...runner.prompts, ...runner.injects].join('\n')).toContain('补一个边界用例')
    // 当前节点位置不变
    expect(back.currentNodeId).toBe('impl')
  })

  it('无当前可注入节点（运行已完成）→ 优雅无操作', async () => {
    const def = wf([agentNode('impl', '实现')])
    const engine = engineAt(def, recordingRunner())
    const done = await engine.start(req).settled
    expect(done.state).toBe('done')
    const after = await engine.inject(done.runId, 'x').settled
    expect(after.state).toBe('done')
  })
})

describe('干预活跑运行须先安全挂起', () => {
  /** 首次 agent 拉起挂起（仅 abort 才结束），之后立即结束——模拟「干预时运行正跑到一半」。 */
  function firstHangsRunner(): AgentRunner & { prompts: string[]; injects: string[]; aborted: number } {
    const r = {
      prompts: [] as string[],
      injects: [] as string[],
      aborted: 0,
      supportsResume: () => true,
      start(spec: Parameters<AgentRunner['start']>[0]): ReturnType<AgentRunner['start']> {
        r.prompts.push(spec.prompt)
        if (r.prompts.length === 1) {
          return {
            kill: () => {},
            done: new Promise((res) =>
              spec.signal?.addEventListener('abort', () => {
                r.aborted++
                res({ code: 0, killed: true })
              })
            )
          }
        }
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume(spec: Parameters<AgentRunner['resume']>[0]): ReturnType<AgentRunner['resume']> {
        r.injects.push(spec.inject)
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      }
    }
    return r
  }

  it('对正在驱动的运行发起 reenter → 先在边界挂起（abort）再重入前向重流', async () => {
    const def = wf([agentNode('impl', '实现', MANUAL)])
    const runner = firstHangsRunner()
    const engine = engineAt(def, runner)
    const launched = engine.start(req) // 不 await：impl agent 挂起，运行停在「驱动中」
    await new Promise((r) => setTimeout(r, 15)) // 让驱动真正开始
    expect(runner.aborted).toBe(0)

    // 干预：先安全挂起（abort 首个挂起的 agent），再重入 impl 前向重流回门
    const back = await engine.reenter(launched.runId, 'impl', '换个思路重来').settled
    expect(runner.aborted).toBe(1) // 确曾安全挂起活跑
    expect(back.state).toBe('waiting-decision')
    expect(back.pendingDecision?.source).toBe('impl:manual-gate')
    expect([...runner.prompts, ...runner.injects].join('\n')).toContain('换个思路重来')
    await launched.settled.catch(() => {}) // 原 settled 收尾
  })
})
