/**
 * 以「无头（非交互）」方式调用用户配置的编程 agent CLI 跑分解：把 prompt 经 stdin 喂进去、取 stdout 回复，
 * 再从回复里解析出候选卡 JSON。对齐 project-goals「复用用户的编程 AI、不自建模型通道」。
 * 这是全局 agent producer 的真实实现（替代占位 stub）；调用失败/超时由上层按「无候选」优雅处理。
 */

import { spawn } from 'node:child_process'
import type { AgentId } from '../shared/agents'
import type { CandidateCard, CardRelation, CardRelationKind } from '../shared/types'
import { CARD_RELATION_KINDS, isValidProposedName, toProposedName } from '../shared/requirement-card'

export interface HeadlessInvocation {
  command: string
  args: string[]
}

/** 各 agent 的无头调用（prompt 走 stdin、stdout 取回复）。模型可空（空＝用 agent 默认）。 */
export function headlessInvocation(agentId: AgentId, model?: string): HeadlessInvocation {
  const m = model?.trim() ? model.trim() : null
  switch (agentId) {
    case 'claude-code':
      return { command: 'claude', args: m ? ['-p', '--model', m] : ['-p'] }
    case 'codex':
      return { command: 'codex', args: m ? ['exec', '-m', m, '-'] : ['exec', '-'] }
    case 'cursor':
      return { command: 'cursor-agent', args: m ? ['-p', '--model', m] : ['-p'] }
  }
}

/** 组装喂给 agent 的完整消息：分解 skill（prompt）+ 用户描述 + 严格的「只输出 JSON 数组」收尾。 */
export function buildDecomposeMessage(prompt: string, description: string): string {
  return [
    prompt,
    '',
    '# 用户的需求描述',
    description,
    '',
    '# 输出要求',
    '严格只输出候选卡 JSON 数组（[{...}]），不要任何解释、前后缀或 markdown 代码围栏。'
  ].join('\n')
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

/** 无头跑一次 agent：spawn → 写 prompt 到 stdin → 收 stdout。非零退出/超时/拉起失败均 reject。 */
export function runAgentHeadless(
  inv: HeadlessInvocation,
  prompt: string,
  opts: { timeoutMs?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    // win 上 agent CLI 多为 .cmd，需 shell 解析；prompt 走 stdin、不进 argv，故无注入风险。
    const child = spawn(inv.command, inv.args, {
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('agent 调用超时'))
    }, opts.timeoutMs ?? 180_000)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`agent 退出码 ${code}：${err.slice(0, 500)}`))
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
