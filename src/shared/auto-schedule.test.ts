import { describe, it, expect } from 'vitest'
import type { StoredCard } from './types'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from './card-type'
import { isAutoEligible, reposUnion, reposOverlap, planFills } from './auto-schedule'

const REGISTRY = typeArchetypeMap(DEFAULT_CARD_TYPES) // feature=leaf, bug=leaf, epic=container

function card(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'add-thing',
    title: 'Add thing',
    description: '',
    typeId: 'feature', // leaf
    relations: [],
    status: '未开始',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    repos: ['web'],
    ...over
  }
}

function byId(cards: StoredCard[]): Map<string, StoredCard> {
  return new Map(cards.map((c) => [c.proposedName, c]))
}

describe('isAutoEligible —— 自动运行资格的隐式判定', () => {
  it('待办 leaf、无未完成 blocker、可派生 → 有资格', () => {
    const c = card()
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(true)
  })

  it('container 卡 → 永不有资格', () => {
    const c = card({ typeId: 'epic' }) // container
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(false)
  })

  it('typeId 不在册（未知原型）→ 无资格（非 leaf）', () => {
    const c = card({ typeId: 'mystery' })
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(false)
  })

  it('状态非「未开始」→ 无资格（已离开待办）', () => {
    const c = card({ status: '进行中' })
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(false)
  })

  it('已有 activeRunId → 无资格（已在跑）', () => {
    const c = card({ activeRunId: 'run-1' })
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(false)
  })

  it('canDerive 为 false（缺 repos / 无激活工作流）→ 无资格', () => {
    const c = card()
    expect(isAutoEligible(c, byId([c]), REGISTRY, false)).toBe(false)
  })

  it('blocked_by 目标未「已完成」→ 无资格（硬门，哪怕其它条件都满足）', () => {
    const blocker = card({ proposedName: 'blocker', status: '进行中' })
    const c = card({ proposedName: 'blocked', relations: [{ kind: 'blocked_by', target: 'blocker' }] })
    expect(isAutoEligible(c, byId([blocker, c]), REGISTRY, true)).toBe(false)
  })

  it('blocked_by 目标已「已完成」→ 硬门放行', () => {
    const blocker = card({ proposedName: 'blocker', status: '已完成' })
    const c = card({ proposedName: 'blocked', relations: [{ kind: 'blocked_by', target: 'blocker' }] })
    expect(isAutoEligible(c, byId([blocker, c]), REGISTRY, true)).toBe(true)
  })

  it('blocked_by 目标不存在于卡表 → 保守判未满足（无资格）', () => {
    const c = card({ relations: [{ kind: 'blocked_by', target: 'ghost' }] })
    expect(isAutoEligible(c, byId([c]), REGISTRY, true)).toBe(false)
  })

  it('多个 blocked_by：任一未完成即无资格；全完成才有资格', () => {
    const b1 = card({ proposedName: 'b1', status: '已完成' })
    const b2 = card({ proposedName: 'b2', status: '未开始' })
    const c = card({
      proposedName: 'blocked',
      relations: [
        { kind: 'blocked_by', target: 'b1' },
        { kind: 'blocked_by', target: 'b2' }
      ]
    })
    expect(isAutoEligible(c, byId([b1, b2, c]), REGISTRY, true)).toBe(false)
    const b2done = card({ proposedName: 'b2', status: '已完成' })
    expect(isAutoEligible(c, byId([b1, b2done, c]), REGISTRY, true)).toBe(true)
  })

  it('非 blocked_by 关系（blocks/coupled_with/parent/child）不作硬门', () => {
    const other = card({ proposedName: 'other', status: '进行中' })
    const c = card({
      proposedName: 'c',
      relations: [
        { kind: 'blocks', target: 'other' },
        { kind: 'coupled_with', target: 'other' }
      ]
    })
    expect(isAutoEligible(c, byId([other, c]), REGISTRY, true)).toBe(true)
  })
})

