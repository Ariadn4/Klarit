import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RunBreakpoint, StoredCard } from '@shared/types'
import { useCardsStore } from './cards'

function bp(over: Partial<RunBreakpoint>): RunBreakpoint {
  return {
    runId: 'r1',
    request: { workflowId: 'w', repoPath: '/repo' },
    state: 'running',
    currentNodeId: 'n1',
    phase: { kind: 'executing' },
    pendingDecision: null,
    ...over
  }
}

describe('cards store · 后台命令生命周期', () => {
  beforeEach(() => {
    useCardsStore.setState({ runs: {}, backgrounds: {} })
  })

  it('started → 运行中；timeout → 同 bgId 更新为超时并保留(不消失)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: '长命令', status: 'running' })
    expect(useCardsStore.getState().backgrounds['r1']).toEqual([
      { bgId: 'b1', nodeId: 'n5', label: '长命令', status: 'running' }
    ])
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: '长命令', status: 'timeout' })
    // 仍在(未被移除),状态变超时。
    expect(useCardsStore.getState().backgrounds['r1']).toEqual([
      { bgId: 'b1', nodeId: 'n5', label: '长命令', status: 'timeout' }
    ])
  })

  it('多个后台命令并存(一个运行中、一个已超时)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: '不限时', status: 'running' })
    s.onBackground('r1', { bgId: 'b2', nodeId: 'n5', label: '限时20s', status: 'timeout' })
    const list = useCardsStore.getState().backgrounds['r1']
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.status)).toEqual(['running', 'timeout'])
  })

  it('clearBackground 仅移除指定条目(用户点清除)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: 'A', status: 'exited' })
    s.onBackground('r1', { bgId: 'b2', nodeId: 'n5', label: 'B', status: 'running' })
    s.clearBackground('r1', 'b1')
    expect(useCardsStore.getState().backgrounds['r1'].map((e) => e.bgId)).toEqual(['b2'])
  })

  it('pruneStoppedBackgrounds 清掉已终止条目、保留运行中(切换节点时用)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: '已中止', status: 'stopped' })
    s.onBackground('r1', { bgId: 'b2', nodeId: 'n5', label: '已结束', status: 'exited' })
    s.onBackground('r1', { bgId: 'b3', nodeId: 'n5', label: '仍在跑', status: 'running' })
    s.pruneStoppedBackgrounds('r1')
    expect(useCardsStore.getState().backgrounds['r1'].map((e) => e.bgId)).toEqual(['b3'])
  })

  it('clearRunBackgrounds 清掉该运行全部后台窗口(抵达已完成时用)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: '仍在跑', status: 'running' })
    s.onBackground('r1', { bgId: 'b2', nodeId: 'n5', label: '已结束', status: 'exited' })
    s.clearRunBackgrounds('r1')
    expect(useCardsStore.getState().backgrounds['r1']).toEqual([])
  })

  it('setRun 终局(done)不把断点里的后台回灌为运行中(防「消失又出现」闪烁)', () => {
    const s = useCardsStore.getState()
    // 断点仍带一条后台记录(引擎清空前的旧快照),但运行已 done。
    s.setRun(bp({ state: 'done', background: [{ bgId: 'b9', nodeId: 'n5', label: '服务', command: 'x' }] }))
    expect(useCardsStore.getState().backgrounds['r1'] ?? []).toEqual([]) // 未回灌
  })

  it('setRun 回灌:补入断点里仍活的后台为运行中,不覆盖已终止历史', () => {
    const s = useCardsStore.getState()
    // 先有一条已超时历史(b1)。
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: 'A', status: 'timeout' })
    // 断点带一条仍活的后台(b2)。
    s.setRun(bp({ background: [{ bgId: 'b2', nodeId: 'n5', label: 'B', command: 'x' }] }))
    const list = useCardsStore.getState().backgrounds['r1']
    expect(list.find((e) => e.bgId === 'b1')?.status).toBe('timeout') // 历史保留
    expect(list.find((e) => e.bgId === 'b2')?.status).toBe('running') // 活的补入
  })

  it('setRun 不把已终止条目重置为运行中(即使断点不再含它)', () => {
    const s = useCardsStore.getState()
    s.onBackground('r1', { bgId: 'b1', nodeId: 'n5', label: 'A', status: 'stopped' })
    s.setRun(bp({ background: [] }))
    expect(useCardsStore.getState().backgrounds['r1']).toEqual([
      { bgId: 'b1', nodeId: 'n5', label: 'A', status: 'stopped' }
    ])
  })
})

function storedCard(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'card-x',
    title: '卡 X',
    description: '',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

describe('cards store · removeCard', () => {
  beforeEach(() => {
    useCardsStore.setState({ cards: [], cardTypes: [], runs: {}, detailSlug: null, detailFocus: null })
  })

  it('调 removeCard(slug) → 走 IPC 删卡、随后 load 刷新', async () => {
    const removeCard = vi.fn(async () => {})
    const remaining = storedCard({ proposedName: 'card-y' })
    const api = {
      removeCard,
      listCards: vi.fn(async () => [remaining]),
      listCardTypes: vi.fn(async () => [])
    }
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api

    useCardsStore.setState({ cards: [storedCard({ proposedName: 'card-x' }), remaining] })
    await useCardsStore.getState().removeCard('card-x')

    expect(removeCard).toHaveBeenCalledWith('card-x', undefined)
    expect(useCardsStore.getState().cards.map((c) => c.proposedName)).toEqual(['card-y'])
  })

  it('删的是当前打开详情的卡 → 关闭详情面板', async () => {
    const api = {
      removeCard: vi.fn(async () => {}),
      listCards: vi.fn(async () => []),
      listCardTypes: vi.fn(async () => [])
    }
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api

    useCardsStore.setState({ cards: [storedCard({ proposedName: 'card-x' })], detailSlug: 'card-x' })
    await useCardsStore.getState().removeCard('card-x')

    expect(useCardsStore.getState().detailSlug).toBeNull()
  })

  it('删的不是当前详情卡 → 不关闭详情', async () => {
    const api = {
      removeCard: vi.fn(async () => {}),
      listCards: vi.fn(async () => [storedCard({ proposedName: 'other' })]),
      listCardTypes: vi.fn(async () => [])
    }
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api

    useCardsStore.setState({ cards: [storedCard({ proposedName: 'card-x' }), storedCard({ proposedName: 'other' })], detailSlug: 'other' })
    await useCardsStore.getState().removeCard('card-x')

    expect(useCardsStore.getState().detailSlug).toBe('other')
  })
})
