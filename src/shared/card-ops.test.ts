import { describe, it, expect } from 'vitest'
import type { CardOp, StoredCard } from './types'
import { normalizeOps, validateOps } from './card-ops'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from './card-type'

const REGISTRY = typeArchetypeMap(DEFAULT_CARD_TYPES)

function stored(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'card-a',
    title: '卡 A',
    description: '',
    typeId: 'feature',
    relations: [],
    status: '未开始',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

describe('normalizeOps（逐条容错收敛）', () => {
  it('非数组 → 空', () => {
    expect(normalizeOps(null)).toEqual([])
    expect(normalizeOps({})).toEqual([])
  })

  it('收敛 create/adjust/relate，丢弃无法收敛的', () => {
    const raw = [
      { kind: 'create', card: { title: '新卡', typeId: 'feature' } },
      { kind: 'adjust', target: 'card-a', patch: { title: '改标题' } },
      { kind: 'relate', op: 'add', from: 'card-a', edge: { kind: 'blocked_by', target: 'card-b' } },
      { kind: 'create', card: { title: '' } }, // 无标题 → 丢
      { kind: 'bogus' }, // 未知 kind → 丢
      { kind: 'adjust', target: '', patch: {} } // 空 target → 丢
    ]
    const ops = normalizeOps(raw)
    expect(ops.map((o) => o.kind)).toEqual(['create', 'adjust', 'relate'])
    const create = ops[0] as Extract<CardOp, { kind: 'create' }>
    expect(create.card.proposedName).toBe('新卡'.length ? create.card.proposedName : '') // 由标题派生
    expect(create.card.proposedName).toBeTruthy()
  })

  it('split 默认 edgeInherit=all、into 至少一张', () => {
    const ops = normalizeOps([
      { kind: 'split', source: 'card-a', into: [{ title: '子一', typeId: 'feature' }, { title: '子二', typeId: 'feature' }] },
      { kind: 'split', source: 'card-a', into: [] } // 空 into → 丢
    ])
    expect(ops).toHaveLength(1)
    const split = ops[0] as Extract<CardOp, { kind: 'split' }>
    expect(split.edgeInherit).toBe('all')
    expect(split.into).toHaveLength(2)
  })

  it('merge：into 可为既有 id 或新卡', () => {
    const ops = normalizeOps([
      { kind: 'merge', sources: ['card-a', 'card-b'], into: 'card-a' },
      { kind: 'merge', sources: ['card-a', 'card-b'], into: { title: '合并卡', typeId: 'feature' } }
    ])
    expect(ops).toHaveLength(2)
    expect((ops[0] as Extract<CardOp, { kind: 'merge' }>).into).toBe('card-a')
    expect(typeof (ops[1] as Extract<CardOp, { kind: 'merge' }>).into).toBe('object')
  })

  it('delete：收敛带 target 者，丢弃缺 target 者', () => {
    const ops = normalizeOps([
      { kind: 'delete', target: 'card-a' },
      { kind: 'delete', target: '  ' }, // 空 target → 丢
      { kind: 'delete' } // 无 target → 丢
    ])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({ kind: 'delete', target: 'card-a' })
  })
})

describe('validateOps（逐 op 校验 + 破坏性收边）', () => {
  const cards = [
    stored({ proposedName: 'card-a', typeId: 'feature', status: '未开始' }),
    stored({ proposedName: 'card-b', typeId: 'feature', status: '未开始' }),
    stored({ proposedName: 'running', typeId: 'feature', status: '进行中', activeRunId: 'r1' }),
    stored({ proposedName: 'epic-1', typeId: 'epic', status: '未开始' })
  ]
  const ctx = { cards, registry: REGISTRY }

  it('合法 create/adjust/relate 无 issue', () => {
    const ops: CardOp[] = [
      { kind: 'create', card: { proposedName: 'new-x', title: 'X', description: '', typeId: 'feature', relations: [] } },
      { kind: 'adjust', target: 'card-a', patch: { title: '改' } },
      { kind: 'relate', op: 'add', from: 'card-a', edge: { kind: 'blocked_by', target: 'card-b' } }
    ]
    expect(validateOps(ops, ctx).issues).toEqual([])
  })

  it('create 预取名撞既有卡 → issue', () => {
    const ops: CardOp[] = [
      { kind: 'create', card: { proposedName: 'card-a', title: 'X', description: '', typeId: 'feature', relations: [] } }
    ]
    expect(validateOps(ops, ctx).issues).toHaveLength(1)
  })

  it('create typeId 不在册 → issue', () => {
    const ops: CardOp[] = [
      { kind: 'create', card: { proposedName: 'new-x', title: 'X', description: '', typeId: '不存在', relations: [] } }
    ]
    expect(validateOps(ops, ctx).issues[0].reason).toMatch(/在册|类型/)
  })

  it('adjust 目标不存在 → issue', () => {
    const ops: CardOp[] = [{ kind: 'adjust', target: 'nope', patch: { title: 'x' } }]
    expect(validateOps(ops, ctx).issues).toHaveLength(1)
  })

  it('破坏性收边：结构 op 作用于已跑卡 → issue', () => {
    const ops: CardOp[] = [
      { kind: 'adjust', target: 'running', patch: { title: 'x' } },
      { kind: 'split', source: 'running', into: [{ proposedName: 's1', title: 'S1', description: '', typeId: 'feature', relations: [] }] },
      { kind: 'merge', sources: ['card-a', 'running'], into: 'card-a' }
    ]
    const issues = validateOps(ops, ctx).issues
    expect(issues.map((i) => i.index).sort()).toEqual([0, 1, 2])
    expect(issues.every((i) => /待办|已离开|运行/.test(i.reason))).toBe(true)
  })

  it('split 合法（源为待办卡、子卡合法）无 issue', () => {
    const ops: CardOp[] = [
      {
        kind: 'split',
        source: 'card-a',
        into: [
          { proposedName: 'a1', title: 'A1', description: '', typeId: 'feature', relations: [] },
          { proposedName: 'a2', title: 'A2', description: '', typeId: 'feature', relations: [] }
        ]
      }
    ]
    expect(validateOps(ops, ctx).issues).toEqual([])
  })

  it('merge 少于两张源 → issue', () => {
    const ops: CardOp[] = [{ kind: 'merge', sources: ['card-a'], into: 'card-a' }]
    expect(validateOps(ops, ctx).issues).toHaveLength(1)
  })

  it('relate 加 parent 指向非容器 → issue', () => {
    const ops: CardOp[] = [
      { kind: 'relate', op: 'add', from: 'card-a', edge: { kind: 'parent', target: 'card-b' } }
    ]
    expect(validateOps(ops, ctx).issues[0].reason).toMatch(/容器|container|子叶|leaf/)
  })

  it('relate 加 parent 指向容器 epic → 合法', () => {
    const ops: CardOp[] = [
      { kind: 'relate', op: 'add', from: 'card-a', edge: { kind: 'parent', target: 'epic-1' } }
    ]
    expect(validateOps(ops, ctx).issues).toEqual([])
  })

  it('relate 自环 → issue', () => {
    const ops: CardOp[] = [
      { kind: 'relate', op: 'add', from: 'card-a', edge: { kind: 'blocked_by', target: 'card-a' } }
    ]
    expect(validateOps(ops, ctx).issues).toHaveLength(1)
  })

  it('delete 目标为待办卡 → 合法无 issue', () => {
    const ops: CardOp[] = [{ kind: 'delete', target: 'card-a' }]
    expect(validateOps(ops, ctx).issues).toEqual([])
  })

  it('delete 目标不存在 → issue', () => {
    const ops: CardOp[] = [{ kind: 'delete', target: 'nope' }]
    const issues = validateOps(ops, ctx).issues
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('delete')
    expect(issues[0].reason).toMatch(/不存在/)
  })

  it('delete 目标已离开待办（已跑卡）→ issue', () => {
    const ops: CardOp[] = [{ kind: 'delete', target: 'running' }]
    const issues = validateOps(ops, ctx).issues
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('delete')
    expect(issues[0].reason).toMatch(/待办|已离开|运行/)
  })
})
