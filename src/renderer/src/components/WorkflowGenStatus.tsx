import { useTranslation } from 'react-i18next'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useWorkflowGenStore } from '../stores/workflowGen'

/**
 * 底栏工作流生成状态：导入后自动派工作流命中支时，后台 author 生成期间挂一行「转圈 + 生成中」。
 * 比照 `DocumentScanStatus`——**只告知、不可交互**（提案就绪后的弹出由 modalQueue 协调器负责，
 * 不在此放任何按钮/入口）；`done` 立即消失、不占位。
 *
 * 生成失败/空产出时不一闪即无——亮一条自动消失的 warning 轻提示「已用默认工作流」，让用户知情
 * 且不打断（`failedNotice` 由 store 计时清掉）。
 */
export function WorkflowGenStatus(): React.JSX.Element | null {
  const { t } = useTranslation()
  const generating = useWorkflowGenStore((s) => s.generating)
  const failedNotice = useWorkflowGenStore((s) => s.failedNotice)

  if (generating) {
    return (
      <div
        role="status"
        className="pointer-events-none inline-flex items-center gap-1.5 text-[12px] text-stone-600"
      >
        <Loader2 size={13} className="animate-spin text-cobalt-500" />
        {t('globalChat.workflowGenStatus')}
      </div>
    )
  }

  if (failedNotice) {
    return (
      <div
        role="status"
        className="pointer-events-none inline-flex items-center gap-1.5 text-[12px] text-warning"
      >
        <AlertTriangle size={13} className="text-warning" />
        {t('globalChat.workflowGenFailed')}
      </div>
    )
  }

  return null
}
