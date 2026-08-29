import { describe, it, expect } from 'vitest'
import type { Project, StoredCard } from '../shared/types'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from '../shared/card-type'
import { createAutoScheduler, type AutoSchedulerDeps } from './auto-scheduler'

const REGISTRY = typeArchetypeMap(DEFAULT_CARD_TYPES)
const PROJECT = { id: 'p1', members: [{ id: 'web' }, { id: 'api' }] } as unknown as Project

let seq = 0
function card(over: Partial<StoredCard> = {}): StoredCard {
  seq += 1
  return {
    proposedName: `card-${seq}`,
    title: `Card ${seq}`,
    description: '',
    typeId: 'feature',
    relations: [],
    status: '未开始',
    createdAt: seq,
    updatedAt: seq,
    projectId: 'p1',
    repos: ['web'],
    ...over
  }
}

/** 有状态测试床：cards 可变、startCard 置 activeRunId + 记一个 live run、liveRun 判活。 */
function harness(initial: StoredCard[], over: Partial<AutoSchedulerDeps> = {}) {
  const cards = new Map(initial.map((c) => [c.proposedName, c]))
  const live = new Set<string>()
  let runSeq = 0
  const started: string[] = []
  const deps: AutoSchedulerDeps = {
    listCards: () => [...cards.values()],
    getProject: () => PROJECT,
    getRegistry: () => REGISTRY,
    canDerive: () => true,
    isRunLive: (runId) => live.has(runId),
    startCard: (c) => {
      const runId = `run-${(runSeq += 1)}`
      cards.set(c.proposedName, { ...c, activeRunId: runId, status: '进行中' })
      live.add(runId)
      started.push(c.proposedName)
    },
    ...over
  }
  return {
    scheduler: createAutoScheduler(deps),
    started,
    finish: (cardId: string) => {
      const c = cards.get(cardId)
      if (c?.activeRunId) live.delete(c.activeRunId)
    },
    setStatus: (cardId: string, status: StoredCard['status']) => {
      const c = cards.get(cardId)
      if (c) cards.set(cardId, { ...c, status })
    },
    /** 模拟删卡：级联中止其运行（run 变不活）+ 从卡表移除。 */
    remove: (cardId: string) => {
      const c = cards.get(cardId)
      if (c?.activeRunId) live.delete(c.activeRunId)
      cards.delete(cardId)
    }
  }
}

describe('createAutoScheduler.evaluate —— 触发点与并发上限', () => {
  it('完全空闲 + 一张有资格卡 → 启动它（0→1）', async () => {
    const h = harness([card({ proposedName: 'a' })])
    await h.scheduler.evaluate()
    expect(h.started).toEqual(['a'])
  })

  it('空闲 + 五张不共享仓候选 → 一次贪心补到 3', async () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map((n, i) => card({ proposedName: n, repos: [`repo-${i}`] }))
    const h = harness(cards)
    await h.scheduler.evaluate()
    expect(h.started.length).toBe(3)
  })

  it('已有 3 个在跑 → 不再自动启动', async () => {
    const running = [1, 2, 3].map((i) => card({ proposedName: `r${i}`, status: '进行中', activeRunId: `run-x${i}` }))
    const todo = card({ proposedName: 'todo', repos: ['api'] })
    const h = harness([...running, todo], {
      // 三个在跑：把它们的 run 记为 live
      isRunLive: (runId) => ['run-x1', 'run-x2', 'run-x3'].includes(runId)
    })
    await h.scheduler.evaluate()
    expect(h.started).toEqual([])
  })

  it('活跃计数含 paused / waiting-decision（仍占槽）', async () => {
    const paused = card({ proposedName: 'p', status: '已暂停', activeRunId: 'run-p' })
    const waiting = card({ proposedName: 'w', status: '等待决策', activeRunId: 'run-w' })
    const todo1 = card({ proposedName: 't1', repos: ['api'] })
    const todo2 = card({ proposedName: 't2', repos: ['infra'] })
    const h = harness([paused, waiting, todo1, todo2], {
      isRunLive: (runId) => ['run-p', 'run-w'].includes(runId)
    })
    await h.scheduler.evaluate()
    // 2 占槽 → 只剩 1 空槽 → 只启动 1 个
    expect(h.started.length).toBe(1)
  })
})

