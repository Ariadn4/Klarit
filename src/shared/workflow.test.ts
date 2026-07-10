import { describe, it, expect } from 'vitest'
import type { WorkflowDefinition, WorkflowNode } from './types'
import {
  isSafeRelativePath,
  validateWorkflow,
  checkBranchPairing,
  createAcceptanceSampleWorkflow,
  createRollbackSampleWorkflow,
  createDefaultWorkflow,
  createDefaultWorkflowPr,
  workflowSummary,
  migrateWorkflowShape,
  ENGINE_OPERATIONS,
  engineOpCapabilities
} from './workflow'

function node(over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'n1',
    name: { zh: '写代码' },
    stageId: 's1',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现需求' } },
    outputs: [],
    ...over
  }
}

function workflow(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: { zh: '默认工作流' },
    stages: [{ id: 's1', name: { zh: '开发' } }],
    nodes: [node()],
    ...over
  }
}

describe('isSafeRelativePath', () => {
  it('接受合规相对路径', () => {
    expect(isSafeRelativePath('docs/report.md')).toBe(true)
    expect(isSafeRelativePath('skills/review.md')).toBe(true)
    expect(isSafeRelativePath('a')).toBe(true)
  })

  it('拒绝绝对路径（POSIX / Windows 盘符 / UNC）', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:\\Users\\x')).toBe(false)
    expect(isSafeRelativePath('\\\\server\\share')).toBe(false)
  })

  it('拒绝含 .. 段与空串', () => {
    expect(isSafeRelativePath('../escape')).toBe(false)
    expect(isSafeRelativePath('a/../b')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
    expect(isSafeRelativePath('   ')).toBe(false)
  })
})

describe('engineOpCapabilities', () => {
  it('封闭操作集为 8 个 git/worktree/fs 操作', () => {
    expect([...ENGINE_OPERATIONS]).toEqual([
      'create-branch',
      'open-worktree',
      'link-env',
      'merge-branch',
      'push-branch',
      'remove-worktree',
      'delete-branch',
      'delete-remote-branch'
    ])
  })

  it('除 push-branch 外三项能力皆为否；push-branch 仅 supportsGate 为真', () => {
    for (const op of ENGINE_OPERATIONS) {
      expect(engineOpCapabilities(op)).toEqual({
        producesOutputs: false,
        supportsGate: op === 'push-branch',
        supportsWritableScope: false
      })
    }
  })

  it('复合别名 delete-branch-worktree 回落为三项皆否（仍被识别、不在下拉）', () => {
    expect(engineOpCapabilities('delete-branch-worktree')).toEqual({
      producesOutputs: false,
      supportsGate: false,
      supportsWritableScope: false
    })
    expect([...ENGINE_OPERATIONS]).not.toContain('delete-branch-worktree')
  })

  it('空串/未知操作回落为三项皆否，不抛异常', () => {
    const none = { producesOutputs: false, supportsGate: false, supportsWritableScope: false }
    expect(engineOpCapabilities('')).toEqual(none)
    expect(engineOpCapabilities('totally-unknown-op')).toEqual(none)
  })
})

