/**
 * 单卡决策面板：统一「**选中 + 一个提交**」交互（对齐 docs/failure-handling.md §2.1）——
 * 背景说明(titleKey) + 可读失败原因(reason) + 可打开产出(outputs) + 前进式选项(options，单选/多选可选中) +
 * 可选自由输入(input) + **一个「提交」按钮**。选项不再点一下立即生效；选一项、和/或写内容，再提交才生效。
 * 人工门动作按钮(actions)是旁路命令（启动/中止某进程、不推进流程），仍为即点即执行、与提交正交。
 * `raw` 仅 dev/test，正式 UI 不渲染。文案随当前语言实时翻译。纯渲染 + 回调，复用于卡详情面板。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EngineDecision } from '@shared/types'
import { useFileViewerStore } from '../stores/fileViewer'

export interface RunDecisionPanelProps {
  decision: EngineDecision
  /** 处置回应；返回 Promise 时面板会显示「处理中」态直到其兑现（决策提交是异步的：走 IPC + 引擎驱动到下一停点）。 */
  onDecide: (response: { optionId?: string; optionIds?: string[]; text?: string }) => void | Promise<void>
  /** 启动某动作(在其无活进程时);经引擎 runGateAction 起一条后台进程。 */
  onAction: (index: number) => void
  /** 中止某动作对应的后台进程(按 bgId);经引擎 stopBackground。 */
  onStopActionProc: (bgId: string) => void
  /** 派生:某动作(按其文案)当前是否有活进程,有则返回其 bgId、否则 null。用于按钮「启动↔中止」切换。 */
  runningActionBg: (label: string) => string | null
}

