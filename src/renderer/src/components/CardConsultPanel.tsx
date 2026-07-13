/**
 * 卡详情面板内的**单需求 agent 咨询区**：跟本卡常驻只读 agent 多轮对话——查进度作答、本卡干预提议
 * （暂停/恢复直接执行；倒回/注入/改资料破坏性二次确认后经引擎/store 执行）、上抛塑造需求的 ops 提案审阅。
 * 一卡一会话（id=cardId、无「新建」）。复用全局对话消息呈现 patterns；仅用语义令牌、深浅双主题。
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Loader2 } from 'lucide-react'
import type {
  CardIntervention,
  CardOp,
  Conversation,
  ConversationMessage,
  RunBreakpoint,
  WorkflowNode
} from '@shared/types'
import { isDestructiveIntervention } from '@shared/card-agent'
import { MarkdownView } from './NewRequirementFlow'
import { ProposalReview } from './ProposalReview'
import { useCardsStore } from '../stores/cards'

/** 干预可读文案（节点 id 映射为名）。 */
function describeIntervention(
  iv: CardIntervention,
  nameOf: (id: string) => string,
  t: (k: string, o?: Record<string, unknown>) => string
): string {
  switch (iv.kind) {
    case 'pause':
      return t('cardConsult.ivPause')
    case 'resume':
      return t('cardConsult.ivResume')
    case 'reenter':
      return t('cardConsult.ivReenter', { node: nameOf(iv.nodeId) })
    case 'inject':
      return t('cardConsult.ivInject')
    case 'adjustCard':
      return t('cardConsult.ivAdjust')
  }
}

function InterventionRow({
  iv,
  nameOf,
  applied,
  onApply
}: {
  iv: CardIntervention
  nameOf: (id: string) => string
  /** 已执行（持久化，重开卡后仍为真）：显「已执行」、不可再触发。 */
  applied: boolean
  onApply: () => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const destructive = isDestructiveIntervention(iv)
  const isDone = applied || done
  const run = async (): Promise<void> => {
    setBusy(true)
    setConfirming(false)
    try {
      await onApply()
      setDone(true)
    } finally {
      setBusy(false)
    }
  }
  // 破坏性（倒回/注入/改资料）：先内联二次确认（不用原生 confirm——Electron 下不可靠）；无损（暂停/恢复）直接执行。
  const onClick = (): void => {
    if (destructive) setConfirming(true)
    else void run()
  }
  const label = describeIntervention(iv, nameOf, t)
  // 右侧状态提示：执行中（转圈）> 已执行（灰）> 执行（cobalt）。
  const hint = busy ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-500">
      <Loader2 className="h-3 w-3 animate-spin" />
      {t('cardConsult.running')}
    </span>
  ) : (
    <span className={`text-[10px] font-medium ${isDone ? 'text-stone-500' : 'text-cobalt-500'}`}>
      {isDone ? t('cardConsult.done') : t('cardConsult.apply')}
    </span>
  )

  // 确认态：整行保持 secondary 外观，右侧给「确认（primary cobalt）/ 取消（secondary 描边）」——对齐品牌按钮系统。
  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-stone-300 bg-canvas px-2.5 py-1.5">
        <span className="min-w-0 flex-1 text-[11px] text-ink">{label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="rounded bg-cobalt-500 px-2.5 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-cobalt-600 disabled:opacity-50"
          >
            {t('cardConsult.confirm')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded border border-stone-300 px-2 py-0.5 text-[10px] text-ink transition-colors hover:border-cobalt-500"
          >
            {t('cardConsult.cancel')}
          </button>
        </div>
      </div>
    )
  }

  // 默认态：**整个选项方框可点击**（不只右侧）——secondary 按钮样式：中性描边、悬停边框转 cobalt，
  // 右侧提示随状态切换（执行中转圈 / 已执行灰 / 执行 cobalt）；已执行或执行中禁用不可再触发。
  return (
    <button
      type="button"
      disabled={isDone || busy}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded border border-stone-300 bg-canvas px-2.5 py-1.5 text-left transition-colors hover:border-cobalt-500 disabled:opacity-60 disabled:hover:border-stone-300"
    >
      <span className="min-w-0 flex-1 text-[11px] text-ink">{label}</span>
      <span className="shrink-0">{hint}</span>
    </button>
  )
}

function MessageRow({
  message,
  nameOf,
  applied,
  applying,
  onApplyIntervention,
  onApplyProposal
}: {
  message: ConversationMessage
  nameOf: (id: string) => string
  applied: boolean
  applying: boolean
  onApplyIntervention: (iv: CardIntervention, messageAt: number, index: number) => Promise<void>
  onApplyProposal: (ops: CardOp[], messageAt: number) => Promise<void>
}): React.JSX.Element {
  const isUser = message.role === 'user'
  // 气泡位置：用户靠右、agent 靠左（同全局对话）；气泡**内**文字一律左对齐（text-left）。
  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {message.text && (
        <div
          className={`max-w-[92%] select-text rounded-card px-2.5 py-1.5 text-left text-[12px] text-ink ${
            isUser ? 'whitespace-pre-wrap bg-cobalt-100' : 'bg-paper'
          }`}
        >
          {isUser ? message.text : <MarkdownView content={message.text} />}
        </div>
      )}
      {message.interventions?.map((iv, i) => (
        <div key={i} className="w-full">
          <InterventionRow
            iv={iv}
            nameOf={nameOf}
            applied={message.appliedInterventions?.includes(i) ?? false}
            onApply={() => onApplyIntervention(iv, message.at, i)}
          />
        </div>
      ))}
      {message.proposal && (
        <div className="w-full">
          <ProposalReview
            proposal={message.proposal}
            applied={applied}
            applying={applying}
            onApply={(ops) => void onApplyProposal(ops, message.at)}
          />
        </div>
      )}
    </div>
  )
}