describe('validateWorkflow', () => {
  it('完整合法工作流通过', () => {
    expect(validateWorkflow(workflow())).toEqual({ ok: true })
  })

  it('id / 显示名为空判非法', () => {
    expect(validateWorkflow(workflow({ id: '' })).ok).toBe(false)
    expect(validateWorkflow(workflow({ name: { zh: '   ' } })).ok).toBe(false)
  })

  it('节点执行者类型非法判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'nope' } as never })] })).ok).toBe(false)
  })

  it('节点 stageId 未引用有效阶段判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ stageId: 'missing' })] })).ok).toBe(false)
  })

  it('engine / command / subworkflow 缺驱动指令判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'engine', operation: '' } })] })).ok).toBe(false)
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: '' }] } })] })).ok).toBe(false)
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'subworkflow', workflowId: '' } })] })).ok).toBe(false)
  })

  it('command 命令列表：至少一条、各条命令行非空', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'npm test' }] } })] }))).toEqual({ ok: true })
    // 两条命令均合法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'serve-a' }, { command: 'serve-b', label: '前端' }] } })] }))).toEqual({ ok: true })
    // 空数组非法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [] } })] })).ok).toBe(false)
    // 某条命令行为空非法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'ok' }, { command: '  ' }] } })] })).ok).toBe(false)
  })

  it('command 前置检查命令：缺省合法、声明则非空（逐条）', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'deploy', check: 'is-deployed' }] } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'deploy', check: '  ' }] } })] })).ok).toBe(false)
  })

  it('超时秒数：缺省合法、正数合法、0/负数/非数值判非法', () => {
    const cmd = (timeoutSec: unknown): WorkflowDefinition =>
      workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x', timeoutSec }] } as never })] })
    expect(validateWorkflow(cmd(undefined))).toEqual({ ok: true })
    expect(validateWorkflow(cmd(30))).toEqual({ ok: true })
    expect(validateWorkflow(cmd(0)).ok).toBe(false)
    expect(validateWorkflow(cmd(-5)).ok).toBe(false)
    expect(validateWorkflow(cmd('20')).ok).toBe(false)
    // 客观门 timeoutSec
    const gate = workflow({
      nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x' }] }, gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' }, timeoutSec: -1 }] })]
    })
    expect(validateWorkflow(gate).ok).toBe(false)
    // 动作按钮 timeoutSec
    const act = workflow({
      nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x' }] }, gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'serve', timeoutSec: 0 }] }] })]
    })
    expect(validateWorkflow(act).ok).toBe(false)
  })

  it('迁移：旧单命令 command 归一为 commands[]，保留 check/timeoutSec 与门超时', () => {
    const raw = {
      id: 'wf-1',
      name: 'x',
      stages: [{ id: 's1', name: '开发' }],
      nodes: [
        {
          id: 'n1',
          name: 'c',
          stageId: 's1',
          executor: { kind: 'command', command: 'serve', check: 'is-up', timeoutSec: 10 },
          outputs: [],
          gate: [
            { kind: 'auto', check: { kind: 'inline', command: 'lint' }, timeoutSec: 20 },
            { kind: 'manual', actions: [{ label: '启动', command: 'npm start', timeoutSec: 30 }] }
          ]
        }
      ]
    }
    const def = migrateWorkflowShape(raw)
    expect(def.nodes[0].executor).toEqual({ kind: 'command', commands: [{ command: 'serve', check: 'is-up', timeoutSec: 10 }] })
    const gates = def.nodes[0].gate!
    expect((gates[0] as { timeoutSec?: number }).timeoutSec).toBe(20)
    expect((gates[1] as { actions: Array<{ timeoutSec?: number }> }).actions[0].timeoutSec).toBe(30)
    expect(validateWorkflow(def)).toEqual({ ok: true })
  })

  it('迁移：新形状 commands[] 幂等（含 label）', () => {
    const raw = {
      id: 'wf-1',
      name: 'x',
      stages: [{ id: 's1', name: '开发' }],
      nodes: [{ id: 'n1', name: 'c', stageId: 's1', executor: { kind: 'command', commands: [{ command: 'a', label: 'A' }, { command: 'b' }] }, outputs: [] }]
    }
    const def = migrateWorkflowShape(raw)
    expect(def.nodes[0].executor).toEqual({ kind: 'command', commands: [{ command: 'a', label: 'A' }, { command: 'b' }] })
  })

  it('agent file 形态：绝对路径或 .. 判非法', () => {
    const abs = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: '/abs/skill.md' } } })] })
    const esc = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: '../skill.md' } } })] })
    const r1 = validateWorkflow(abs)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/路径|skill\.md/)
    expect(validateWorkflow(esc).ok).toBe(false)
  })

  it('agent file 形态：包内相对路径通过', () => {
    const ok = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: 'skills/review.md' } } })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('产出 file 路径非法（绝对/..）判非法', () => {
    const abs = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: '/abs/report.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(abs).ok).toBe(false)
    const esc = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: '../report.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(esc).ok).toBe(false)
  })

  it('产出路径非 .md 判非法', () => {
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/report.txt' }, template: { kind: 'none' }, required: true }] })] })
    const r = validateWorkflow(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/markdown|\.md/)
  })

  it('合法 file 产出（不声明模板 / 引用模板）通过', () => {
    const none = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/change/spec.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(none)).toEqual({ ok: true })
    const ref = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/change/spec.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 'spec-template' } }, required: true }] })] })
    expect(validateWorkflow(ref)).toEqual({ ok: true })
  })

  it('可写范围路径非法判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ writableScope: ['../outside'] })] })).ok).toBe(false)
  })

  it('自动校验命令行：缺命令判非法、有命令通过', () => {
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'inline', command: '' } }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'inline', command: 'npm test' } }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('自动校验引用：条目 id 非空通过、空判非法；不强制引用存在', () => {
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: 'p', itemId: 'run-tests' } } }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: '', itemId: '' } } }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('产出模板引用：条目 id 非空通过、空判非法', () => {
    const ok = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 'spec-template' } }, required: false }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: '' } }, required: false }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('自动校验检查项目标须匹配本节点产出路径', () => {
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'none' }, required: true }], gate: [{ kind: 'auto', check: { kind: 'inline', command: 'x' }, targets: ['b.md'] }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'none' }, required: true }], gate: [{ kind: 'auto', check: { kind: 'inline', command: 'x' }, targets: ['a.md'] }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('人工评审动作按钮缺名称/命令判非法；零动作合法', () => {
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'manual', actions: [{ label: '启动', command: '' }] }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'npm start' }] }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    // 无动作按钮（零）也合法
    expect(validateWorkflow(workflow({ nodes: [node({ gate: [{ kind: 'manual' }] })] }))).toEqual({ ok: true })
  })

  it('agent 不声明 exec 合法；声明 exec 各字段合法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } } })] }))).toEqual({ ok: true })
    const withExec = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, exec: { toolId: 'claude-code', model: 'opus' } } })] })
    expect(validateWorkflow(withExec)).toEqual({ ok: true })
  })

  it('未声明 newRequirementInstruction 合法', () => {
    expect(validateWorkflow(workflow())).toEqual({ ok: true })
  })

  it('newRequirementInstruction：inline 文本与 file 合规相对路径通过', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'inline', text: '把描述分解成多张卡' } }))
    ).toEqual({ ok: true })
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: 'skills/decompose.md' } }))
    ).toEqual({ ok: true })
  })

  it('newRequirementInstruction：越界 file 路径被拒', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: '../escape.md' } })).ok
    ).toBe(false)
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: 'C:\\abs.md' } })).ok
    ).toBe(false)
  })

  it('newRequirementInstruction：形态非法被拒', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'whatever' } as never })).ok
    ).toBe(false)
  })
})

