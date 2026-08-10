import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RunBreakpoint, StoredCard } from '@shared/types'
import { useCardsStore, outputKey, OUTPUT_WINDOW } from './cards'

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

describe('cards store · load 并发防竞态', () => {
  beforeEach(() => {
    useCardsStore.setState({ cards: [], cardTypes: [], runs: {}, detailSlug: null, detailFocus: null })
  })

  it('先发起但较晚返回的 load（陈旧数据）不覆盖后发起的 load（新数据）', async () => {
    const stale = storedCard({ proposedName: 'stale', status: '未开始' })
    const fresh = storedCard({ proposedName: 'fresh', status: '进行中' })
    // 第一次 load 返回慢（陈旧），第二次 load 返回快（新）。
    let call = 0
    let releaseStale: () => void = () => {}
    const staleGate = new Promise<void>((res) => {
      releaseStale = res
    })
    const api = {
      listCards: vi.fn(async () => {
        call += 1
        if (call === 1) {
          await staleGate // 第一次卡住，等第二次先完成
          return [stale]
        }
        return [fresh]
      }),
      listCardTypes: vi.fn(async () => []),
      getRunState: vi.fn(async () => null)
    }
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api

    const p1 = useCardsStore.getState().load() // 先发起（慢）
    const p2 = useCardsStore.getState().load() // 后发起（快）
    await p2 // 后发起者先完成 → 应用新数据
    expect(useCardsStore.getState().cards.map((c) => c.proposedName)).toEqual(['fresh'])
    releaseStale()
    await p1 // 先发起者姗姗来迟 → 因已被取代而丢弃，不覆盖
    expect(useCardsStore.getState().cards.map((c) => c.proposedName)).toEqual(['fresh'])
  })

  it('单次 load 正常写入结果', async () => {
    const c = storedCard({ proposedName: 'only', status: '进行中' })
    const api = {
      listCards: vi.fn(async () => [c]),
      listCardTypes: vi.fn(async () => []),
      getRunState: vi.fn(async () => null)
    }
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
    await useCardsStore.getState().load()
    expect(useCardsStore.getState().cards.map((x) => x.proposedName)).toEqual(['only'])
  })
})

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

/**
 * 渲染层每桶只常驻**尾部有界窗口**（超出部分从内存丢弃），往上回看走既有「从引擎缓冲读该桶」的路径。
 * 丢过就得标出来——否则界面会把截过的开头当成完整历史。
 */
describe('cards store · 输出常驻窗口有界', () => {
  beforeEach(() => {
    useCardsStore.setState({ outputs: {}, outputTruncated: {} })
  })

  it('持续追加 → 每桶常驻内容有界，只留尾部', () => {
    const s = useCardsStore.getState()
    for (let i = 0; i < 400; i++) s.appendOutput('r1', 'node:n1', `${'x'.repeat(200)}行${i}\n`)
    const text = useCardsStore.getState().outputs[outputKey('r1', 'node:n1')]
    expect(text.length).toBeLessThanOrEqual(OUTPUT_WINDOW)
    expect(text.endsWith('行399\n')).toBe(true) // 留的是尾部（最新）
    expect(text).not.toContain('行0\n') // 开头已被丢弃
  })

  it('丢过内容就标记该桶已截断（供界面提供回看入口）', () => {
    const s = useCardsStore.getState()
    s.appendOutput('r1', 'node:n1', '短短一行\n')
    expect(useCardsStore.getState().outputTruncated[outputKey('r1', 'node:n1')]).toBeFalsy()
    s.appendOutput('r1', 'node:n1', 'y'.repeat(OUTPUT_WINDOW + 10))
    expect(useCardsStore.getState().outputTruncated[outputKey('r1', 'node:n1')]).toBe(true)
  })

  it('seed 回看内容同样只常驻尾部，且标出被截', () => {
    useCardsStore.getState().seedOutput('r1', 'node:n2', 'z'.repeat(OUTPUT_WINDOW * 2))
    expect(useCardsStore.getState().outputs[outputKey('r1', 'node:n2')].length).toBe(OUTPUT_WINDOW)
    expect(useCardsStore.getState().outputTruncated[outputKey('r1', 'node:n2')]).toBe(true)
  })

  it('别的桶不受影响：截断标记按桶独立', () => {
    const s = useCardsStore.getState()
    s.appendOutput('r1', 'node:big', 'q'.repeat(OUTPUT_WINDOW + 1))
    s.appendOutput('r1', 'node:small', '一行\n')
    expect(useCardsStore.getState().outputTruncated[outputKey('r1', 'node:big')]).toBe(true)
    expect(useCardsStore.getState().outputTruncated[outputKey('r1', 'node:small')]).toBeFalsy()
  })
})
