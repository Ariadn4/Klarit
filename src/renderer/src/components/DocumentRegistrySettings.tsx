import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ScanSearch, Save } from 'lucide-react'
import type { Project } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { DocumentRegistryEditor, DocumentRegistryPurpose } from './DocumentRegistryEditor'
import { AnalyzeStatusBanner } from './DocumentOnboardingDialog'
import { HeaderActions } from './ui/SettingsHeaderSlot'
import { IconButton } from './ui/controls'
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
      {/* 动作走设置面板顶栏插槽（与关闭 X 同行、图标按钮），内容区只留登记表本身。 */}
      <HeaderActions>
        <span />
        <div className="flex items-center gap-1">
          <IconButton
            label={t('documentRegistry.rescan')}
            tooltip={t('documentRegistry.rescan')}
            disabled={analyzing}
            onClick={() => void analyze(memberId)}
          >
            <ScanSearch size={16} />
          </IconButton>
          <IconButton
            label={t('common.save')}
            tooltip={t('common.save')}
            onClick={() => {
              // 保存即整表审批（与 onboarding「确认并保存」同语义）。
              approveAll()
              void save()
            }}
          >
            <Save size={16} />
          </IconButton>
        </div>
      </HeaderActions>

      {/* 成员切换只在多仓项目出现（单仓时不留空行）。 */}
      {project.members.length > 1 && (
        <select
          aria-label={t('documentRegistry.memberSelectAria')}
          className={`${inputClass} w-44 cursor-pointer self-start`}
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

      <DocumentRegistryPurpose />

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
