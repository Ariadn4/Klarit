import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { BotMessageSquare, Copy, Loader2, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react'
import type { CardOp, ConversationMessage, DetectedAgent, OrchestrationProposal, WorkflowProposal, WorkflowSummary } from '@shared/types'
import type { RulePack } from '@shared/rule-pack'
import { listSupportedAgents } from '@shared/agents'
import { useGlobalChatStore } from '../stores/globalChat'
import { useModalQueue } from '../stores/modalQueue'
import { FloatingWindow, MarkdownView } from './NewRequirementFlow'
import { ProposalReview, describeOp } from './ProposalReview'
import { WorkflowEditor } from './WorkflowEditor'

const ghostBtn = 'px-2 text-[13px] text-stone-600 hover:text-ink'
const primaryBtn =
  'inline-flex items-center gap-1 rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50'

/** 单语言选一个可读值（复制文本用，无 i18n 上下文）：zh → en → 任意 → 兜底。 */
function pickText(loc: Record<string, string> | undefined, fallback: string): string {
  if (!loc) return fallback
  return loc.zh || loc.en || Object.values(loc)[0] || fallback
}

/** 把一条消息整理成可复制的纯文本：用户=文字；agent=回复 + 新项目提议 + 工作流提案 + 各 op 可读描述。 */
export function messageToText(message: ConversationMessage, describe: (op: CardOp) => string): string {
  const parts: string[] = []
  if (message.text?.trim()) parts.push(message.text.trim())
  if (message.proposal) {
    if (message.proposal.suggestedProject) parts.push(`新项目：${message.proposal.suggestedProject.name}`)
    const wf = message.proposal.workflow
    if (wf) parts.push(`工作流：${pickText(wf.workflow.name, wf.workflow.id)}`)
    for (const op of message.proposal.ops) parts.push(`• ${describe(op)}`)
  }
  return parts.join('\n')
}

/**
 * 工作流提案只读预览 + 存库：按阶段列节点（各带执行者短标签、门标记），有校验问题则列出、禁用存库
 * （半成品仍显示、不丢弃——供改需求后让 agent 重出）。仅用语义令牌、深浅双主题。
 */
function WorkflowProposalReview({
  wf,
  messageAt
}: {
  wf: WorkflowProposal
  messageAt: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const openPreview = useGlobalChatStore((s) => s.openWorkflowPreview)
  const saved = useGlobalChatStore((s) => s.savedWorkflowAt.includes(messageAt))
  return (
    <div className="w-full rounded border border-stone-300 bg-canvas p-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">{t('globalChat.workflowProposalTitle')}</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[12px] text-stone-500">{t('globalChat.workflowSaved')}</span>}
          <button type="button" onClick={() => openPreview(wf, messageAt)} className={primaryBtn}>
            {t('globalChat.workflowPreview')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 工作流提案的完整编辑器浮层（草稿态可编辑、顶部保存入库）；复用设置里的 `WorkflowEditor`。
 * 由全局 `globalChat` store 的 `workflowPreview` 驱动、经 portal 挂 body，故渲染点与聊天面板开合解耦——
 * 在 App 级**常驻**渲染一处即可（既供会话内「预览草稿」，也供导入后主动推送的提案预览），
 * 不要再在聊天面板里重复渲染（否则面板开着时会双开浮层）。
 */
export function WorkflowPreviewModal(): React.JSX.Element | null {
  const { t } = useTranslation()
  const preview = useGlobalChatStore((s) => s.workflowPreview)
  const close = useGlobalChatStore((s) => s.closeWorkflowPreview)
  const markSaved = useGlobalChatStore((s) => s.markWorkflowSaved)
  const alreadySaved = useGlobalChatStore((s) => (preview ? s.savedWorkflowAt.includes(preview.messageAt) : false))
  const previewSeq = useGlobalChatStore((s) => s.previewSeq)
  const registerModalOpen = useModalQueue((s) => s.registerModalOpen)
  const registerModalClose = useModalQueue((s) => s.registerModalClose)
  const [others, setOthers] = useState<WorkflowSummary[]>([])
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([])
  const [rulePacks, setRulePacks] = useState<RulePack[]>([])
  // 当前项目激活工作流 id（用于判断这份是否已是激活工作流 → 隐藏「设置为本项目工作流」）。
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null)
  useEffect(() => {
    if (!preview) return
    void window.klarit.listWorkflows().then(setOthers)
    void window.klarit.scanAgents?.().then((a) => setDetectedAgents(a ?? []))
    void window.klarit.allRulePacks?.().then((p) => setRulePacks(p ?? []))
    void window.klarit.getActiveWorkflow?.().then((id) => setActiveWorkflowId(id ?? null))
  }, [preview])
  // 预览浮层自身也登记进全局模态协调器：开着期间，后续主动弹出（如第二份提案）排队等待、绝不叠加；
  // 关闭即撤销登记，触发协调器出队顺次弹。
  useEffect(() => {
    if (!preview) return
    registerModalOpen('workflow-preview')
    return () => registerModalClose('workflow-preview')
  }, [preview, registerModalOpen, registerModalClose])
  if (!preview) return null
  // 改写：草稿的 def.id 强制为 baseId（覆盖那个包）；创建：按 def.id 新建。
  const def = preview.wf.baseId ? { ...preview.wf.workflow, id: preview.wf.baseId } : preview.wf.workflow
  // 已入库过 → 再次打开读**库里的版本**（含上次编辑），而非重放原始提案草稿（否则编辑会"丢失"）；
  // 未入库 → 用提案草稿 initialDef 种子。
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('globalChat.workflowPreview')}
        className="flex h-full w-full max-w-[900px] flex-col overflow-hidden rounded-card border border-stone-100 bg-paper"
      >
        <WorkflowEditor
          key={previewSeq}
          workflowId={def.id}
          initialDef={def}
          libraryFirst={alreadySaved}
          chromeless
          footerLabels={{
            close: t('globalChat.workflowClose'),
            update: t('globalChat.workflowUpdate'),
            saveAndActive: t('globalChat.workflowSaveAndActive')
          }}
          isActive={def.id === activeWorkflowId}
          onSetActive={async (id) => {
            await window.klarit.setActiveWorkflow?.(id)
            markSaved(preview.messageAt)
            setActiveWorkflowId(id) // 现在它就是激活工作流 → 按钮自动消失（不关浮层，可继续看/改）
          }}
          others={others.filter((w) => w.id !== def.id)}
          detectedAgents={detectedAgents}
          rulePacks={rulePacks}
          onClose={close}
          onSaved={() => markSaved(preview.messageAt)}
        />
      </div>
    </div>,
    document.body
  )
}

/** 全局对话里的提案审阅：把共用呈现组件 `ProposalReview` 接到会话 store（应用/建项目/已应用态）。 */
function ConnectedProposalReview({
  proposal,
  messageAt
}: {
  proposal: OrchestrationProposal
  messageAt: number
}): React.JSX.Element | null {
  const requestApply = useGlobalChatStore((s) => s.requestApply)
  const createProjectFromProposal = useGlobalChatStore((s) => s.createProjectFromProposal)
  const applying = useGlobalChatStore((s) => s.applying)
  const applied = useGlobalChatStore((s) => s.appliedAt.includes(messageAt))
  return (
    <ProposalReview
      proposal={proposal}
      applied={applied}
      applying={applying}
      onApply={(ops) => requestApply(ops, messageAt)}
      onCreateProject={(ops, workflowId) => void createProjectFromProposal(ops, messageAt, workflowId)}
    />
  )
}

/** 面板级单实例右键菜单载荷：整条文字 + 光标位置 + 当前选区（含来源消息 key，供高亮匹配）。 */
interface MenuState {
  key: number
  x: number
  y: number
  selection: string
  text: string
}

/** 消息底部一个操作图标按钮。 */
function MsgAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
    >
      {icon}
    </button>
  )
}

