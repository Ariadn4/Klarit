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
  Conversation,
  ConversationMessage,
  OrchestrationProposal,
  RunBreakpoint,
  WorkflowNode
} from '@shared/types'
import { isDestructiveIntervention } from '@shared/card-agent'
import { MarkdownView } from './NewRequirementFlow'
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
  onApply
}: {
  iv: CardIntervention
  nameOf: (id: string) => string
  onApply: (iv: CardIntervention) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      await onApply(iv)
      setDone(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-stone-300 bg-canvas px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{describeIntervention(iv, nameOf, t)}</span>
      <button
        type="button"
        disabled={done || busy}
        onClick={() => void apply()}
        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
          isDestructiveIntervention(iv)
            ? 'bg-warning/15 text-warning hover:bg-warning/25'
            : 'bg-cobalt-600 text-white hover:bg-cobalt-700'
        } disabled:opacity-50`}
      >
        {done ? t('cardConsult.done') : t('cardConsult.apply')}
      </button>
    </div>
  )
}

function ProposalRow({ proposal, onApply }: { proposal: OrchestrationProposal; onApply: () => Promise<void> }): React.JSX.Element | null {
  const { t } = useTranslation()
  const [applied, setApplied] = useState(false)
  const [busy, setBusy] = useState(false)
  const valid = proposal.ops.filter((_, i) => !proposal.issues.some((iss) => iss.index === i))
  if (valid.length === 0) return null
  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      await onApply()
      setApplied(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 rounded border border-stone-300 bg-canvas px-2 py-1.5">
      <div className="mb-1 text-[10px] font-medium text-cobalt-500">{t('cardConsult.proposalNote')}</div>
      <ul className="mb-1.5 space-y-0.5 text-[11px] text-ink">
        {valid.map((op, i) => (
          <li key={i} className="truncate">
            • {op.kind === 'create' ? op.card.title : op.kind}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={applied || busy}
        onClick={() => void apply()}
        className="rounded bg-cobalt-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-cobalt-700 disabled:opacity-50"
      >
        {applied ? t('cardConsult.applied') : t('cardConsult.applyProposal', { count: valid.length })}
      </button>
    </div>
  )
}

function MessageRow({
  message,
  nameOf,
  onApplyIntervention,
  onApplyProposal
}: {
  message: ConversationMessage
  nameOf: (id: string) => string
  onApplyIntervention: (iv: CardIntervention) => Promise<void>
  onApplyProposal: (p: OrchestrationProposal) => Promise<void>
}): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] space-y-1 ${isUser ? 'text-right' : 'text-left'}`}>
        {message.text && (
          <div
            className={`inline-block select-text rounded-card px-2.5 py-1.5 text-[12px] text-ink ${
              isUser ? 'bg-cobalt-100' : 'bg-paper'
            }`}
          >
            {isUser ? message.text : <MarkdownView content={message.text} />}
          </div>
        )}
        {message.interventions?.map((iv, i) => (
          <InterventionRow key={i} iv={iv} nameOf={nameOf} onApply={onApplyIntervention} />
        ))}
        {message.proposal && <ProposalRow proposal={message.proposal} onApply={() => onApplyProposal(message.proposal!)} />}
      </div>
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

  const applyIntervention = async (iv: CardIntervention): Promise<void> => {
    if (iv.kind === 'pause') {
      if (runId) onRunUpdate(await window.klarit.pauseRun(runId))
      return
    }
    if (iv.kind === 'resume') {
      if (runId) onRunUpdate(await window.klarit.resumeRun(runId))
      return
    }
    // 破坏性：二次确认后经引擎/store 执行。
    if (iv.kind === 'reenter') {
      // eslint-disable-next-line no-alert
      if (!runId || !confirm(t('cardConsult.confirmReenter', { node: nameOf(iv.nodeId) }))) return
      onRunUpdate(await window.klarit.reenterRun(runId, iv.nodeId, iv.instruction))
      return
    }
    if (iv.kind === 'inject') {
      // eslint-disable-next-line no-alert
      if (!runId || !confirm(t('cardConsult.confirmInject'))) return
      onRunUpdate(await window.klarit.injectRun(runId, iv.instruction))
      return
    }
    if (iv.kind === 'adjustCard') {
      // eslint-disable-next-line no-alert
      if (!confirm(t('cardConsult.confirmAdjust'))) return
      await window.klarit.updateCard(cardId, iv.patch)
      await reloadBoard()
    }
  }

  const applyProposal = async (p: OrchestrationProposal): Promise<void> => {
    const valid = p.ops.filter((_, i) => !p.issues.some((iss) => iss.index === i))
    const destructive = valid.some((op) => op.kind === 'split' || op.kind === 'merge')
    await window.klarit.applyOps(valid, destructive)
    await reloadBoard()
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
