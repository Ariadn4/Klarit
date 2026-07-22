import { describe, it, expect, vi } from 'vitest'
import type { CandidateCard, CardTypeDef, StoredCard, WorkflowDefinition } from '../shared/types'
import { resolveDecomposePrompt, runDecompose, type ResolveDeps } from './decompose-service'
import { DEFAULT_CARD_TYPES } from '../shared/card-type'

function stored(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'running',
    title: '在跑卡',
    description: '',
    typeId: 'feature',
    relations: [],
    status: '进行中',
    activeRunId: 'r1',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

function wf(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { id: 'wf', name: { zh: '流程' }, stages: [{ id: 's1', name: { zh: '开发' } }], nodes: [], ...over }
}

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    getActiveWorkflowId: () => null,
    getWorkflow: () => null,
    readWorkflowSkill: () => null,
    getTypes: () => [...DEFAULT_CARD_TYPES],
    readOverride: () => null,
    ...over
  }
}

describe('resolveDecomposePrompt', () => {
  it('激活工作流声明 inline 新建需求 prompt → 用之（最高优先）', () => {
    const d = deps({
      getActiveWorkflowId: () => 'wf',
      getWorkflow: () => wf({ newRequirementInstruction: { kind: 'inline', text: '工作流专属分解 prompt' } })
    })
    expect(resolveDecomposePrompt(d)).toBe('工作流专属分解 prompt')
  })

  it('激活工作流声明 file 新建需求 prompt → 读包内 skill 内容', () => {
    const readWorkflowSkill = vi.fn(() => '文件形态分解 prompt')
    const d = deps({
      getActiveWorkflowId: () => 'wf',
      getWorkflow: () => wf({ newRequirementInstruction: { kind: 'file', path: 'skills/decompose.md' } }),
      readWorkflowSkill
    })
    expect(resolveDecomposePrompt(d)).toBe('文件形态分解 prompt')
    expect(readWorkflowSkill).toHaveBeenCalledWith('wf', 'skills/decompose.md')
  })

  it('无工作流 prompt 但有全局覆盖 skill → 用覆盖', () => {
    expect(resolveDecomposePrompt(deps({ readOverride: () => '我的覆盖 skill' }))).toBe('我的覆盖 skill')
  })

  it('无覆盖 → 用由类型注册表自动生成的分解 skill（含类型 id 与描述）', () => {
    const prompt = resolveDecomposePrompt(deps())
    expect(prompt).toContain('feature')
    expect(prompt).toContain('typeId')
    expect(prompt).toContain('可用类型')
  })

  it('改类型描述 → 自动生成 skill 随之变化', () => {
    const custom: CardTypeDef[] = [{ id: 'spike', name: '探路', description: '不确定性高先探路', archetype: 'leaf' }]
    const prompt = resolveDecomposePrompt(deps({ getTypes: () => custom }))
    expect(prompt).toContain('spike')
    expect(prompt).toContain('不确定性高先探路')
  })
})

describe('runDecompose', () => {
  const card = (over: Partial<CandidateCard> = {}): CandidateCard => ({
    proposedName: 'add-dark-mode',
    title: '增加暗色模式',
    description: '给界面加暗色主题',
    typeId: 'feature',
    relations: [],
    ...over
  })

  it('用解析出的 prompt 驱动 producer，并规整+按注册表校验候选返回', async () => {
    const produce = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('可用类型')
      return [card(), card({ title: 'B' })] // 同名 → 规整去重
    })
    const res = await runDecompose({ description: '一大段想法' }, deps(), produce)
    expect(res.candidates.map((c) => c.proposedName)).toEqual(['add-dark-mode', 'add-dark-mode-2'])
    expect(res.issues).toEqual([])
  })

  it('typeId 不在册 → issues 带原因、不静默回落', async () => {
    const produce = async (): Promise<CandidateCard[]> => [card({ typeId: 'unknown-type' })]
    const res = await runDecompose({ description: 'x' }, deps(), produce)
    expect(res.issues.length).toBeGreaterThan(0)
    expect(res.issues.some((i) => /unknown-type|在册|类型/.test(i.reason))).toBe(true)
  })

  it('producer 产出非法候选 → issues 带原因、不抛错', async () => {
    const produce = async (): Promise<CandidateCard[]> => [card({ title: '' })]
    const res = await runDecompose({ description: 'x' }, deps(), produce)
    expect(res.issues.length).toBeGreaterThan(0)
  })

  it('注入现有卡 → 候选 blocked_by 现有在跑卡通过', async () => {
    const produce = async (): Promise<CandidateCard[]> => [
      card({ relations: [{ kind: 'blocked_by', target: 'running' }] })
    ]
    const res = await runDecompose({ description: 'x' }, deps({ getCards: () => [stored()] }), produce)
    expect(res.issues).toEqual([])
  })

  it('注入现有卡 → 候选 blocks 现有在跑卡进 issue', async () => {
    const produce = async (): Promise<CandidateCard[]> => [
      card({ relations: [{ kind: 'blocks', target: 'running' }] })
    ]
    const res = await runDecompose({ description: 'x' }, deps({ getCards: () => [stored()] }), produce)
    expect(res.issues.some((i) => /在运行|blocks|前置|飞行|待办/.test(i.reason))).toBe(true)
  })
})
