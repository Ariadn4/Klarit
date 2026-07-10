import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CandidateCard, CardTypeDef } from '../shared/types'
import { typeArchetypeMap } from '../shared/card-type'
import { createCardStore, createMemoryCardStore, type CardStore } from './card-store'

const TYPES: CardTypeDef[] = [
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
  { id: 'feat', name: 'Feature', description: '', archetype: 'leaf' }
]
const REGISTRY = typeArchetypeMap(TYPES)

function cand(over: Partial<CandidateCard>): CandidateCard {
  return {
    proposedName: 'a-card',
    title: 'A card',
    description: '',
    typeId: 'feat',
    relations: [],
    ...over
  }
}

const NOW = 1_700_000_000_000

// 对每种 store 实现跑同一组契约。
function contract(name: string, make: () => CardStore): void {
  describe(name, () => {
    let store: CardStore
    beforeEach(() => {
      store = make()
    })

    it('create → 可按项目列出、按 id 取单，状态默认未开始', () => {
      const res = store.create({
        projectId: 'p1',
        candidates: [cand({ proposedName: 'one' })],
        now: NOW,
        registry: REGISTRY,
        repos: ['repo-a']
      })
      expect(res.issues).toEqual([])
      expect(res.created).toHaveLength(1)
      const list = store.list('p1')
      expect(list.map((c) => c.proposedName)).toEqual(['one'])
      expect(store.get('p1', 'one')).toMatchObject({
        status: '未开始',
        projectId: 'p1',
        repos: ['repo-a']
      })
    })

    it('类型集按项目隔离', () => {
      store.create({ projectId: 'p1', candidates: [cand({ proposedName: 'x' })], now: NOW, registry: REGISTRY })
      store.create({ projectId: 'p2', candidates: [cand({ proposedName: 'y' })], now: NOW, registry: REGISTRY })
      expect(store.list('p1').map((c) => c.proposedName)).toEqual(['x'])
      expect(store.list('p2').map((c) => c.proposedName)).toEqual(['y'])
    })

    it('同项目预取名重复被拒、回 issue 不覆盖既有', () => {
      store.create({ projectId: 'p1', candidates: [cand({ proposedName: 'dup', title: '原' })], now: NOW, registry: REGISTRY })
      const res = store.create({
        projectId: 'p1',
        candidates: [cand({ proposedName: 'dup', title: '新' })],
        now: NOW,
        registry: REGISTRY
      })
      expect(res.created).toHaveLength(0)
      expect(res.issues[0]).toMatchObject({ proposedName: 'dup' })
      expect(store.get('p1', 'dup')?.title).toBe('原')
    })

    it('非法候选（typeId 不在册）被拒、合法者仍落库', () => {
      const res = store.create({
        projectId: 'p1',
        candidates: [cand({ proposedName: 'ok' }), cand({ proposedName: 'bad', typeId: 'ghost' })],
        now: NOW,
        registry: REGISTRY
      })
      expect(res.created.map((c) => c.proposedName)).toEqual(['ok'])
      expect(res.issues.map((i) => i.proposedName)).toEqual(['bad'])
      expect(store.list('p1').map((c) => c.proposedName)).toEqual(['ok'])
    })

    it('关系双向落地：parent → 对侧落 child', () => {
      store.create({
        projectId: 'p1',
        candidates: [
          cand({ proposedName: 'parent-card', typeId: 'epic', relations: [{ kind: 'child', target: 'kid' }] }),
          cand({ proposedName: 'kid', relations: [{ kind: 'parent', target: 'parent-card' }] })
        ],
        now: NOW,
        registry: REGISTRY
      })
      const kid = store.get('p1', 'kid')
      const parent = store.get('p1', 'parent-card')
      expect(kid?.relations).toContainEqual({ kind: 'parent', target: 'parent-card' })
      expect(parent?.relations).toContainEqual({ kind: 'child', target: 'kid' })
    })

    it('blocked_by ↔ blocks、coupled_with 自反 双向落地', () => {
      store.create({
        projectId: 'p1',
        candidates: [
          cand({ proposedName: 'b', relations: [{ kind: 'blocked_by', target: 'a' }] }),
          cand({ proposedName: 'a' }),
          cand({ proposedName: 'c', relations: [{ kind: 'coupled_with', target: 'a' }] })
        ],
        now: NOW,
        registry: REGISTRY
      })
      expect(store.get('p1', 'a')?.relations).toContainEqual({ kind: 'blocks', target: 'b' })
      expect(store.get('p1', 'a')?.relations).toContainEqual({ kind: 'coupled_with', target: 'c' })
    })

    it('删卡清理其它卡上指向它的悬挂边', () => {
      store.create({
        projectId: 'p1',
        candidates: [
          cand({ proposedName: 'keep', relations: [{ kind: 'blocked_by', target: 'gone' }] }),
          cand({ proposedName: 'gone' })
        ],
        now: NOW,
        registry: REGISTRY
      })
      store.remove('p1', 'gone')
      expect(store.get('p1', 'gone')).toBeNull()
      expect(store.get('p1', 'keep')?.relations.some((r) => r.target === 'gone')).toBe(false)
    })

    it('update 合并字段并刷新 updatedAt', () => {
      store.create({ projectId: 'p1', candidates: [cand({ proposedName: 'u' })], now: NOW, registry: REGISTRY })
      const updated = store.update('p1', 'u', { status: '进行中', activeRunId: 'run-9', updatedAt: NOW + 1000 })
      expect(updated).toMatchObject({ status: '进行中', activeRunId: 'run-9' })
      expect(store.get('p1', 'u')?.status).toBe('进行中')
    })
  })
}