export function RunDecisionPanel({
  decision,
  onDecide,
  onAction,
  onStopActionProc,
  runningActionBg
}: RunDecisionPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const multi = decision.multi ?? false
  // 单选存一个 id；多选存一组 id。
  const [selected, setSelected] = useState<string[]>([])
  // 提交中：决策提交是异步的（IPC + 引擎驱动到下一停点）。此间不清空选中、不让面板变空死等，显式给「处理中」态。
  const [submitting, setSubmitting] = useState(false)
  // 新决策到达（source 变）→ 复位选中/输入/提交态，避免上一张的选中串到下一张。
  useEffect(() => {
    setSelected([])
    setText('')
    setSubmitting(false)
  }, [decision.source])

  // 「推荐」只在有多个选项要权衡时才有意义；独一份的前进项（如单个「通过」）不标推荐。
  const showRecommended = decision.options.length > 1
  const optLabel = (opt: EngineDecision['options'][number]): string =>
    opt.label ?? (opt.labelKey ? t(opt.labelKey) : opt.id)
  const optDetail = (opt: EngineDecision['options'][number]): string | undefined =>
    opt.detail ?? (opt.detailKey ? t(opt.detailKey) : undefined)

  const toggle = (id: string): void => {
    setSelected((cur) => (multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]))
  }

  const hasSelection = selected.length > 0
  const hasText = text.trim().length > 0
  const canSubmit = (hasSelection || hasText) && !submitting

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    const res: { optionId?: string; optionIds?: string[]; text?: string } = {}
    if (multi && hasSelection) res.optionIds = selected
    else if (!multi && hasSelection) res.optionId = selected[0]
    if (hasText) res.text = text
    // 保留选中/输入不清空，进入「处理中」；await 异步兑现。新决策到达由 effect 复位；同决策（如再弹）则下面兜底复位。
    setSubmitting(true)
    try {
      await onDecide(res)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded border border-warning/30 bg-warning/10 p-2">
      <div className="text-[12px] text-ink">{t(decision.titleKey, decision.titleParams)}</div>

      {/* 原因（为什么停下）置于选项/输入之前——先看清缘由再决定怎么处理。无标签，框本身即表意。 */}
      {decision.reason && (
        <div className="mt-1.5 rounded border border-warning/30 bg-canvas px-2 py-1.5">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink">
            {decision.reason}
          </pre>
        </div>
      )}

      {/* 可打开产出（评审时先看产物再决定）——旁路查看，不参与提交。 */}
      {decision.outputs && decision.outputs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium text-stone-600">{t('engineDecision.reviewOutputs')}</span>
          {decision.outputs.map((o) => (
            <button
              key={o.path}
              type="button"
              onClick={() => useFileViewerStore.getState().open(o.path)}
              className="rounded border border-stone-300 px-2 py-1 text-[12px] font-medium text-cobalt-600 hover:bg-stone-100"
            >
              📄 {o.name}
            </button>
          ))}
        </div>
      )}

      {/* 可点击外部链接（如 open-pr 回报的 PR/MR 链接）——显示**裸 URL**：可点开（系统浏览器），也可选中复制自行打开。 */}
      {decision.links && decision.links.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          <span className="text-[10px] font-medium text-stone-600">{t('engineDecision.prLinks')}</span>
          {decision.links.map((l) => (
            <div key={l.url} className="flex items-baseline gap-1.5">
              {/* 仓名前缀只在多仓（多个链接）时显示以区分；单仓不加，避免噪音。 */}
              {decision.links!.length > 1 && l.label && l.label !== l.url && (
                <span className="shrink-0 text-[11px] text-stone-500">{l.label}</span>
              )}
              <button
                type="button"
                onClick={() => void window.klarit.openExternal(l.url)}
                title={t('engineDecision.openInBrowser')}
                className="select-text break-all text-left font-mono text-[12px] text-cobalt-600 underline underline-offset-2 hover:text-cobalt-700"
              >
                {l.url}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 选项：可选中（单选 ◉/○、多选 ☑/☐），不即点即生效；详情常显在选项下方（不藏悬浮）。 */}
      <div className="mt-2 flex flex-col gap-1.5">
        {decision.options.map((opt) => {
          const on = selected.includes(opt.id)
          const detail = optDetail(opt)
          return (
            <button
              key={opt.id}
              type="button"
              disabled={submitting}
              onClick={() => toggle(opt.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                on ? 'border-cobalt-500 bg-cobalt-50' : 'border-stone-300 hover:bg-stone-100'
              } ${submitting && !on ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className={`shrink-0 text-[13px] leading-none ${on ? 'text-cobalt-600' : 'text-stone-300'}`}>
                  {multi ? (on ? '☑' : '☐') : on ? '◉' : '○'}
                </span>
                <span className="flex-1 text-[12px] font-medium text-ink">{optLabel(opt)}</span>
                {opt.recommended && showRecommended && (
                  <span className="shrink-0 rounded-full bg-cobalt-100 px-1.5 py-0.5 text-[10px] font-medium text-cobalt-700">
                    {t('engineDecision.recommended')}
                  </span>
                )}
              </div>
              {detail && <div className="mt-1 pl-2 text-[11px] leading-relaxed text-stone-600">{detail}</div>}
            </button>
          )
        })}
      </div>

      {/* 自由输入（可选）：写想法/驳回意见等；与选项可并存（据决策语义处置）。 */}
      {decision.input && (
        <input
          value={text}
          disabled={submitting}
          onChange={(e) => setText(e.target.value)}
          placeholder={decision.input.placeholderKey ? t(decision.input.placeholderKey) : undefined}
          aria-label={t(decision.input.labelKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void submit()
          }}
          className="mt-1.5 w-full rounded border border-stone-300 bg-canvas px-1.5 py-1 text-[12px] text-ink focus:border-cobalt-500 disabled:opacity-60"
        />
      )}

      {/* 唯一提交按钮：选一项、和/或写内容后提交才生效。提交中显示「处理中…」并锁面板，避免空白死等。 */}
      <div className="mt-1.5 flex items-center justify-end gap-2">
        {submitting && <span className="text-[11px] text-stone-600">{t('engineDecision.submitting')}</span>}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="rounded bg-cobalt-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-40"
        >
          {submitting ? t('engineDecision.submitting') : t('board.submit')}
        </button>
      </div>

      {/* 人工门动作按钮：旁路命令（启动/中止某进程），即点即执行、不参与提交。 */}
      {decision.actions && decision.actions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-warning/30 pt-1.5">
          {decision.actions.map((act) => {
            const bgId = runningActionBg(act.label)
            return bgId ? (
              <button
                key={act.index}
                type="button"
                onClick={() => onStopActionProc(bgId)}
                className="rounded border border-danger/40 px-2 py-1 text-[12px] font-medium text-danger hover:bg-danger/10"
              >
                ■ {t('board.stopAction', { name: act.label })}
              </button>
            ) : (
              <button
                key={act.index}
                type="button"
                onClick={() => onAction(act.index)}
                className="rounded border border-stone-300 px-2 py-1 text-[12px] font-medium text-ink hover:bg-stone-100"
              >
                ▶ {act.label}
              </button>
            )
          })}
        </div>
      )}

      {decision.gateHistory && decision.gateHistory.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-warning/30 pt-1.5 text-[10px] text-stone-600">
          {decision.gateHistory.map((h, i) => (
            <li key={i}>
              {h.cause === 'timeout'
                ? t('engineDecision.gateHistoryTimeout', { n: i + 1 })
                : t('engineDecision.gateHistoryError', { n: i + 1, code: h.code ?? 0 })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
