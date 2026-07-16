import { create } from 'zustand'
import type { CardOp, Conversation, OrchestrationProposal, WorkflowProposal } from '@shared/types'
import { DESTRUCTIVE_OP_KINDS } from '@shared/types'
import { useCardsStore } from './cards'

/** 全局对话相位：空闲 / 正在编排（等 agent 产出提案）。 */
export type ChatPhase = 'idle' | 'sending'

/** 待二次确认的破坏性应用（含目标提案 ops 与其来源消息时间戳，用于应用后禁用按钮）。 */
interface PendingConfirm {
  ops: CardOp[]
  messageAt: number
}

interface GlobalChatState {
  open: boolean
  /** 本项目会话列表（按最近更新倒序，来自主进程）。 */
  conversations: Conversation[]
  activeId: string | null
  /** 当前会话完整体（含历史消息与提案）。 */
  active: Conversation | null
  phase: ChatPhase
  input: string
  /** 空态（如未绑定项目）。 */
  notice: string | null
  applying: boolean
  /** 已应用过的提案消息时间戳（禁用其「应用」按钮，防重复应用）。 */
  appliedAt: number[]
  /** 已入库过的工作流提案消息时间戳（提案入口显已存态、防重复）。 */
  savedWorkflowAt: number[]
  /** 正在预览/编辑的工作流提案（打开完整编辑器浮层）；null 即无。 */
  workflowPreview: { wf: WorkflowProposal; messageAt: number } | null
  /** 每次打开预览自增：作编辑器 key，保证每次打开都重挂（重新按草稿/库解析初值，不复用上次实例）。 */
  previewSeq: number
  /** 破坏性提案待用户二次确认；null 即无。 */
  confirm: PendingConfirm | null
  /** 全局默认 agent/模型（会话未选时的回落显示）。选项本身由静态 SUPPORTED_AGENTS 驱动。 */
  defaultAgentId: string | null
  defaultModel: string | null

  openPanel: () => Promise<void>
  closePanel: () => void
  setInput: (text: string) => void
  loadConversations: () => Promise<void>
  newConversation: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  send: () => Promise<void>
  /** 请求应用一条提案：含破坏性 op 则弹二次确认，否则直接应用。 */
  requestApply: (ops: CardOp[], messageAt: number) => void
  cancelConfirm: () => void
  /** 执行应用（confirmed 表示破坏性已确认）。 */
  applyProposal: (ops: CardOp[], messageAt: number, confirmedDestructive: boolean) => Promise<void>
  /** 新项目提议落地：选目录建/导入项目并绑窗口、激活所选工作流，把 create ops 种入；取消则无操作。 */
  createProjectFromProposal: (ops: CardOp[], messageAt: number, workflowId?: string) => Promise<void>
  /** 打开工作流提案的完整编辑器浮层（草稿态可编辑、顶部保存入库）。 */
  openWorkflowPreview: (wf: WorkflowProposal, messageAt: number) => void
  /** 关闭工作流预览浮层。 */
  closeWorkflowPreview: () => void
  /** 标记某工作流提案已入库（入口显已存态；保存按钮改「更新工作流」）；不关闭浮层，由「关闭」按钮关。 */
  markWorkflowSaved: (messageAt: number) => void
  /** 加载可选 agent 清单 + 全局默认（供会话选型下拉）。 */
  loadAgentOptions: () => Promise<void>
  /** 设当前会话选用的 agent/模型（覆盖全局默认；持久化并更新本地）。 */
  setConversationAgentModel: (agentId?: string, model?: string) => Promise<void>
  /** 重试最新 agent 回复：丢弃它、重跑上一条用户意图，替换本地。 */
  retry: () => Promise<void>
  /** 编辑最新用户消息：把其文字回填输入框、从会话移除该轮。 */
  editLast: () => Promise<void>
}

/** 提案是否含破坏性 op（split/merge）——决定是否需二次确认。 */
export function hasDestructive(ops: CardOp[]): boolean {
  return ops.some((o) => DESTRUCTIVE_OP_KINDS.includes(o.kind))
}