contract('createMemoryCardStore', () => createMemoryCardStore())

describe('关系边增删原语 addRelation/removeRelation', () => {
  let store: CardStore
  beforeEach(() => {
    store = createMemoryCardStore()
    store.create({
      projectId: 'p1',
      candidates: [cand({ proposedName: 'a' }), cand({ proposedName: 'b' }), cand({ proposedName: 'epic1', typeId: 'epic' })],
      now: NOW,
      registry: REGISTRY
    })
  })

  it('加边双向落地', () => {
    const res = store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'blocked_by', target: 'b' }, registry: REGISTRY })
    expect(res.ok).toBe(true)
    expect(store.get('p1', 'a')?.relations).toContainEqual({ kind: 'blocked_by', target: 'b' })
    expect(store.get('p1', 'b')?.relations).toContainEqual({ kind: 'blocks', target: 'a' })
  })

  it('重复加边幂等', () => {
    store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'blocked_by', target: 'b' }, registry: REGISTRY })
    store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'blocked_by', target: 'b' }, registry: REGISTRY })
    expect(store.get('p1', 'a')?.relations.filter((r) => r.target === 'b')).toHaveLength(1)
  })

  it('删边清对侧反向', () => {
    store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'blocked_by', target: 'b' }, registry: REGISTRY })
    store.removeRelation('p1', 'a', { kind: 'blocked_by', target: 'b' })
    expect(store.get('p1', 'a')?.relations.some((r) => r.target === 'b')).toBe(false)
    expect(store.get('p1', 'b')?.relations.some((r) => r.target === 'a')).toBe(false)
  })

  it('非容器加 parent 被拒', () => {
    const res = store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'parent', target: 'b' }, registry: REGISTRY })
    expect(res.ok).toBe(false)
  })

  it('容器 epic 作 parent 合法', () => {
    const res = store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'parent', target: 'epic1' }, registry: REGISTRY })
    expect(res.ok).toBe(true)
    expect(store.get('p1', 'epic1')?.relations).toContainEqual({ kind: 'child', target: 'a' })
  })

  it('自环被拒', () => {
    const res = store.addRelation({ projectId: 'p1', from: 'a', edge: { kind: 'coupled_with', target: 'a' }, registry: REGISTRY })
    expect(res.ok).toBe(false)
  })
})

describe('拆卡 splitCard', () => {
  let store: CardStore
  beforeEach(() => {
    store = createMemoryCardStore()
    store.create({
      projectId: 'p1',
      candidates: [
        cand({ proposedName: 'src', relations: [{ kind: 'blocked_by', target: 'dep' }] }),
        cand({ proposedName: 'dep' })
      ],
      now: NOW,
      registry: REGISTRY
    })
  })

  it('拆未跑卡：N 卡落库、源外部边继承子卡、源删、双向一致', () => {
    const res = store.splitCard({
      projectId: 'p1',
      source: 'src',
      into: [cand({ proposedName: 's1' }), cand({ proposedName: 's2' })],
      edgeInherit: 'all',
      now: NOW,
      registry: REGISTRY
    })
    expect(res.ok).toBe(true)
    expect(res.created.map((c) => c.proposedName).sort()).toEqual(['s1', 's2'])
    expect(store.get('p1', 'src')).toBeNull()
    // 子卡继承源的外部边 blocked_by dep
    expect(store.get('p1', 's1')?.relations).toContainEqual({ kind: 'blocked_by', target: 'dep' })
    expect(store.get('p1', 's2')?.relations).toContainEqual({ kind: 'blocked_by', target: 'dep' })
    // dep 反向 blocks 指向两子卡、不再指向 src
    const depBlocks = store.get('p1', 'dep')?.relations.filter((r) => r.kind === 'blocks').map((r) => r.target).sort()
    expect(depBlocks).toEqual(['s1', 's2'])
  })

  it('edgeInherit=none 子卡不继承源外部边', () => {
    store.splitCard({
      projectId: 'p1',
      source: 'src',
      into: [cand({ proposedName: 's1' })],
      edgeInherit: 'none',
      now: NOW,
      registry: REGISTRY
    })
    expect(store.get('p1', 's1')?.relations ?? []).toEqual([])
  })

  it('源卡已离开待办被拒、不落任何卡', () => {
    store.update('p1', 'src', { status: '进行中', activeRunId: 'r1' })
    const res = store.splitCard({
      projectId: 'p1',
      source: 'src',
      into: [cand({ proposedName: 's1' })],
      edgeInherit: 'all',
      now: NOW,
      registry: REGISTRY
    })
    expect(res.ok).toBe(false)
    expect(store.get('p1', 's1')).toBeNull()
    expect(store.get('p1', 'src')).not.toBeNull()
  })
})

