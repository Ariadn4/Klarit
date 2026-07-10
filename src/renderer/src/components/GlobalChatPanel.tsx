import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { BotMessageSquare, Copy, Loader2, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react'
import Markdown from 'react-markdown'
import type { CardOp, ConversationMessage, OrchestrationProposal } from '@shared/types'
import { listSupportedAgents } from '@shared/agents'
import { useGlobalChatStore } from '../stores/globalChat'
import { FloatingWindow, MarkdownView } from './NewRequirementFlow'

const ghostBtn = 'px-2 text-[13px] text-stone-600 hover:text-ink'
const primaryBtn =
  'inline-flex items-center gap-1 rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50'

/** 把一个卡操作渲染成人可读的一行效果预览。 */
function describeOp(op: CardOp, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (op.kind) {
    case 'create':
      return t('globalChat.opCreate', { name: op.card.title || op.card.proposedName })
    case 'adjust':
      return t('globalChat.opAdjust', { target: op.target })
    case 'split':
      return t('globalChat.opSplit', { source: op.source, count: op.into.length })
    case 'merge':
      return t('globalChat.opMerge', {
        sources: op.sources.join('、'),
        into: typeof op.into === 'string' ? op.into : op.into.proposedName
      })
    case 'relate':
      return t(op.op === 'add' ? 'globalChat.opRelateAdd' : 'globalChat.opRelateRemove', {
        from: op.from,
        kind: op.edge.kind,
        target: op.edge.target
      })
  }
}

/** op 标题色：破坏性(merge/split)红以示醒目，其余黑(text-ink)便于阅读。 */
function opTone(op: CardOp): string {
  return op.kind === 'merge' || op.kind === 'split' ? 'text-tag-red' : 'text-ink'
}

/** 卡描述的 markdown 样式：正文灰、标题(#)加粗深色显特殊、列表/代码基础排版。 */
const descMd =
  'text-[12px] leading-relaxed text-stone-600 ' +
  '[&_h1]:mb-0.5 [&_h1]:mt-1.5 [&_h1]:text-[12px] [&_h1]:font-semibold [&_h1]:text-ink ' +
  '[&_h2]:mb-0.5 [&_h2]:mt-1.5 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h2]:text-ink ' +
  '[&_h3]:font-semibold [&_h3]:text-ink [&_p]:mb-1 [&_li]:ml-4 [&_li]:list-disc [&_code]:font-mono [&_strong]:text-ink'

/** 可展开的卡描述：虚线框内、markdown 渲染（正文灰、标题特殊样式）；默认折叠、点展开看全。 */
function CardDesc({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="ml-5 mt-1 rounded border border-dashed border-stone-300 px-2 py-1">
      <div className={`${descMd} ${open ? '' : 'max-h-[3.4em] overflow-hidden'}`}>
        <Markdown>{text}</Markdown>
      </div>
      <button
        type="button"
        className="mt-0.5 text-[11px] text-cobalt-500 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? t('globalChat.collapse') : t('globalChat.expand')}
      </button>
    </div>
  )
}

/** 把一条消息整理成可复制的纯文本：用户=文字；agent=回复 + 新项目提议 + 各 op 可读描述。 */
export function messageToText(message: ConversationMessage, describe: (op: CardOp) => string): string {
  const parts: string[] = []
  if (message.text?.trim()) parts.push(message.text.trim())
  if (message.proposal) {
    if (message.proposal.suggestedProject) parts.push(`新项目：${message.proposal.suggestedProject.name}`)
    for (const op of message.proposal.ops) parts.push(`• ${describe(op)}`)
  }
  return parts.join('\n')
}

/** 一条 agent 提案的审阅块：逐 op 可勾选 + 卡描述预览 + 换行警告 + 应用选中项。 */
function ProposalReview({
  proposal,
  messageAt
}: {
  proposal: OrchestrationProposal
  messageAt: number
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const requestApply = useGlobalChatStore((s) => s.requestApply)
  const createProjectFromProposal = useGlobalChatStore((s) => s.createProjectFromProposal)
  const applying = useGlobalChatStore((s) => s.applying)
  const applied = useGlobalChatStore((s) => s.appliedAt.includes(messageAt))
  // 用户取消勾选的合法 op 下标（默认全选合法项；非法项不可选）。
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set())
  const newProject = proposal.suggestedProject
  if (proposal.ops.length === 0 && !newProject) return null

  // 非法 op 是**我们（系统/agent）的问题**，不甩给用户：静默丢弃 + 记 console 供开发排查，
  // 只保留合法 op 呈现/应用（3 张里 2 张错就只出 1 张）。
  const invalidIdx = new Set(proposal.issues.map((iss) => iss.index))
  const validEntries = proposal.ops.map((op, i) => ({ op, i })).filter(({ i }) => !invalidIdx.has(i))
  const droppedCount = proposal.ops.length - validEntries.length
  if (droppedCount > 0) {
    // 记给我们自己（开发在 devtools 里能看到具体哪张卡、什么原因），用户无需处理。
    console.warn('[项目Agent] 丢弃了不合规的卡操作（系统生成问题）：', proposal.issues)
  }
  if (validEntries.length === 0 && droppedCount === 0 && !newProject) return null

  const included = (i: number): boolean => !excluded.has(i)
  const selectedOps = validEntries.filter(({ i }) => included(i)).map(({ op }) => op)
  const validCount = selectedOps.length
  const toggle = (i: number): void =>
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  return (
    <div className="mt-2 rounded border border-stone-300 bg-canvas p-2">
      <div className="mb-1 text-[12px] font-semibold text-ink">
        {newProject ? t('globalChat.newProjectTitle', { name: newProject.name }) : t('globalChat.proposalTitle')}
      </div>
      {newProject?.description && <div className="mb-1.5 text-[12px] text-stone-600">{newProject.description}</div>}
      <ul className="flex flex-col gap-1.5">
        {validEntries.map(({ op, i }) => (
          <li key={i} className="text-[13px] leading-snug">
            <label className="flex cursor-pointer items-start gap-1.5">
              <input
                type="checkbox"
                className="mt-[3px] accent-cobalt-500"
                checked={included(i)}
                onChange={() => toggle(i)}
                aria-label={describeOp(op, t)}
              />
              <span className={`min-w-0 flex-1 font-medium ${opTone(op)}`}>{describeOp(op, t)}</span>
            </label>
            {op.kind === 'create' && op.card.description.trim() !== '' && <CardDesc text={op.card.description} />}
          </li>
        ))}
      </ul>
      {droppedCount > 0 && (
        <div className="mt-1.5 text-[11px] text-stone-600">
          {validCount === 0
            ? t('globalChat.allDroppedNote')
            : t('globalChat.droppedNote', { count: droppedCount })}
        </div>
      )}
      {/* 有可选卡就显按钮（全不勾则禁用，提示用户去勾）；全非法（无可选卡）才不显、只留重试提示。 */}
      {(applied || validEntries.length > 0) && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {applied ? (
            <span className="text-[12px] text-stone-600">{t('globalChat.applied')}</span>
          ) : newProject ? (
            <button
              type="button"
              className={primaryBtn}
              disabled={applying || validCount === 0}
              onClick={() => void createProjectFromProposal(selectedOps, messageAt, newProject.workflowId)}
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('globalChat.createProject')}
            </button>
          ) : (
            <button
              type="button"
              className={primaryBtn}
              disabled={applying || validCount === 0}
              onClick={() => requestApply(selectedOps, messageAt)}
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('globalChat.apply', { count: validCount })}
            </button>
          )}
        </div>
      )}
    </div>
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

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`} onContextMenu={onContextMenu}>
      {message.text &&
        (isUser ? (
          <div className={`max-w-[85%] select-text whitespace-pre-wrap rounded bg-cobalt-100 px-2.5 py-1.5 text-[13px] text-ink ${ring}`}>
            {message.text}
          </div>
        ) : (
          // agent 回复按 markdown 渲染（标题/列表/代码等），不再给源码。
          <div className={`max-w-[85%] select-text rounded bg-canvas px-2.5 py-1.5 ${ring}`}>
            <MarkdownView content={message.text} />
          </div>
        ))}
      {!isUser && hasProposalBody && (
        <div className={`w-full select-text rounded ${ring}`}>
          <ProposalReview proposal={proposal!} messageAt={message.at} />
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
    .filter((o) => o.kind === 'merge' || o.kind === 'split')
    .map((o) => (o.kind === 'merge' ? o.sources.join('、') : (o as { source: string }).source))
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
