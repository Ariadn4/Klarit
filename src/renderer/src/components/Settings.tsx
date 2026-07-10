import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon } from 'lucide-react'
import type { DetectedAgent, Project } from '@shared/types'
import type { SupportedLanguage } from '@shared/language'
import type { Appearance } from '@shared/appearance'
import type { AgentId } from '@shared/agents'
import { SettingsPanel } from './SettingsPanel'

interface SettingsProps {
  /** 当前生效的语言。 */
  language: SupportedLanguage
  /** 用户切换语言时回调（已是当前语言则不触发）。 */
  onChangeLanguage: (language: SupportedLanguage) => void
  /** 当前外观偏好。 */
  appearance: Appearance
  /** 用户切换外观时回调（已是当前外观则不触发）。 */
  onChangeAppearance: (appearance: Appearance) => void
  /** 本机已检测到的 agent。 */
  detectedAgents: DetectedAgent[]
  /** 当前默认 agent（未选择为 null）。 */
  defaultAgent: AgentId | null
  /** 当前默认模型（未选择为 null）。 */
  defaultModel: string | null
  /** 用户切换默认 agent 时回调。 */
  onChangeDefaultAgent: (agentId: AgentId) => void
  /** 用户切换默认模型时回调。 */
  onChangeDefaultModel: (modelId: string) => void
  /** 用户在项目工作流选择器激活某工作流后回调（驱动主面板看板列重算）。 */
  onActiveWorkflowChange?: (workflowId: string) => void
  /** 当前窗口绑定的项目（决定项目设置区是否可用）。 */
  project: Project | null
}

export function Settings({
  language,
  onChangeLanguage,
  appearance,
  onChangeAppearance,
  detectedAgents,
  defaultAgent,
  defaultModel,
  onChangeDefaultAgent,
  onChangeDefaultModel,
  onActiveWorkflowChange,
  project
}: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t('settings.openLabel')}
        title={t('settings.openLabel')}
        className="flex items-center justify-center rounded p-2 text-stone-600 hover:bg-stone-100"
      >
        <SettingsIcon size={16} />
      </button>

      {open && (
        <SettingsPanel
          language={language}
          onChangeLanguage={onChangeLanguage}
          appearance={appearance}
          onChangeAppearance={onChangeAppearance}
          detectedAgents={detectedAgents}
          defaultAgent={defaultAgent}
          defaultModel={defaultModel}
          onChangeDefaultAgent={onChangeDefaultAgent}
          onChangeDefaultModel={onChangeDefaultModel}
          onActiveWorkflowChange={onActiveWorkflowChange}
          project={project}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
