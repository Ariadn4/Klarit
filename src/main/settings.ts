import type { AppSettings } from '../shared/types'
import { coerceLanguage, normalizeLocale } from '../shared/language'
import { coerceAppearance } from '../shared/appearance'
import { coerceDefaultAgentId, coerceDefaultModel, coerceEffort, type AgentId } from '../shared/agents'

/** initSettings 的注入依赖——便于不依赖 electron 单测。 */
export interface SettingsDeps {
  /** 读取已持久化的设置；文件缺失或损坏时返回 null。 */
  read: () => AppSettings | null
  /** 持久化设置。 */
  write: (settings: AppSettings) => void
  /** 操作系统语言（如 app.getLocale() 的返回）。 */
  systemLocale: () => string
}

/**
 * 加载应用设置。首次启动（无 language）时按系统语言初始化并持久化；
 * 已有语言则沿用（收敛兜底，不覆盖、不写回）。文件损坏视为首启安全恢复。
 */
export function initSettings(deps: SettingsDeps): AppSettings {
  const stored = deps.read()
  if (stored && stored.language !== undefined) {
    const defaultAgent = coerceDefaultAgentId(stored.defaultAgent)
    return {
      language: coerceLanguage(stored.language),
      appearance: coerceAppearance(stored.appearance),
      defaultAgent,
      defaultModel: coerceDefaultModel(defaultAgent, stored.defaultModel),
      defaultEffort: coerceEffort(stored.defaultEffort)
    }
  }
  const language = normalizeLocale(deps.systemLocale())
  const settings: AppSettings = { language }
  deps.write(settings)
  return { ...settings, appearance: coerceAppearance(stored?.appearance) }
}

/** 更新外观：收敛为受支持值后持久化，返回新设置。 */
export function setAppearance(
  current: AppSettings,
  value: unknown,
  deps: Pick<SettingsDeps, 'write'>
): AppSettings {
  const next: AppSettings = { ...current, appearance: coerceAppearance(value) }
  deps.write(next)
  return next
}

/** 更新语言：收敛为受支持值后持久化，返回新设置。 */
export function setLanguage(
  current: AppSettings,
  value: unknown,
  deps: Pick<SettingsDeps, 'write'>
): AppSettings {
  const next: AppSettings = { ...current, language: coerceLanguage(value) }
  deps.write(next)
  return next
}

/**
 * 更新默认 agent：须为受支持且「已检测到」（在 allowedAgentIds 内）的 agent，否则无副作用
 * （不写非法/不可用值）。agent 变更时清空旧默认模型（模型标识家际不通用）；effort 不清
 * （枚举语义家际可移植，由 adapter 各自翻译）。
 */
export function setDefaultAgent(
  current: AppSettings,
  value: unknown,
  allowedAgentIds: AgentId[],
  deps: Pick<SettingsDeps, 'write'>
): AppSettings {
  const agent = coerceDefaultAgentId(value)
  if (!agent || !allowedAgentIds.includes(agent)) return current
  const next: AppSettings = {
    ...current,
    defaultAgent: agent,
    defaultModel: agent === current.defaultAgent ? current.defaultModel : undefined
  }
  deps.write(next)
  return next
}

/** 更新默认模型：agent 已选 + 任意非空字符串即放行（清单仅供 UI 建议），否则收敛为未选择。 */
export function setDefaultModel(
  current: AppSettings,
  value: unknown,
  deps: Pick<SettingsDeps, 'write'>
): AppSettings {
  const next: AppSettings = {
    ...current,
    defaultModel: coerceDefaultModel(current.defaultAgent, value)
  }
  deps.write(next)
  return next
}

/** 更新默认 effort：收敛为合法档位（枚举外＝未设置，跟随各 agent 默认）后持久化。 */
export function setDefaultEffort(
  current: AppSettings,
  value: unknown,
  deps: Pick<SettingsDeps, 'write'>
): AppSettings {
  const next: AppSettings = { ...current, defaultEffort: coerceEffort(value) }
  deps.write(next)
  return next
}
