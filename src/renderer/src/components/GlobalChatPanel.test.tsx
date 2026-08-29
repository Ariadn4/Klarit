import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardOp, Conversation, ConversationMessage, OrchestrationProposal } from '@shared/types'
import GlobalChatPanel, { GlobalChatEntry, WorkflowPreviewModal, messageToText } from './GlobalChatPanel'
import { useGlobalChatStore } from '../stores/globalChat'

/** 内存会话状态，模拟主进程：orchestrate 追加用户+agent 消息、getConversation 读回。 */
let convs: Conversation[]
let nextProposal: OrchestrationProposal
let applyOps: ReturnType<typeof vi.fn>
let orchestrateCreateProject: ReturnType<typeof vi.fn>
let setConversationAgentModel: ReturnType<typeof vi.fn>
let copyText: ReturnType<typeof vi.fn>
let retryLastTurn: ReturnType<typeof vi.fn>
let dropLastTurn: ReturnType<typeof vi.fn>
let saveWorkflow: ReturnType<typeof vi.fn>

function makeConv(id: string): Conversation {
  return { id, projectId: 'p1', title: id, messages: [], createdAt: 1, updatedAt: 1 }
}

function installKlarit(over: Record<string, unknown> = {}): void {
  const api = {
    // 会话应用级全局：createConversation 恒可建（不再依赖绑定）。
    listConversations: vi.fn(async () => [...convs]),
    getConversation: vi.fn(async (id: string) => convs.find((c) => c.id === id) ?? null),
    createConversation: vi.fn(async () => {
      const c = makeConv(`conv-${convs.length + 1}`)
      convs.push(c)
      return c.id
    }),
    removeConversation: vi.fn(async (id: string) => {
      convs = convs.filter((c) => c.id !== id)
    }),
    orchestrate: vi.fn(async ({ intent, conversationId }: { intent: string; conversationId?: string }) => {
      const c = convs.find((x) => x.id === conversationId)
      if (c) {
        const user: ConversationMessage = { role: 'user', text: intent, at: 10 }
        const agent: ConversationMessage = { role: 'agent', text: nextProposal.reply ?? '', proposal: nextProposal, at: 11 }
        c.messages = [...c.messages, user, agent]
      }
      return nextProposal
    }),
    applyOps,
    orchestrateCreateProject,
    setConversationAgentModel,
    copyText,
    retryLastTurn,
    dropLastTurn,
    saveWorkflow,
    setActiveWorkflow: vi.fn(async () => {}),
    getActiveWorkflow: vi.fn(async () => null),
    listWorkflows: vi.fn(async () => []),
    allRulePacks: vi.fn(async () => []),
    getWorkflow: vi.fn(async () => null),
    scanAgents: vi.fn(async () => [
      {
        id: 'claude-code',
        name: 'Claude Code',
        executablePath: 'C:\bin\claude.exe',
        models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }]
      }
    ]),
    getDefaultAgent: vi.fn(async () => 'claude-code'),
    getDefaultModel: vi.fn(async () => null),
    listCards: vi.fn(async () => []),
    listCardTypes: vi.fn(async () => []),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

const proposal = (ops: CardOp[], reply = '好的'): OrchestrationProposal => ({ ops, issues: [], reply })