describe('reposUnion / reposOverlap —— 共享成员仓粗筛', () => {
  it('reposUnion 汇总所有在跑卡涉及仓、去重', () => {
    const u = reposUnion([card({ repos: ['web', 'api'] }), card({ repos: ['api', 'infra'] })])
    expect(u).toEqual(new Set(['web', 'api', 'infra']))
  })

  it('reposOverlap：仓不相交 → false（冲突分 0）', () => {
    expect(reposOverlap(['api'], new Set(['web']))).toBe(false)
  })

  it('reposOverlap：有共享仓 → true', () => {
    expect(reposOverlap(['web', 'x'], new Set(['web']))).toBe(true)
  })

  it('空在跑集合 → 恒不相交', () => {
    expect(reposOverlap(['web'], new Set())).toBe(false)
  })
})

describe('planFills —— 确定性即时填槽（无 agent）', () => {
  it('空槽 ≤ 0 → 空计划', () => {
    expect(planFills(0, [card()], [])).toEqual([])
  })

  it('无候选 → 空计划', () => {
    expect(planFills(3, [], [])).toEqual([])
  })

  it('候选唯一 → 直接选它', () => {
    const c = card({ proposedName: 'only' })
    expect(planFills(3, [c], []).map((x) => x.proposedName)).toEqual(['only'])
  })

  it('候选 ≤ 空槽 → 全部启动（按入列顺序）', () => {
    const a = card({ proposedName: 'a' })
    const b = card({ proposedName: 'b' })
    expect(planFills(3, [a, b], []).map((x) => x.proposedName)).toEqual(['a', 'b'])
  })

  it('在跑为空 → 全不共享，按入列顺序取前 k', () => {
    const a = card({ proposedName: 'a', repos: ['web'] })
    const b = card({ proposedName: 'b', repos: ['api'] })
    const c = card({ proposedName: 'c', repos: ['infra'] })
    expect(planFills(2, [a, b, c], []).map((x) => x.proposedName)).toEqual(['a', 'b'])
  })

  it('与在跑不共享仓的候选优先于共享仓的（多仓错开）', () => {
    const running = [card({ proposedName: 'r', repos: ['web'] })]
    const shared = card({ proposedName: 'shared', repos: ['web'] }) // 与在跑共享
    const safe = card({ proposedName: 'safe', repos: ['api'] }) // 不共享
    // 1 空槽：优先启动 safe（虽然 shared 在前）
    expect(planFills(1, [shared, safe], running).map((x) => x.proposedName)).toEqual(['safe'])
  })

  it('填满空槽：不共享者优先（按序）→ 再共享者（按序）', () => {
    const running = [card({ proposedName: 'r', repos: ['web'] })]
    const safe = card({ proposedName: 'safe', repos: ['api'] })
    const risky1 = card({ proposedName: 'risky1', repos: ['web'] })
    const risky2 = card({ proposedName: 'risky2', repos: ['web'] })
    // 2 空槽、3 候选：safe 优先，再按序补 1 个共享仓 → [safe, risky1]，填满不留空
    expect(planFills(2, [risky1, safe, risky2], running).map((x) => x.proposedName)).toEqual([
      'safe',
      'risky1'
    ])
  })

  it('单仓退化：全共享唯一仓 → 纯按入列顺序填满空槽', () => {
    const running = [card({ proposedName: 'r', repos: ['web'] })]
    const r1 = card({ proposedName: 'r1', repos: ['web'] })
    const r2 = card({ proposedName: 'r2', repos: ['web'] })
    const r3 = card({ proposedName: 'r3', repos: ['web'] })
    // 2 空槽、3 张全共享 → 按序填满前 2 张（不保守留空）
    expect(planFills(2, [r1, r2, r3], running).map((x) => x.proposedName)).toEqual(['r1', 'r2'])
  })

  it('计划长度不超过空槽数', () => {
    const cands = Array.from({ length: 5 }, (_, i) => card({ proposedName: `c${i}`, repos: ['web'] }))
    const running = [card({ proposedName: 'r', repos: ['web'] })]
    expect(planFills(2, cands, running).length).toBe(2)
  })
})
