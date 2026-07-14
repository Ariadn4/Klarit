/**
 * 卡详情面板内的**单需求 agent 咨询区**：跟本卡常驻只读 agent 多轮对话——查进度作答、本卡干预（一轮多项
 * 干预统一框起、勾选后「执行选中」按序执行、执行后锁定；同构 ops 提案审阅）、上抛塑造需求的 ops 提案审阅。
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

/** 与 ops 提案审阅按钮同款（bg-cobalt-500 / px-3 py-1.5 / text-[13px]）——两处 UI 尺寸一致。 */
const primaryBtn =
  'inline-flex items-center gap-1 rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50'

/**
 * 一轮的本卡干预：**互斥备选方案，单选（radio）一个 → 点「执行」跑那一个**。执行开始即锁定全部选项、
 * 在所选项上显执行状态（执行中…）；执行完**整组锁死**——不能再选、不能执行别的，所选项标「已执行」。
 * 尺寸/样式与 `ProposalReview` 一致。
 */
function InterventionGroup({
  interventions,
  applied,
  groupKey,
  nameOf,
  onExecute
}: {
  interventions: CardIntervention[]
  /** 已执行的干预下标（持久化）；非空即整组已定、锁死。 */
  applied: number[]
  /** radio name 用（同组互斥、跨组不串）。 */
  groupKey: string
  nameOf: (id: string) => string
  onExecute: (indices: number[]) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const appliedSet = new Set(applied)
  const resolved = applied.length > 0 // 已执行过一个 → 整组锁死
  const firstPending = interventions.findIndex((_, i) => !appliedSet.has(i))
  // 默认预选第一个未执行项：单个干预时=一键执行；多个备选时可切换。
  const [selected, setSelected] = useState<number | null>(firstPending >= 0 ? firstPending : null)
  const [busy, setBusy] = useState(false)
  const execute = async (): Promise<void> => {
    if (selected == null) return
    setBusy(true)
    try {
      await onExecute([selected])
    } finally {
      setBusy(false)
    }
  }
  const locked = resolved || busy
  return (
    <div className="mt-2 w-full rounded border border-stone-300 bg-canvas p-2">
      <div className="mb-1 text-[12px] font-semibold text-ink">{t('cardConsult.interventionsTitle')}</div>
      <ul className="flex flex-col gap-1.5">
        {interventions.map((iv, i) => {
          const done = appliedSet.has(i)
          const running = busy && selected === i
          return (
            <li key={i} className="text-[13px] leading-snug">
              <label className={`flex cursor-pointer items-start gap-1.5 ${done ? '' : resolved ? 'opacity-50' : ''}`}>
                <input
                  type="radio"
                  name={`iv-${groupKey}`}
                  className="mt-[3px] accent-cobalt-500"
                  disabled={locked}
                  checked={done || selected === i}
                  onChange={() => setSelected(i)}
                  aria-label={describeIntervention(iv, nameOf, t)}
                />
                <span className="min-w-0 flex-1 font-medium text-ink">{describeIntervention(iv, nameOf, t)}</span>
                {done && <span className="shrink-0 text-[11px] font-medium text-stone-500">{t('cardConsult.done')}</span>}
                {running && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-stone-500">
                    <Loader2 size={12} className="animate-spin" />
                    {t('cardConsult.running')}
                  </span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
      {!resolved && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <button type="button" disabled={busy || selected == null} onClick={() => void execute()} className={primaryBtn}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t('cardConsult.apply')}
          </button>
        </div>
      )}
    </div>
  )
}

function MessageRow({
  message,
  nameOf,
  applied,
  applying,
  onExecuteInterventions,
  onApplyProposal
}: {
  message: ConversationMessage
  nameOf: (id: string) => string
  applied: boolean
  applying: boolean
  onExecuteInterventions: (messageAt: number, interventions: CardIntervention[], indices: number[]) => Promise<void>
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
      {message.interventions && message.interventions.length > 0 && (
        <InterventionGroup
          interventions={message.interventions}
          applied={message.appliedInterventions ?? []}
          groupKey={String(message.at)}
          nameOf={nameOf}
          onExecute={(indices) => onExecuteInterventions(message.at, message.interventions!, indices)}
        />
      )}
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
  const [clearing, setClearing] = useState(false)
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

  // 执行单个干预动作（经引擎/store 中转），不含持久化/刷新——供批量执行按序调用。
  const runInterventionAction = async (iv: CardIntervention): Promise<void> => {
    if (iv.kind === 'pause') {
      if (runId) onRunUpdate(await window.klarit.pauseRun(runId))
    } else if (iv.kind === 'resume') {
      if (runId) onRunUpdate(await window.klarit.resumeRun(runId))
    } else if (iv.kind === 'reenter') {
      if (runId) onRunUpdate(await window.klarit.reenterRun(runId, iv.nodeId, iv.instruction))
    } else if (iv.kind === 'inject') {
      if (runId) onRunUpdate(await window.klarit.injectRun(runId, iv.instruction))
    } else if (iv.kind === 'adjustCard') {
      await window.klarit.updateCard(cardId, iv.patch)
      await reloadBoard()
    }
  }

  // 批量执行选中的干预：**保序**逐个执行（处理两步计划），逐个持久化「已执行」，最后刷一次会话。
  const executeInterventions = async (
    messageAt: number,
    interventions: CardIntervention[],
    indices: number[]
  ): Promise<void> => {
    for (const i of indices) {
      await runInterventionAction(interventions[i])
      try {
        await window.klarit.markCardInterventionApplied(cardId, messageAt, i)
      } catch {
        /* 持久化失败（如旧 preload 尚未加载该通道）：忽略，重开可能不显已执行，但本次执行已生效 */
      }
    }
    await reload()
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

  // 清空对话：清消息 + 断续接（保留会话与所选 agent/模型），回到空态。二次确认（内联，不用原生弹窗）。
  const clearChat = async (): Promise<void> => {
    setClearing(false)
    setAppliedAt(new Set())
    try {
      await window.klarit.clearCardConversation(cardId)
    } catch {
      /* 旧 preload 尚无该通道时忽略 */
    }
    await reload()
  }

  const messages = conv?.messages ?? []

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-stone-600">{t('cardConsult.title')}</span>
        {messages.length > 0 &&
          (clearing ? (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-500">{t('cardConsult.clearConfirm')}</span>
              <button
                type="button"
                onClick={() => void clearChat()}
                className="rounded bg-cobalt-500 px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-cobalt-600"
              >
                {t('cardConsult.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setClearing(false)}
                className="rounded border border-stone-300 px-2 py-0.5 text-[10px] text-ink transition-colors hover:border-cobalt-500"
              >
                {t('cardConsult.cancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setClearing(true)}
              className="text-[10px] text-stone-500 transition-colors hover:text-ink"
            >
              {t('cardConsult.clear')}
            </button>
          ))}
      </div>
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
              onExecuteInterventions={executeInterventions}
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
