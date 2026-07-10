import { describe, it, expect } from 'vitest'
import type { CardOp, CardTypeDef, StoredCard } from '../shared/types'
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
})
