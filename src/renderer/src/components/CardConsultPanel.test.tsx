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

  it('暂停干预：点整个选项方框（点标签即可）→ 直接调 pauseRun（无损、无确认）', async () => {
    const api = installKlarit(makeConv([{ role: 'agent', text: '好的', interventions: [{ kind: 'pause' }], at: 1 }]))
    const onRunUpdate = vi.fn()
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={onRunUpdate} />)
    // 点标签文字（不是右侧 pill）也能触发——证明整框可点
    await userEvent.click(await screen.findByText(/暂停本卡|Pause this card/))
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith('r1'))
    expect(onRunUpdate).toHaveBeenCalled()
  })

  it('倒回干预 → 内联二次确认后调 reenterRun', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: '建议倒回', interventions: [{ kind: 'reenter', nodeId: 'impl', instruction: '换方案' }], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    // 破坏性：点整框（点标签）出内联确认，未确认前不执行
    await userEvent.click(await screen.findByText(/倒回到/))
    expect(api.reenterRun).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByText(/^确认$|^Confirm$/))
    await waitFor(() => expect(api.reenterRun).toHaveBeenCalledWith('r1', 'impl', '换方案'))
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

  it('倒回干预取消内联确认 → 不执行', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: 'x', interventions: [{ kind: 'reenter', nodeId: 'impl' }], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await userEvent.click(await screen.findByText(/倒回到/))
    await userEvent.click(await screen.findByText(/^取消$|^Cancel$/))
    await new Promise((r) => setTimeout(r, 10))
    expect(api.reenterRun).not.toHaveBeenCalled()
  })
})
