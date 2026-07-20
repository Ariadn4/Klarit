import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { DocumentRegistryEditor } from './DocumentRegistryEditor'
import { AnalyzeStatusBanner } from './DocumentOnboardingDialog'
import { inputClass } from './ui/styles'

/**
 * 设置常驻文档登记表面板（project-documents section）：复用两栏改判编辑器，
 * 多成员仓项目可切成员；「重新扫描」触发 agent 语义分析（分析中只给加载指示、完成统一呈现；
 * 主进程合并既有表，不覆盖已审批条）、「保存」整表落盘。
 */
export function DocumentRegistrySettings({ project }: { project: Project }): React.JSX.Element {
  const { t } = useTranslation()
  const { registry, analyzing, analyzeError, load, analyze, approveAll, save } = useDocumentsStore()
  const [memberId, setMemberId] = useState(project.members[0]?.id ?? '')

  useEffect(() => {
    if (memberId) void load(memberId)
  }, [memberId, load])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {project.members.length > 1 && (
          <select
            aria-label={t('documentRegistry.memberSelectAria')}
            className={`${inputClass} w-44 cursor-pointer`}
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.derivedName}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={analyzing}
          onClick={() => void analyze(memberId)}
          className="rounded border border-stone-300 px-2.5 py-1 text-[13px] text-ink hover:border-cobalt-500 hover:text-cobalt-500 disabled:opacity-50"
        >
          {t('documentRegistry.rescan')}
        </button>
        <button
          type="button"
          onClick={() => {
            // 保存即整表审批（与 onboarding「确认并保存」同语义）。
            approveAll()
            void save()
          }}
          className="rounded bg-cobalt-500 px-2.5 py-1 text-[13px] font-medium text-paper hover:bg-cobalt-800"
        >
          {t('common.save')}
        </button>
      </div>

      {analyzing ? (
        <p className="flex items-center gap-2 text-[13px] text-stone-600">
          <Loader2 size={14} className="animate-spin text-cobalt-500" />
          {t('documentRegistry.analyzing')}
        </p>
      ) : registry ? (
        <div>
          <AnalyzeStatusBanner analyzeError={analyzeError} />
          <DocumentRegistryEditor />
        </div>
      ) : (
        <p className="text-[13px] text-stone-600">{t('documentRegistry.settingsEmpty')}</p>
      )}
    </div>
  )
}
