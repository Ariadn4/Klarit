import { describe, it, expect } from 'vitest'
import type { RunBreakpoint, WorkflowNode } from '../../shared/types'
import { deriveLineage, renderLineage, type DiffNames } from './lineage'

function node(id: string, outputs: string[] = []): WorkflowNode {
  return {
    id,
    name: { zh: id },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: 't' } },
    outputs: outputs.map((p) => ({ destination: { kind: 'file', path: p }, template: { kind: 'none' }, required: true }))
  }
}

function bpWith(agentRuns: RunBreakpoint['agentRuns']): RunBreakpoint {
  return {
    runId: 'r',
    request: { workflowId: 'wf', repoPath: '/r', branch: 'b', worktreePath: '/wt', baseBranch: 'main' },
    state: 'running',
    currentNodeId: null,
    phase: { kind: 'executing' },
    pendingDecision: null,
    agentRuns
  }
}

describe('deriveLineage — 产物溯源派生视图', () => {
  it('声明式产出按 node.outputs 路径归到声明它的节点', () => {
    const nodes = [node('plan', ['PLAN.md']), node('impl', [])]
    const entries = deriveLineage(bpWith({}), nodes, () => [])
    expect(entries.find((e) => e.nodeId === 'plan')?.declared).toEqual(['PLAN.md'])
    // impl 无声明式产出、无代码产物 → 不入图
    expect(entries.find((e) => e.nodeId === 'impl')).toBeUndefined()
  })

  it('代码隐式产出按 git diff startSha..commitSha 归到该 agent 节点', () => {
    const nodes = [node('impl')]
    const bp = bpWith({ impl: { startSha: { m1: 'aaa' }, commitSha: { m1: 'bbb' } } })
    const diff: DiffNames = (member, from, to) => (member === 'm1' && from === 'aaa' && to === 'bbb' ? ['src/x.ts', 'src/y.ts'] : [])
    const entries = deriveLineage(bp, nodes, diff)
    expect(entries.find((e) => e.nodeId === 'impl')?.code).toEqual(['src/x.ts', 'src/y.ts'])
  })

  it('多仓：各成员仓 diff 合并去重归到同一节点', () => {
    const nodes = [node('impl')]
    const bp = bpWith({ impl: { startSha: { fe: 'a', be: 'c' }, commitSha: { fe: 'b', be: 'd' } } })
    const diff: DiffNames = (member) => (member === 'fe' ? ['shared.ts', 'fe.ts'] : ['shared.ts', 'be.ts'])
    const entries = deriveLineage(bp, nodes, diff)
    expect(entries[0].code.sort()).toEqual(['be.ts', 'fe.ts', 'shared.ts'])
  })

  it('缺 startSha 或 commitSha 的节点不产代码产物、不入图', () => {
    const nodes = [node('a'), node('b')]
    const bp = bpWith({ a: { startSha: { m: 'x' } }, b: { commitSha: { m: 'y' } } }) // 各缺一个
    const entries = deriveLineage(bp, nodes, () => ['ignored.ts'])
    expect(entries).toEqual([])
  })

  it('同一文件被多节点先后改动 → 归属含全部生产节点（供判定取最早）', () => {
    const nodes = [node('early'), node('late')]
    const bp = bpWith({
      early: { startSha: { m: 'a0' }, commitSha: { m: 'a1' } },
      late: { startSha: { m: 'a1' }, commitSha: { m: 'a2' } }
    })
    const diff: DiffNames = (_m, from) => (from === 'a0' ? ['config.ts'] : ['config.ts', 'more.ts'])
    const entries = deriveLineage(bp, nodes, diff)
    // config.ts 同时挂在 early 与 late 上，判定 agent 可据此取最早的 early
    expect(entries.find((e) => e.nodeId === 'early')?.code).toContain('config.ts')
    expect(entries.find((e) => e.nodeId === 'late')?.code).toContain('config.ts')
  })
})

describe('renderLineage — 溯源渲染为判定 prompt 文本', () => {
  it('列出每节点 id、名与产物', () => {
    const entries = deriveLineage(bpWith({}), [node('plan', ['PLAN.md'])], () => [])
    const text = renderLineage(entries, (id) => (id === 'plan' ? '规划' : id))
    expect(text).toContain('plan')
    expect(text).toContain('规划')
    expect(text).toContain('PLAN.md')
  })

  it('空溯源给占位说明', () => {
    expect(renderLineage([], (id) => id)).toContain('暂无')
  })
})
