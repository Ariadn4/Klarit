import { describe, it, expect } from 'vitest'
import type { CardOp, CardTypeDef, ConversationMessage, StoredCard, WorkflowDefinition } from '../shared/types'
import { createDefaultWorkflow, workflowSummary } from '../shared/workflow'
import { createOrchestrateSeam, buildOrchestratePrompt, type OpsProducer, type OrchestrateDeps } from './orchestrate-service'

const TYPES: CardTypeDef[] = [
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
  { id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }
]

function card(over: Partial<StoredCard>): StoredCard {
  return {
    proposedName: 'c',
    title: 'C',
    description: '',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

function deps(cards: StoredCard[]): OrchestrateDeps {
  return {
    getCards: () => cards,
    getTypes: () => TYPES,
    getGoals: () => '目标',
    getConstitution: () => ['测试先行']
  }
}

/** 假全局 agent：忽略 prompt，返回预设 ops。 */
const fakeProducer =
  (ops: CardOp[], reply = 'ok'): OpsProducer =>
  async () => ({ ops, reply })

describe('createOrchestrateSeam', () => {
  it('未绑定项目 → 仍照常跑（不再回 unbound 空态）', async () => {
    const ops: CardOp[] = [{ kind: 'create', card: { proposedName: 'x', title: 'X', description: '', typeId: 'feature', relations: [] } }]
    const produce: OpsProducer = async () => ({ ops, reply: '来做个新项目', suggestedProject: { name: '新工具', description: '一个新东西' } })
    const seam = createOrchestrateSeam(deps([]), produce)
    const out = await seam.orchestrate({ intent: '我要做个全新的 X 工具' }, null)
    expect('unbound' in out).toBe(false)
    if ('unbound' in out) return
    expect(out.suggestedProject).toEqual({ name: '新工具', description: '一个新东西' })
    expect(out.issues).toEqual([])
    expect((out.ops[0] as Extract<CardOp, { kind: 'create' }>).card.typeId).toBe('feature')
  })

  it('新项目挑工作流 → 按该工作流类型校验（story 合法、非当前项目类型）', async () => {
    const ops: CardOp[] = [{ kind: 'create', card: { proposedName: 'home', title: '首页', description: '', typeId: 'story', relations: [] } }]
    const produce: OpsProducer = async () => ({ ops, reply: '建新项目', suggestedProject: { name: '新工具', workflowId: 'wf-1' } })
    const d: OrchestrateDeps = {
      ...deps([card({ proposedName: 'x' })]),
      getWorkflows: () => [{ id: 'wf-1', name: '标准流', types: [{ id: 'story', name: 'Story', description: '', archetype: 'leaf' }] }]
    }
    const seam = createOrchestrateSeam(d, produce)
    const out = await seam.orchestrate({ intent: '做个新工具' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    // story 在所选工作流类型里 → 合法，不被纠正
    expect(out.issues).toEqual([])
    expect((out.ops[0] as Extract<CardOp, { kind: 'create' }>).card.typeId).toBe('story')
  })

  it('卡想挂子卡但类型是叶子 → 自动纠到容器类型（保住层级、不丢卡）', async () => {
    // agent 给了个 feature(叶子) 卡却挂了 child 子卡 —— 修复应把它纠到 epic(容器)。
    const ops: CardOp[] = [
      { kind: 'create', card: { proposedName: 'grp', title: '分组', description: '', typeId: 'feature', relations: [{ kind: 'child', target: 'sub' }] } },
      { kind: 'create', card: { proposedName: 'sub', title: '子', description: '', typeId: 'feature', relations: [{ kind: 'parent', target: 'grp' }] } }
    ]
    const produce: OpsProducer = async () => ({ ops, reply: '拆一下', suggestedProject: { name: '新工具' } })
    const seam = createOrchestrateSeam(deps([]), produce)
    const out = await seam.orchestrate({ intent: '做个新工具' }, null)
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.issues).toEqual([]) // 纠正后合法、无丢弃
    expect((out.ops[0] as Extract<CardOp, { kind: 'create' }>).card.typeId).toBe('epic') // 挂子卡的纠到容器
  })

  it('新项目：按默认类型校验 + 纠正未知 typeId → 卡合法', async () => {
    const ops: CardOp[] = [{ kind: 'create', card: { proposedName: 'home', title: '首页', description: '', typeId: 'story', relations: [] } }]
    const produce: OpsProducer = async () => ({ ops, reply: '建新项目', suggestedProject: { name: '新工具' } })
    // deps 的项目类型是 epic/feat（非默认）；但新项目按默认类型 epic/feature/bug 校验，'story' 纠到 'feature'。
    const seam = createOrchestrateSeam(deps([card({ proposedName: 'x' })]), produce)
    const out = await seam.orchestrate({ intent: '做个新工具' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.issues).toEqual([])
    expect((out.ops[0] as Extract<CardOp, { kind: 'create' }>).card.typeId).toBe('feature')
  })

  it('已绑定项目、无新项目意图 → 不带 suggestedProject', async () => {
    const seam = createOrchestrateSeam(deps([card({ proposedName: 'a' })]), fakeProducer([{ kind: 'adjust', target: 'a', patch: { title: 'x' } }]))
    const out = await seam.orchestrate({ intent: '改 a' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.suggestedProject).toBeUndefined()
  })

  it('假 producer 产出合法 ops → 提案无 issue', async () => {
    const cards = [card({ proposedName: 'a' }), card({ proposedName: 'b' })]
    const ops: CardOp[] = [{ kind: 'merge', sources: ['a', 'b'], into: 'a' }]
    const seam = createOrchestrateSeam(deps(cards), fakeProducer(ops, '已合并'))
    const out = await seam.orchestrate({ intent: '把 a b 合并' }, 'p1')
    expect('unbound' in out).toBe(false)
    if ('unbound' in out) return
    expect(out.ops).toEqual(ops)
    expect(out.issues).toEqual([])
    expect(out.reply).toBe('已合并')
  })

  it('纯聊天轮：producer 只回 reply、ops 空 → 提案只有 reply、无 issue', async () => {
    const seam = createOrchestrateSeam(deps([card({ proposedName: 'a' })]), fakeProducer([], '这个方向我觉得可行，你想先做哪块？'))
    const out = await seam.orchestrate({ intent: '你觉得这个方向如何' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.ops).toEqual([])
    expect(out.issues).toEqual([])
    expect(out.reply).toBe('这个方向我觉得可行，你想先做哪块？')
  })

  it('越界结构 op（作用已跑卡）→ 提案带 issue', async () => {
    const cards = [card({ proposedName: 'run', status: '进行中', activeRunId: 'r1' }), card({ proposedName: 'b' })]
    const ops: CardOp[] = [{ kind: 'merge', sources: ['run', 'b'], into: 'b' }]
    const seam = createOrchestrateSeam(deps(cards), fakeProducer(ops))
    const out = await seam.orchestrate({ intent: 'x' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.issues.length).toBeGreaterThan(0)
    expect(out.issues[0].reason).toMatch(/待办|离开/)
  })

  it('producer 抛错 → 优雅降级空提案 + 提示', async () => {
    const failing: OpsProducer = async () => {
      throw new Error('CLI 未装')
    }
    const seam = createOrchestrateSeam(deps([]), failing)
    const out = await seam.orchestrate({ intent: 'x' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.ops).toEqual([])
    expect(out.reply).toMatch(/未能产出|失败|未配置/)
  })

  it('buildOrchestratePrompt：自由对话助手人格 + 回复优先 + 各技能 + 破坏性收边', () => {
    const prompt = buildOrchestratePrompt('【BOARD】', '我的意图', TYPES)
    expect(prompt).toContain('【BOARD】')
    expect(prompt).toContain('我的意图')
    // 自由对话助手人格 + 回复优先 + 纯聊天有效
    expect(prompt).toMatch(/自由(聊天|对话)/)
    expect(prompt).toContain('reply')
    // 各操作技能都在（内联）
    expect(prompt).toContain('新建卡')
    expect(prompt).toContain('拆卡')
    expect(prompt).toContain('并卡')
    expect(prompt).toContain('关系')
    expect(prompt).toContain('新建项目')
    expect(prompt).toContain('"kind": "merge"')
    expect(prompt).toContain('破坏性收边')
  })

  it('buildOrchestratePrompt：带 authoring → 内联写工作流 skill + 可改写工作流摘要 + 活动工作流基准定义', () => {
    const active = createDefaultWorkflow('active-flow')
    const prompt = buildOrchestratePrompt('【BOARD】', '在我的流里加个门', TYPES, false, {
      summaries: [workflowSummary(active), { id: 'other', name: { zh: '另一个流' } }],
      activeWorkflow: active
    })
    // 写工作流 skill 内联（含引擎操作与 baseId 契约）
    expect(prompt).toContain('写工作流')
    expect(prompt).toContain('create-branch')
    expect(prompt).toContain('baseId')
    // 可改写工作流摘要（id + 名）
    expect(prompt).toContain('active-flow')
    expect(prompt).toContain('另一个流')
    // 活动工作流的完整定义作基准（注入其 id 供 agent 以此为起点覆盖）
    expect(prompt).toMatch(/基准|当前工作流|活动工作流/)
  })

  it('buildOrchestratePrompt：无 authoring / 无活动工作流 → 不崩、正常返回', () => {
    expect(() => buildOrchestratePrompt('【BOARD】', 'x', TYPES, false)).not.toThrow()
    const prompt = buildOrchestratePrompt('【BOARD】', 'x', TYPES, false, { summaries: [], activeWorkflow: null })
    expect(prompt).toContain('【BOARD】')
  })

  it('buildOrchestratePrompt：多仓项目 → 列出成员仓与标签供按仓组织', () => {
    const active = createDefaultWorkflow('active-flow')
    const prompt = buildOrchestratePrompt('【BOARD】', 'x', TYPES, false, {
      summaries: [workflowSummary(active)],
      activeWorkflow: active,
      repos: [
        { name: 'web', tag: '前端', memberId: 'm-web' },
        { name: 'api', tag: '后端', memberId: 'm-api' }
      ]
    })
    expect(prompt).toMatch(/多仓|成员仓/)
    expect(prompt).toContain('web')
    expect(prompt).toContain('api')
    expect(prompt).toContain('前端')
    expect(prompt).toContain('后端')
  })

  it('工作流提案（合法）→ out.workflow 带定义与 baseId、issues 空', async () => {
    const def = createDefaultWorkflow('my-flow')
    const produce: OpsProducer = async () => ({ ops: [], reply: '给你加了个门', workflow: { workflow: def, baseId: 'my-flow' } })
    const seam = createOrchestrateSeam(deps([card({ proposedName: 'a' })]), produce)
    const out = await seam.orchestrate({ intent: '改我的流' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.workflow?.workflow.id).toBe('my-flow')
    expect(out.workflow?.baseId).toBe('my-flow')
    expect(out.workflow?.issues).toEqual([])
  })

  it('工作流提案（分支配对不过）→ 自动修复到合法：补删分支节点、issues 空（直接给合法工作流）', async () => {
    // 有 create-branch 却无 delete-branch → repairWorkflow 应补一个 delete-branch，使之合法。
    const leaky: WorkflowDefinition = {
      id: 'leaky',
      name: { zh: '漏分支流' },
      stages: [{ id: 's1', name: { zh: '准备' } }],
      nodes: [{ id: 'cb', name: { zh: '建分支' }, stageId: 's1', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [] }]
    }
    const produce: OpsProducer = async () => ({ ops: [], workflow: { workflow: leaky } })
    const seam = createOrchestrateSeam(deps([]), produce)
    const out = await seam.orchestrate({ intent: '做个流' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.workflow?.issues).toEqual([]) // 修复后合法，无需用户回话调整
    expect(
      out.workflow?.workflow.nodes.some((n) => n.executor.kind === 'engine' && n.executor.operation === 'delete-branch')
    ).toBe(true)
  })

  it('工作流提案（结构非法：无显示名）→ 自动修复填名、issues 空', async () => {
    const bad = { id: 'bad', name: {}, stages: [{ id: 's1', name: { zh: '准备' } }], nodes: [] } as unknown as WorkflowDefinition
    const produce: OpsProducer = async () => ({ ops: [], workflow: { workflow: bad } })
    const seam = createOrchestrateSeam(deps([]), produce)
    const out = await seam.orchestrate({ intent: 'x' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.workflow?.workflow.id).toBe('bad')
    expect(out.workflow?.issues).toEqual([])
  })

  it('无工作流意图 → out.workflow 为 undefined（卡编排路径不回归）', async () => {
    const seam = createOrchestrateSeam(deps([card({ proposedName: 'a' })]), fakeProducer([{ kind: 'adjust', target: 'a', patch: { title: 'x' } }]))
    const out = await seam.orchestrate({ intent: '改 a' }, 'p1')
    if ('unbound' in out) throw new Error('unexpected unbound')
    expect(out.workflow).toBeUndefined()
    expect(out.ops).toHaveLength(1)
  })

  it('改写基准：会话末条 agent 带未存草稿 → 注入草稿定义为基准（覆盖活动工作流）', async () => {
    const active = createDefaultWorkflow('active-flow')
    const draft = createDefaultWorkflow('draft-flow')
    let captured = ''
    const produce: OpsProducer = async (prompt) => {
      captured = prompt
      return { ops: [], reply: 'ok' }
    }
    const history: ConversationMessage[] = [
      { role: 'user', text: '给我写个流', at: 1 },
      { role: 'agent', text: '这是草稿', at: 2, proposal: { ops: [], issues: [], workflow: { workflow: draft, issues: [] } } }
    ]
    const d: OrchestrateDeps = {
      ...deps([card({ proposedName: 'a' })]),
      getActiveWorkflow: () => active,
      getWorkflowSummaries: () => [workflowSummary(active)],
      getHistory: () => history
    }
    const seam = createOrchestrateSeam(d, produce)
    await seam.orchestrate({ intent: '加一道人工验收 manual 门', conversationId: 'c1' }, 'p1')
    // 注入的基准定义是草稿（JSON 形态），而非活动工作流
    expect(captured).toContain('"id":"draft-flow"')
    expect(captured).not.toContain('"id":"active-flow"')
  })

  it('改写基准：会话无未存草稿 → 基准回落活动工作流（原行为不变）', async () => {
    const active = createDefaultWorkflow('active-flow')
    let captured = ''
    const produce: OpsProducer = async (prompt) => {
      captured = prompt
      return { ops: [], reply: 'ok' }
    }
    // 末条 agent 消息只是聊天，无 proposal.workflow 草稿
    const history: ConversationMessage[] = [
      { role: 'user', text: '聊聊', at: 1 },
      { role: 'agent', text: '好啊', at: 2 }
    ]
    const d: OrchestrateDeps = {
      ...deps([card({ proposedName: 'a' })]),
      getActiveWorkflow: () => active,
      getWorkflowSummaries: () => [workflowSummary(active)],
      getHistory: () => history
    }
    const seam = createOrchestrateSeam(d, produce)
    await seam.orchestrate({ intent: '在我的流里加个门', conversationId: 'c1' }, 'p1')
    expect(captured).toContain('"id":"active-flow"')
  })
})