describe('createAutoScheduler —— 资格过滤', () => {
  it('container / 被阻塞 / 不可派生 → 不启动', async () => {
    const epic = card({ proposedName: 'epic', typeId: 'epic' })
    const blocker = card({ proposedName: 'blk', status: '进行中' })
    const blocked = card({ proposedName: 'bd', relations: [{ kind: 'blocked_by', target: 'blk' }] })
    const noDerive = card({ proposedName: 'nd' })
    const ok = card({ proposedName: 'ok', repos: ['api'] })
    const h = harness([epic, blocker, blocked, noDerive, ok], {
      canDerive: (c) => c.proposedName !== 'nd'
    })
    await h.scheduler.evaluate()
    expect(h.started).toEqual(['ok'])
  })

  it('blocker 完成后再评估 → 被阻塞卡变得有资格并启动', async () => {
    const blocker = card({ proposedName: 'blk', status: '进行中', activeRunId: 'run-blk' })
    const blocked = card({ proposedName: 'bd', relations: [{ kind: 'blocked_by', target: 'blk' }] })
    const h = harness([blocker, blocked], { isRunLive: (r) => r === 'run-blk' })
    await h.scheduler.evaluate()
    expect(h.started).toEqual([]) // blk 未完成、bd 被挡；blk 在跑占槽
    h.setStatus('blk', '已完成')
    h.finish('blk')
    await h.scheduler.evaluate()
    expect(h.started).toEqual(['bd'])
  })
})

describe('createAutoScheduler —— 确定性填槽（无 agent）', () => {
  it('多候选竞争有限槽：与在跑不共享仓者优先', async () => {
    const running = card({ proposedName: 'r', status: '进行中', activeRunId: 'run-r', repos: ['web'] })
    const a = card({ proposedName: 'a', repos: ['web'] }) // 共享
    const b = card({ proposedName: 'b', repos: ['web'] }) // 共享
    const c = card({ proposedName: 'c', repos: ['api'] }) // 不共享 → 优先
    // 2 空槽（3-1）、3 候选：c 优先，再按序补 a → [c, a]
    const h = harness([running, a, b, c], { isRunLive: (x) => x === 'run-r', maxConcurrent: 3 })
    await h.scheduler.evaluate()
    expect(h.started).toEqual(['c', 'a'])
  })

  it('单仓（全共享唯一仓）→ 按入列顺序填满空槽，不停摆', async () => {
    const running = card({ proposedName: 'r', status: '进行中', activeRunId: 'run-r', repos: ['web'] })
    const a = card({ proposedName: 'a', repos: ['web'] })
    const b = card({ proposedName: 'b', repos: ['web'] })
    const cc = card({ proposedName: 'cc', repos: ['web'] })
    const h = harness([running, a, b, cc], { isRunLive: (x) => x === 'run-r', maxConcurrent: 3 })
    await h.scheduler.evaluate()
    // 2 空槽 → 按序填 a、b
    expect(h.started).toEqual(['a', 'b'])
  })
})

describe('createAutoScheduler —— 串行化与既成超额', () => {
  it('并发 evaluate 时同一张卡至多被启动一次', async () => {
    const a = card({ proposedName: 'a', repos: ['web'] })
    const b = card({ proposedName: 'b', repos: ['web'] })
    const c = card({ proposedName: 'c', repos: ['web'] })
    const h = harness([a, b, c])
    const p1 = h.scheduler.evaluate()
    const p2 = h.scheduler.evaluate() // 第二次应被合并/串行，不重复启动
    await Promise.all([p1, p2])
    expect(h.started.filter((x) => x === 'a').length).toBe(1)
    expect(h.started.filter((x) => x === 'b').length).toBe(1)
    expect(h.started.filter((x) => x === 'c').length).toBe(1)
    expect(h.started.length).toBe(3) // 空闲 3 槽全填
  })

  it('删除一张在跑卡腾出槽位后，再评估自动补位（问题2）', async () => {
    const r1 = card({ proposedName: 'r1', status: '进行中', activeRunId: 'run-a', repos: ['web'] })
    const r2 = card({ proposedName: 'r2', status: '进行中', activeRunId: 'run-b', repos: ['web'] })
    const r3 = card({ proposedName: 'r3', status: '进行中', activeRunId: 'run-c', repos: ['web'] })
    const todo = card({ proposedName: 'todo', repos: ['web'] })
    const h = harness([r1, r2, r3, todo], {
      isRunLive: (x) => ['run-a', 'run-b', 'run-c'].includes(x)
    })
    await h.scheduler.evaluate()
    expect(h.started).toEqual([]) // 3 满，不补
    h.remove('r2') // 删除一张在跑卡 → 活跃 3→2
    await h.scheduler.evaluate()
    expect(h.started).toEqual(['todo']) // 腾出槽位后补 1 张
  })

  it('既成超额（活跃>3）→ 不启动、不抛、不动在跑', async () => {
    const running = [1, 2, 3, 4].map((i) =>
      card({ proposedName: `r${i}`, status: '进行中', activeRunId: `run-o${i}`, repos: [`repo${i}`] })
    )
    const todo = card({ proposedName: 'todo', repos: ['api'] })
    const h = harness([...running, todo], {
      isRunLive: (r) => ['run-o1', 'run-o2', 'run-o3', 'run-o4'].includes(r)
    })
    await expect(h.scheduler.evaluate()).resolves.toBeUndefined()
    expect(h.started).toEqual([])
  })
})

