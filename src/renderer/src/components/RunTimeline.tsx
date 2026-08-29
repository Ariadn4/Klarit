/**
 * 运行时间线（run-timeline「时间线展开复用既有输出回看」）：把一个运行的运行日志渲染成按节点分组的段序列——
 * 每段一个节点、含耗时、终局、门重试与后台任务；点开一段用**既有** `CommandOutputView` 看该节点的输出桶。
 *
 * 数据 = 主进程 journal 的一次读取 + 之后引擎进度事件的实时追加（运行中不需要用户手动刷新）。
 * 分段不在这里做，走 `shared/run-timeline` 的纯函数，视图只负责翻译与呈现。
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { RunJournalEntry, WorkflowNode } from '@shared/types'
import { buildRunTimeline, type TimelineSegment } from '@shared/run-timeline'
import { chunkBucket } from '@shared/output-bucket'
import { resolveLocalized } from '@shared/localized'
import { CommandOutputView } from './CommandOutputView'

export function RunTimeline({ runId, nodes }: { runId: string; nodes?: WorkflowNode[] }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  /** null＝还没读回来（不闪空态）。 */
  const [entries, setEntries] = useState<RunJournalEntry[] | null>(null)
  /** 该运行真实存在的输出桶（多命令节点的 `node:<id>:<i>` 只有它知道）。 */
  const [buckets, setBuckets] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setEntries(null)
    setExpanded(null)
    void window.klarit.readRunJournal(runId).then((list) => {
      if (alive) setEntries(list)
    })
    void window.klarit.listRunOutputBuckets(runId).then((list) => {
      if (alive) setBuckets(list)
    })
    return () => {
      alive = false
    }
  }, [runId])

  // 运行中实时追加：结构性事件直接进时间线；op-chunk 只用来发现新桶（字节由输出组件自己流）。
  useEffect(() => {
    return window.klarit.onEngineProgress((evt) => {
      if (evt.runId !== runId) return
      if (evt.kind === 'op-chunk') {
        const bucket = chunkBucket(evt.nodeId, { bgId: evt.bgId, cmdIndex: evt.cmdIndex })
        setBuckets((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
        return
      }
      setEntries((prev) => [...(prev ?? []), { ...evt, at: Date.now() }])
    })
  }, [runId])

  const segments = useMemo(() => buildRunTimeline(entries ?? []), [entries])

  if (entries === null) return null
  if (segments.length === 0) {
    return <div className="rounded border border-stone-300 bg-canvas p-3 text-[12px] text-stone-600">{t('board.timeline.empty')}</div>
  }

  const nodeName = (nodeId: string): string => {
    const node = nodes?.find((n) => n.id === nodeId)
    return node ? resolveLocalized(node.name, i18n.language) : nodeId
  }
  const duration = (ms: number): string => {
    if (ms < 1000) return t('board.timeline.durationBelowSecond')
    const sec = Math.round(ms / 1000)
    return sec < 60
      ? t('board.timeline.durationSec', { sec })
      : t('board.timeline.durationMin', { min: Math.floor(sec / 60), sec: sec % 60 })
  }
  /** 展开时给哪些桶：该节点实际存在的前台桶（含各命令桶）+ 本段的后台任务桶。 */
  const bucketsOf = (seg: TimelineSegment): string[] => {
    const fg = buckets.filter((b) => b === `node:${seg.nodeId}` || b.startsWith(`node:${seg.nodeId}:`))
    return [...(fg.length ? fg : [`node:${seg.nodeId}`]), ...seg.backgrounds.map((b) => `bg:${b.bgId}`)]
  }

  const badge = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium'

  return (
    <ol className="space-y-1.5">
      {segments.map((seg) => {
        const key = `${seg.nodeId}#${seg.entry}`
        const open = expanded === key
        const name = nodeName(seg.nodeId)
        return (
          <li key={key} className="rounded border border-stone-300 bg-canvas">
            <button
              type="button"
              aria-expanded={open}
              aria-label={t(open ? 'board.timeline.collapse' : 'board.timeline.expand', { node: name })}
              onClick={() => setExpanded(open ? null : key)}
              className="flex w-full items-center gap-1.5 px-1.5 py-1.5 text-left hover:bg-stone-100"
            >
              {open ? (
                <ChevronDown size={12} className="shrink-0 text-stone-600" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-stone-600" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{name}</span>
              {seg.entry > 1 && (
                <span className={`${badge} bg-cobalt-50 text-cobalt-800`}>{t('board.timeline.nthEntry', { n: seg.entry })}</span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-stone-600">{duration(seg.durationMs)}</span>
              {seg.outcome.kind === 'completed' && <span className={`${badge} bg-stone-100 text-stone-600`}>{t('board.timeline.completed')}</span>}
              {seg.outcome.kind === 'skipped' && <span className={`${badge} bg-stone-100 text-stone-600`}>{t('board.timeline.skipped')}</span>}
              {seg.outcome.kind === 'decision' && <span className={`${badge} bg-tag-red/10 text-tag-red`}>{t('board.timeline.stoppedAtDecision')}</span>}
              {/* 未结束：停在决策上 / 进程被中断。段仍在，只是没有退出事件。 */}
              {!seg.finished && <span className={`${badge} bg-warning/15 text-warning`}>{t('board.timeline.unfinished')}</span>}
            </button>

            <div className="space-y-1 px-1.5 pb-1.5 text-[11px] text-stone-600 empty:hidden">
              {seg.outcome.kind === 'skipped' && <div className="break-words">{seg.outcome.reason}</div>}
              {seg.gateRetries.length > 0 && (
                <div>
                  {t('board.timeline.gateRetries', {
                    times: seg.gateRetries.length,
                    detail: seg.gateRetries
                      .map((a) => `${t(`board.timeline.cause.${a.cause}`)}·${t(`board.timeline.rerun.${a.rerun}`)}`)
                      .join('，')
                  })}
                </div>
              )}
              {seg.backgrounds.length > 0 && (
                <ul className="space-y-0.5">
                  {seg.backgrounds.map((b) => (
                    <li key={b.bgId} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span
                        className={`${badge} ${b.status === 'timeout' ? 'bg-warning/15 text-warning' : 'bg-stone-100 text-stone-600'}`}
                      >
                        {b.status === 'started' ? t('board.timeline.bgRunning') : t(`board.bg.${b.status}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 展开：复用既有输出分桶回看组件（前台节点/各命令桶 + 各后台任务桶），不另写输出渲染。 */}
            {open && (
              <div className="space-y-1.5 border-t border-stone-100 px-1.5 py-1.5">
                {bucketsOf(seg).map((bucket) => (
                  <div key={bucket}>
                    <div className="mb-0.5 truncate font-mono text-[10px] text-stone-600">{bucket}</div>
                    <CommandOutputView runId={runId} bucket={bucket} />
                  </div>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
