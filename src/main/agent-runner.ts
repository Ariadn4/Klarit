/**
 * 以「无头（非交互）」方式调用用户配置的编程 agent CLI 跑分解：把 prompt 经 stdin 喂进去、取 stdout 回复，
 * 再从回复里解析出候选卡 JSON。对齐 project-goals「复用用户的编程 AI、不自建模型通道」。
 * 这是全局 agent producer 的真实实现（替代占位 stub）；调用失败/超时由上层按「无候选」优雅处理。
 */

import { spawnAgent } from './agent/launch'
import { clampEffortToHigh, type AgentId, type EffortLevel } from '../shared/agents'
import type { CandidateCard, CardRelation, CardRelationKind } from '../shared/types'
import { CARD_RELATION_KINDS, isValidProposedName, toProposedName } from '../shared/requirement-card'

/**
 * 一次无头调用的调用式：**只有外壳 id 与 argv**，没有命令名——起哪个可执行文件由探测出的绝对路径
 * 决定（与引擎节点 agent 共用同一套启动约束，见 `agent/launch.ts`）。
 */
export interface HeadlessInvocation {
  agentId: AgentId
  args: string[]
}

/** 各 agent 的无头调用（prompt 走 stdin、stdout 取回复）。模型/effort 可空（空＝用 agent 默认）。 */
export function headlessInvocation(agentId: AgentId, model?: string, effort?: EffortLevel): HeadlessInvocation {
  const m = model?.trim() ? model.trim() : null
  switch (agentId) {
    case 'claude-code': {
      const args = ['-p']
      if (m) args.push('--model', m)
      // ultracode 是提示词关键词档，本路径（分解/起草等结构化小任务）不宜编排 → 视同未设置。
      if (effort && effort !== 'ultracode') args.push('--effort', effort)
      return { agentId, args }
    }
    case 'codex': {
      const args = ['exec']
      if (m) args.push('-m', m)
      // codex 档位止于 high，xhigh/max 收敛（与 adapter 同规则）。
      if (effort) args.push('-c', `model_reasoning_effort=${clampEffortToHigh(effort)}`)
      args.push('-')
      return { agentId, args }
    }
    case 'cursor':
      // cursor 无 effort 参数，忽略。
      return { agentId, args: m ? ['-p', '--model', m] : ['-p'] }
  }
}

/**
 * 组装喂给 agent 的完整消息：分解 skill（prompt）+ 可选全盘视野 + 用户描述 + 严格的「只输出 JSON 数组」收尾。
 * 有 `boardContext` 时插入项目全盘视野，供 agent 引用现有卡的 id 建立跨卡依赖（尤其 `blocked_by` 在跑/未完成卡）。
 */
export function buildDecomposeMessage(prompt: string, description: string, boardContext?: string): string {
  const parts: string[] = [prompt, '']
  if (boardContext && boardContext.trim() !== '') {
    parts.push(
      '# 项目全盘视野（关系 target 可引用其中现有卡的 id 建立跨卡依赖，尤其用 blocked_by 挂到在跑/未完成的现有卡）',
      boardContext.trim(),
      ''
    )
  }
  parts.push(
    '# 用户的需求描述',
    description,
    '',
    '# 输出要求',
    '严格只输出候选卡 JSON 数组（[{...}]），不要任何解释、前后缀或 markdown 代码围栏。'
  )
  return parts.join('\n')
}

function stripFences(text: string): string {
  // 去掉 ```json ... ``` 之类围栏，保留内容。
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
}

/** 从一段文本里抠出最外层 JSON 数组并解析；失败返回 null。 */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function coerceTypeId(o: Record<string, unknown>): string {
  // 透传 LLM 给的 typeId（兼容旧 prompt 的 category 字段）；不在此处回落到某默认类型——
  // 在册与否由 validateCandidateBatch 据项目注册表判定，未知 typeId 进 issue（不静默回落）。
  const raw = o.typeId ?? o.category
  return typeof raw === 'string' ? raw.trim() : ''
}

function coerceRelations(v: unknown): CardRelation[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((r): r is { kind: unknown; target: unknown } => !!r && typeof r === 'object')
    .filter((r) => CARD_RELATION_KINDS.includes(r.kind as CardRelationKind) && typeof r.target === 'string' && r.target.trim() !== '')
    .map((r) => ({ kind: r.kind as CardRelationKind, target: String(r.target) }))
}

function coerceCandidate(raw: unknown): CandidateCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (title === '') return null // 无标题的条目丢弃（无意义）
  const description = typeof o.description === 'string' ? o.description : ''
  const proposed = typeof o.proposedName === 'string' && isValidProposedName(o.proposedName) ? o.proposedName : toProposedName(title)
  return {
    proposedName: proposed,
    title,
    description,
    typeId: coerceTypeId(o),
    relations: coerceRelations(o.relations)
  }
}

/** 从 agent 回复文本解析候选卡：去围栏 → 抠 JSON 数组 → 逐条容错收敛为合规候选。失败返回空数组。 */
export function parseCandidateCards(stdout: string): CandidateCard[] {
  const arr = extractJsonArray(stripFences(stdout ?? ''))
  if (!Array.isArray(arr)) return []
  return arr.map(coerceCandidate).filter((c): c is CandidateCard => c !== null)
}

/**
 * 无头跑一次 agent：走**与引擎节点 agent 同一个**共用启动实现（绝对路径 / 不经 shell 拼接 / env 净化，
 * 见 `agent/launch.ts`）→ 写 prompt 到 stdin → 收 stdout。非零退出/超时/拉起失败（含解析不到可信绝对
 * 路径）均 reject，由上层按「无候选」优雅处理，绝不回落裸命令名。
 */
export function runAgentHeadless(
  inv: HeadlessInvocation,
  prompt: string,
  opts: { timeoutMs?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const spawned = spawnAgent({ toolId: inv.agentId, args: inv.args })
    if (!spawned.ok) {
      reject(new Error(`agent 启动失败：${spawned.reason}`))
      return
    }
    const child = spawned.child
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      spawned.kill()
      reject(new Error('agent 调用超时'))
    }, opts.timeoutMs ?? 180_000)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.stderr?.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`agent 退出码 ${code}：${err.slice(0, 500)}`))
    })
    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}