describe('createAutoScheduler —— 并发槽与巡检共享', () => {
  it('巡检拉起的活跃运行计入活跃数，空槽相应减少', async () => {
    const todos = ['a', 'b', 'c'].map((n, i) => card({ proposedName: n, repos: [`repo-${i}`] }))
    const h = harness(todos, {
      // 一个由巡检拉起、仍活跃的运行（不绑卡，故不在卡表里）
      listPatrolRuns: () => [{ runId: 'run-patrol', repos: ['ops'] }],
      isRunLive: (runId) => runId === 'run-patrol'
    })
    expect(h.scheduler.freeSlots()).toBe(2)
    await h.scheduler.evaluate()
    expect(h.started.length).toBe(2)
  })

  it('巡检运行终局后不再占槽（同一 isRunLive 判定）', async () => {
    const h = harness([card({ proposedName: 'a' })], {
      listPatrolRuns: () => [{ runId: 'run-patrol', repos: ['web'] }],
      isRunLive: () => false // 该巡检运行已 done
    })
    expect(h.scheduler.freeSlots()).toBe(3)
  })

  it('巡检占满槽 → 本次评估不拉起任何待办卡', async () => {
    const h = harness([card({ proposedName: 'a', repos: ['api'] })], {
      listPatrolRuns: () => [
        { runId: 'p1', repos: ['ops'] },
        { runId: 'p2', repos: ['ops'] },
        { runId: 'p3', repos: ['ops'] }
      ],
      isRunLive: (runId) => ['p1', 'p2', 'p3'].includes(runId)
    })
    expect(h.scheduler.freeSlots()).toBe(0)
    await h.scheduler.evaluate()
    expect(h.started).toEqual([])
  })

  it('巡检运行的成员仓参与「与在跑不共享仓者优先」的选取', async () => {
    const shared = card({ proposedName: 'shared', repos: ['web'] })
    const free = card({ proposedName: 'free', repos: ['api'] })
    const h = harness([shared, free], {
      listPatrolRuns: () => [{ runId: 'run-patrol', repos: ['web'] }],
      isRunLive: (runId) => runId === 'run-patrol',
      maxConcurrent: 2
    })
    await h.scheduler.evaluate()
    // 1 个空槽：与巡检在跑不共享仓的 free 优先
    expect(h.started).toEqual(['free'])
  })

  it('手动启动仍不受上限约束：既成超额时排程只是不填槽，不抛不中止', async () => {
    const manual = [1, 2, 3, 4].map((i) =>
      card({ proposedName: `m${i}`, status: '进行中', activeRunId: `run-m${i}`, repos: ['web'] })
    )
    const todo = card({ proposedName: 'todo', repos: ['api'] })
    const h = harness([...manual, todo], {
      listPatrolRuns: () => [{ runId: 'run-patrol', repos: ['ops'] }],
      isRunLive: (runId) => runId.startsWith('run-')
    })
    // 手动 4 + 巡检 1 = 5 > 3：空槽为 0（不为负），排程按兵不动。
    expect(h.scheduler.freeSlots()).toBe(0)
    await expect(h.scheduler.evaluate()).resolves.toBeUndefined()
    expect(h.started).toEqual([])
  })

  it('未注入巡检运行来源（无巡检）→ 空槽口径与既有一致', () => {
    const h = harness([card({ proposedName: 'a' })])
    expect(h.scheduler.freeSlots()).toBe(3)
  })
})
