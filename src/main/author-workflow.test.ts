import { describe, it, expect } from 'vitest'
import type { CardTypeDef, WorkflowDefinition } from '../shared/types'
import { createDefaultWorkflow, lintWorkflow } from '../shared/workflow'
import {
  authorWorkflow,
  inferScaffoldVariant,
  extractArchiveDocs,
  type OpsProducer,
  type OrchestrateDeps
} from './orchestrate-service'

const TYPES: CardTypeDef[] = [
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
  { id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }
]

function deps(): OrchestrateDeps {
  return {
    getCards: () => [],
    getTypes: () => TYPES,
    getGoals: () => '',
    getConstitution: () => []
  }
}

const SYSTEM_INTENT =
  '这是一个已有项目。请查看它平时怎么使用 AI 编程 agent（如 .claude/、CLAUDE.md、.cursor 等）与它的 git/交付习惯，据此为它写一份贴合的 Klarit 工作流。'

describe('authorWorkflow（无头写工作流核，富结果——区分抛错/空产出/校验不过）', () => {
  it('干净工作流 → { proposal, failure: undefined }，reply 上浮，不碰会话库', async () => {
    const def = createDefaultWorkflow('habit-flow')
    const produce: OpsProducer = async () => ({ ops: [], reply: '照习惯给你搭了个流', workflow: { workflow: def } })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal).not.toBeNull()
    expect(result.proposal?.workflow.id).toBe('habit-flow')
    expect(result.proposal?.issues).toEqual([])
    expect(result.failure).toBeUndefined()
    expect(result.reply).toBe('照习惯给你搭了个流')
  })

  it('产出与聊天路径同构：走同一 repairWorkflow/两闸校验，缺删分支被补齐、issues 空、failure undefined', async () => {
    // 只给 create-branch、缺 delete-branch —— buildWorkflowProposal 内的 repairWorkflow 应补上删分支。
    const leaky: WorkflowDefinition = {
      id: 'leaky',
      name: { zh: '漏分支流' },
      stages: [{ id: 's1', name: { zh: '准备' } }],
      nodes: [
        { id: 'cb', name: { zh: '建分支' }, stageId: 's1', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [] }
      ]
    }
    const produce: OpsProducer = async () => ({ ops: [], workflow: { workflow: leaky } })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal?.issues).toEqual([])
    expect(result.failure).toBeUndefined()
    expect(
      result.proposal?.workflow.nodes.some((n) => n.executor.kind === 'engine' && n.executor.operation === 'delete-branch')
    ).toBe(true)
  })

  it('产出校验不过（issues 非空）→ { proposal, failure: "invalid" }（仍带出提案供调用方决定）', async () => {
    // 一个 repairWorkflow 修不掉的坏产出：产出模板引用了空 packId（validateOutput 会判非法）。
    // 坏产出挂在一个**干活（agent）节点**上——脚手架规整会保留干活节点作 middle，故非法产出仍带进最终提案被判非法。
    const badTemplate: WorkflowDefinition = {
      id: 'bad-tpl',
      name: { zh: '坏模板流' },
      stages: [{ id: 's1', name: { zh: '阶段' } }],
      nodes: [
        {
          id: 'n1',
          name: { zh: '干活节点' },
          stageId: 's1',
          executor: { kind: 'agent', instruction: { kind: 'inline', text: '干活' } },
          outputs: [
            {
              destination: { kind: 'file', path: 'notes.md' },
              template: { kind: 'ref', ref: { packId: '', itemId: 'x' } },
              required: true
            }
          ]
        }
      ]
    }
    const produce: OpsProducer = async () => ({ ops: [], workflow: { workflow: badTemplate } })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal).not.toBeNull()
    expect(result.proposal!.issues.length).toBeGreaterThan(0)
    expect(result.failure).toBe('invalid')
  })

  it('agent 跑通但没产出工作流（纯聊天/只产卡操作）→ { proposal: null, failure: "empty" }', async () => {
    const produce: OpsProducer = async () => ({ ops: [], reply: '我看了看，暂不需要新流' })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal).toBeNull()
    expect(result.failure).toBe('empty')
  })

  it('producer 抛错（agent 未配置/超时）→ { proposal: null, failure: "threw", reply }，不抛', async () => {
    const failing: OpsProducer = async () => {
      throw new Error('CLI 未装')
    }
    const result = await authorWorkflow(deps(), failing, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal).toBeNull()
    expect(result.failure).toBe('threw')
    expect(typeof result.reply).toBe('string')
    expect(result.reply).toContain('agent 调用失败')
  })

  it('自动路产出（脊柱摆错）→ 规整到固定脚手架：固定头 + 干活中间 → 验收门 → 归档(带清单) → 合并 → 清理，lint 干净', async () => {
    // author 产整份、脊柱摆错：归档摆在合并之后、没有固定头、验收门缺失。规整应把干活节点当中间、套固定头/尾。
    const misordered: WorkflowDefinition = {
      id: 'habit',
      name: { zh: '习惯流' },
      stages: [{ id: 's', name: { zh: '干活' } }],
      nodes: [
        // 干活节点（应作 middle 保留）
        { id: 'do-work', name: { zh: '实现' }, stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现需求' } }, outputs: [] },
        // 脊柱摆错：合并在归档之前
        { id: 'merge', name: { zh: '合并' }, stageId: 's', executor: { kind: 'engine', operation: 'merge-branch' }, outputs: [] },
        { id: 'arch', name: { zh: '归档' }, stageId: 's', executor: { kind: 'engine', operation: 'archive-docs', archiveDocs: [{ path: 'README.md', kind: 'dynamic' }] }, outputs: [] }
      ]
    }
    const produce: OpsProducer = async () => ({ ops: [], reply: '按习惯搭了个流', workflow: { workflow: misordered } })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    const wf = result.proposal?.workflow
    expect(wf).toBeTruthy()
    if (!wf) return
    // 固定头（准备段）
    const ops = wf.nodes.map((n) => (n.executor.kind === 'engine' ? n.executor.operation : n.id))
    expect(ops.slice(0, 3)).toEqual(['create-branch', 'open-worktree', 'link-env'])
    // 干活节点作 middle 保留
    expect(wf.nodes.some((n) => n.id === 'do-work')).toBe(true)
    // 顺序钉死：验收门 → 归档 → 合并
    const idxApproval = wf.nodes.findIndex((n) => (n.gate ?? []).some((g) => g.kind === 'manual'))
    const idxArchive = wf.nodes.findIndex((n) => n.executor.kind === 'engine' && n.executor.operation === 'archive-docs')
    const idxMerge = wf.nodes.findIndex((n) => n.executor.kind === 'engine' && n.executor.operation === 'merge-branch')
    expect(idxApproval).toBeGreaterThanOrEqual(0)
    expect(idxApproval).toBeLessThan(idxArchive)
    expect(idxArchive).toBeLessThan(idxMerge)
    // 归档分类配置从 author 的 archive-docs 节点带入固定归档节点
    const archiveNode = wf.nodes.find((n) => n.executor.kind === 'engine' && n.executor.operation === 'archive-docs')
    expect(archiveNode?.executor.kind === 'engine' && archiveNode.executor.archiveDocs).toEqual([{ path: 'README.md', kind: 'dynamic' }])
    // 清理在最后
    expect(ops[ops.length - 1]).toBe('delete-branch')
    // meta.id 透传、无 issues、lint 干净、非失败
    expect(wf.id).toBe('habit')
    expect(result.proposal?.issues).toEqual([])
    expect(lintWorkflow(wf)).toEqual([])
    expect(result.failure).toBeUndefined()
  })

  it('自动路 author 失败（null 提案）→ 原样透传、不套脚手架', async () => {
    const produce: OpsProducer = async () => ({ ops: [], reply: '暂不需要新流' })
    const result = await authorWorkflow(deps(), produce, 'proj-1', SYSTEM_INTENT)
    expect(result.proposal).toBeNull()
    expect(result.failure).toBe('empty')
  })
})