/** 一条会话消息（用户右、agent 左；agent 带提案则渲染审阅块）。文字可选中；右键由面板统一开菜单；底部操作行。 */
function MessageRow({
  message,
  highlighted,
  isLastUser,
  onOpenMenu
}: {
  message: ConversationMessage
  highlighted: boolean
  isLastUser: boolean
  onOpenMenu: (m: MenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const retry = useGlobalChatStore((s) => s.retry)
  const editLast = useGlobalChatStore((s) => s.editLast)
  const isUser = message.role === 'user'
  const proposal = message.proposal
  const hasProposalBody = !!proposal && (proposal.ops.length > 0 || !!proposal.suggestedProject)
  const copyText = messageToText(message, (op) => describeOp(op, t))

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const selection = (window.getSelection?.()?.toString() ?? '').trim()
    onOpenMenu({ key: message.at, x: e.clientX, y: e.clientY, selection, text: copyText })
  }
  const ring = highlighted ? 'ring-2 ring-cobalt-500' : ''

  // agent 提案板（卡操作 / 工作流）与回复文字同置一个气泡内；有提案的气泡放宽些留位。
  const hasBoard = !isUser && (hasProposalBody || !!proposal?.workflow)
  const agentBubbleW = hasBoard ? 'max-w-[95%]' : 'max-w-[85%]'
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`} onContextMenu={onContextMenu}>
      {isUser
        ? message.text && (
            <div className={`max-w-[85%] select-text whitespace-pre-wrap rounded bg-cobalt-100 px-2.5 py-1.5 text-[13px] text-ink ${ring}`}>
              {message.text}
            </div>
          )
        : (message.text || hasBoard) && (
            // agent 回复按 markdown 渲染；提案板（复审/工作流）都放进同一气泡框内。
            <div className={`${agentBubbleW} select-text rounded bg-canvas px-2.5 py-1.5 ${ring}`}>
              {message.text && <MarkdownView content={message.text} />}
              {hasProposalBody && <ConnectedProposalReview proposal={proposal!} messageAt={message.at} />}
              {proposal?.workflow && (
                <div className={hasProposalBody ? 'mt-2' : message.text ? 'mt-2' : ''}>
                  <WorkflowProposalReview wf={proposal.workflow} messageAt={message.at} />
                </div>
              )}
            </div>
          )}
      {/* 底部操作行：所有消息「复制」；最新用户消息另有「编辑」+「重试」；agent 只有复制。 */}
      <div className="mt-0.5 flex items-center gap-0.5">
        {copyText.trim() !== '' && (
          <MsgAction label={t('board.copy')} icon={<Copy size={13} />} onClick={() => void window.klarit.copyText(copyText)} />
        )}
        {isUser && isLastUser && (
          <>
            <MsgAction label={t('globalChat.editMessage')} icon={<Pencil size={13} />} onClick={() => void editLast()} />
            <MsgAction label={t('globalChat.retry')} icon={<RotateCcw size={13} />} onClick={() => void retry()} />
          </>
        )}
      </div>
    </div>
  )
}

/** 会话头部选型条：按会话选 agent + 模型（覆盖全局默认；改动即持久化、对本会话后续轮生效）。 */
function ConvAgentModelBar(): React.JSX.Element | null {
  const { t } = useTranslation()
  const active = useGlobalChatStore((s) => s.active)
  const defaultAgentId = useGlobalChatStore((s) => s.defaultAgentId)
  const defaultModel = useGlobalChatStore((s) => s.defaultModel)
  const setAM = useGlobalChatStore((s) => s.setConversationAgentModel)
  if (!active) return null
  // 选项由静态 SUPPORTED_AGENTS 驱动（永远非空、不依赖 CLI 探测）；模型随所选 agent 静态给出。
  const agents = listSupportedAgents()
  const selectedAgent = active.agentId ?? defaultAgentId ?? agents[0]?.id ?? ''
  const models = agents.find((a) => a.id === selectedAgent)?.models ?? []
  // 值只看会话覆盖：无覆盖 → 空串（选中「默认模型」项，实际用全局默认，解析在主进程）。
  // 不要回落到 defaultModel，否则「默认模型」项永远无法被选中/显示。
  const selectedModel = active.model ?? ''
  const defaultName = defaultModel ? (models.find((m) => m.id === defaultModel)?.name ?? '') : ''
  const selectCls =
    'rounded border border-stone-300 bg-canvas px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-cobalt-500'
  return (
    <div className="mb-1 flex items-center gap-2 border-b border-stone-100 pb-1 text-[12px] text-stone-600">
      <span>{t('globalChat.modelLabel')}</span>
      <select
        aria-label={t('globalChat.agentSelect')}
        className={selectCls}
        value={selectedAgent}
        onChange={(e) => void setAM(e.target.value || undefined, undefined)}
      >
        {agents.length === 0 && <option value="">{t('globalChat.noAgent')}</option>}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('globalChat.modelSelect')}
        className={selectCls}
        value={selectedModel}
        disabled={models.length === 0}
        onChange={(e) => void setAM(selectedAgent || undefined, e.target.value || undefined)}
      >
        <option value="">
          {defaultName ? `${t('globalChat.defaultModelOption')}（${defaultName}）` : t('globalChat.defaultModelOption')}
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** 破坏性应用二次确认弹窗（portal + scrim）。 */
function ConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const confirm = useGlobalChatStore((s) => s.confirm)
  const cancelConfirm = useGlobalChatStore((s) => s.cancelConfirm)
  const applyProposal = useGlobalChatStore((s) => s.applyProposal)
  if (!confirm) return null
  const targets = confirm.ops
    .filter((o) => o.kind === 'merge' || o.kind === 'split' || o.kind === 'delete')
    .map((o) =>
      o.kind === 'merge'
        ? o.sources.join('、')
        : o.kind === 'split'
          ? o.source
          : o.target
    )
    .join('；')
  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('globalChat.confirmTitle')}
        className="flex w-[420px] flex-col gap-3 rounded-card border border-stone-100 bg-paper p-5"
      >
        <div className="text-[15px] font-semibold text-ink">{t('globalChat.confirmTitle')}</div>
        <div className="text-[13px] text-stone-600">{t('globalChat.confirmBody', { targets })}</div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={cancelConfirm}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-tag-red px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            onClick={() => void applyProposal(confirm.ops, confirm.messageAt, true)}
          >
            {t('globalChat.confirmApply')}
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal(content, document.body)
}

/** 全局对话入口：叠在主面板**常驻底栏（任务栏）**上、**右对齐**（FileViewer 文件标签在左，互不挤），
 * 点它开/收全局对话面板（与「待办列·描述想法」并列的头牌入口）。容器 pointer-events-none 只让按钮命中，
 * 不挡底栏其余点击；z-[61] 浮在底栏面（z-[60]）之上。 */
export function GlobalChatEntry(): React.JSX.Element {
  const { t } = useTranslation()
  const open = useGlobalChatStore((s) => s.open)
  const openPanel = useGlobalChatStore((s) => s.openPanel)
  const closePanel = useGlobalChatStore((s) => s.closePanel)
  const loadAgentOptions = useGlobalChatStore((s) => s.loadAgentOptions)
  // 挂载即拉默认 agent/模型（选型下拉回落值），不依赖开面板时机。
  useEffect(() => {
    void loadAgentOptions()
  }, [loadAgentOptions])
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[61] flex h-7 items-center justify-end px-1.5">
        <button
          type="button"
          aria-label={t('globalChat.title')}
          onClick={() => (open ? closePanel() : void openPanel())}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-medium ${
            open ? 'bg-stone-100 text-ink' : 'text-ink hover:bg-stone-100'
          }`}
        >
          <BotMessageSquare size={14} className="text-cobalt-500" />
          {t('globalChat.title')}
        </button>
      </div>
    </>
  )
}

