import { execFileSync } from 'node:child_process'
import { SUPPORTED_AGENTS, type SupportedAgent } from '../shared/agents'
import type { DetectedAgent } from '../shared/types'

/** 探测某 CLI 是否在本机可用（在 PATH 中可解析）。 */
export type AgentProbe = (command: string) => boolean

/**
 * 真实探测：用系统 `where`（Windows）/ `which`（类 Unix）查 command 是否在 PATH。
 * 带超时与全静默 stdio；任何失败（非零退出、超时、命令不存在）由调用方按「未检测到」处理。
 */
export function makeAgentProbe(): AgentProbe {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return (command) => {
    execFileSync(finder, [command], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 3000 })
    return true
  }
}

/**
 * 扫描本机已安装的受支持 agent：逐一探测，单个探测异常（抛错/超时）视为「未检测到」并继续，
 * 整体永不抛出。返回已检测到的 agent（内联其模型清单），未装的不出现。
 */
export function scanAgents(
  probe: AgentProbe,
  agents: SupportedAgent[] = SUPPORTED_AGENTS
): DetectedAgent[] {
  const detected: DetectedAgent[] = []
  for (const a of agents) {
    let ok = false
    try {
      ok = probe(a.command)
    } catch {
      ok = false
    }
    if (ok) detected.push({ id: a.id, name: a.name, models: a.models })
  }
  return detected
}
