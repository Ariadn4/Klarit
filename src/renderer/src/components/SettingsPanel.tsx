import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { DetectedAgent, Project } from '@shared/types'
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@shared/language'
import { SUPPORTED_APPEARANCES, coerceAppearance, type Appearance } from '@shared/appearance'
import { coerceEffort, EFFORT_LEVELS, type AgentId, type EffortLevel } from '@shared/agents'
import { ModelCombobox } from './ui/ModelCombobox'
import { WorkflowLibrary } from './WorkflowLibrary'
import { WorkflowPicker } from './WorkflowPicker'
import { RuleLibrary } from './RuleLibrary'
import { CardTypeLibrary } from './CardTypeLibrary'
import { ConstitutionSettings } from './ConstitutionSettings'
import { DocumentRegistrySettings } from './DocumentRegistrySettings'
import { PatrolSettings } from './PatrolSettings'
import { Field } from './ui/Field'
import { inputClass } from './ui/styles'
import { SettingsHeaderSlotContext } from './ui/SettingsHeaderSlot'

interface SettingsPanelProps {
  language: SupportedLanguage
  onChangeLanguage: (language: SupportedLanguage) => void
  /** 当前外观偏好（dark/light/system）。 */
  appearance: Appearance
  /** 用户切换外观时回调（已是当前外观则不触发）。 */
  onChangeAppearance: (appearance: Appearance) => void
  /** 本机已检测到的 agent（默认 agent/模型下拉的可选项来源）。 */
  detectedAgents: DetectedAgent[]
  /** 当前默认 agent（未选择为 null）。 */
  defaultAgent: AgentId | null
  /** 当前默认模型（未选择为 null）。 */
  defaultModel: string | null
  /** 用户切换默认 agent 时回调。 */
  onChangeDefaultAgent: (agentId: AgentId) => void
  /** 用户切换默认模型时回调。 */
  onChangeDefaultModel: (modelId: string) => void
  /** 当前默认 effort（未设置为 null＝跟随各 agent 默认）。 */
  defaultEffort: EffortLevel | null
  /** 用户切换默认 effort 时回调（null＝清除，回到跟随 agent 默认）。 */
  onChangeDefaultEffort: (effort: EffortLevel | null) => void
  /** 用户在项目工作流选择器激活某工作流后回调（驱动主面板看板列重算）。 */
  onActiveWorkflowChange?: (workflowId: string) => void
  /** 当前窗口绑定的项目；null 时项目设置区显示空态。 */
  project: Project | null
  onClose: () => void
}

/** 设置项下拉的统一样式（复用共享输入类：canvas 底 + stone-300 边 + 聚焦 cobalt）。 */
const SELECT_CLS = `${inputClass} cursor-pointer`

type SectionId =
  | 'app-general'
  | 'app-workflow'
  | 'app-rules'
  | 'project-workflow'
  | 'project-card-types'
  | 'project-constitution'
  | 'project-documents'
  | 'project-patrol'

interface NavItem {
  id: SectionId
  labelKey: string
}
interface NavGroup {
  titleKey: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    titleKey: 'settingsPanel.groupAppTitle',
    items: [
      { id: 'app-general', labelKey: 'settingsPanel.navGeneral' },
      { id: 'app-workflow', labelKey: 'settingsPanel.navWorkflow' },
      { id: 'app-rules', labelKey: 'settingsPanel.navRules' }
    ]
  },
  {
    titleKey: 'settingsPanel.groupProjectTitle',
    items: [
      { id: 'project-workflow', labelKey: 'settingsPanel.navWorkflow' },
      { id: 'project-card-types', labelKey: 'settingsPanel.navCardTypes' },
      { id: 'project-constitution', labelKey: 'settingsPanel.navConstitution' },
      { id: 'project-documents', labelKey: 'settingsPanel.navDocuments' },
      { id: 'project-patrol', labelKey: 'settingsPanel.navPatrol' }
    ]
  }
]

/**
 * 设置面板（模态，左右结构）：左侧分组导航（应用设置 / 项目设置），右侧对应内容。
 * 经 portal 挂到 body 顶层、高 z-index，避免被应用内其它浮层（如文件预览底栏）穿透。
 * 注：窗口右上角的最小化/最大化/关闭为操作系统原生标题栏按钮，DOM 蒙层无法覆盖。
 */
