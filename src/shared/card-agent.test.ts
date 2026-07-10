import { describe, it, expect } from 'vitest'
import {
  CARD_CONSULT_CONTRACT,
  buildCardConsultPrompt,
  parseCardTurn,
  normalizeInterventions,
  isDestructiveIntervention,
  buildCardConsultContext
} from './card-agent'

describe('CARD_CONSULT_CONTRACT / buildCardConsultPrompt', () => {
  it('内联三类技能与只读红线', () => {
    expect(CARD_CONSULT_CONTRACT).toMatch(/查进度|进度/)
    expect(CARD_CONSULT_CONTRACT).toMatch(/干预/)
    expect(CARD_CONSULT_CONTRACT).toMatch(/塑造需求|upshift/)
    expect(CARD_CONSULT_CONTRACT).toMatch(/只读/)
  })

  it('拼装 prompt = 读上下文 + 契约 + 用户这轮的话', () => {
    const p = buildCardConsultPrompt('（本卡读上下文）', '这卡跑到哪了')
    expect(p).toContain('（本卡读上下文）')
    expect(p).toContain(CARD_CONSULT_CONTRACT)
    expect(p).toContain('这卡跑到哪了')
    // 上下文在契约之前
    expect(p.indexOf('（本卡读上下文）')).toBeLessThan(p.indexOf(CARD_CONSULT_CONTRACT))
  })
})

describe('normalizeInterventions', () => {
  it('收敛 pause/resume', () => {
    expect(normalizeInterventions([{ kind: 'pause' }, { kind: 'resume' }])).toEqual([
      { kind: 'pause' },
      { kind: 'resume' }
    ])
  })

  it('reenter 带 nodeId 与可选指令', () => {
    expect(normalizeInterventions([{ kind: 'reenter', nodeId: 'n2', instruction: '改用 fetch' }])).toEqual([
      { kind: 'reenter', nodeId: 'n2', instruction: '改用 fetch' }
    ])
    // 缺 instruction 合法
    expect(normalizeInterventions([{ kind: 'reenter', nodeId: 'n2' }])).toEqual([{ kind: 'reenter', nodeId: 'n2' }])
  })

  it('reenter 缺 nodeId 丢弃', () => {
    expect(normalizeInterventions([{ kind: 'reenter', instruction: 'x' }])).toEqual([])
  })

  it('inject 须带非空 instruction', () => {
    expect(normalizeInterventions([{ kind: 'inject', instruction: '补一句' }])).toEqual([
      { kind: 'inject', instruction: '补一句' }
    ])
    expect(normalizeInterventions([{ kind: 'inject', instruction: '   ' }])).toEqual([])
    expect(normalizeInterventions([{ kind: 'inject' }])).toEqual([])
  })

  it('adjustCard 收敛 patch 子集', () => {
    expect(
      normalizeInterventions([{ kind: 'adjustCard', patch: { title: 'T', description: 'D', typeId: 'feature', bogus: 1 } }])
    ).toEqual([{ kind: 'adjustCard', patch: { title: 'T', description: 'D', typeId: 'feature' } }])
    // 空 patch 丢弃
    expect(normalizeInterventions([{ kind: 'adjustCard', patch: {} }])).toEqual([])
  })

  it('未知 kind / 非对象 丢弃；非数组 → []', () => {
    expect(normalizeInterventions([{ kind: 'nuke' }, 42, null])).toEqual([])
    expect(normalizeInterventions('nope')).toEqual([])
    expect(normalizeInterventions(undefined)).toEqual([])
  })
})

describe('isDestructiveIntervention', () => {
  it('reenter/inject/adjustCard 破坏性；pause/resume 非', () => {
    expect(isDestructiveIntervention({ kind: 'reenter', nodeId: 'n' })).toBe(true)
    expect(isDestructiveIntervention({ kind: 'inject', instruction: 'x' })).toBe(true)
    expect(isDestructiveIntervention({ kind: 'adjustCard', patch: { title: 'x' } })).toBe(true)
    expect(isDestructiveIntervention({ kind: 'pause' })).toBe(false)
    expect(isDestructiveIntervention({ kind: 'resume' })).toBe(false)
  })
})