export const useGlobalChatStore = create<GlobalChatState>((set, get) => ({
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
  defaultModel: null,

  openPanel: async () => {
    // 全局对话是永远可用的入口——无需绑定项目即可打开、agent 随时可起。
    set({ open: true, notice: null })
    await get().loadAgentOptions()
    await get().loadConversations()
    // 无会话则建一条；否则选中最近一条。
    const { conversations } = get()
    if (conversations.length === 0) await get().newConversation()
    else await get().selectConversation(conversations[0].id)
  },

  closePanel: () => set({ open: false }),

  setInput: (text) => set({ input: text }),

  loadConversations: async () => {
    const conversations = await window.klarit.listConversations()
    set({ conversations })
  },

  newConversation: async () => {
    const id = await window.klarit.createConversation()
    if (!id) {
      set({ notice: 'unbound' })
      return
    }
    await get().loadConversations()
    await get().selectConversation(id)
  },

  selectConversation: async (id) => {
    const active = await window.klarit.getConversation(id)
    set({ activeId: id, active, appliedAt: [] })
  },

  removeConversation: async (id) => {
    await window.klarit.removeConversation(id)
    await get().loadConversations()
    const { conversations, activeId } = get()
    if (activeId === id) {
      if (conversations.length > 0) await get().selectConversation(conversations[0].id)
      else set({ activeId: null, active: null })
    }
  },

  send: async () => {
    const intent = get().input.trim()
    const activeId = get().activeId
    if (intent === '' || !activeId || get().phase === 'sending') return
    // 乐观：立即把用户消息追加到本地 active 并显示，不等 agent 返回。
    set((st) => ({
      phase: 'sending',
      input: '',
      active: st.active
        ? { ...st.active, messages: [...st.active.messages, { role: 'user', text: intent, at: Date.now() }] }
        : st.active
    }))
    await window.klarit.orchestrate({ intent, conversationId: activeId })
    // 守卫：期间会话被切走则丢弃这次结果。
    if (get().activeId !== activeId) {
      set({ phase: 'idle' })
      return
    }
    // 主进程已把用户消息 + agent 答复/提案落进会话——重读拿权威最新历史（替换乐观副本）。
    const active = await window.klarit.getConversation(activeId)
    set({ phase: 'idle', active })
    await get().loadConversations()
  },

  requestApply: (ops, messageAt) => {
    if (hasDestructive(ops)) set({ confirm: { ops, messageAt } })
    else void get().applyProposal(ops, messageAt, false)
  },

  cancelConfirm: () => set({ confirm: null }),

  applyProposal: async (ops, messageAt, confirmedDestructive) => {
    set({ applying: true, confirm: null })
    await window.klarit.applyOps(ops, confirmedDestructive)
    // 应用即刷新看板；标记该提案已应用（禁用按钮防重复）。
    await useCardsStore.getState().load()
    set((st) => ({ applying: false, appliedAt: [...st.appliedAt, messageAt] }))
  },

  createProjectFromProposal: async (ops, messageAt, workflowId) => {
    set({ applying: true })
    const res = await window.klarit.orchestrateCreateProject(ops, workflowId)
    if (res) {
      // 新项目已建/绑并种入卡——刷新看板、标记已应用。
      await useCardsStore.getState().load()
      set((st) => ({ applying: false, appliedAt: [...st.appliedAt, messageAt] }))
    } else {
      // 用户取消选目录：无操作。
      set({ applying: false })
    }
  },

  openWorkflowPreview: (wf, messageAt) => set((st) => ({ workflowPreview: { wf, messageAt }, previewSeq: st.previewSeq + 1 })),

  closeWorkflowPreview: () => set({ workflowPreview: null }),

  markWorkflowSaved: (messageAt) =>
    set((st) => ({
      savedWorkflowAt: st.savedWorkflowAt.includes(messageAt) ? st.savedWorkflowAt : [...st.savedWorkflowAt, messageAt]
    })),

  loadAgentOptions: async () => {
    const [defaultAgentId, defaultModel] = await Promise.all([
      window.klarit.getDefaultAgent(),
      window.klarit.getDefaultModel()
    ])
    set({ defaultAgentId, defaultModel })
  },

  setConversationAgentModel: async (agentId, model) => {
    const id = get().activeId
    if (!id) return
    // 乐观更新本地（UI 立即反映选择），再持久化；持久化失败不回滚本地选择。
    set((st) => ({ active: st.active ? { ...st.active, agentId, model } : st.active }))
    try {
      await window.klarit.setConversationAgentModel(id, agentId, model)
    } catch {
      /* 持久化失败（如主进程尚未就绪）不影响本地选择 */
    }
  },

  retry: async () => {
    const id = get().activeId
    if (!id || get().phase === 'sending') return
    // 乐观：先去掉本地末条 agent 回复并置处理态，再重跑。
    set((st) => ({
      phase: 'sending',
      active: st.active ? { ...st.active, messages: st.active.messages.slice(0, findLastAgent(st.active) ?? st.active.messages.length) } : st.active
    }))
    const conv = await window.klarit.retryLastTurn(id)
    if (get().activeId !== id) {
      set({ phase: 'idle' })
      return
    }
    set({ phase: 'idle', active: conv })
    await get().loadConversations()
  },

  editLast: async () => {
    const id = get().activeId
    if (!id) return
    const res = await window.klarit.dropLastTurn(id)
    if (res) set({ input: res.text })
    const active = await window.klarit.getConversation(id)
    set({ active })
    await get().loadConversations()
  }
}))

/** 末条 agent 消息的下标（用于重试时乐观截断）；无则 null。 */
function findLastAgent(conv: Conversation): number | null {
  for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'agent') return i
  return null
}

export type { OrchestrationProposal }