export function SettingsPanel({
  language,
  onChangeLanguage,
  appearance,
  onChangeAppearance,
  detectedAgents,
  defaultAgent,
  defaultModel,
  onChangeDefaultAgent,
  onChangeDefaultModel,
  defaultEffort,
  onChangeDefaultEffort,
  onActiveWorkflowChange,
  project,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>('app-general')
  // 决策通知开关（默认开）：自读自写主进程设置，不经外层 props 层层穿。
  const [notifyOnDecision, setNotifyOnDecision] = useState(true)
  useEffect(() => {
    let alive = true
    void window.klarit.getNotifyOnDecision().then((on) => {
      if (alive) setNotifyOnDecision(on)
    })
    return () => {
      alive = false
    }
  }, [])
  // 顶栏插槽：内部视图（编辑器/详情页）把 返回/保存 传送到与 X 同行。
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)
  // 默认模型建议清单随当前默认 agent 联动；combobox 可输可选（自绘弹层，聚焦展示完整建议）。
  const selectedAgent = detectedAgents.find((a) => a.id === defaultAgent)
  const agentModels = selectedAgent?.models ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settingsPanel.dialogLabel')}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] max-h-[840px] w-[min(1040px,92vw)] overflow-hidden rounded-card border border-stone-100 bg-paper"
      >
        {/* 左侧分组导航 */}
        <nav aria-label={t('settingsPanel.navAriaLabel')} className="flex w-44 shrink-0 flex-col gap-3 border-r border-stone-100 bg-canvas p-3">
          {NAV.map((group) => (
            <div key={group.titleKey}>
              <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-stone-600">
                {t(group.titleKey)}
              </div>
              {/* 行间留 gap，避免相邻 hover/选中底色连成一片；行高压低 */}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={section === item.id}
                    onClick={() => setSection(item.id)}
                    className={`flex w-full items-center rounded px-2 py-1 text-left text-[13px] ${section === item.id ? 'bg-cobalt-50 font-medium text-cobalt-800' : 'text-ink hover:bg-stone-100'}`}
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-2">
            {/* 内部视图把 返回/保存 传送到这里，与 X 同行；三者等高（规范 icon-btn 26×26） */}
            <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center justify-between" />
            <button
              type="button"
              aria-label={t('settingsPanel.closeAriaLabel')}
              onClick={onClose}
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          <SettingsHeaderSlotContext.Provider value={headerSlot}>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {section === 'app-general' && (
              <section aria-label={t('settingsPanel.navGeneral')} className="max-w-xs">
                <Field label={t('settingsPanel.appearanceLabel')} htmlFor="settings-appearance">
                  <select
                    id="settings-appearance"
                    aria-label={t('settingsPanel.appearanceLabel')}
                    className={SELECT_CLS}
                    value={appearance}
                    onChange={(e) => {
                      const next = coerceAppearance(e.target.value)
                      if (next !== appearance) onChangeAppearance(next)
                    }}
                  >
                    {SUPPORTED_APPEARANCES.map((a) => (
                      <option key={a} value={a}>
                        {t(`settingsPanel.appearanceOption.${a}`)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t('settingsPanel.languageLabel')} htmlFor="settings-language">
                  <select
                    id="settings-language"
                    aria-label={t('settingsPanel.languageLabel')}
                    className={SELECT_CLS}
                    value={language}
                    onChange={(e) => {
                      const next = e.target.value as SupportedLanguage
                      if (next !== language) onChangeLanguage(next)
                    }}
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {LANGUAGE_LABELS[lang]}
                      </option>
                    ))}
                  </select>
                </Field>

                {detectedAgents.length === 0 ? (
                  <Field
                    label={t('settingsPanel.defaultAgentLabel')}
                    description={t('settingsPanel.noAgentsDetected')}
                  />
                ) : (
                  <>
                    <Field label={t('settingsPanel.defaultAgentLabel')} htmlFor="settings-default-agent">
                      <select
                        id="settings-default-agent"
                        aria-label={t('settingsPanel.defaultAgentLabel')}
                        className={SELECT_CLS}
                        value={defaultAgent ?? ''}
                        onChange={(e) => {
                          const next = e.target.value as AgentId
                          if (next !== defaultAgent) onChangeDefaultAgent(next)
                        }}
                      >
                        {defaultAgent === null && (
                          <option value="" disabled>
                            {t('settingsPanel.selectAgentPlaceholder')}
                          </option>
                        )}
                        {detectedAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      label={t('settingsPanel.defaultModelLabel')}
                      htmlFor="settings-default-model"
                      description={t('settingsPanel.modelComboboxHint')}
                    >
                      <ModelCombobox
                        id="settings-default-model"
                        ariaLabel={t('settingsPanel.defaultModelLabel')}
                        value={defaultModel ?? ''}
                        suggestions={agentModels}
                        disabled={!selectedAgent}
                        placeholder={
                          selectedAgent
                            ? t('settingsPanel.selectModelPlaceholder')
                            : t('settingsPanel.selectAgentFirst')
                        }
                        onCommit={onChangeDefaultModel}
                      />
                    </Field>

                    <Field
                      label={t('settingsPanel.defaultEffortLabel')}
                      htmlFor="settings-default-effort"
                      description={t('settingsPanel.effortHint')}
                    >
                      <select
                        id="settings-default-effort"
                        aria-label={t('settingsPanel.defaultEffortLabel')}
                        className={SELECT_CLS}
                        value={defaultEffort ?? ''}
                        onChange={(e) => {
                          const next = coerceEffort(e.target.value) ?? null
                          if (next !== defaultEffort) onChangeDefaultEffort(next)
                        }}
                      >
                        <option value="">{t('settingsPanel.effortFollowDefault')}</option>
                        {EFFORT_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {lv}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}

                {/* 决策通知：有新待决策且应用不在前台时弹桌面通知（见 decision-inbox）。 */}
                <Field
                  label={t('decisionInbox.notifyLabel')}
                  htmlFor="settings-notify-decision"
                  description={t('decisionInbox.notifyHint')}
                >
                  <input
                    id="settings-notify-decision"
                    type="checkbox"
                    checked={notifyOnDecision}
                    onChange={(e) => {
                      const next = e.target.checked
                      setNotifyOnDecision(next)
                      void window.klarit.setNotifyOnDecision(next)
                    }}
                    className="h-4 w-4 accent-cobalt-500"
                  />
                </Field>
              </section>
            )}

            {section === 'app-workflow' && (
              <section aria-label={t('settingsPanel.sectionWorkflowLibrary')}>
                <WorkflowLibrary detectedAgents={detectedAgents} />
              </section>
            )}

            {section === 'app-rules' && (
              <section aria-label={t('settingsPanel.sectionRuleLibrary')}>
                <RuleLibrary />
              </section>
            )}

            {section === 'project-workflow' && (
              <section aria-label={t('settingsPanel.sectionProjectWorkflow')}>
                {project ? (
                  <WorkflowPicker onActiveChange={onActiveWorkflowChange} />
                ) : (
                  <p className="text-[13px] text-stone-600">
                    {t('settingsPanel.noProjectWorkflow')}
                  </p>
                )}
              </section>
            )}

            {section === 'project-card-types' && (
              <section aria-label={t('settingsPanel.sectionCardTypes')}>
                {project ? (
                  <CardTypeLibrary />
                ) : (
                  <p className="text-[13px] text-stone-600">{t('settingsPanel.noProjectCardTypes')}</p>
                )}
              </section>
            )}

            {section === 'project-documents' && (
              <section aria-label={t('settingsPanel.sectionProjectDocuments')}>
                {project ? (
                  <DocumentRegistrySettings project={project} />
                ) : (
                  <p className="text-[13px] text-stone-600">
                    {t('settingsPanel.noProjectDocuments')}
                  </p>
                )}
              </section>
            )}

            {section === 'project-patrol' && (
              <section aria-label={t('settingsPanel.sectionProjectPatrol')}>
                {project ? (
                  <PatrolSettings />
                ) : (
                  <p className="text-[13px] text-stone-600">{t('settingsPanel.noProjectPatrol')}</p>
                )}
              </section>
            )}

            {section === 'project-constitution' && (
              <section aria-label={t('settingsPanel.sectionProjectConstitution')}>
                {project ? (
                  <ConstitutionSettings />
                ) : (
                  <p className="text-[13px] text-stone-600">
                    {t('settingsPanel.noProjectConstitution')}
                  </p>
                )}
              </section>
            )}
          </div>
          </SettingsHeaderSlotContext.Provider>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