describe('parseCardTurn', () => {
  it('结构化 JSON 取 reply + interventions', () => {
    const out = parseCardTurn('{ "reply": "好的，暂停这卡", "interventions": [ { "kind": "pause" } ] }')
    expect(out.reply).toBe('好的，暂停这卡')
    expect(out.interventions).toEqual([{ kind: 'pause' }])
    expect(out.upshift).toBeUndefined()
  })

  it('取 upshift；upshift 存在时不带 interventions（互斥，上抛优先）', () => {
    const out = parseCardTurn(
      '{ "reply": "这像是新需求", "upshift": { "intent": "加个导出功能" }, "interventions": [ { "kind": "pause" } ] }'
    )
    expect(out.upshift).toEqual({ intent: '加个导出功能' })
    expect(out.interventions ?? []).toEqual([])
  })

  it('无结构化 JSON → 整段当 reply（自由聊天轮）', () => {
    const out = parseCardTurn('当前跑到「写测试」这步，还差一个门没过。')
    expect(out.reply).toBe('当前跑到「写测试」这步，还差一个门没过。')
    expect(out.interventions ?? []).toEqual([])
    expect(out.upshift).toBeUndefined()
  })

  it('去 markdown 围栏与 [完成]/[工具] 噪音后解析', () => {
    const raw = '[工具] 读断点\n[完成]\n```json\n{ "reply": "在写测试", "interventions": [] }\n```'
    const out = parseCardTurn(raw)
    expect(out.reply).toBe('在写测试')
    expect(out.interventions ?? []).toEqual([])
  })

  it('空输出 → 空 reply、无干预无上抛', () => {
    const out = parseCardTurn('')
    expect(out.reply).toBe('')
    expect(out.interventions ?? []).toEqual([])
    expect(out.upshift).toBeUndefined()
  })
})

describe('buildCardConsultContext', () => {
  const base = {
    card: { title: '登录页', typeId: 'feature', status: '进行中', description: '做个登录页', relations: 'blocks → dashboard' },
    breakpoint: '当前节点：写测试（executing）\n最远进展：写测试\n门把：0/1',
    lineage: '1. 节点 n1（脚手架）\n   - 代码改动文件：src/login.tsx',
    branchDiffs: [{ repo: 'web', diff: 'src/login.tsx\nsrc/login.test.tsx' }]
  }

  it('装配含活现状 + 断点 + 溯源 + 分支 diff，限本卡', () => {
    const ctx = buildCardConsultContext(base)
    expect(ctx).toContain('登录页')
    expect(ctx).toContain('当前节点：写测试')
    expect(ctx).toContain('脚手架')
    expect(ctx).toContain('web')
    expect(ctx).toContain('src/login.tsx')
  })

  it('未运行卡：标明尚未运行、无断点/溯源/分支', () => {
    const ctx = buildCardConsultContext({ card: base.card, breakpoint: null, lineage: null, branchDiffs: [] })
    expect(ctx).toContain('登录页')
    expect(ctx).toMatch(/尚未运行|未运行/)
  })

  it('超预算按确定性顺序截断（先截分支 diff）并标注省略', () => {
    const big = 'x'.repeat(5000)
    const ctx = buildCardConsultContext(
      { ...base, branchDiffs: [{ repo: 'web', diff: big }] },
      { budgetChars: 400 }
    )
    // 活现状/断点保留
    expect(ctx).toContain('登录页')
    // 分支 diff 被截，显式标注省略
    expect(ctx).toMatch(/省略|截断/)
    expect(ctx.length).toBeLessThan(2000)
  })
})