/** 全局对话面板：多轮跟全局 agent 聊需求编排；多会话可切换（可多开），提案审阅→确认→应用。 */
export default function GlobalChatPanel(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useGlobalChatStore((s) => s.open)
  const conversations = useGlobalChatStore((s) => s.conversations)
  const activeId = useGlobalChatStore((s) => s.activeId)
  const active = useGlobalChatStore((s) => s.active)
  const phase = useGlobalChatStore((s) => s.phase)
  const input = useGlobalChatStore((s) => s.input)
  const setInput = useGlobalChatStore((s) => s.setInput)
  const send = useGlobalChatStore((s) => s.send)
  const closePanel = useGlobalChatStore((s) => s.closePanel)
  const newConversation = useGlobalChatStore((s) => s.newConversation)
  const selectConversation = useGlobalChatStore((s) => s.selectConversation)
  const removeConversation = useGlobalChatStore((s) => s.removeConversation)
  // 新消息/处理态变化时自动滚到底，露出最新一条（含 agent 回复）。
  const scrollRef = useRef<HTMLDivElement>(null)
  const msgCount = active?.messages.length ?? 0
  const msgs = active?.messages ?? []
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user')
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgCount, phase])
  // 单实例右键菜单（面板级）：任一时刻只有一个菜单 + 一处高亮，避免多条各自开菜单错位。
  const [menu, setMenu] = useState<MenuState | null>(null)
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])
  const onCopyFromMenu = async (): Promise<void> => {
    const text = menu?.selection ? menu.selection : (menu?.text ?? '')
    if (text) await window.klarit.copyText(text)
    setMenu(null)
  }
  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <>
      <FloatingWindow
        title={t('globalChat.title')}
        onMinimize={closePanel}
        widthClass="w-[720px]"
        footer={
          <div className="flex w-full items-end gap-2">
            <textarea
              aria-label={t('globalChat.inputLabel')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={t('globalChat.placeholder')}
              disabled={!activeId}
              className="min-h-0 flex-1 resize-none rounded border border-stone-300 bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-cobalt-500"
            />
            <button
              type="button"
              className={primaryBtn}
              disabled={phase === 'sending' || input.trim() === '' || !activeId}
              onClick={() => void send()}
            >
              {phase === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {t('globalChat.send')}
            </button>
          </div>
        }
      >
        <div className="flex h-[420px] gap-3">
          {/* 会话列表（可多开：多条独立会话，切换） */}
          <div className="flex w-[180px] flex-col gap-1 border-r border-stone-100 pr-2">
            <button
              type="button"
              onClick={() => void newConversation()}
              className="mb-1 inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-cobalt-500 hover:bg-stone-100"
            >
              <Plus size={14} />
              {t('globalChat.newConversation')}
            </button>
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center justify-between rounded px-2 py-1 text-[13px] ${
                  c.id === activeId ? 'bg-stone-100 text-ink' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                <button type="button" onClick={() => void selectConversation(c.id)} className="min-w-0 flex-1 truncate text-left">
                  {c.title}
                </button>
                <button
                  type="button"
                  aria-label={t('globalChat.removeConversation')}
                  onClick={() => void removeConversation(c.id)}
                  className="ml-1 hidden text-stone-600 hover:text-tag-red group-hover:block"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* 消息流（头部选型条 + 可滚动消息） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <ConvAgentModelBar />
            <div ref={scrollRef} className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto pr-1">
              {active?.messages.map((m, i) => (
                <MessageRow
                  key={i}
                  message={m}
                  highlighted={!!menu && !menu.selection && menu.key === m.at}
                  isLastUser={i === lastUserIdx}
                  onOpenMenu={setMenu}
                />
              ))}
              {/* 空态文案：只在还没任何消息、且不在处理中时显示。 */}
              {msgCount === 0 && phase !== 'sending' && (
                <div className="mt-8 text-center text-[13px] text-stone-600">{t('globalChat.empty')}</div>
              )}
              {/* 处理中：agent 侧的等待气泡。 */}
              {phase === 'sending' && (
                <div className="flex items-center gap-1 self-start rounded bg-canvas px-2.5 py-1.5 text-[12px] text-stone-600">
                  <Loader2 size={13} className="animate-spin" />
                  {t('globalChat.thinking')}
                </div>
              )}
            </div>
          </div>
        </div>
      </FloatingWindow>
      <ConfirmDialog />
      {/* 工作流预览浮层已上提到 App 级常驻渲染（见 WorkflowPreviewModal 注释），此处不再渲染以免双开。 */}
      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[90]"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div
              role="menu"
              className="fixed z-[91] min-w-[96px] overflow-hidden rounded-card border border-stone-300 bg-paper py-1 text-[13px] text-ink"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1 text-left hover:bg-stone-100"
                onClick={() => void onCopyFromMenu()}
              >
                {t('board.copy')}
              </button>
            </div>
          </>,
          document.body
        )}
    </>
  )
}
