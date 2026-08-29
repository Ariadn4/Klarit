import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { SUPPORTED_AGENTS, type AgentId, type SupportedAgent } from '../shared/agents'
import type { DetectedAgent } from '../shared/types'

/**
 * 探测某 CLI：返回**按解析顺序排列的候选绝对路径**（`where`/`which` 的原始输出行），未解析到返回空数组。
 * 产物是「在哪」而不是「有没有」——路径是后续启动 agent 的唯一可信来源（见 agent-execution）。
 */
export type AgentProbe = (command: string) => string[]

/** 未检出某 agent 的可辨认原因：压根没解析到 vs 解析到了但被安全护栏拒。 */
export type AgentDetectReason = 'not-found' | 'rejected-by-guard'

/** 一条「该 agent 没被检出」的记录（含原因与被看过的候选，供日志排查）。 */
export interface AgentDetectIssue {
  id: AgentId
  reason: AgentDetectReason
  candidates: string[]
}

/** 扫描结果：检出的 agent + 未检出者的原因（不把护栏拒绝笼统归为「未安装」）。 */
export interface AgentScanResult {
  agents: DetectedAgent[]
  issues: AgentDetectIssue[]
}

export interface AgentScanOptions {
  /**
   * 已注册项目目录与需求卡 worktree 目录：候选落在其内（含子目录）即拒。
   * 这些目录的内容由外部 agent 写入、可能源自导入的第三方项目，不能决定我们起哪个可执行文件。
   */
  forbiddenDirs?: string[]
}

const isWin = process.platform === 'win32'
/** 该平台的已知可执行形态（win 之外不按扩展名判定）。 */
const KNOWN_EXTS = ['.exe', '.cmd']

/**
 * 真实探测：用系统 `where`（Windows）/ `which`（类 Unix）解析 command 的**绝对路径**。
 *
 * `resolveCwd` 必须是**受控目录**（Klarit 自己的目录，非任何项目 / worktree）：`where` 的搜索范围是
 * 「当前目录 + PATH」，不钉 cwd 就等于让被管理的仓库参与决定解析结果——护栏在这一步就被绕过了。
 * 带超时；解析不到 / 命令不存在 / 超时一律返回空候选（由调用方按「未检测到」处理）。
 */
export function makeAgentProbe(resolveCwd: string): AgentProbe {
  const finder = isWin ? 'where' : 'which'
  return (command) => {
    let out: string
    try {
      out = execFileSync(finder, [command], {
        cwd: resolveCwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
        windowsHide: true
      })
    } catch {
      return [] // 非零退出（未找到）/ 超时 / finder 本身缺失
    }
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
  }
}

/** 路径 p 是否落在目录 dir 之内（含深层子目录）；跨盘/无关路径为 false。 */
function isInside(dir: string, p: string): boolean {
  const norm = (s: string): string => (isWin ? resolve(s).toLowerCase() : resolve(s))
  const rel = relative(norm(dir), norm(p))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 四条护栏（互补，缺一条就漏）：绝对路径 / 真实文件 / 不落在任何项目或 worktree 内 / 已知可执行形态。
 * 任一不满足即该候选作废（不降级使用）。
 */
function acceptCandidate(candidate: string, forbiddenDirs: string[]): boolean {
  if (!isAbsolute(candidate)) return false
  if (forbiddenDirs.some((d) => isInside(d, candidate))) return false
  if (isWin && !KNOWN_EXTS.includes(extname(candidate).toLowerCase())) return false
  try {
    if (!statSync(candidate).isFile()) return false
  } catch {
    return false // 不存在 / 无权访问
  }
  return true
}

/**
 * 扫描本机已安装的受支持 agent：逐一解析其 CLI 的绝对路径，候选按解析顺序取**第一个通过护栏**的
 * （`where` 会先列出无扩展名的同名脚本，故不能只看第一条）。单个探测异常（抛错/超时）或候选全被拒
 * 均视为「未检测到」并继续，整体永不抛出；未检出者附可辨认原因。
 */
export function scanAgents(
  probe: AgentProbe,
  opts: AgentScanOptions = {},
  agents: SupportedAgent[] = SUPPORTED_AGENTS
): AgentScanResult {
  const forbidden = opts.forbiddenDirs ?? []
  const detected: DetectedAgent[] = []
  const issues: AgentDetectIssue[] = []
  for (const a of agents) {
    let candidates: string[] = []
    try {
      candidates = probe(a.command) ?? []
    } catch {
      candidates = []
    }
    const hit = candidates.find((c) => acceptCandidate(c, forbidden))
    if (hit) {
      detected.push({ id: a.id, name: a.name, models: a.models, executablePath: hit })
      continue
    }
    issues.push({
      id: a.id,
      reason: candidates.length === 0 ? 'not-found' : 'rejected-by-guard',
      candidates
    })
  }
  return { agents: detected, issues }
}
