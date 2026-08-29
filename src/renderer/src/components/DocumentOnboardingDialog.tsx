import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentsStore } from '../stores/documents'
import { useModalQueue } from '../stores/modalQueue'
import { DocumentRegistryEditor, DocumentRegistryPurpose } from './DocumentRegistryEditor'

/**
 * 分析状态横幅（dialog 与设置面板共用）：确无 agent（no-agent，启发式兜底结果）/
 * 分析失败（如实带原因，同样呈现启发式兜底；绝不把失败误报成「未配置 agent」）。无状态时不渲染。
 */
export function AnalyzeStatusBanner({ analyzeError }: { analyzeError: string | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  const cls =
    'mb-3 rounded border border-stone-100 bg-canvas px-2.5 py-1.5 text-[12px] text-stone-600'
  if (analyzeError === 'no-agent') return <p className={cls}>{t('documentRegistry.noAgentHint')}</p>
  if (analyzeError) {
    return (
      <p role="alert" className={`${cls} text-danger`}>
        {t('documentRegistry.analyzeFailed', { message: analyzeError })}
      </p>
    )
  }
  return null
}

/**
 * 导入项目后的文档确认步（onboarding）：挂载即触发 agent 语义分析（分组+分类+起草一体）。
 * **扫描期间不弹窗**——模态不该把用户堵在纯等待的空壳里，进度交给底栏 `DocumentScanStatus`；
 * 分析完成才推出，一出来就是完整两栏编辑器（改判/移出/添加/编辑/审批），不展示会被推翻的中间态。
 * 「确认并保存」与「跳过」都按当前状态落盘（跳过=留待设置里继续）。模态遮罩用规范唯一例外 bg-black/50。
 */
export function DocumentOnboardingDialog({
  memberId,
  onClose
}: {
  memberId: string
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { analyzing, analyzeError, analyze, approveAll, save } = useDocumentsStore()
  const registerModalOpen = useModalQueue((s) => s.registerModalOpen)
  const registerModalClose = useModalQueue((s) => s.registerModalClose)

  useEffect(() => {
    void analyze(memberId)
  }, [memberId, analyze])

  // 登记进全局模态协调器：本确认步在开（含扫描期的底栏态）期间，主动弹出（如工作流提案）排队等待、
  // 绝不叠加；卸载即撤销登记，触发协调器出队顺次弹。
  useEffect(() => {
    registerModalOpen('document-onboarding')
    return () => registerModalClose('document-onboarding')
  }, [registerModalOpen, registerModalClose])

  /** 「确认并保存」= 整表审批 + 落盘；「跳过」= 按当前未审批状态落盘（留待设置里继续）。 */
  const finish = async (approve: boolean): Promise<void> => {
    if (approve) approveAll()
    await save()
    onClose()
  }

  // 扫描期间整个不渲染：底栏状态条负责告知进度，用户该干嘛干嘛。
  if (analyzing) return null

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('documentRegistry.onboardingTitle')}
        className="flex max-h-[82vh] w-[760px] flex-col overflow-hidden rounded-card border border-stone-100 bg-paper"
      >
        {/* 标题区：标题 + 用途说明同在分割线之上——说明是对整张表的交代，跟着条目区滚走就读不到了。 */}
        <div className="flex flex-col gap-1.5 border-b border-stone-100 px-4 py-3">
          <h2 className="text-[15px] font-semibold text-ink">
            {t('documentRegistry.onboardingTitle')}
          </h2>
          <DocumentRegistryPurpose />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <AnalyzeStatusBanner analyzeError={analyzeError} />
          <DocumentRegistryEditor />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3">
          <button
            type="button"
            onClick={() => void finish(false)}
            className="rounded px-3 py-1.5 text-[13px] text-stone-600 hover:bg-stone-100 hover:text-ink"
          >
            {t('documentRegistry.skip')}
          </button>
          <button
            type="button"
            onClick={() => void finish(true)}
            className="rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-paper hover:bg-cobalt-800"
          >
            {t('documentRegistry.confirmSave')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