beforeEach(() => {
  convs = []
  applyOps = vi.fn(async () => ({ created: [], updated: [], removed: [], issues: [] }))
  orchestrateCreateProject = vi.fn(async () => ({ projectId: 'p-new', applied: { created: [], updated: [], removed: [], issues: [] } }))
  setConversationAgentModel = vi.fn(async () => {})
  copyText = vi.fn(async () => {})
  saveWorkflow = vi.fn(async () => ({ ok: true }))
  retryLastTurn = vi.fn(async (id: string) => convs.find((c) => c.id === id) ?? null)
  // 模拟主进程：从最新用户消息起整轮截断（该用户消息及其后 agent 回复一并移除）。
  dropLastTurn = vi.fn(async (id: string) => {
    const c = convs.find((x) => x.id === id)
    if (!c) return null
    const lu = c.messages.map((m) => m.role).lastIndexOf('user')
    const text = lu >= 0 ? c.messages[lu].text : ''
    c.messages = c.messages.slice(0, Math.max(0, lu))
    return { text }
  })
  nextProposal = proposal([{ kind: 'create', card: { proposedName: 'x', title: 'X', description: '', typeId: 'feat', relations: [] } }])
  installKlarit()
  useGlobalChatStore.setState({
    open: false,
    conversations: [],
    activeId: null,
    active: null,
    phase: 'idle',
    input: '',
    notice: null,
    applying: false,
    appliedAt: [],
    savedWorkflowAt: [],
    workflowPreview: null,
    previewSeq: 0,
    confirm: null,
    defaultAgentId: null,
    defaultModel: null
  })
})

const openPanel = (): Promise<void> => act(async () => {
  await useGlobalChatStore.getState().openPanel()
})

