import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Conversation, WorkflowNode } from '@shared/types'
import { CardConsultPanel } from './CardConsultPanel'
import { useCardsStore } from '../stores/cards'

const NODES: WorkflowNode[] = [
  { id: 'impl', name: { zh: '实现' }, stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: '' } }, outputs: [] }
]

function makeConv(messages: Conversation['messages']): Conversation {
  return { id: 'login', projectId: 'p1', title: 'login', messages, createdAt: 1, updatedAt: 1 }
}

function installKlarit(conv: Conversation, extra: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getCardConversation: vi.fn(async () => conv),
    sendCardConsult: vi.fn(async () => ({ reply: 'ok' })),
    pauseRun: vi.fn(async () => ({ state: 'paused' })),
    resumeRun: vi.fn(async () => ({ state: 'running' })),
    reenterRun: vi.fn(async () => ({ state: 'running' })),
    injectRun: vi.fn(async () => ({ state: 'running' })),
    updateCard: vi.fn(async () => null),
    applyOps: vi.fn(async () => ({ created: [], updated: [], removed: [], issues: [] })),
    markCardInterventionApplied: vi.fn(async () => {}),
    cardsList: vi.fn(async () => []),
    ...extra
  }
  ;(window as unknown as { klarit: unknown }).klarit = api
  return api
}

beforeEach(() => {
  vi.restoreAllMocks()
  // 隔离看板刷新：applyProposal/adjustCard 后调 useCardsStore.load()，用桩避免触真 IPC。
  useCardsStore.setState({ load: vi.fn(async () => {}) })
})

describe('CardConsultPanel', () => {
  it('渲染会话回复（agent 消息）', async () => {
    installKlarit(makeConv([{ role: 'agent', text: '当前跑到写测试这步', at: 1 }]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    expect(await screen.findByText('当前跑到写测试这步')).toBeTruthy()
  })

  it('发送意图 → 调 sendCardConsult 并刷新会话', async () => {
    const api = installKlarit(makeConv([]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const box = await screen.findByPlaceholderText(/问进度|Ask progress/)
    await userEvent.type(box, '跑到哪了')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.sendCardConsult).toHaveBeenCalledWith('login', '跑到哪了'))
    expect(api.getCardConversation).toHaveBeenCalledTimes(2) // 初始 + 发送后刷新
  })

  it('发送后立即乐观显示用户气泡（思考期间可见，不等 agent 回复）', async () => {
    let resolveSend: (v: { reply: string }) => void = () => {}
    const pending = new Promise<{ reply: string }>((r) => (resolveSend = r))
    installKlarit(makeConv([]), { sendCardConsult: vi.fn(() => pending) })
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const box = await screen.findByPlaceholderText(/问进度|Ask progress/)
    await userEvent.type(box, '恢复')
    await userEvent.keyboard('{Enter}')
    // agent 还没回（send 未 resolve），用户气泡已可见
    expect(await screen.findByText('恢复')).toBeTruthy()
    resolveSend({ reply: 'done' })
  })

  it('干预组：勾选 + 执行选中 → 调 pauseRun 并持久化已执行', async () => {
    const api = installKlarit(makeConv([{ role: 'agent', text: '好的', interventions: [{ kind: 'pause' }], at: 1 }]))
    const onRunUpdate = vi.fn()
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={onRunUpdate} />)
    // 未勾选前不执行
    await userEvent.click(await screen.findByRole('checkbox'))
    await userEvent.click(screen.getByText(/执行选中|Run selected/))
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith('r1'))
    expect(onRunUpdate).toHaveBeenCalled()
    await waitFor(() => expect(api.markCardInterventionApplied).toHaveBeenCalledWith('login', 1, 0))
  })

  it('两步计划：勾选两项 → 保序执行两个干预', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: '两步', interventions: [{ kind: 'adjustCard', patch: { title: 'T' } }, { kind: 'reenter', nodeId: 'impl' }], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const boxes = await screen.findAllByRole('checkbox')
    await userEvent.click(boxes[0])
    await userEvent.click(boxes[1])
    await userEvent.click(screen.getByText(/执行选中|Run selected/))
    await waitFor(() => expect(api.updateCard).toHaveBeenCalled())
    await waitFor(() => expect(api.reenterRun).toHaveBeenCalledWith('r1', 'impl', undefined))
    // 两项都持久化
    await waitFor(() => expect(api.markCardInterventionApplied).toHaveBeenCalledTimes(2))
  })

  it('已执行的干预 → 勾选框选中且禁用、显「已执行」、不再重复触发', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: 'ok', interventions: [{ kind: 'pause' }], appliedInterventions: [0], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const cb = (await screen.findByRole('checkbox')) as HTMLInputElement
    expect(cb.checked).toBe(true)
    expect(cb.disabled).toBe(true)
    expect(screen.getByText(/已执行|Done/)).toBeTruthy()
    // 全部已执行 → 无「执行选中」按钮
    expect(screen.queryByText(/执行选中|Run selected/)).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(api.pauseRun).not.toHaveBeenCalled()
  })

  it('上抛提案：可勾选审阅 + 应用调 applyOps', async () => {
    const proposal = {
      ops: [{ kind: 'create' as const, card: { proposedName: 'export', title: '导出功能', description: '导出为 CSV', typeId: 'feature', relations: [] } }],
      issues: []
    }
    const api = installKlarit(makeConv([{ role: 'agent', text: '这像新需求', proposal, at: 1 }]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    // 复用全局提案审阅 UI：勾选框 + 可读描述
    expect(await screen.findByText(/导出功能/)).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()
    await userEvent.click(screen.getByText(/应用|Apply/))
    await waitFor(() => expect(api.applyOps).toHaveBeenCalled())
    expect(api.applyOps.mock.calls[0][0]).toHaveLength(1) // 勾选的 create op
  })

  it('未勾选任何项 → 执行按钮禁用、不执行', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: 'x', interventions: [{ kind: 'reenter', nodeId: 'impl' }], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const btn = (await screen.findByText(/执行选中|Run selected/)).closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await userEvent.click(btn)
    await new Promise((r) => setTimeout(r, 10))
    expect(api.reenterRun).not.toHaveBeenCalled()
  })
})
