import { describe, it, expect } from 'vitest'
import type { CardTypeDef, WorkflowDefinition } from '../shared/types'
import { createDefaultWorkflow } from '../shared/workflow'
import { authorWorkflow, type OpsProducer, type OrchestrateDeps } from './orchestrate-service'

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
    const badTemplate: WorkflowDefinition = {
      id: 'bad-tpl',
      name: { zh: '坏模板流' },
      stages: [{ id: 's1', name: { zh: '阶段' } }],
      nodes: [
        {
          id: 'n1',
          name: { zh: '节点' },
          stageId: 's1',
          executor: { kind: 'engine', operation: 'merge-branch' },
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
})