describe('全局对话入口与面板', () => {
  it('入口按钮点击 → 已绑定则开面板并建首条会话', async () => {
    render(
      <>
        <GlobalChatEntry />
        <GlobalChatPanel />
      </>
    )
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '项目Agent' }))
    })
    expect(screen.getByRole('dialog', { name: '项目Agent' })).toBeInTheDocument()
    expect(useGlobalChatStore.getState().activeId).toBeTruthy()
  })

  it('未绑定项目也能开面板（永远可用的入口）', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    expect(useGlobalChatStore.getState().open).toBe(true)
    expect(screen.getByRole('dialog', { name: '项目Agent' })).toBeInTheDocument()
    expect(useGlobalChatStore.getState().activeId).toBeTruthy()
  })

  it('新项目提议 → 渲染「创建项目并加入这些需求」、点击走建项目流', async () => {
    nextProposal = {
      ops: [{ kind: 'create', card: { proposedName: 'home', title: '首页', description: '', typeId: 'feat', relations: [] } }],
      issues: [],
      reply: '建个新项目',
      suggestedProject: { name: '新工具', description: '一个新东西', workflowId: 'wf-1' }
    }
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('我要做个全新的工具')
      await useGlobalChatStore.getState().send()
    })
    expect(screen.getByText(/新项目：新工具/)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: '创建项目并加入这些需求' })
    await act(async () => {
      await userEvent.click(btn)
    })
    // 带上 agent 选定的工作流 id
    expect(orchestrateCreateProject).toHaveBeenCalledWith(nextProposal.ops, 'wf-1')
  })

  it('发送意图 → 用户气泡 + agent 回复 + ops 审阅都渲染，空态消失', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    // 空态文案初始可见
    expect(screen.getByText(/跟 Agent 聊聊/)).toBeInTheDocument()
    await act(async () => {
      useGlobalChatStore.getState().setInput('新增一个需求 X')
      await useGlobalChatStore.getState().send()
    })
    // 用户消息气泡
    expect(screen.getByText('新增一个需求 X')).toBeInTheDocument()
    // agent 回复文案（nextProposal.reply='好的'）
    expect(screen.getByText('好的')).toBeInTheDocument()
    // ops 审阅
    expect(screen.getByText('卡操作提案')).toBeInTheDocument()
    expect(screen.getByText(/新建卡「X」/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用/ })).toBeInTheDocument()
    // 有消息后空态文案消失
    expect(screen.queryByText(/跟 Agent 聊聊/)).not.toBeInTheDocument()
  })

  it('提案：非法卡静默丢弃只留合法、显示卡描述、可勾选、有跳过提示', async () => {
    nextProposal = {
      ops: [
        { kind: 'create', card: { proposedName: 'a', title: '卡A', description: '这是卡A的描述', typeId: 'feat', relations: [] } },
        { kind: 'create', card: { proposedName: 'b', title: '卡B', description: '这是卡B的描述', typeId: 'feat', relations: [] } }
      ],
      issues: [{ index: 1, kind: 'create', reason: '类型不在册（系统问题）' }],
      reply: '建两张卡'
    }
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('建两张卡')
      await useGlobalChatStore.getState().send()
    })
    // 只显示合法卡 A；非法卡 B 被静默丢弃（无 checkbox、无红警告）
    expect(screen.getByRole('checkbox', { name: /新建卡「卡A」/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /新建卡「卡B」/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/系统问题/)).not.toBeInTheDocument()
    // 卡 A 描述（markdown 渲染）可见
    expect(screen.getByText('这是卡A的描述')).toBeInTheDocument()
    // 有低调的跳过提示
    expect(screen.getByText(/未能生成合规卡/)).toBeInTheDocument()
    // 只 1 张合法 →「应用 1 项」
    expect(screen.getByRole('button', { name: /应用/ }).textContent).toMatch(/1/)
    // 取消勾选卡A → 无勾选项 → 按钮仍在但禁用（提示用户去勾）
    await act(async () => {
      await userEvent.click(screen.getByRole('checkbox', { name: /新建卡「卡A」/ }))
    })
    expect(screen.getByRole('button', { name: /应用/ })).toBeDisabled()
  })

  it('非破坏性提案 → 直接应用（confirmedDestructive=false）', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('建卡')
      await useGlobalChatStore.getState().send()
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /应用/ }))
    })
    expect(applyOps).toHaveBeenCalledWith(nextProposal.ops, false)
    await waitFor(() => expect(screen.getByText('已应用')).toBeInTheDocument())
  })

  it('破坏性提案（merge）→ 二次确认后才应用（confirmedDestructive=true）', async () => {
    nextProposal = proposal([{ kind: 'merge', sources: ['a', 'b'], into: 'a' }], '合并')
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('把 a b 合并')
      await useGlobalChatStore.getState().send()
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /应用/ }))
    })
    // 弹二次确认、尚未应用
    expect(screen.getByRole('dialog', { name: '确认破坏性操作' })).toBeInTheDocument()
    expect(applyOps).not.toHaveBeenCalled()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '确认应用' }))
    })
    expect(applyOps).toHaveBeenCalledWith(nextProposal.ops, true)
  })

  it('全非法提案：不向用户显示红警告，只留低调跳过提示、无应用按钮', async () => {
    nextProposal = {
      ops: [{ kind: 'merge', sources: ['run', 'b'], into: 'b' }],
      issues: [{ index: 0, kind: 'merge', reason: '源卡「run」已离开待办列，不可合并' }],
      reply: '这些卡不在待办'
    }
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('合并跑过的卡')
      await useGlobalChatStore.getState().send()
    })
    // agent 回复仍在；不甩红警告给用户
    expect(screen.getByText('这些卡不在待办')).toBeInTheDocument()
    expect(screen.queryByText(/已离开待办列/)).not.toBeInTheDocument()
    // 无合法 op → 无应用按钮，只有低调跳过提示
    expect(screen.queryByRole('button', { name: /应用/ })).not.toBeInTheDocument()
    expect(screen.getByText(/未能生成合规卡/)).toBeInTheDocument()
  })

  it('会话头部可选模型（静态 SUPPORTED_AGENTS 驱动），改动持久化到该会话', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    // 选项来自静态支持表；默认 agent=claude-code，其模型含 Sonnet 5。
    const modelSelect = screen.getByLabelText('选择模型')
    await act(async () => {
      await userEvent.selectOptions(modelSelect, 'claude-sonnet-5')
    })
    // window IPC 签名 (conversationId, agentId, model)。
    expect(setConversationAgentModel).toHaveBeenCalledWith('conv-1', 'claude-code', 'claude-sonnet-5')
  })

  it('可多开：新建第二条会话、独立切换', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    const first = useGlobalChatStore.getState().activeId
    await act(async () => {
      await useGlobalChatStore.getState().newConversation()
    })
    const second = useGlobalChatStore.getState().activeId
    expect(second).not.toBe(first)
    expect(useGlobalChatStore.getState().conversations.length).toBe(2)
  })

  it('无选区右键消息 →「复制」调 copyText(整条)', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('新增一个需求 X')
      await useGlobalChatStore.getState().send()
    })
    fireEvent.contextMenu(screen.getByText('新增一个需求 X'))
    await act(async () => {
      await userEvent.click(screen.getByRole('menuitem', { name: '复制' }))
    })
    expect(copyText).toHaveBeenCalledWith('新增一个需求 X')
  })

  it('有文字选区右键 →「复制」调 copyText(选区文本)', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('你好世界')
      await useGlobalChatStore.getState().send()
    })
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '世界' } as unknown as Selection)
    fireEvent.contextMenu(screen.getByText('你好世界'))
    await act(async () => {
      await userEvent.click(screen.getByRole('menuitem', { name: '复制' }))
    })
    expect(copyText).toHaveBeenCalledWith('世界')
    spy.mockRestore()
  })

  it('可切回「默认模型」：清除会话覆盖（model=undefined）', async () => {
    render(<GlobalChatPanel />)
    await openPanel()
    const modelSelect = screen.getByLabelText('选择模型') as HTMLSelectElement
    // 先选具体模型
    await act(async () => {
      await userEvent.selectOptions(modelSelect, 'claude-sonnet-5')
    })
    // 再切回「默认模型」（value=""）
    await act(async () => {
      await userEvent.selectOptions(modelSelect, '')
    })
    expect(setConversationAgentModel).toHaveBeenLastCalledWith('conv-1', 'claude-code', undefined)
  })

  it('纯聊天轮：agent 只回 reply → 显示回复，不显占位、不显提案块', async () => {
    nextProposal = { ops: [], issues: [], reply: '这个方向可行，你想先做哪块？' }
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('你觉得这个方向如何')
      await useGlobalChatStore.getState().send()
    })
    expect(screen.getByText('这个方向可行，你想先做哪块？')).toBeInTheDocument()
    expect(screen.queryByText(/本轮没有产出内容/)).not.toBeInTheDocument()
    expect(screen.queryByText('卡操作提案')).not.toBeInTheDocument()
  })

  it('agent 空回复 → 不留占位气泡（仍可重试）', async () => {
    nextProposal = { ops: [], issues: [], reply: '' }
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('继续')
      await useGlobalChatStore.getState().send()
    })
    expect(screen.getByText('继续')).toBeInTheDocument() // 用户消息在
    expect(screen.queryByText(/本轮没有产出内容/)).not.toBeInTheDocument() // 不再显示占位
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument() // 最新 agent 有重试
  })

  it('消息操作：复制/编辑/重试都在最新用户消息；agent 只有复制', async () => {
    nextProposal = proposal([], 'AI 的回复文本')
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('新增一个需求 X')
      await useGlobalChatStore.getState().send()
    })
    // 最新用户消息有编辑 + 重试；agent 只有复制（编辑/重试各仅一个）
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '复制' }).length).toBeGreaterThanOrEqual(2)
    // 复制
    await act(async () => {
      await userEvent.click(screen.getAllByRole('button', { name: '复制' })[0])
    })
    expect(copyText).toHaveBeenCalled()
    // 重试 → retryLastTurn
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '重试' }))
    })
    expect(retryLastTurn).toHaveBeenCalledWith('conv-1')
  })

  it('编辑最新用户消息 → 用户消息与其后 AI 回复一并消失、回填输入', async () => {
    nextProposal = proposal([], 'AI 回复内容')
    render(<GlobalChatPanel />)
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('我发的话')
      await useGlobalChatStore.getState().send()
    })
    expect(screen.getByText('我发的话')).toBeInTheDocument()
    expect(screen.getByText('AI 回复内容')).toBeInTheDocument()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    })
    // 该轮整体截断：AI 回复消失、会话消息清空（用户气泡也没了；用户文字此时只在输入框里）
    expect(screen.queryByText('AI 回复内容')).not.toBeInTheDocument()
    expect(useGlobalChatStore.getState().active?.messages ?? []).toHaveLength(0)
    // 文字回填输入框
    expect(useGlobalChatStore.getState().input).toBe('我发的话')
  })

  it('messageToText：用户=文字；agent=回复 + op 描述拼接', () => {
    const userText = messageToText({ role: 'user', text: '嗨', at: 1 }, () => '')
    expect(userText).toBe('嗨')
    const agentText = messageToText(
      { role: 'agent', text: '好的', at: 1, proposal: { ops: [{ kind: 'adjust', target: 'a', patch: {} }], issues: [] } },
      (op) => `[${op.kind}]`
    )
    expect(agentText).toBe('好的\n• [adjust]')
  })
})

