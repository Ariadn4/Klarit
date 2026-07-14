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
    clearCardConversation: vi.fn(async () => {}),
    abortCardConsult: vi.fn(async () => {}),
    dropLastCardConsultTurn: vi.fn(async () => ({ text: '上一条' })),
    retryLastCardConsult: vi.fn(async () => makeConv([])),
    copyText: vi.fn(async () => {}),
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

  it('单个干预默认预选 → 点「执行」即跑 + 持久化已执行', async () => {
    const api = installKlarit(makeConv([{ role: 'agent', text: '好的', interventions: [{ kind: 'pause' }], at: 1 }]))
    const onRunUpdate = vi.fn()
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={onRunUpdate} />)
    ;((await screen.findByRole('radio')) as HTMLInputElement) // 默认已预选
    await userEvent.click(screen.getByText(/^执行$|^Run$/))
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith('r1'))
    expect(onRunUpdate).toHaveBeenCalled()
    await waitFor(() => expect(api.markCardInterventionApplied).toHaveBeenCalledWith('login', 1, 0))
  })

  it('互斥备选：单选第二个 → 只执行所选那个（不执行第一个）', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: '两个做法', interventions: [{ kind: 'pause' }, { kind: 'reenter', nodeId: 'impl' }], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const radios = await screen.findAllByRole('radio')
    await userEvent.click(radios[1]) // 选第二个（倒回）
    await userEvent.click(screen.getByText(/^执行$|^Run$/))
    await waitFor(() => expect(api.reenterRun).toHaveBeenCalledWith('r1', 'impl', undefined))
    expect(api.pauseRun).not.toHaveBeenCalled() // 未选的不执行
    await waitFor(() => expect(api.markCardInterventionApplied).toHaveBeenCalledWith('login', 1, 1))
    expect(api.markCardInterventionApplied).toHaveBeenCalledTimes(1) // 只执行一个
  })

  it('清空对话：二次确认后调 clearCardConversation 并刷新（确认前不清）', async () => {
    let cleared = false
    const conv = makeConv([{ role: 'user', text: '历史', at: 1 }])
    const api = installKlarit(conv, {
      clearCardConversation: vi.fn(async () => {
        cleared = true
      }),
      getCardConversation: vi.fn(async () => (cleared ? makeConv([]) : conv))
    })
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await screen.findByText('历史')
    await userEvent.click(await screen.findByRole('button', { name: /询问 Agent|Ask Agent/ })) // 先展开
    await userEvent.click(screen.getByText(/清空对话|Clear chat/))
    expect(api.clearCardConversation).not.toHaveBeenCalled() // 确认前不清
    await userEvent.click(screen.getByText(/^确认$|^Confirm$/))
    await waitFor(() => expect(api.clearCardConversation).toHaveBeenCalledWith('login'))
    await waitFor(() => expect(screen.queryByText('历史')).toBeNull()) // 回空态
  })

  it('消息底部操作：所有消息「复制」；仅最新用户消息另有「编辑」「重试」', async () => {
    const api = installKlarit(
      makeConv([
        { role: 'user', text: '旧问题', at: 1 },
        { role: 'agent', text: '旧回复', at: 2 },
        { role: 'user', text: '新问题', at: 3 },
        { role: 'agent', text: '新回复', at: 4 }
      ])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await screen.findByText('新问题')
    // 复制：4 条消息各一个
    expect(screen.getAllByTitle(/复制|Copy/)).toHaveLength(4)
    // 编辑/重试：只在最新用户消息 → 各一个
    expect(screen.getAllByTitle(/编辑|Edit/)).toHaveLength(1)
    expect(screen.getAllByTitle(/重试|Retry/)).toHaveLength(1)
    // 点复制 → 走剪贴板
    await userEvent.click(screen.getAllByTitle(/复制|Copy/)[0])
    await waitFor(() => expect(api.copyText).toHaveBeenCalled())
  })

  it('编辑最新用户消息 → 移除该轮并回填输入', async () => {
    const api = installKlarit(makeConv([{ role: 'user', text: '改我', at: 1 }, { role: 'agent', text: 'a', at: 2 }]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await screen.findByText('改我')
    await userEvent.click(screen.getByTitle(/编辑|Edit/))
    await waitFor(() => expect(api.dropLastCardConsultTurn).toHaveBeenCalledWith('login'))
    // 回填输入框
    expect((await screen.findByPlaceholderText(/问进度|Ask progress/)) as HTMLTextAreaElement).toHaveValue('上一条')
  })

  it('重试最新用户消息 → 立即消除下方 agent 气泡 + 调 retryLastCardConsult', async () => {
    let resolveRetry: (v: unknown) => void = () => {}
    const pending = new Promise((r) => (resolveRetry = r))
    const api = installKlarit(makeConv([{ role: 'user', text: '重来', at: 1 }, { role: 'agent', text: '旧回复A', at: 2 }]), {
      retryLastCardConsult: vi.fn(() => pending)
    })
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await screen.findByText('旧回复A')
    await userEvent.click(screen.getByTitle(/重试|Retry/))
    // retry 还没返回，agent 气泡已即刻消失（乐观截断）
    expect(screen.queryByText('旧回复A')).toBeNull()
    expect(screen.getByText('重来')).toBeTruthy() // 用户消息保留
    expect(api.retryLastCardConsult).toHaveBeenCalledWith('login')
    resolveRetry(makeConv([{ role: 'user', text: '重来', at: 1 }]))
  })

  it('思考中显示「停止」→ 点击调 abortCardConsult', async () => {
    let resolveSend: (v: { reply: string }) => void = () => {}
    const pending = new Promise<{ reply: string }>((r) => (resolveSend = r))
    const api = installKlarit(makeConv([]), { sendCardConsult: vi.fn(() => pending) })
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const box = await screen.findByPlaceholderText(/问进度|Ask progress/)
    await userEvent.type(box, '问一下')
    await userEvent.keyboard('{Enter}')
    // 思考中：出现「停止」
    const stopBtn = await screen.findByLabelText(/停止|Stop/)
    await userEvent.click(stopBtn)
    expect(api.abortCardConsult).toHaveBeenCalledWith('login')
    resolveSend({ reply: 'x' })
  })

  it('底部抽屉：默认折叠（不显标题/清空），点把手展开/收起', async () => {
    installKlarit(makeConv([{ role: 'agent', text: '历史', at: 1 }]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const handle = await screen.findByRole('button', { name: /询问 Agent|Ask Agent/ }) // aria-label 即使折叠也可寻
    expect(handle.getAttribute('aria-expanded')).toBe('false') // 默认折叠
    expect(screen.queryByText(/清空对话|Clear chat/)).toBeNull() // 折叠不显清空
    await userEvent.click(handle)
    expect(handle.getAttribute('aria-expanded')).toBe('true') // 展开
    expect(screen.getByText(/清空对话|Clear chat/)).toBeTruthy() // 展开显清空
    await userEvent.click(handle)
    expect(handle.getAttribute('aria-expanded')).toBe('false') // 收起
  })

  it('发送问题即展开底部抽屉', async () => {
    installKlarit(makeConv([]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const handle = await screen.findByRole('button', { name: /询问 Agent|Ask Agent/ })
    expect(handle.getAttribute('aria-expanded')).toBe('false')
    await userEvent.type(screen.getByPlaceholderText(/问进度|Ask progress/), '在跑吗')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(handle.getAttribute('aria-expanded')).toBe('true'))
  })

  it('无历史时不显示清空入口', async () => {
    installKlarit(makeConv([]))
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    await screen.findByPlaceholderText(/问进度|Ask progress/)
    expect(screen.queryByText(/清空对话|Clear chat/)).toBeNull()
  })

  it('已执行 → 整组锁死：radio 禁用、显「已执行」、无执行按钮、不可再触发别的', async () => {
    const api = installKlarit(
      makeConv([{ role: 'agent', text: 'ok', interventions: [{ kind: 'pause' }, { kind: 'reenter', nodeId: 'impl' }], appliedInterventions: [0], at: 1 }])
    )
    render(<CardConsultPanel cardId="login" runId="r1" nodes={NODES} onRunUpdate={() => {}} />)
    const radios = (await screen.findAllByRole('radio')) as HTMLInputElement[]
    expect(radios[0].checked).toBe(true)
    expect(radios.every((r) => r.disabled)).toBe(true) // 全锁
    expect(screen.getByText(/已执行|Done/)).toBeTruthy()
    expect(screen.queryByText(/^执行$|^Run$/)).toBeNull() // 无执行按钮
    await new Promise((r) => setTimeout(r, 10))
    expect(api.pauseRun).not.toHaveBeenCalled()
    expect(api.reenterRun).not.toHaveBeenCalled()
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

})