describe('并卡 mergeCards', () => {
  let store: CardStore
  beforeEach(() => {
    store = createMemoryCardStore()
    store.create({
      projectId: 'p1',
      candidates: [
        cand({ proposedName: 'x', description: 'X 描述', relations: [{ kind: 'blocked_by', target: 'dep' }] }),
        cand({ proposedName: 'y', description: 'Y 描述', relations: [{ kind: 'coupled_with', target: 'z' }] }),
        cand({ proposedName: 'dep' }),
        cand({ proposedName: 'z' })
      ],
      now: NOW,
      registry: REGISTRY
    })
  })

  it('并入新目标卡：合并描述、边并集重指、被并卡删、邻居反向重指', () => {
    const res = store.mergeCards({
      projectId: 'p1',
      sources: ['x', 'y'],
      into: cand({ proposedName: 'merged', description: '合并后' }),
      now: NOW,
      registry: REGISTRY
    })
    expect(res.ok).toBe(true)
    expect(store.get('p1', 'x')).toBeNull()
    expect(store.get('p1', 'y')).toBeNull()
    const merged = store.get('p1', 'merged')
    expect(merged?.description).toBe('合并后')
    // 并集外部边重指目标
    expect(merged?.relations).toContainEqual({ kind: 'blocked_by', target: 'dep' })
    expect(merged?.relations).toContainEqual({ kind: 'coupled_with', target: 'z' })
    // 邻居反向边重指 merged、不再指向 x/y
    expect(store.get('p1', 'dep')?.relations).toContainEqual({ kind: 'blocks', target: 'merged' })
    expect(store.get('p1', 'z')?.relations).toContainEqual({ kind: 'coupled_with', target: 'merged' })
    expect(store.get('p1', 'dep')?.relations.some((r) => r.target === 'x')).toBe(false)
  })

  it('并入既有源卡为幸存者：另一张被删、边并入幸存者', () => {
    const res = store.mergeCards({ projectId: 'p1', sources: ['x', 'y'], into: 'x', now: NOW, registry: REGISTRY })
    expect(res.ok).toBe(true)
    expect(store.get('p1', 'y')).toBeNull()
    const x = store.get('p1', 'x')
    expect(x?.relations).toContainEqual({ kind: 'blocked_by', target: 'dep' })
    expect(x?.relations).toContainEqual({ kind: 'coupled_with', target: 'z' })
  })

  it('任一源卡已离开待办被拒、不动任何卡', () => {
    store.update('p1', 'y', { status: '进行中', activeRunId: 'r1' })
    const res = store.mergeCards({ projectId: 'p1', sources: ['x', 'y'], into: 'x', now: NOW, registry: REGISTRY })
    expect(res.ok).toBe(false)
    expect(store.get('p1', 'x')).not.toBeNull()
    expect(store.get('p1', 'y')).not.toBeNull()
  })
})

describe('createCardStore（文件持久化）', () => {
  let baseDir: string
  afterEach(() => {
    if (baseDir) rmSync(baseDir, { recursive: true, force: true })
  })
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'klarit-cards-'))
  })

  it('一卡一文件、损坏文件容错跳过', () => {
    const store = createCardStore(baseDir)
    store.create({ projectId: 'p1', candidates: [cand({ proposedName: 'good' })], now: NOW, registry: REGISTRY })
    // 注入一个损坏卡文件
    mkdirSync(join(baseDir, 'p1'), { recursive: true })
    writeFileSync(join(baseDir, 'p1', 'broken.json'), '{ not json', 'utf8')
    expect(store.list('p1').map((c) => c.proposedName)).toEqual(['good'])
  })

  it('落盘后另起 store 实例可读回（持久化）', () => {
    createCardStore(baseDir).create({
      projectId: 'p1',
      candidates: [cand({ proposedName: 'persist' })],
      now: NOW,
      registry: REGISTRY
    })
    expect(createCardStore(baseDir).get('p1', 'persist')?.proposedName).toBe('persist')
  })
})

// 文件 store 也跑一遍公共契约（用独立临时目录，afterEach 清理）。
describe('createCardStore 契约', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'klarit-cards-c-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  contract('file-backed', () => createCardStore(dir))
})