describe('inferScaffoldVariant（从 author 产出推断变体）', () => {
  it('含引擎 open-pr 节点 → pr', () => {
    const def: WorkflowDefinition = {
      id: 'x',
      name: { zh: 'x' },
      stages: [{ id: 's', name: { zh: 's' } }],
      nodes: [{ id: 'p', name: { zh: 'p' }, stageId: 's', executor: { kind: 'engine', operation: 'open-pr' }, outputs: [] }]
    }
    expect(inferScaffoldVariant(def)).toBe('pr')
  })

  it('无 open-pr → local-merge', () => {
    expect(inferScaffoldVariant(createDefaultWorkflow('lm'))).toBe('local-merge')
  })
})

describe('extractArchiveDocs（从 author 产出抽分类归档配置）', () => {
  it('archive-docs 节点带 executor.archiveDocs → 抽出分类配置', () => {
    const def: WorkflowDefinition = {
      id: 'x',
      name: { zh: 'x' },
      stages: [{ id: 's', name: { zh: 's' } }],
      nodes: [{ id: 'a', name: { zh: 'a' }, stageId: 's', executor: { kind: 'engine', operation: 'archive-docs', archiveDocs: [{ path: 'README.md', kind: 'dynamic' }, { path: 'docs/adr.md', kind: 'snapshot' }] }, outputs: [] }]
    }
    expect(extractArchiveDocs(def)).toEqual([
      { path: 'README.md', kind: 'dynamic' },
      { path: 'docs/adr.md', kind: 'snapshot' }
    ])
  })

  it('无 archive-docs 节点 → []', () => {
    expect(extractArchiveDocs(createDefaultWorkflow('lm'))).toEqual([])
  })
})
