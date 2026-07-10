/**
 * 需求卡详情面板：卡信息 + 运行控制（运行/暂停/恢复）+ 单卡决策（RunDecisionPanel）+ 命令输出分流
 * （前台当前命令 + 各后台命令各自可看）。决策与输出区可由卡上圆点点击定位（detailFocus）。
 * 跨卡决策弹窗不在本能力范围。
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, RotateCcw, X } from 'lucide-react'
import type { WorkflowDefinition } from '@shared/types'
import { RunDecisionPanel } from './RunDecisionPanel'
import { CommandOutputView } from './CommandOutputView'
import { CopyButton } from './CopyButton'
import { cardBadgeClass } from './cardTypeColors'
import { runStateToCardStatus } from '../lib/board'
import { useCardsStore, type BgEntry } from '../stores/cards'

/** 稳定空数组引用：避免 zustand 选择器每次返回新 `[]` 触发 useSyncExternalStore 无限循环。 */
const EMPTY_BG: BgEntry[] = []

export function RequirementCardDetail(): React.JSX.Element | null {
  const { t } = useTranslation()
  const slug = useCardsStore((s) => s.detailSlug)
  const focus = useCardsStore((s) => s.detailFocus)
  const card = useCardsStore((s) => s.cards.find((c) => c.proposedName === s.detailSlug) ?? null)
  const cardTypes = useCardsStore((s) => s.cardTypes)
  const bp = useCardsStore((s) => (card?.activeRunId ? (s.runs[card.activeRunId] ?? null) : null))
  const close = useCardsStore((s) => s.closeDetail)
  const setRun = useCardsStore((s) => s.setRun)
  const runCard = useCardsStore((s) => s.runCard)
  const backgrounds = useCardsStore((s) =>
    card?.activeRunId ? (s.backgrounds[card.activeRunId] ?? EMPTY_BG) : EMPTY_BG
  )
  const clearBackground = useCardsStore((s) => s.clearBackground)
  const seedOutput = useCardsStore((s) => s.seedOutput)

  const decisionRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // 载入该运行的工作流定义：判断当前节点是否 command（决定是否显示推进控件）与是否末节点。
  const [wf, setWf] = useState<WorkflowDefinition | null>(null)
  const wfId = bp?.request.workflowId
  useEffect(() => {
    if (!wfId) {
      setWf(null)
      return
    }
    void window.klarit.getWorkflow(wfId).then(setWf)
  }, [wfId])

  // 圆点点击带 focus 进来：滚到对应区域。
  useEffect(() => {
    if (!focus) return
    const el = focus === 'decision' ? decisionRef.current : outputRef.current
    el?.scrollIntoView({ block: 'nearest' })
  }, [focus, slug, bp?.state])

  if (!slug || !card) return null

  const type = cardTypes.find((tp) => tp.id === card.typeId)
  const state = bp?.state
  const canRun = !card.activeRunId || state === 'done' || state === 'aborted'

  const run = async (): Promise<void> => {
    const res = await runCard(card.proposedName)
    // eslint-disable-next-line no-alert
    if (res.error) alert(`${t('board.cannotRun')}：${res.error}`)
  }
  const runId = card.activeRunId
  const pause = async (): Promise<void> => {
    if (runId) setRun(await window.klarit.pauseRun(runId))
  }
  const resume = async (): Promise<void> => {
    if (runId) setRun(await window.klarit.resumeRun(runId))
  }
  const decide = async (response: { optionId?: string; optionIds?: string[]; text?: string }): Promise<void> => {
    if (runId) setRun(await window.klarit.decideRun(runId, response))
  }
  const runAction = (index: number): void => {
    if (!runId || !bp?.currentNodeId) return
    // 动作 bgId 按按钮身份稳定(须与引擎 runGateAction 一致):复用同一格,先清掉上次(崩溃/中止)的旧输出。
    seedOutput(runId, `bg:bg-action-${bp.currentNodeId}-${index}`, '')
    void window.klarit.runGateAction(runId, index)
  }
  const stopBackground = (bgId: string): void => {
    if (runId) void window.klarit.stopBackground(runId, bgId)
  }
  // 派生:某动作(按其文案)当前是否有活后台进程 → 其 bgId(供决策按钮「启动↔中止」切换)。
  const runningActionBg = (label: string): string | null =>
    backgrounds.find((b) => b.label === label && b.status === 'running')?.bgId ?? null
  const advance = (mode: 'abort' | 'detach'): void => {
    if (runId) void window.klarit.advanceCommand(runId, mode)
  }

  // 命令节点执行中：需要手动推进控件（长驻命令如 npm start 不会自行退出，否则运行卡在此节点）。
  const currentNode = wf?.nodes.find((n) => n.id === bp?.currentNodeId)
  const commandRunning =
    state === 'running' && bp?.phase.kind === 'executing' && currentNode?.executor.kind === 'command'
  // 末节点：转后台无意义（完成即被收），只给「中止并完成流程」使运行走到 done。
  const isLastNode =
    !!wf && wf.nodes.length > 0 && wf.nodes[wf.nodes.length - 1].id === bp?.currentNodeId

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-full w-[34rem] max-w-full flex-col overflow-hidden rounded-card border border-stone-300 bg-paper">
        {/* 头部：标题 + 类型 + 关闭 */}
        <header className="flex items-start gap-2 border-b border-stone-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[14px] font-semibold text-ink">{card.title}</h2>
              {type && (
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cardBadgeClass(type.color)}`}>
                  {type.name}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">
              {t(`board.status.${(state && runStateToCardStatus(state)) || card.status}`)} · {card.proposedName}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('board.close')}
            onClick={close}
            className="shrink-0 rounded p-1 text-stone-600 hover:bg-stone-100 hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3 text-[12px]">
          {card.description && (
            <p className="whitespace-pre-wrap break-words text-ink">{card.description}</p>
          )}

          {/* 运行控制 */}
          <div className="flex flex-wrap gap-1.5">
            {canRun && (
              <button
                type="button"
                onClick={() => void run()}
                className="flex items-center gap-1 rounded bg-cobalt-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-cobalt-600"
              >
                <Play size={12} /> {t('board.run')}
              </button>
            )}
            {(state === 'running' || state === 'waiting-decision') && (
              <button
                type="button"
                onClick={() => void pause()}
                className="flex items-center gap-1 rounded border border-stone-300 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-stone-100"
              >
                <Pause size={12} /> {t('board.pause')}
              </button>
            )}
            {state === 'paused' && (
              <button
                type="button"
                onClick={() => void resume()}
                className="flex items-center gap-1 rounded border border-stone-300 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-stone-100"
              >
                <RotateCcw size={12} /> {t('board.resume')}
              </button>
            )}
          </div>

          {/* 命令节点执行中：手动推进控件（长驻命令不阻塞运行）。末节点只给「中止并完成流程」使运行走到已完成。 */}
          {commandRunning && (
            <div className="flex flex-wrap gap-1.5">
              {isLastNode ? (
                <button
                  type="button"
                  onClick={() => advance('abort')}
                  className="rounded border border-stone-300 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-stone-100"
                >
                  {t('board.abortFinish')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => advance('detach')}
                    className="rounded border border-stone-300 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-stone-100"
                  >
                    {t('board.advanceDetach')}
                  </button>
                  <button
                    type="button"
                    onClick={() => advance('abort')}
                    className="rounded border border-stone-300 px-2.5 py-1 text-[12px] font-medium text-stone-600 hover:bg-stone-100"
                  >
                    {t('board.advanceAbort')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* 单卡决策 */}
          {state === 'waiting-decision' && bp?.pendingDecision && (
            <div ref={decisionRef}>
              <div className="mb-1 text-[11px] font-medium text-stone-600">{t('board.decision')}</div>
              <RunDecisionPanel
                decision={bp.pendingDecision}
                onDecide={decide}
                onAction={runAction}
                onStopActionProc={stopBackground}
                runningActionBg={runningActionBg}
              />
            </div>
          )}

          {/* 前台输出分流：agent 节点显示「AI 活动」；命令节点按每条命令各一格（node:<id>:<i>）分流，绝不夹揉。 */}
          {runId && bp?.currentNodeId && currentNode?.executor.kind === 'agent' && (
            <div ref={outputRef}>
              <div className="mb-1 text-[11px] font-medium text-stone-600">{t('board.agentActivity')}</div>
              {bp.agentRuns?.[bp.currentNodeId]?.prompt && (
                <details className="mb-1 rounded border border-stone-300 bg-canvas">
                  <summary className="cursor-pointer px-1.5 py-1 text-[10px] font-medium text-stone-600">
                    {t('board.viewPrompt')}
                  </summary>
                  <div className="group relative">
                    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-all px-1.5 py-1 text-[11px] leading-snug text-ink">
                      {bp.agentRuns[bp.currentNodeId].prompt}
                    </pre>
                    <CopyButton
                      text={bp.agentRuns[bp.currentNodeId].prompt ?? ''}
                      className="absolute right-4 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </details>
              )}
              <CommandOutputView runId={runId} bucket={`node:${bp.currentNodeId}`} />
            </div>
          )}
          {runId && bp?.currentNodeId && currentNode?.executor.kind === 'command' && (
            <div ref={outputRef}>
              <div className="mb-1 text-[11px] font-medium text-stone-600">{t('board.currentCommand')}</div>
              <div className="space-y-2">
                {currentNode.executor.commands.map((c, i) => (
                  <div key={i}>
                    {currentNode.executor.kind === 'command' && currentNode.executor.commands.length > 1 && (
                      <div className="mb-0.5 truncate font-mono text-[10px] text-stone-600">{c.label ?? c.command}</div>
                    )}
                    <CommandOutputView runId={runId} bucket={`node:${bp.currentNodeId}:${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {runId && backgrounds.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-stone-600">{t('board.backgroundCommands')}</div>
              <div className="space-y-2">
                {backgrounds.map((b) => (
                  <div key={b.bgId} className="rounded border border-stone-300 p-1.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{b.label}</span>
                      {/* 运行中：可中止；已终止：显示终态 + 清除（保留到用户点清除才移除，避免「计时中止」直接消失像 bug）。 */}
                      {b.status === 'running' ? (
                        <button
                          type="button"
                          onClick={() => stopBackground(b.bgId)}
                          className="shrink-0 rounded border border-stone-300 px-1.5 py-0.5 text-[10px] text-stone-600 hover:bg-stone-100"
                        >
                          {t('board.stop')}
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              b.status === 'timeout'
                                ? 'bg-warning/15 text-warning'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            {t(`board.bg.${b.status}`)}
                          </span>
                          <button
                            type="button"
                            onClick={() => clearBackground(runId, b.bgId)}
                            className="rounded border border-stone-300 px-1.5 py-0.5 text-[10px] text-stone-600 hover:bg-stone-100"
                          >
                            {t('board.clear')}
                          </button>
                        </div>
                      )}
                    </div>
                    <CommandOutputView runId={runId} bucket={`bg:${b.bgId}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
