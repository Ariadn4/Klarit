import { describe, it, expect, beforeEach } from 'vitest'
import type { CardOp, CardTypeDef } from '../shared/types'
import { typeArchetypeMap } from '../shared/card-type'
import { createMemoryCardStore, type CardStore } from './card-store'
import { applyOps, createOpsFromCandidates } from './apply-ops'

const TYPES: CardTypeDef[] = [
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
  { id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }
]
const REGISTRY = typeArchetypeMap(TYPES)
const NOW = 1_700_000_000_000

function seed(store: CardStore, names: string[]): void {
  store.create({
    projectId: 'p1',
    candidates: names.map((proposedName) => ({ proposedName, title: proposedName, description: '', typeId: 'feat', relations: [] })),
    now: NOW,
    registry: REGISTRY
  })
}

describe('applyOps 派发', () => {
  let store: CardStore
  beforeEach(() => {
    store = createMemoryCardStore()
  })

  it('create/adjust/relate 派发落库', () => {
    seed(store, ['a', 'b'])
    const ops: CardOp[] = [
      { kind: 'create', card: { proposedName: 'new-c', title: 'C', description: '', typeId: 'feat', relations: [] } },
      { kind: 'adjust', target: 'a', patch: { title: '改了' } },
      { kind: 'relate', op: 'add', from: 'a', edge: { kind: 'blocked_by', target: 'b' } }
    ]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues).toEqual([])
    expect(store.get('p1', 'new-c')).not.toBeNull()
    expect(store.get('p1', 'a')?.title).toBe('改了')
    expect(store.get('p1', 'a')?.relations).toContainEqual({ kind: 'blocked_by', target: 'b' })
  })

  it('破坏性 op 未确认 → 跳过并回 issue', () => {
    seed(store, ['a', 'b'])
    const ops: CardOp[] = [{ kind: 'merge', sources: ['a', 'b'], into: 'a' }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues[0].reason).toMatch(/二次确认/)
    expect(store.get('p1', 'b')).not.toBeNull() // 未合并
  })

  it('破坏性 op 已确认 → 应用（merge 删被并卡）', () => {
    seed(store, ['a', 'b'])
    const ops: CardOp[] = [{ kind: 'merge', sources: ['a', 'b'], into: 'a' }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY, confirmedDestructive: true })
    expect(res.issues).toEqual([])
    expect(res.removed).toContain('b')
    expect(store.get('p1', 'b')).toBeNull()
  })

  it('split 已确认 → 建子卡删源、removed 记源', () => {
    seed(store, ['src'])
    const ops: CardOp[] = [
      { kind: 'split', source: 'src', into: [{ proposedName: 's1', title: 'S1', description: '', typeId: 'feat', relations: [] }], edgeInherit: 'all' }
    ]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY, confirmedDestructive: true })
    expect(res.created.map((c) => c.proposedName)).toEqual(['s1'])
    expect(res.removed).toEqual(['src'])
    expect(store.get('p1', 'src')).toBeNull()
  })

  it('非法 op（越界结构 op 作用已跑卡）→ 记 issue、跳过应用', () => {
    seed(store, ['a'])
    store.update('p1', 'a', { status: '进行中', activeRunId: 'r1' })
    const ops: CardOp[] = [{ kind: 'adjust', target: 'a', patch: { title: 'x' } }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues.length).toBeGreaterThan(0)
    expect(store.get('p1', 'a')?.title).toBe('a') // 未改
  })

  it('delete 已确认 → 删卡、removed 记该卡、清悬挂边', () => {
    seed(store, ['a', 'b'])
    store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'blocked_by', target: 'b' }, registry: REGISTRY })
    const ops: CardOp[] = [{ kind: 'delete', target: 'b' }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY, confirmedDestructive: true })
    expect(res.issues).toEqual([])
    expect(res.removed).toContain('b')
    expect(store.get('p1', 'b')).toBeNull()
    // a 上指向 b 的悬挂边被清
    expect(store.get('p1', 'a')?.relations.some((r) => r.target === 'b')).toBe(false)
  })

  it('delete 未确认 → 跳过并回 issue（不删）', () => {
    seed(store, ['a'])
    const ops: CardOp[] = [{ kind: 'delete', target: 'a' }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues[0].reason).toMatch(/二次确认/)
    expect(store.get('p1', 'a')).not.toBeNull()
  })

  it('delete 目标已离开待办（已跑卡）→ 记 issue、不删', () => {
    seed(store, ['a'])
    store.update('p1', 'a', { status: '进行中', activeRunId: 'r1' })
    const ops: CardOp[] = [{ kind: 'delete', target: 'a' }]
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY, confirmedDestructive: true })
    expect(res.issues.length).toBeGreaterThan(0)
    expect(store.get('p1', 'a')).not.toBeNull()
  })

  it('回归：批内 parent/child 互引经 applyOps 仍双向互链（不因逐条落库丢链）', () => {
    // decompose 常产出「容器 + 子卡」批，子卡 parent 指向同批容器、容器 child 指向子卡。
    const ops = createOpsFromCandidates([
      { proposedName: 'kid', title: '子', description: '', typeId: 'feat', relations: [{ kind: 'parent', target: 'epic-x' }] },
      { proposedName: 'epic-x', title: '容器', description: '', typeId: 'epic', relations: [{ kind: 'child', target: 'kid' }] }
    ])
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues).toEqual([])
    expect(store.get('p1', 'kid')?.relations).toContainEqual({ kind: 'parent', target: 'epic-x' })
    expect(store.get('p1', 'epic-x')?.relations).toContainEqual({ kind: 'child', target: 'kid' })
  })

  it('createOpsFromCandidates：decompose 落库收敛为全 create 特例', () => {
    const ops = createOpsFromCandidates([
      { proposedName: 'x', title: 'X', description: '', typeId: 'feat', relations: [] },
      { proposedName: 'y', title: 'Y', description: '', typeId: 'feat', relations: [] }
    ])
    const res = applyOps(store, { projectId: 'p1', ops, now: NOW, registry: REGISTRY })
    expect(res.issues).toEqual([])
    expect(store.list('p1').map((c) => c.proposedName).sort()).toEqual(['x', 'y'])
  })
})
