import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useDocumentsStore } from '../stores/documents'

/**
 * 底栏文档扫描状态：分析（onboarding 首扫 / 设置里重扫）期间在应用底栏挂一行「转圈 + 扫描中」。
 * **只告知、不可交互**——扫描是后台活，不该用模态把用户堵在纯等待的空壳里，所以这里不放任何
 * 按钮/链接/跳过入口；扫描完成后确认步弹窗才推出，本状态随之消失（不在扫描时不渲染、不占位）。
 */
export function DocumentScanStatus(): React.JSX.Element | null {
  const { t } = useTranslation()
  const analyzing = useDocumentsStore((s) => s.analyzing)
  if (!analyzing) return null
  return (
    <div
      role="status"
      className="pointer-events-none inline-flex items-center gap-1.5 text-[12px] text-stone-600"
    >
      <Loader2 size={13} className="animate-spin text-cobalt-500" />
      {t('documentRegistry.scanStatus')}
    </div>
  )
}
