/**
 * agent 运行器：把 adapter 翻出的调用式真正拉成无头子进程——喂 stdin、流式回调 stdout/stderr、
 * 可取消（杀整棵进程树，复用 command-run 的 killTree）。这是引擎依赖的注入式接口 `AgentRunner`；
 * 引擎测试注入**假运行器**（写假握手 + 编排退出码），不依赖真 CLI。
 *
 * 一个 agent 节点一个 agent（跨其全部目标仓）：`cwd`=主目标仓 worktree，`extraDirs`=其余目标仓。
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { killTree } from '../command-run'
import { resolveAdapter, type AgentAdapter, type AgentInvocation, type AgentInvokeOpts } from './adapter'
import type { EffortLevel } from '../../shared/agents'

/** 一个在跑的 agent：可杀，退出兑现 `{ code, killed }`。 */
export interface AgentLaunch {
  kill: () => void
  done: Promise<{ code: number; killed: boolean }>
}

/** 拉起一个 agent 的公共规格（start 带 prompt / resume 带 inject 各自补齐）。 */
export interface AgentRunSpec {
  toolId: string
  /** 主目标仓 worktree（子进程 cwd）。 */
  cwd: string
  /** 其余目标仓 worktree（一个 agent 跨仓，翻成 --add-dir 等）。 */
  extraDirs?: string[]
  model?: string
  /** 推理力度（统一枚举，级联已在 prepare 侧解析完）；adapter 按家翻译，不支持的家忽略。 */
  effort?: EffortLevel
  extraArgs?: string
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
  signal?: AbortSignal
  /** 续接用：要 `--resume` 的**具体**会话 id（resume 才用；无则 resume 返 null → 引擎回落历史重建）。 */
  sessionId?: string
  /** 抓到会话 id 时回调（引擎存进断点，供下次 --resume 精确续接）。 */
  onSession?: (id: string) => void
  /** 原始流式记录落盘路径（jsonl，边跑边增量追加）；供续接失败时的「喂回历史」兜底。 */
  historyPath?: string
}

/** 引擎依赖的 agent 运行接口（注入式，便于假实现）。 */
export interface AgentRunner {
  /** 某外壳是否支持无头原生续接（供续接阶梯择优）。未知外壳返回 false。 */
  supportsResume: (toolId: string) => boolean
  /** 起一次全新任务；未知/未落地外壳返回 null（调用方按技术失败处理）。 */
  start: (spec: AgentRunSpec & { prompt: string }) => AgentLaunch | null
  /** 原生续接（注入文本）；外壳不支持或未落地返回 null（调用方回落自存重建）。 */
  resume: (spec: AgentRunSpec & { inject: string }) => AgentLaunch | null
}

const isWin = process.platform === 'win32'

/** 按调用式拉起子进程：喂 stdin、流式（按行：抓 session id + 落历史 + 转人可读）、可取消（杀进程树）。永不抛。 */
function runInvocation(inv: AgentInvocation, spec: AgentRunSpec, adapter?: AgentAdapter): AgentLaunch {
  // win 上 agent CLI 多为 .cmd，需 shell 解析；input 走 stdin、参数为受信 flag，无注入面。
  const child = spawn(inv.command, inv.args, {
    cwd: spec.cwd,
    shell: isWin,
    detached: !isWin, // POSIX：独立进程组以便整组 kill；win 由 taskkill /T 处理
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let killed = false
  const kill = (): void => {
    killed = true
    if (child.pid) killTree(child.pid)
  }
  if (spec.signal) {
    if (spec.signal.aborted) kill()
    else spec.signal.addEventListener('abort', kill, { once: true })
  }

  const lineMode = !!(adapter?.displayFromStreamLine || adapter?.sessionIdFromStreamLine || spec.historyPath)
  let sessionSent = false
  const handleLine = (line: string): void => {
    if (spec.historyPath) {
      try {
        appendFileSync(spec.historyPath, `${line}\n`) // 边跑边增量落盘，供续接失败时喂回历史
      } catch {
        /* 落盘失败不影响运行 */
      }
    }
    if (!sessionSent && adapter?.sessionIdFromStreamLine) {
      const id = adapter.sessionIdFromStreamLine(line)
      if (id) {
        sessionSent = true
        spec.onSession?.(id)
      }
    }
    const text = adapter?.displayFromStreamLine ? adapter.displayFromStreamLine(line) : line
    if (text) spec.onChunk?.('stdout', text.endsWith('\n') ? text : `${text}\n`)
  }

  if (lineMode) {
    let buf = ''
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
  } else {
    child.stdout?.on('data', (d: Buffer) => spec.onChunk?.('stdout', d.toString()))
  }
  child.stderr?.on('data', (d: Buffer) => spec.onChunk?.('stderr', d.toString()))

  const done = new Promise<{ code: number; killed: boolean }>((resolve) => {
    child.on('error', () => resolve({ code: 1, killed }))
    child.on('close', (code) => resolve({ code: code ?? (killed ? -1 : 1), killed }))
  })

  if (inv.input != null && child.stdin) {
    child.stdin.write(inv.input)
    child.stdin.end()
  }

  return { kill, done }
}

/** 真实 agent 运行器：经 adapter 翻 argv、拉无头子进程。 */
export const realAgentRunner: AgentRunner = {
  supportsResume: (toolId) => resolveAdapter(toolId)?.supportsResume ?? false,

  start: (spec) => {
    const adapter = resolveAdapter(spec.toolId)
    if (!adapter) return null
    const opts: AgentInvokeOpts = {
      model: spec.model,
      effort: spec.effort,
      extraArgs: spec.extraArgs,
      extraDirs: spec.extraDirs
    }
    return runInvocation(adapter.start(spec.prompt, opts), spec, adapter)
  },

  resume: (spec) => {
    const adapter = resolveAdapter(spec.toolId)
    if (!adapter || !adapter.supportsResume) return null
    const opts: AgentInvokeOpts = {
      model: spec.model,
      effort: spec.effort,
      extraArgs: spec.extraArgs,
      extraDirs: spec.extraDirs,
      sessionId: spec.sessionId
    }
    const inv = adapter.resume(spec.inject, opts)
    return inv ? runInvocation(inv, spec, adapter) : null
  }
}
