import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import type { AgentId } from '@shared/agents'
import type { DetectedAgent } from '@shared/types'

interface AgentOnboardingDialogProps {
  /** 本机已检测到的 agent（空则不渲染——由调用方保证非空才挂载，这里再兜一层）。 */
  agents: DetectedAgent[]
  /** 用户确认所选默认 agent 与模型（无可选模型时 modelId 为 null）。 */
  onConfirm: (agentId: AgentId, modelId: string | null) => void
  /** 用户跳过：不写入任何偏好。 */
  onSkip: () => void
}

/** 与设置面板下拉一致的统一样式（对齐品牌令牌，不另起配色/投影）。 */
const SELECT_CLS =
  'w-full rounded border border-stone-100 bg-canvas px-2 py-1.5 text-[13px] text-ink'

/**
 * 首次启动 agent 引导弹窗（模态，portal 挂 body 顶层）：仅让用户选默认 agent 与其模型，可跳过。
 * 仅当扫描到至少一个 agent 时由 App 挂载；扫不到不出现。样式遵循品牌令牌、深浅两套由 data-theme 驱动。
 */
export function AgentOnboardingDialog({
  agents,
  onConfirm,
  onSkip
}: AgentOnboardingDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [agentId, setAgentId] = useState<AgentId>(agents[0]?.id)
  const selected = agents.find((a) => a.id === agentId) ?? agents[0]
  const [modelId, setModelId] = useState<string | null>(selected?.models[0]?.id ?? null)

  if (agents.length === 0) return null

  const onAgentChange = (nextId: AgentId): void => {
    setAgentId(nextId)
    // 切换 agent 后模型联动为新 agent 的首个模型（无模型则置空）。
    const next = agents.find((a) => a.id === nextId)
    setModelId(next?.models[0]?.id ?? null)
  }

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('agentOnboarding.title')}
        className="flex w-[420px] flex-col gap-4 rounded-card border border-stone-100 bg-paper p-5"
      >
        <div>
          <h2 className="text-[15px] font-medium text-ink">{t('agentOnboarding.title')}</h2>
          <p className="mt-1 text-[13px] text-stone-600">{t('agentOnboarding.description')}</p>
        </div>

        <div>
          <label htmlFor="onboarding-agent" className="mb-1.5 block text-[13px] font-medium text-ink">
            {t('agentOnboarding.defaultAgent')}
          </label>
          <select
            id="onboarding-agent"
            aria-label={t('agentOnboarding.defaultAgent')}
            className={SELECT_CLS}
            value={agentId}
            onChange={(e) => onAgentChange(e.target.value as AgentId)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="onboarding-model" className="mb-1.5 block text-[13px] font-medium text-ink">
            {t('agentOnboarding.defaultModel')}
          </label>
          <select
            id="onboarding-model"
            aria-label={t('agentOnboarding.defaultModel')}
            className={SELECT_CLS}
            value={modelId ?? ''}
            disabled={!selected || selected.models.length === 0}
            onChange={(e) => setModelId(e.target.value)}
          >
            {selected && selected.models.length > 0 ? (
              selected.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            ) : (
              <option value="">{t('agentOnboarding.noModels')}</option>
            )}
          </select>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded px-3 py-1.5 text-[13px] text-stone-600 hover:bg-stone-100"
          >
            {t('agentOnboarding.skip')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(agentId, modelId)}
            className="rounded bg-cobalt-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600"
          >
            {t('agentOnboarding.confirm')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