export function CardConsultPanel({
  cardId,
  runId,
  nodes,
  onRunUpdate
}: {
  cardId: string
  runId: string | undefined
  nodes: WorkflowNode[] | undefined
  onRunUpdate: (bp: RunBreakpoint | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [appliedAt, setAppliedAt] = useState<ReadonlySet<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const reloadBoard = useCardsStore((s) => s.load)

  const reload = async (): Promise<void> => {
    setConv(await window.klarit.getCardConversation(cardId))
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [conv?.messages.length, busy])

  const nameOf = (id: string): string => nodes?.find((n) => n.id === id)?.name.zh ?? id

  const send = async (): Promise<void> => {
    const intent = input.trim()
    if (!intent || busy) return
    setInput('')
    setBusy(true)
    // 乐观追加用户气泡：主进程落库前先显示，思考期间用户能看到自己刚发的话（reload 后以权威历史替换）。
    setConv((c) =>
      c
        ? { ...c, messages: [...c.messages, { role: 'user', text: intent, at: Date.now() }] }
        : { id: cardId, projectId: '', title: cardId, messages: [{ role: 'user', text: intent, at: Date.now() }], createdAt: Date.now(), updatedAt: Date.now() }
    )
    try {
      await window.klarit.sendCardConsult(cardId, intent)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  // 执行一个本卡干预（经引擎/store 中转）；成功后持久化「已执行」标记并刷新会话（重开卡仍显已执行）。
  const applyIntervention = async (iv: CardIntervention, messageAt: number, index: number): Promise<void> => {
    if (iv.kind === 'pause') {
      if (runId) onRunUpdate(await window.klarit.pauseRun(runId))
    } else if (iv.kind === 'resume') {
      if (runId) onRunUpdate(await window.klarit.resumeRun(runId))
    } else if (iv.kind === 'reenter') {
      // 破坏性干预：二次确认已由 InterventionRow 内联把关，此处直接经引擎执行。
      if (runId) onRunUpdate(await window.klarit.reenterRun(runId, iv.nodeId, iv.instruction))
    } else if (iv.kind === 'inject') {
      if (runId) onRunUpdate(await window.klarit.injectRun(runId, iv.instruction))
    } else if (iv.kind === 'adjustCard') {
      await window.klarit.updateCard(cardId, iv.patch)
      await reloadBoard()
    }
    // 持久化「已执行」+ 刷会话——失败不应回滚本次已执行的展示（本地 done 仍标记成功）。
    try {
      await window.klarit.markCardInterventionApplied(cardId, messageAt, index)
      await reload()
    } catch {
      /* 持久化失败（如旧 preload 尚未加载该通道）：忽略，本地仍显已执行 */
    }
  }

  // 应用选中的 ops（ProposalReview 已过滤为勾选的合法项，勾选+点应用即明确同意）：applyOps → 刷看板 → 标记已应用。
  const applyProposal = async (ops: CardOp[], messageAt: number): Promise<void> => {
    const destructive = ops.some((op) => op.kind === 'split' || op.kind === 'merge')
    setApplying(true)
    try {
      await window.klarit.applyOps(ops, destructive)
      await reloadBoard()
      setAppliedAt((prev) => new Set(prev).add(messageAt))
    } finally {
      setApplying(false)
    }
  }

  const messages = conv?.messages ?? []

  return (
    <div className="flex flex-col">
      <div className="mb-1 text-[11px] font-medium text-stone-600">{t('cardConsult.title')}</div>
      <div ref={listRef} className="max-h-64 space-y-2 overflow-auto rounded-card border border-stone-300 bg-canvas p-2">
        {messages.length === 0 && !busy ? (
          <div className="py-4 text-center text-[11px] text-stone-500">{t('cardConsult.empty')}</div>
        ) : (
          messages.map((m, i) => (
            <MessageRow
              key={i}
              message={m}
              nameOf={nameOf}
              applied={appliedAt.has(m.at)}
              applying={applying}
              onApplyIntervention={applyIntervention}
              onApplyProposal={applyProposal}
            />
          ))
        )}
        {busy && (
          <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('cardConsult.thinking')}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-end gap-1.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder={t('cardConsult.placeholder')}
          className="min-h-[2rem] flex-1 resize-none rounded-card border border-stone-300 bg-paper px-2 py-1 text-[12px] text-ink placeholder:text-stone-400 focus:border-cobalt-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-cobalt-600 text-white hover:bg-cobalt-700 disabled:opacity-50"
          aria-label={t('cardConsult.send')}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
