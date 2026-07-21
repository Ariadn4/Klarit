/**
 * 受支持的本地编程 agent 及其可选模型（main 与 renderer 共用，单一来源）。
 * 新增 agent / 调整模型清单只改这一处；后续可换成动态获取，调用方接口不变。
 */

/** 受支持 agent 标识（稳定值，会被持久化进 settings，勿随意改名）。 */
export type AgentId = 'claude-code' | 'codex' | 'cursor'

/** 一个可选模型：稳定 id + 展示名。 */
export interface AgentModel {
  id: string
  name: string
}

/** 一个受支持 agent 的静态定义。 */
export interface SupportedAgent {
  id: AgentId
  /** 展示名（弹窗与设置下拉用）。 */
  name: string
  /** 探测用的 CLI 可执行名（跨平台用 where/which 查找其是否在 PATH）。 */
  command: string
  /** 该 agent 的可选模型清单（可为空，表示无可选模型）。 */
  models: AgentModel[]
  /**
   * 该运行时是否**确证支持子 agent**（如 Claude Code 的 Task/子 agent 能力）——供 `archive-docs` 等节点
   * 决定「派多个子 agent 并行」还是「单 agent 串行退化」。**缺省视为不支持**（保守：探测不准即走串行，
   * 不因误判并行而失败）。
   */
  supportsSubagents?: boolean
}

/**
 * 内置受支持 agent 表。模型清单为当前已知静态值，可在 review 时增删；
 * id 一旦发布即视为稳定（被存进用户 settings）。
 */
export const SUPPORTED_AGENTS: SupportedAgent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    // Claude Code 自带 Task/子 agent 能力 → 归档等可派多个子 agent 并行。
    supportsSubagents: true,
    models: [
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' }
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    models: [
      { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
      { id: 'gpt-5', name: 'GPT-5' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor-agent',
    models: [
      { id: 'auto', name: 'Auto' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
      { id: 'gpt-5', name: 'GPT-5' }
    ]
  }
]

/** 全部受支持 agent（UI 由它驱动渲染）。 */
export function listSupportedAgents(): SupportedAgent[] {
  return SUPPORTED_AGENTS
}

function findAgent(id: unknown): SupportedAgent | undefined {
  return typeof id === 'string' ? SUPPORTED_AGENTS.find((a) => a.id === id) : undefined
}

/** 某 agent 的可选模型清单；未知 agent 安全返回空。 */
export function modelsForAgent(id: AgentId): AgentModel[] {
  return findAgent(id)?.models ?? []
}

/** 把任意输入收敛为受支持 agent id；非受支持值返回 undefined（视为未选择）。 */
export function coerceDefaultAgentId(value: unknown): AgentId | undefined {
  return findAgent(value)?.id
}

/**
 * 某运行时是否**确证支持子 agent**（供 `archive-docs` 决定并行 vs 串行退化）。**保守**：未知/未选择/未声明
 * 一律返回 `false`（探测不准即走串行，不因误判并行而失败）。见 document-archive 的能力门控。
 */
export function agentSupportsSubagents(id: unknown): boolean {
  return findAgent(id)?.supportsSubagents === true
}

/**
 * 把模型值收敛为「属于该 agent 的模型」；不属于 / agent 未选择 / 未知一律返回 undefined。
 * 用于切换 agent 时清除不匹配的旧模型，保证 settings 中 agent 与 model 始终自洽。
 */
export function coerceDefaultModel(agentId: AgentId | undefined, modelId: unknown): string | undefined {
  if (typeof modelId !== 'string') return undefined
  const agent = findAgent(agentId)
  if (!agent) return undefined
  return agent.models.some((m) => m.id === modelId) ? modelId : undefined
}
