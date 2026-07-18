/**
 * 运行进度行：运行圆点 + 当前节点文案 + 括号内细状态（工作中/检查中/等待决策）+ 暂停图标。
 * 卡面与详情抽屉共用同一份，保证两处视觉与语义完全一致（勿在别处复制这套派生/渲染）。
 * 无运行断点（未运行 / done / aborted）时回落展示 `fallbackStatus` 生命周期状态文案。
 */

import { useTranslation } from 'react-i18next'
import { Pause } from 'lucide-react'
import type { RunBreakpoint, WorkflowDefinition } from '@shared/types'
import { runDot } from '../lib/board'
import { RunDot } from './RunDot'

export function RunStatusLine({
  breakpoint,
  workflow,
  fallbackStatus,
  className
}: {
  breakpoint: RunBreakpoint | null
  workflow: WorkflowDefinition | null
  /** 无运行圆点时回落的生命周期状态（CardStatus 文案键，如 `进行中`/`已完成`）。 */
  fallbackStatus: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const dot = runDot(breakpoint, workflow)

  // 无圆点（未运行 / 已完成 / 已中止）：回落生命周期状态文案。
  if (!dot) {
    return <span className={className}>{t(`board.status.${fallbackStatus}`)}</span>
  }

  // 圆点后方括号细状态：工作中/检查中，或等待决策时取决策背景文案。
  const subLabel =
    dot.state === 'waiting-decision'
      ? breakpoint?.pendingDecision
        ? t(breakpoint.pendingDecision.titleKey, breakpoint.pendingDecision.titleParams)
        : t('board.decisionWaiting')
      : dot.state === 'checking'
        ? t('board.checking')
        : dot.state === 'working'
          ? t('board.working')
          : ''

  return (
    <span className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <RunDot dot={dot} />
      {/* 暂停：单独一个暂停图标表示，不改圆点颜色/括号文案。 */}
      {dot.paused && (
        <Pause size={11} className="shrink-0 fill-stone-600 text-stone-600" aria-label={t('board.status.已暂停')} />
      )}
      <span className="truncate text-[11px] text-stone-600">
        {dot.nodeLabel}
        {subLabel ? `（${subLabel}）` : ''}
      </span>
    </span>
  )
}