describe('validateWorkflow — 节点目标仓选择 target', () => {
  const engineNode = (over: Partial<WorkflowNode> = {}): WorkflowNode =>
    node({ id: 'e1', name: { zh: '建分支' }, executor: { kind: 'engine', operation: 'create-branch' }, ...over })

  it('缺省 target 合法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode()] }))).toEqual({ ok: true })
  })

  it('target=all 合法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'all' } })] }))).toEqual({ ok: true })
  })

  it('target=tag：标签非空合法、空判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'tag', tag: '后端' } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'tag', tag: '  ' } })] })).ok).toBe(false)
  })

  it('target=repo：memberId 非空合法、空判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'repo', memberId: 'm1' } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'repo', memberId: '' } })] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用前置且声明结构化输出的 agent 节点合法', () => {
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: '判涉及仓' }, structuredOutput: { repos: true } }
    })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    expect(validateWorkflow(workflow({ nodes: [agent, eng] }))).toEqual({ ok: true })
  })

  it('target=fromUpstream：引用不存在的节点判非法', () => {
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: '不存在' } })
    expect(validateWorkflow(workflow({ nodes: [eng] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用后置节点判非法', () => {
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, structuredOutput: { repos: true } }
    })
    // eng 在前、agent 在后 → 非法
    expect(validateWorkflow(workflow({ nodes: [eng, agent] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用非 agent 节点判非法', () => {
    const notAgent = node({ id: 'c1', name: { zh: '命令' }, executor: { kind: 'command', commands: [{ command: 'x' }] } })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'c1' } })
    expect(validateWorkflow(workflow({ nodes: [notAgent, eng] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用的 agent 未声明结构化输出判非法', () => {
    const agent = node({ id: 'a1', name: { zh: '普通 agent' }, executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } } })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    expect(validateWorkflow(workflow({ nodes: [agent, eng] })).ok).toBe(false)
  })

  it('agent 节点声明结构化输出本身合法', () => {
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, structuredOutput: { repos: true } }
    })
    expect(validateWorkflow(workflow({ nodes: [agent] }))).toEqual({ ok: true })
  })
})

