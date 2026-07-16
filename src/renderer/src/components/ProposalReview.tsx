/**
 * 卡操作提案审阅（全局对话 + 单需求 agent 上抛共用的**呈现组件**）：逐 op 可勾选、create 卡描述可展开预览、
 * 破坏性 op 红标、非法 op 静默丢弃（记 console 供排查）、应用选中项。落库动作经 props 注入（全局走会话 store、
 * 单卡走 applyOps + 刷看板），故本组件不绑任何 store，两处 UI 一模一样。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import Markdown from 'react-markdown'
import type { CardOp, OrchestrationProposal } from '@shared/types'

const primaryBtn =
  'inline-flex items-center gap-1 rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50'

/** 把一个卡操作渲染成人可读的一行效果预览。 */
export function describeOp(op: CardOp, t: (k: string, o?: Record<string, unknown>) => string): string {
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
    case 'delete':
      return t('globalChat.opDelete', { target: op.target })
  }
}

/** op 标题色：破坏性(merge/split/delete)红以示醒目，其余黑(text-ink)便于阅读。 */
function opTone(op: CardOp): string {
  return op.kind === 'merge' || op.kind === 'split' || op.kind === 'delete' ? 'text-tag-red' : 'text-ink'
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

/**
 * 一条 agent 提案的审阅块（呈现组件）：逐 op 可勾选 + 卡描述预览 + 应用选中项。
 * 落库动作经 `onApply`（普通提案）/ `onCreateProject`（新项目提议）注入；`applied`/`applying` 由上层驱动。
 */
export function ProposalReview({
  proposal,
  applied,
  applying,
  onApply,
  onCreateProject
}: {
  proposal: OrchestrationProposal
  applied: boolean
  applying: boolean
  onApply: (ops: CardOp[]) => void
  onCreateProject?: (ops: CardOp[], workflowId?: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  // 用户取消勾选的合法 op 下标（默认全选合法项；非法项不可选）。
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set())
  const newProject = proposal.suggestedProject
  if (proposal.ops.length === 0 && !newProject) return null

  // 非法 op 是**我们（系统/agent）的问题**，不甩给用户：静默丢弃 + 记 console 供开发排查，只保留合法 op。
  const invalidIdx = new Set(proposal.issues.map((iss) => iss.index))
  const validEntries = proposal.ops.map((op, i) => ({ op, i })).filter(({ i }) => !invalidIdx.has(i))
  const droppedCount = proposal.ops.length - validEntries.length
  if (droppedCount > 0) {
    console.warn('[Agent] 丢弃了不合规的卡操作（系统生成问题）：', proposal.issues)
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
          {validCount === 0 ? t('globalChat.allDroppedNote') : t('globalChat.droppedNote', { count: droppedCount })}
        </div>
      )}
      {(applied || validEntries.length > 0) && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {applied ? (
            <span className="text-[12px] text-stone-600">{t('globalChat.applied')}</span>
          ) : newProject && onCreateProject ? (
            <button
              type="button"
              className={primaryBtn}
              disabled={applying || validCount === 0}
              onClick={() => onCreateProject(selectedOps, newProject.workflowId)}
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('globalChat.createProject')}
            </button>
          ) : (
            <button
              type="button"
              className={primaryBtn}
              disabled={applying || validCount === 0}
              onClick={() => onApply(selectedOps)}
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