describe('工作流提案审阅', () => {
  const wfProposal = (over: Partial<import('@shared/types').WorkflowProposal> = {}): OrchestrationProposal => ({
    ops: [],
    issues: [],
    reply: '给你搭了个流',
    workflow: {
      workflow: {
        id: 'pr-flow',
        name: { zh: 'PR 流' },
        stages: [{ id: 's1', name: { zh: '交付' } }],
        nodes: [
          { id: 'n1', name: { zh: '推送主干' }, stageId: 's1', executor: { kind: 'engine', operation: 'push-branch' }, outputs: [] }
        ]
      },
      issues: [],
      ...over
    }
  })

  it('板子只留「工作流提案」+「预览草稿」；点开进编辑器、主按钮「保存并设为本项目工作流」一键保存并激活（不关闭）', async () => {
    nextProposal = wfProposal()
    const setActiveWorkflow = vi.fn(async (_id: string) => {})
    installKlarit({ setActiveWorkflow })
    render(
      <>
        <GlobalChatPanel />
        <WorkflowPreviewModal />
      </>
    )
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('帮我做个带评审门的 PR 工作流')
      await useGlobalChatStore.getState().send()
    })
    // 板子精简：只有「工作流提案」+「预览草稿」，不铺开流名/节点
    expect(screen.getByText('工作流提案')).toBeInTheDocument()
    expect(screen.queryByText('推送主干')).not.toBeInTheDocument()
    expect(screen.queryByText(/PR 流/)).not.toBeInTheDocument()
    // 点「预览草稿」打开完整编辑器（草稿态：显示名输入框带流名）
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    })
    expect(await screen.findByDisplayValue('PR 流')).toBeInTheDocument()
    // 顶栏无返回/保存；底部横栏有「关闭」+ 合并后的主按钮「保存并设为本项目工作流」，无独立「设置为本项目工作流」
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '设置为本项目工作流' })).not.toBeInTheDocument()
    // 一键：保存入库 + 激活（setActiveWorkflow），两件事一次点击完成
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    })
    expect(saveWorkflow).toHaveBeenCalledTimes(1)
    expect(saveWorkflow.mock.calls[0][0].id).toBe('pr-flow')
    await waitFor(() => expect(setActiveWorkflow).toHaveBeenCalledWith('pr-flow'))
    // 标记已存、浮层不关闭；激活后主按钮改为「更新工作流」，且无独立 set-active 按钮/二次确认
    expect(useGlobalChatStore.getState().savedWorkflowAt.length).toBe(1)
    expect(useGlobalChatStore.getState().workflowPreview).not.toBeNull()
    expect(await screen.findByRole('button', { name: '更新工作流' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '设置为本项目工作流' })).not.toBeInTheDocument()
  })

  it('改写提案（带 baseId）：编辑器草稿 def.id 强制为 baseId → 保存覆盖那个包', async () => {
    nextProposal = wfProposal({ baseId: 'existing-flow' })
    render(
      <>
        <GlobalChatPanel />
        <WorkflowPreviewModal />
      </>
    )
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('在我的流里加个门')
      await useGlobalChatStore.getState().send()
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    })
    await screen.findByDisplayValue('PR 流')
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    })
    expect(saveWorkflow.mock.calls[0][0].id).toBe('existing-flow')
  })

  it('浮层已是本项目活动工作流：主按钮仅「更新工作流」，点击只保存不再激活', async () => {
    nextProposal = wfProposal()
    const setActiveWorkflow = vi.fn(async (_id: string) => {})
    // 这份提案的 id 已是当前项目活动工作流 → isActive 为真
    installKlarit({ setActiveWorkflow, getActiveWorkflow: vi.fn(async () => 'pr-flow') })
    render(
      <>
        <GlobalChatPanel />
        <WorkflowPreviewModal />
      </>
    )
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('做个 PR 流')
      await useGlobalChatStore.getState().send()
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    })
    await screen.findByDisplayValue('PR 流')
    // 已激活：主按钮是「更新工作流」，无「保存并设为本项目工作流」、无独立 set-active 按钮
    expect(await screen.findByRole('button', { name: '更新工作流' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存并设为本项目工作流' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '设置为本项目工作流' })).not.toBeInTheDocument()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '更新工作流' }))
    })
    expect(saveWorkflow).toHaveBeenCalledTimes(1)
    // 已激活 → 仅保存，不再调 setActiveWorkflow
    expect(setActiveWorkflow).not.toHaveBeenCalled()
  })

  it('保存校验不过 → 不激活（不调 setActiveWorkflow）', async () => {
    nextProposal = wfProposal()
    const setActiveWorkflow = vi.fn(async (_id: string) => {})
    installKlarit({ setActiveWorkflow, saveWorkflow: vi.fn(async () => ({ ok: false, reason: '不合法' })) })
    render(
      <>
        <GlobalChatPanel />
        <WorkflowPreviewModal />
      </>
    )
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('做个 PR 流')
      await useGlobalChatStore.getState().send()
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    })
    await screen.findByDisplayValue('PR 流')
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    })
    // 保存被校验拦下 → 不激活
    expect(setActiveWorkflow).not.toHaveBeenCalled()
    expect(useGlobalChatStore.getState().workflowPreview).not.toBeNull()
  })

  it('已入库后再次预览：从库读（含编辑）的版本，而非重放原始草稿', async () => {
    nextProposal = wfProposal()
    // 库里的「编辑过」版本：显示名已改。首次草稿预览时不会调 getWorkflow（用 initialDef 种子）。
    const getWorkflow = vi.fn(async () => ({
      id: 'pr-flow',
      name: { zh: '改过的名' },
      description: {},
      stages: [{ id: 's1', name: { zh: '交付' } }],
      nodes: [{ id: 'n1', name: { zh: '推送主干' }, stageId: 's1', executor: { kind: 'engine', operation: 'push-branch' }, outputs: [] }]
    }))
    installKlarit({ getWorkflow })
    render(
      <>
        <GlobalChatPanel />
        <WorkflowPreviewModal />
      </>
    )
    await openPanel()
    await act(async () => {
      useGlobalChatStore.getState().setInput('做个 PR 流')
      await useGlobalChatStore.getState().send()
    })
    // 首次预览（草稿）：用 initialDef 种子、不读库 → 显原始草稿名，getWorkflow 未被调
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    })
    expect(await screen.findByDisplayValue('PR 流')).toBeInTheDocument()
    expect(getWorkflow).not.toHaveBeenCalled()
    // 保存 → 关闭
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    })
    await act(async () => useGlobalChatStore.getState().closeWorkflowPreview())
    // 再次预览（已入库）：initialDef 置空 → 从库读 → 显编辑后的名，而非原始草稿名
    await act(async () => useGlobalChatStore.getState().openWorkflowPreview(nextProposal.workflow!, 11))
    await waitFor(() => expect(getWorkflow).toHaveBeenCalledWith('pr-flow'))
    expect(await screen.findByDisplayValue('改过的名')).toBeInTheDocument()
  })
})