describe('checkBranchPairing', () => {
  const engineNode = (id: string, operation: string): WorkflowNode =>
    node({ id, name: { zh: id }, executor: { kind: 'engine', operation } })

  it('建分支无删分支判无效，带可读原因', () => {
    const def = workflow({ nodes: [engineNode('c', 'create-branch')] })
    const r = checkBranchPairing(def)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/create-branch/)
      expect(r.reason).toMatch(/delete-branch/)
    }
  })

  it('建分支且有删分支判有效', () => {
    const def = workflow({
      nodes: [engineNode('c', 'create-branch'), engineNode('d', 'delete-branch-worktree')]
    })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
  })

  it('既不建分支也不删分支判有效（无分支可泄漏）', () => {
    expect(checkBranchPairing(workflow())).toEqual({ ok: true })
    // 只删不建也有效（不做反向校验）
    expect(checkBranchPairing(workflow({ nodes: [engineNode('d', 'delete-branch-worktree')] }))).toEqual({ ok: true })
  })

  it('默认种子工作流通过分支配对校验', () => {
    expect(checkBranchPairing(createDefaultWorkflow('seed-x'))).toEqual({ ok: true })
  })
})

describe('createDefaultWorkflow', () => {
  it('用注入 id 生成合法的、以 engine 操作为主的线性工作流', () => {
    const def = createDefaultWorkflow('seed-1')
    expect(def.id).toBe('seed-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    const engineNodes = def.nodes.filter((n) => n.executor.kind === 'engine')
    expect(engineNodes.length).toBeGreaterThanOrEqual(3)
    const ops = engineNodes.map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toContain('create-branch')
    expect(ops).toContain('open-worktree')
    expect(ops).toContain('merge-branch')
    // 每个节点都归属一个已声明的阶段
    const stageIds = new Set(def.stages.map((s) => s.id))
    expect(def.nodes.every((n) => stageIds.has(n.stageId))).toBe(true)
  })

  it('本地直合默认含新词表交付段（合并/push/删 worktree/删本地分支）', () => {
    const ops = createDefaultWorkflow('seed-2')
      .nodes.filter((n) => n.executor.kind === 'engine')
      .map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toEqual([
      'create-branch',
      'open-worktree',
      'link-env',
      'merge-branch',
      'push-branch',
      'remove-worktree',
      'delete-branch'
    ])
  })
})

describe('createDefaultWorkflowPr', () => {
  it('合法、过分支配对，交付段含 push 需求分支/人工门/删云端分支', () => {
    const def = createDefaultWorkflowPr('pr-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
    const engineNodes = def.nodes.filter((n) => n.executor.kind === 'engine')
    const ops = engineNodes.map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toContain('push-branch')
    expect(ops).toContain('delete-remote-branch')
    expect(ops).toContain('delete-branch')
    // push 需求分支节点挂了人工评审门
    const pushFeature = def.nodes.find((n) => n.id === 'push-feature')
    expect(pushFeature?.gate?.[0]?.kind).toBe('manual')
  })

  it('两个默认工作流都通过分支配对校验', () => {
    expect(checkBranchPairing(createDefaultWorkflow('a'))).toEqual({ ok: true })
    expect(checkBranchPairing(createDefaultWorkflowPr('b'))).toEqual({ ok: true })
  })
})

describe('createAcceptanceSampleWorkflow', () => {
  it('合法、含三个验收面:两前台命令 / 两后台命令 / 两门动作按钮', () => {
    const def = createAcceptanceSampleWorkflow('acc-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    const fg = def.nodes.find((n) => n.id === 'two-foreground')!
    expect(fg.executor.kind === 'command' && fg.executor.commands).toHaveLength(2)
    const bg = def.nodes.find((n) => n.id === 'two-background')!
    expect(bg.executor.kind === 'command' && bg.executor.commands).toHaveLength(2)
    const gate = def.nodes.find((n) => n.id === 'two-gate-actions')!
    expect(gate.gate?.[0]?.kind).toBe('manual')
    const actions = gate.gate?.[0]?.kind === 'manual' ? gate.gate[0].actions : []
    expect(actions).toHaveLength(2)
  })
})

describe('createRollbackSampleWorkflow', () => {
  it('合法、过分支配对，含 plan(产 PLAN.md)/implement(agent)/评审门', () => {
    const def = createRollbackSampleWorkflow('rb-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
    const plan = def.nodes.find((n) => n.id === 'plan')!
    expect(plan.executor.kind).toBe('agent')
    expect(plan.outputs.map((o) => o.destination.path)).toContain('PLAN.md')
    expect(plan.outputs.find((o) => o.destination.path === 'PLAN.md')?.required).toBe(true)
    const impl = def.nodes.find((n) => n.id === 'implement')!
    expect(impl.executor.kind).toBe('agent')
    // 评审节点挂人工评审门（驳回入口）
    const review = def.nodes.find((n) => n.id === 'review')!
    expect(review.gate?.[0]?.kind).toBe('manual')
  })
})

describe('workflowSummary', () => {
  it('有效工作流：提取 id 与 name，不带 invalidReason', () => {
    expect(workflowSummary(workflow({ id: 'x', name: { zh: '流程 X' } }))).toEqual({ id: 'x', name: { zh: '流程 X' } })
  })

  it('无效工作流（建分支无删分支）：摘要带 invalidReason', () => {
    const def = workflow({
      id: 'y',
      name: { zh: '流程 Y' },
      nodes: [node({ id: 'c', name: { zh: 'c' }, executor: { kind: 'engine', operation: 'create-branch' } })]
    })
    const s = workflowSummary(def)
    expect(s.id).toBe('y')
    expect(s.name).toEqual({ zh: '流程 Y' })
    expect(s.invalidReason).toMatch(/delete-branch/)
  })
})

describe('migrateWorkflowShape', () => {
  it('对新形状幂等（默认种子往返不变）', () => {
    const def = createDefaultWorkflow('seed')
    expect(migrateWorkflowShape(JSON.parse(JSON.stringify(def)))).toEqual(def)
  })

  it('旧产出有路径→file 目的地+none 模板（丢弃旧 type/format）', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }, outputs: [{ type: 'report', format: 'md', path: 'docs/r.md', required: true }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].outputs).toEqual([
      { destination: { kind: 'file', path: 'docs/r.md' }, template: { kind: 'none' }, required: true }
    ])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧 inline/file 模板 → none（嵌入形态已废）；ref 模板保留', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [
        { destination: { kind: 'file', path: 'a.md' }, template: { kind: 'inline', text: '## x' }, required: false },
        { destination: { kind: 'file', path: 'b.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 't' } }, required: false }
      ] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].outputs[0].template).toEqual({ kind: 'none' })
    expect(migrated.nodes[0].outputs[1].template).toEqual({ kind: 'ref', ref: { packId: 'p', itemId: 't' } })
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧产出无路径（卡片数据）丢弃', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [{ type: 'note', format: 'text', required: false }] }]
    }
    expect(migrateWorkflowShape(old).nodes[0].outputs).toEqual([])
  })

  it('旧检查项：无命令 auto 丢弃、manual 保留为新形状', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [], gate: [{ kind: 'auto', description: '客观' }, { kind: 'manual', description: '人工' }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].gate).toEqual([{ kind: 'manual' }])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧 auto 检查项有命令 → inline 校验', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [], gate: [{ kind: 'auto', description: '客观', command: 'npm test' }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].gate).toEqual([{ kind: 'auto', check: { kind: 'inline', command: 'npm test' } }])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('agent 无 exec 保持原样、迁移后合法', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }, outputs: [] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].executor).toEqual({ kind: 'agent', instruction: { kind: 'inline', text: 'x' } })
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })
})
