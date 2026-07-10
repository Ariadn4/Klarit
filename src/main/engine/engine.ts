/**
 * 工作流运行引擎:阶段状态机(executing → gate k → done)、幂等 ensure 的 engine 执行器、可取消的
 * command 执行器(前置检查护栏 + 每命令可选超时)、客观门真跑(inline/ref)、人工门动作按钮、
 * 失败四归宿 + 固定选项决策回路、断点持久化与恢复。
 *
 * 触发与「等结果」分离:start/resume/decide 触发后台驱动并立即返回 `{ runId, settled }`——`settled`
 * 在运行进入停点(done/waiting-decision/paused/aborted)时兑现。IPC 只取 runId、不 await settled
 * (Promise 不跨进程);测试 await settled。引擎在内存持「活运行登记表」,pause 对活运行 abort 子进程并在
 * 阶段边界落 paused(消除「pause 写副本被 drive 覆盖回 running」的竞态)。command 是首个可被中途打断的执行者。
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  AgentHandshake,
  DecisionResponse,
  CommandSpec,
  EngineDecision,
  EngineProgressEvent,
  GateAttempt,
  MemberDerived,
  NodePhase,
  RunBreakpoint,
  RunRepoTarget,
  RunRequest,
  WorkflowDefinition,
  WorkflowNode
} from '../../shared/types'
import type { RulePackItemRef } from '../../shared/rule-pack'
import { resolveLocalized } from '../../shared/localized'
import { DEFAULT_LANGUAGE } from '../../shared/language'
import { listBranches, makeGitRunner } from '../git'
import { makeAsyncGitRunner, mergeBranch } from '../git-write'
import { runCommand as realRunCommand, type CommandResult } from '../command-run'
import { createMemoryOutputBuffer, type OutputBuffer } from './output-buffer'
import { chunkBucket } from '../../shared/output-bucket'
import {
  ensureBranch,
  ensureJunction,
  ensureMerged,
  ensureNoBranch,
  ensureNoRemoteBranch,
  ensureNoWorktree,
  ensurePushed,
  ensureWorktree,
  type EnsureContext,
  type EnsureResult
} from './ensure'
import {
  buildAgentDecision,
  buildCommandFailedDecision,
  buildCommandTimeoutDecision,
  buildFailureDecision,
  buildGateDecision,
  buildManualGateDecision,
  buildRollbackConfirmDecision,
  buildScopeDecision,
  isAutoSkippable
} from './decisions'
import { deriveLineage, renderLineage } from './lineage'
import type { RunStore } from './run-store'
import { memberWorktreePath, nextSuffixed, resolveFreeBranch } from './branch-naming'
import { realAgentRunner, type AgentLaunch, type AgentRunner, type AgentRunSpec } from '../agent/runner'
import { launchContinuation, buildContinuationDelta } from '../agent/continuation'
import { readHandshake as realReadHandshake } from '../agent/handshake'
import { scopeGuard } from '../agent/scope'

/** 引擎给 prepareAgent 的执行上下文：握手绝对路径 + 本节点目标仓（供注入多仓布局）。 */
export interface AgentPrepContext {
  /** 引擎指定的握手文件绝对路径（worktree 之外，注入协议层）。 */
  handshakePath: string
  /** 本节点目标成员仓：id、worktree 路径、是否主目录（agent cwd）。 */
  targetRepos: Array<{ memberId: string; path: string; primary: boolean }>
}

/** 引擎/命令节点技术失败的 heal / 处置 agent 拼 prompt 所需的上下文（引擎给 prepareHealAgent）。 */
export interface HealPrepContext {
  /** 合并冲突 heal / 命令失败 heal / 决策自由输入的处置 / 只读回退判定（内容驱动回退）。 */
  kind: 'merge-conflict' | 'command-failure' | 'disposition' | 'rollback-judge'
  /** 引擎指定的握手绝对路径（worktree 之外）。 */
  handshakePath: string
  /** 出错/处置所在的成员仓 worktree（heal agent 的 cwd）。 */
  repo: { memberId: string; path: string }
  branch: string
  base: string
  /** merge-conflict：冲突文件清单。 */
  conflictFiles?: string[]
  /** command-failure：失败命令与输出。 */
  command?: string
  output?: string
  /** disposition：失败背景 + 用户自由输入。rollback-judge：`userInput`=驳回意见。 */
  background?: string
  userInput?: string
  /** rollback-judge：产物溯源上下文文本（deriveLineage 渲染）+ 评审门节点显示名。 */
  lineage?: string
  nodeName?: string
}

/** agent 节点执行所需的解析结果（真实由 main 注入：偏好级联解析工具/模型 + 拼完整 prompt）。 */
export interface AgentPrep {
  /** 已拼好的完整 prompt（宪法 + 节点 prompt + 卡 + 涉及仓 + 可写范围 + 产出 + 引擎交互协议）。 */
  prompt: string
  /** 解析后的外壳 id（节点声明 < 全局默认）。 */
  toolId: string
  model?: string
  extraArgs?: string
}

/** agent 节点自愈上限：达到即升级为带背景的 agent 决策。 */
const MAX_AGENT_HEAL = 3

type RunCommandFn = (
  command: string,
  opts: {
    cwd: string
    signal?: AbortSignal
    onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
    onStart?: (handle: { kill: () => void }) => void
  }
) => Promise<CommandResult>

/** 触发一个运行后立即返回:runId + 到停点即兑现的 awaitable。 */
export interface Launched {
  runId: string
  /** 运行进入停点(done/waiting-decision/paused/aborted)时兑现为彼时断点。 */
  settled: Promise<RunBreakpoint>
}

/** 注入式依赖,便于测试(注入内存 store / 假 runId / 假命令运行器 / 假规则库解析)。 */
export interface EngineDeps {
  getWorkflow: (id: string) => WorkflowDefinition | null
  store: RunStore
  emit?: (evt: EngineProgressEvent) => void
  newRunId?: () => string
  /** 构造 ensure 上下文(默认按 repoPath 真实构造);测试可注入。 */
  makeContext?: (repoPath: string, remote: string) => EnsureContext
  /** 命令运行器;默认走真实可取消运行器。测试可注入假实现。 */
  runCommand?: RunCommandFn
  /** 把客观门的 `ref` 解析为可执行命令;缺省返回 null(按缺失处理)。真实由 main 注入规则库解析。 */
  getObjectiveCheck?: (ref: RulePackItemRef) => string | null
  /** 命令输出按桶缓冲(可回看);缺省内存缓冲。真实由 main 注入文件缓冲(userData/engine-runs/<runId>/)。 */
  outputBuffer?: OutputBuffer
  /** 当前界面语言存取（用于把节点显示名解析为单语言标签）；缺省回退默认语言。 */
  language?: () => string
  /** agent 运行器（无头拉起 agent CLI）；缺省真实运行器。测试注入假运行器（写假握手 + 编排退出码）。 */
  runAgent?: AgentRunner
  /** 读引擎指定绝对路径的握手文件；缺省真实 fs 读取。测试注入假握手。 */
  readHandshake?: (handshakePath: string) => AgentHandshake
  /** 解析某 agent 节点的工具/模型 + 拼完整 prompt（含握手路径与多仓布局）；缺省返回 null（视 agent 不可用）。 */
  prepareAgent?: (node: WorkflowNode, bp: RunBreakpoint, ctx: AgentPrepContext) => AgentPrep | null
  /** 拼 heal / 处置 agent 的完整 prompt（公共输入 + heal 任务段）；缺省返回 null（视 heal 不可用，回落人工）。 */
  prepareHealAgent?: (bp: RunBreakpoint, ctx: HealPrepContext) => AgentPrep | null
  /** 握手文件根目录（引擎按 runId/nodeId 组织其绝对路径，在 worktree 之外）；缺省用系统临时目录。 */
  handshakeDir?: string
}

export interface Engine {
  start: (req: RunRequest) => Launched
  resume: (runId: string) => Launched
  decide: (runId: string, response: DecisionResponse) => Launched
  pause: (runId: string) => Promise<RunBreakpoint>
  getRunState: (runId: string) => RunBreakpoint | null
  resumeAll: () => Promise<void>
  /** 触发某人工门第 index 个动作按钮:登记为后台命令(各自 bgId/桶/中止/后台生命周期)、立即返回其 bgId、不推进运行。 */
  runGateAction: (runId: string, actionIndex: number) => Promise<{ bgId: string }>
  /** 停止某运行当前所有门把动作进程(细粒度中止用 stopBackground)。 */
  stopGateAction: (runId: string) => void
  /** 命令节点执行中手动推进:abort=杀掉后进下一节点;detach=转后台后进下一节点(均跳过剩余门把)。 */
  advanceCommand: (runId: string, mode: 'abort' | 'detach') => void
  /** 列出某运行的后台命令。 */
  listBackground: (runId: string) => Array<{ bgId: string; nodeId: string; label: string }>
  /** 中止某后台命令(杀进程树)。 */
  stopBackground: (runId: string, bgId: string) => void
  /** 杀掉所有运行的所有后台命令(app 退出兜底,不留孤儿)。 */
  killAllBackground: () => void
  /** 读某运行某桶(`node:<nodeId>` / `bg:<bgId>`)累积命令输出(可回看)。 */
  readOutput: (runId: string, bucket: string) => string
  /** 列某运行的全部输出桶键。 */
  listOutputBuckets: (runId: string) => string[]
}

/** 一个转入后台的命令:仍在跑、仍流式输出,持杀进程树句柄供中止。 */
interface BackgroundProc {
  bgId: string
  nodeId: string
  label: string
  kill: () => void
  /** 门动作进程标记:承载动作身份(节点+索引),供单例判定与 stopGateAction 定位。缺省=普通后台命令。 */
  action?: { nodeId: string; index: number }
}

/** 每个运行的内存态(非持久):取消/推进句柄 + 暂停标志 + 后台命令登记 + 当前 settled。 */
interface Active {
  abort: AbortController
  paused: boolean
  /** 命令执行中手动推进意图:'abort'=杀+进;'detach'=转后台+进。 */
  advance?: 'abort' | 'detach'
  /** 各前台命令的「转后台」触发器(节点可并发多命令,detach 广播到全部在跑命令)。 */
  detachResolvers: Array<() => void>
  driving: boolean
  settled: Promise<RunBreakpoint>
  background: BackgroundProc[]
}

/** 单仓退化时的隐式成员 id(无 card.repos 时以 request.repoPath 为唯一成员)。 */
const SINGLE_MEMBER = '<single>'

let counter = 0
let bgCounter = 0
/** 客观门自动重试上限:达到即升级为带历史的人工决策。 */
const MAX_GATE_RETRY = 3

export function createEngine(deps: EngineDeps): Engine {
  // 节点显示名解析为单语言标签（决策/命令 label 用）；语言取当前界面语言，缺省回退默认。
  const nodeLabel = (node: WorkflowNode): string => resolveLocalized(node.name, deps.language?.() ?? DEFAULT_LANGUAGE)
  const outputBuffer = deps.outputBuffer ?? createMemoryOutputBuffer()
  const rawEmit = deps.emit ?? ((): void => {})
  // 包装 emit:op-chunk 在流式推送之外按桶累积(前台 node:<id>、后台 bg:<id>),供关重开回看。
  const emit = (evt: EngineProgressEvent): void => {
    if (evt.kind === 'op-chunk') {
      outputBuffer.append(evt.runId, chunkBucket(evt.nodeId, { bgId: evt.bgId, cmdIndex: evt.cmdIndex }), evt.chunk)
    }
    rawEmit(evt)
  }
  const newRunId = deps.newRunId ?? ((): string => `run-${Date.now()}-${counter++}`)
  const makeContext =
    deps.makeContext ??
    ((repoPath: string, remote: string): EnsureContext => ({
      repoPath,
      run: makeAsyncGitRunner(repoPath),
      read: makeGitRunner(repoPath),
      remote
    }))
  const runCmd: RunCommandFn = deps.runCommand ?? realRunCommand
  const getObjectiveCheck = deps.getObjectiveCheck ?? ((): string | null => null)
  const runAgent: AgentRunner = deps.runAgent ?? realAgentRunner
  const readHandshake = deps.readHandshake ?? realReadHandshake
  // agent 执行器是**可选注入**：未注入 prepareAgent 时 agent 节点优雅跳过（同旧行为，供未接执行器的上下文/测试）；
  // 注入后 agent 节点真正执行。注入但对某节点返回 null＝该节点 agent 不可用（技术失败决策）。
  const prepareAgent = deps.prepareAgent
  const prepareHealAgent = deps.prepareHealAgent
  const handshakeDir = deps.handshakeDir ?? join(tmpdir(), 'klarit-handshakes')
  /** heal / 处置 agent 的自愈上限（复用 agent 自愈上限）。 */
  const MAX_HEAL = MAX_AGENT_HEAL

  /** 把 request 派生齐全(分支/worktree路径/基分支/远端/links),写回 bp 供恢复稳定。 */
  function derive(req: RunRequest, runId: string): Required<Omit<RunRequest, 'links' | 'cardId' | 'repos' | 'avoidBranchConflict'>> & {
    links: NonNullable<RunRequest['links']>
    cardId?: string
    repos?: RunRepoTarget[]
  } {
    const remote = req.remote ?? 'origin'
    const branch = req.branch ?? `klarit/${runId.slice(-8)}`
    const worktreePath = req.worktreePath ?? memberWorktreePath(req.repoPath, branch)
    let baseBranch = req.baseBranch
    if (!baseBranch) {
      const cur = makeGitRunner(req.repoPath)(['branch', '--show-current'])
      baseBranch = cur && cur.length ? cur : 'main'
    }
    return { workflowId: req.workflowId, repoPath: req.repoPath, cardId: req.cardId, branch, worktreePath, baseBranch, remote, links: req.links ?? [], repos: req.repos }
  }

  /** 运行的成员仓集合:带 `repos` 用之,否则单仓退化为一个隐式成员(memberId=SINGLE_MEMBER)。 */
  function membersOf(d: RunRequest): RunRepoTarget[] {
    return d.repos && d.repos.length
      ? d.repos
      : [{ memberId: SINGLE_MEMBER, repoPath: d.repoPath, tag: undefined }]
  }

  /**
   * 逐成员派生上下文:分支名=卡 slug(跨仓同名);worktree 取各成员同级派生;base 逐仓解析自身主线。
   * 单仓隐式成员沿用 request 既有派生(worktreePath/baseBranch),保证单仓行为与今日完全一致。
   */
  function deriveMembers(d: RunRequest): Record<string, MemberDerived> {
    const branch = d.branch!
    const out: Record<string, MemberDerived> = {}
    for (const m of membersOf(d)) {
      const isSingle = m.memberId === SINGLE_MEMBER
      const worktreePath = isSingle ? d.worktreePath! : memberWorktreePath(m.repoPath, branch)
      let baseBranch: string
      if (isSingle) {
        baseBranch = d.baseBranch!
      } else {
        const cur = makeGitRunner(m.repoPath)(['branch', '--show-current'])
        baseBranch = cur && cur.length ? cur : 'main'
      }
      out[m.memberId] = { memberId: m.memberId, repoPath: m.repoPath, branch, worktreePath, baseBranch }
    }
    return out
  }

  /**
   * 把节点 target 解析为成员 id 子集(缺省/all=全体;tag/repo 过滤;fromUpstream 交上游结构化输出)。
   * 见 repo-targeting。
   */
  function resolveTargetMembers(bp: RunBreakpoint, node: WorkflowNode): string[] {
    const members = membersOf(bp.request)
    const t = node.target
    if (!t || t.kind === 'all') return members.map((m) => m.memberId)
    if (t.kind === 'tag') return members.filter((m) => m.tag === t.tag).map((m) => m.memberId)
    if (t.kind === 'repo') return members.filter((m) => m.memberId === t.memberId).map((m) => m.memberId)
    // fromUpstream:与上游节点结构化输出记录的涉及仓求交。
    const picked = new Set(bp.upstreamOutputs?.[t.nodeId]?.repos ?? [])
    return members.filter((m) => picked.has(m.memberId)).map((m) => m.memberId)
  }

  function nodesOf(bp: RunBreakpoint): WorkflowNode[] {
    return deps.getWorkflow(bp.request.workflowId)?.nodes ?? []
  }

  function persist(bp: RunBreakpoint): RunBreakpoint {
    deps.store.save(bp)
    emit({ kind: 'state', runId: bp.runId, state: bp.state })
    return bp
  }

  // 每运行的瞬时(非持久)选项:决策选「强制/先拉再推」后,下一次 executing 透传给 ensure。
  const transient = new Map<string, { force?: boolean; pullFirst?: boolean }>()
  const retries = new Map<string, number>() // runId:nodeId → 已重试次数(瞬时失败有限次)
  const MAX_RETRY = 2
  // 「放宽可写范围」一次性豁免：键 `runId:nodeId`；命中时该节点本次越界检测按整条分支可写（不还原、全提交）。
  const scopeWaived = new Set<string>()

  // 活运行登记表:承载进行中的取消句柄与暂停标志(进程退出后自然无可杀者)。
  const active = new Map<string, Active>()
  function ensureActive(runId: string): Active {
    let a = active.get(runId)
    if (!a) {
      a = { abort: new AbortController(), paused: false, driving: false, settled: Promise.resolve(null as never), background: [], detachResolvers: [] }
      active.set(runId, a)
    }
    return a
  }

  /** 为一次新驱动重置活运行的瞬时句柄,但**保留后台命令登记**(跨 resume/decide 不丢,避免孤儿)。 */
  function freshActive(runId: string): Active {
    const a = ensureActive(runId)
    a.abort = new AbortController()
    a.paused = false
    a.advance = undefined
    a.detachResolvers = []
    a.driving = true
    return a
  }

  /**
   * 登记一个后台活进程:挂监听——自然退出(非暂停挂起)则摘掉记录;暂停杀掉则保留记录待恢复。
   * 若记录带 `timeoutSec`,超时即杀掉该后台进程(后台是旁路,不抛运行级决策)。
   */
  function registerBackground(
    bp: RunBreakpoint,
    a: Active,
    rec: { bgId: string; nodeId: string; label: string; timeoutSec?: number },
    killHandle: () => void,
    runP: Promise<unknown>
  ): void {
    a.background.push({ bgId: rec.bgId, nodeId: rec.nodeId, label: rec.label, kill: killHandle })
    emit({ kind: 'background', runId: bp.runId, nodeId: rec.nodeId, bgId: rec.bgId, label: rec.label, status: 'started' })
    let timedOut = false
    const timer =
      rec.timeoutSec && rec.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true
            killHandle()
          }, rec.timeoutSec * 1000)
        : null
    void runP.then(() => {
      if (timer) clearTimeout(timer)
      const i = a.background.findIndex((b) => b.bgId === rec.bgId)
      if (i >= 0) a.background.splice(i, 1)
      // i<0 表示该进程已被 killBackgroundOf/stopBackground **显式移除并发过 stopped 事件**——此处进程真死的回调
      // MUST NOT 再补发一个 exited 终态事件(否则渲染层在条目已清后又收到迟到终态,把它复活 → 「消失→又出现」)。
      if (!a.paused && i >= 0) {
        // 自然退出/超时被杀(非暂停挂起、非显式中止):从**当前持久化断点**摘掉该后台记录并保存——
        // 绝不回写捕获的 `bp`(它可能已过期:主流程或已推进到更后的节点),否则会把断点覆盖回旧节点。
        const cur = deps.store.load(bp.runId)
        if (cur?.background) {
          cur.background = cur.background.filter((r) => r.bgId !== rec.bgId)
          deps.store.save(cur)
        }
        emit({
          kind: 'background',
          runId: bp.runId,
          nodeId: rec.nodeId,
          bgId: rec.bgId,
          label: rec.label,
          status: timedOut ? 'timeout' : 'exited'
        })
      }
    })
  }

  /** 按记录重新拉起一个后台命令(暂停恢复 / 关软件重开用);超时按记录重新计时。 */
  function startBackground(
    bp: RunBreakpoint,
    a: Active,
    rec: { bgId: string; nodeId: string; label: string; command: string; timeoutSec?: number }
  ): void {
    let killHandle: () => void = () => {}
    const runP = runCmd(rec.command, {
      cwd: cwdOf(bp),
      onChunk: (stream, chunk) =>
        emit({ kind: 'op-chunk', runId: bp.runId, nodeId: rec.nodeId, stream, chunk, bgId: rec.bgId }),
      onStart: (h) => {
        killHandle = h.kill
      }
    })
    registerBackground(bp, a, rec, () => killHandle(), runP)
  }

  /** 确保 bp 里每条后台记录都有活进程:缺的拉起(避免重复拉起已活的)。 */
  function ensureBackgroundRunning(bp: RunBreakpoint, a: Active): void {
    for (const rec of bp.background ?? []) {
      if (!a.background.some((b) => b.bgId === rec.bgId)) startBackground(bp, a, rec)
    }
  }

  /** 暂停:杀掉全部后台活进程,但**保留可重启记录**(恢复时据此重启)。 */
  function suspendBackground(a: Active): void {
    for (const bg of a.background.splice(0)) bg.kill()
  }

  /** 终局:杀掉全部后台活进程并**清空记录**(完成/中止不再重启)。 */
  function killBackgroundOf(runId: string, bp: RunBreakpoint, a: Active): void {
    const killed = a.background.splice(0)
    for (const bg of killed) bg.kill()
    // 先清空并**持久化**记录、再发 stopped 事件:否则 stopped 事件触发的 getRunState 会读到「记录仍在」的旧断点,
    // 渲染层据此把已终止的后台命令又回灌为运行中 → 已完成时窗口「消失→又出现→再消失」的闪烁。
    bp.background = []
    deps.store.save(bp)
    for (const bg of killed) {
      emit({ kind: 'background', runId, nodeId: bg.nodeId, bgId: bg.bgId, label: bg.label, status: 'stopped' })
    }
  }

  /** 命令工作目录:worktree 目录真存在则用它(work 发生处),否则回落主仓。 */
  function cwdOf(bp: RunBreakpoint): string {
    const wt = bp.request.worktreePath
    return wt && existsSync(wt) ? wt : bp.request.repoPath
  }

  /**
   * 跑一条命令:合并「暂停/中止取消」与「超时取消」,流式发 op-chunk。`allowDetach` 时支持「转后台」——
   * 把命令的杀句柄移入后台登记、提前返回 detached,命令继续在后台跑(流式不断,最终自然退出从登记移除)。
   */
  async function execCmd(
    bp: RunBreakpoint,
    nodeId: string,
    command: string,
    a: Active,
    opts: { timeoutSec?: number; allowDetach?: boolean; label?: string; cmdIndex?: number; siblingAbort?: AbortSignal } = {}
  ): Promise<CommandResult & { timedOut: boolean; detached: boolean }> {
    const cwd = cwdOf(bp)
    const ctrl = new AbortController()
    const onPause = (): void => ctrl.abort()
    if (a.abort.signal.aborted) ctrl.abort()
    else a.abort.signal.addEventListener('abort', onPause, { once: true })
    // 同节点兄弟命令失败时的连带取消(收掉本节点其余仍在跑的命令)。
    const onSibling = (): void => ctrl.abort()
    if (opts.siblingAbort) {
      if (opts.siblingAbort.aborted) ctrl.abort()
      else opts.siblingAbort.addEventListener('abort', onSibling, { once: true })
    }
    let timedOut = false
    const timer =
      opts.timeoutSec && opts.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true
            ctrl.abort()
          }, opts.timeoutSec * 1000)
        : null
    let killHandle: () => void = () => {}
    // 转后台后,该命令的后续输出改挂到 bg 桶(bgId 在 detach 时赋值),使后台命令输出视图能收到其输出。
    let detachedBgId: string | undefined
    // 前台桶键:多命令节点各命令一桶(node:<id>:<i>),单命令/无序号退化为 node:<id>。
    const fgBucket = opts.cmdIndex !== undefined ? `node:${nodeId}:${opts.cmdIndex}` : `node:${nodeId}`
    const runP = runCmd(command, {
      cwd,
      signal: ctrl.signal,
      onChunk: (stream, chunk) =>
        emit({ kind: 'op-chunk', runId: bp.runId, nodeId, stream, chunk, bgId: detachedBgId, cmdIndex: detachedBgId ? undefined : opts.cmdIndex }),
      onStart: (h) => {
        killHandle = h.kill
      }
    })

    // 本次调用的 detach 触发器登记进 a.detachResolvers(节点级 detach 广播到全部在跑命令)。
    let detachResolve: (() => void) | undefined
    const removeResolver = (): void => {
      if (!detachResolve) return
      const i = a.detachResolvers.indexOf(detachResolve)
      if (i >= 0) a.detachResolvers.splice(i, 1)
      detachResolve = undefined
    }
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      a.abort.signal.removeEventListener('abort', onPause)
      if (opts.siblingAbort) opts.siblingAbort.removeEventListener('abort', onSibling)
      removeResolver()
    }

    if (opts.allowDetach) {
      const detachP = new Promise<'detach'>((resolve) => {
        detachResolve = () => resolve('detach')
        a.detachResolvers.push(detachResolve)
      })
      const winner = await Promise.race([runP.then(() => 'done' as const), detachP])
      if (winner === 'detach') {
        // 转后台:不杀、认领已在跑的进程(记入可重启记录 + 活句柄),命令继续跑(流式不断)。
        // 节点超时跟随到后台:cleanup 清掉前台 timer,改由 registerBackground 据 timeoutSec 重新计时。
        const rec = {
          bgId: `bg-${bgCounter++}`,
          nodeId,
          label: opts.label ?? command,
          command,
          ...(opts.timeoutSec ? { timeoutSec: opts.timeoutSec } : {})
        }
        detachedBgId = rec.bgId // 此后该命令输出进 bg 桶
        // 把转后台前该命令已产出的前台输出并入 bg 桶,使后台输出视图看到从头到尾的完整输出(而非只有转后台之后)。
        const carried = outputBuffer.read(bp.runId, fgBucket)
        if (carried) outputBuffer.append(bp.runId, `bg:${rec.bgId}`, carried)
        ;(bp.background ??= []).push(rec)
        deps.store.save(bp)
        cleanup()
        registerBackground(bp, a, rec, killHandle, runP)
        return { code: 0, stdout: '', stderr: '', killed: false, timedOut: false, detached: true }
      }
    }

    const r = await runP
    cleanup()
    return { ...r, timedOut, detached: false }
  }

  /** 对单个成员仓跑一次引擎操作,返回 ensure 结果。 */
  async function runEngineOpForMember(
    bp: RunBreakpoint,
    node: WorkflowNode,
    md: MemberDerived,
    t: { force?: boolean; pullFirst?: boolean },
    a: Active
  ): Promise<EnsureResult> {
    const d = bp.request
    const ctx = makeContext(md.repoPath, d.remote ?? 'origin')
    const { branch, baseBranch: base, worktreePath: wt } = md
    const links = d.links ?? []
    const op = node.executor.kind === 'engine' ? node.executor.operation : ''
    const all = nodesOf(bp)
    switch (op) {
      case 'create-branch':
        return ensureBranch(ctx, branch, base)
      case 'open-worktree':
        return ensureWorktree(ctx, wt, branch)
      case 'link-env':
        return ensureJunction(wt, links)
      case 'merge-branch': {
        const r = await ensureMerged(ctx, branch, base)
        if (r.outcome !== 'conflict') return r
        // 冲突：先在卡自己分支上 heal（把主线并进卡分支解冲突）；解决后再跑一遍 ensureMerged 即干净快进。
        const outcome = await healMergeMember(bp, node, md, a)
        if (outcome === 'parked') return { done: false, outcome: 'heal-parked', detail: '' }
        if (outcome === 'resolved') return ensureMerged(ctx, branch, base)
        // 超限/不可 heal → 回落人工；把「AI 试了几次、最后为何失败」并入 detail 供决策 reason 展示。
        const hr = bp.healRuns?.[`${node.id}:${md.memberId}`]
        const summary = hr?.attempts
          ? `\n\n——\nAI 已自动尝试解决 ${hr.attempts} 次仍未成功。最后一次失败原因：\n${hr.lastFailure ?? '(无详情)'}`
          : prepareHealAgent
            ? ''
            : '\n\n——\n未配置可用的 AI（默认 agent），无法自动解决，请手动处理。'
        return { ...r, detail: `${r.detail}${summary}` }
      }
      case 'push-branch': {
        const myIdx = all.findIndex((n) => n.id === node.id)
        const mergeIdx = all.findIndex(
          (n) => n.executor.kind === 'engine' && n.executor.operation === 'merge-branch'
        )
        const target = mergeIdx >= 0 && mergeIdx < myIdx ? base : branch
        // skip-if-empty:推一个区别于 base 的 feature 分支时,若其相对自身 base 无新提交
        // (未被改动的成员仓),跳过以免建垃圾远端分支(多仓默认全建场景)。推 base 本身或
        // branch===base(推主线)不跳。
        if (target === branch && branch !== base) {
          const count = makeGitRunner(md.repoPath)(['rev-list', '--count', `${base}..${branch}`])
          if (count !== null && count.trim() === '0') return { done: true, outcome: 'noop', detail: '' }
        }
        return ensurePushed(ctx, target, { force: t.force, pullFirst: t.pullFirst })
      }
      case 'remove-worktree':
        return ensureNoWorktree(ctx, wt, { force: t.force })
      case 'delete-branch':
        return ensureNoBranch(ctx, branch, { force: t.force })
      case 'delete-remote-branch':
        return ensureNoRemoteBranch(ctx, branch)
      case 'delete-branch-worktree': {
        const aRes = await ensureNoWorktree(ctx, wt, { force: t.force })
        return aRes.done ? ensureNoBranch(ctx, branch, { force: t.force }) : aRes
      }
      default:
        return { done: false, outcome: 'error', detail: `未知引擎操作:${op}` }
    }
  }

  /**
   * 运行某节点 executing 阶段的引擎(git)操作:按节点 target 解析成员子集,对每个成员各跑一遍;
   * 各成员独立(某成员失败不阻断其余探测),整节点等子集全收敛后聚合——任一未达即返回首个失败
   * (detail 带成员标注,供决策可见),全达则成功(全 noop 报 noop)。见 repo-targeting / engine-execution。
   */
  async function runEngineOp(bp: RunBreakpoint, node: WorkflowNode, a: Active): Promise<EnsureResult> {
    const t = transient.get(bp.runId) ?? {}
    const derivedMembers = bp.members ?? deriveMembers(bp.request)
    const memberIds = resolveTargetMembers(bp, node)
    const results: Array<{ id: string; res: EnsureResult }> = []
    for (const id of memberIds) {
      const md = derivedMembers[id]
      if (!md) {
        results.push({ id, res: { done: false, outcome: 'error', detail: `未派生成员上下文:${id}` } })
        continue
      }
      const res = await runEngineOpForMember(bp, node, md, t, a)
      // heal 逐仓解冲突时可能抛出 agent 决策或被暂停：运行已进入停点，停止扇出、上报 parked。
      if (res.outcome === 'heal-parked') {
        transient.delete(bp.runId)
        return { done: false, outcome: 'heal-parked', detail: '' }
      }
      results.push({ id, res })
      emit({
        kind: 'op-output',
        runId: bp.runId,
        nodeId: node.id,
        outcome: res.outcome,
        detail: memberIds.length > 1 ? `[${id}] ${res.detail}` : res.detail
      })
    }
    transient.delete(bp.runId)
    const failed = results.find((r) => !r.res.done)
    if (failed) {
      const tag = memberIds.length > 1 ? `[${failed.id}] ` : ''
      return { done: false, outcome: failed.res.outcome, detail: `${tag}${failed.res.detail}` }
    }
    const allNoop = results.length > 0 && results.every((r) => r.res.outcome === 'noop')
    return { done: true, outcome: allNoop ? 'noop' : 'success', detail: '' }
  }

  /**
   * 运行 command 节点的 executing(前置检查 + 主命令 + 超时 + 手动推进)。返回处置:
   * `done`=自然成功(进门把);`advance`=手动推进(中止或转后台,跳过剩余门把);`paused`;`decided`。
   */
  async function runCommandNode(
    bp: RunBreakpoint,
    node: WorkflowNode,
    a: Active
  ): Promise<'done' | 'advance' | 'paused' | 'decided'> {
    if (node.executor.kind !== 'command') return 'done'
    const specs = node.executor.commands
    // 本节点级连带取消:某条命令失败即杀其余仍在跑的命令。
    const nodeAbort = new AbortController()
    type Fail = { spec: CommandSpec; r: CommandResult & { timedOut: boolean } }
    const failedRef: { cur: Fail | null } = { cur: null }
    const setFailure = (f: Fail): void => {
      if (!failedRef.cur) {
        failedRef.cur = f
        nodeAbort.abort()
      }
    }
    const laneLabel = (spec: CommandSpec): string =>
      spec.label ?? (specs.length > 1 ? spec.command : nodeLabel(node))

    // 一条命令的一生:前置检查 → 主命令。返回处置。
    const runLane = async (
      spec: CommandSpec,
      i: number
    ): Promise<'ok' | 'advance' | 'paused' | 'failed' | 'sibling'> => {
      if (spec.check) {
        const cc = await execCmd(bp, node.id, spec.check, a, { cmdIndex: i, siblingAbort: nodeAbort.signal })
        if (cc.killed && a.advance) return 'advance'
        if (cc.killed && a.paused && !cc.timedOut) return 'paused'
        if (cc.killed && failedRef.cur) return 'sibling'
        if (cc.code === 0) {
          emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: 'noop', detail: '前置检查通过,跳过命令', code: 0 })
          return 'ok'
        }
      }
      const r = await execCmd(bp, node.id, spec.command, a, {
        timeoutSec: spec.timeoutSec,
        allowDetach: true,
        label: laneLabel(spec),
        cmdIndex: i,
        siblingAbort: nodeAbort.signal
      })
      if (r.detached) return 'advance'
      if (r.killed && a.advance === 'abort') return 'advance'
      if (r.killed && a.paused && !r.timedOut) return 'paused'
      if (r.killed && failedRef.cur) return 'sibling' // 被兄弟命令失败连带杀掉
      if (r.code === 0 && !r.timedOut) return 'ok'
      setFailure({ spec, r })
      return 'failed'
    }

    const results = await Promise.all(specs.map((spec, i) => runLane(spec, i)))

    // 聚合处置:手动推进 > 暂停 > 失败 > 成功。
    if (a.advance) return 'advance'
    if (results.some((x) => x === 'paused')) return 'paused'
    if (failedRef.cur) {
      const { spec, r } = failedRef.cur
      emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: r.timedOut ? 'timeout' : 'command-failed', detail: r.stderr || r.stdout, code: r.code })
      if (r.timedOut) {
        // 超时不 heal（可能死循环/慢机）：直接人工。
        raiseDecision(bp, buildCommandTimeoutDecision(node.id, spec.command, spec.timeoutSec ?? 0, `${r.stdout}\n${r.stderr}`.trim()))
        return 'decided'
      }
      // 命令没过（非零退出）→ 先 heal：改代码 → 引擎提交 → 重跑该命令验证；超限回落人工。
      const failIdx = specs.indexOf(spec)
      const healed = await healCommand(bp, node, a, {
        command: spec.command,
        output: `${r.stdout}\n${r.stderr}`.trim(),
        verify: async () => {
          const v = await execCmd(bp, node.id, spec.command, a, { cmdIndex: failIdx >= 0 ? failIdx : undefined })
          return v.code === 0 && !v.timedOut && !v.killed
        }
      })
      if (healed === 'resolved') return 'done'
      if (healed === 'parked') return 'decided'
      // 回落人工：把「AI 试了几次、最后为何失败」并入原因供决策展示。
      const chr = bp.healRuns?.[node.id]
      const cmdSummary = chr?.attempts
        ? `\n\n——\nAI 已自动尝试修复 ${chr.attempts} 次仍未通过。最后一次失败原因：\n${chr.lastFailure ?? '(无详情)'}`
        : ''
      raiseDecision(bp, buildCommandFailedDecision(node.id, spec.command, r.code, `${r.stderr || r.stdout}${cmdSummary}`))
      return 'decided'
    }
    emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: 'success', detail: '', code: 0 })
    return 'done'
  }

  /**
   * 运行 agent 节点的 executing 阶段（里程碑 A：单仓；多仓 extraDirs 留阶段 B）。一个 agent 承担本节点：
   * 全新拉起 或 续接（自愈计数>0 时按阶梯 resume/自存重建），流式回显，退出读握手分流：
   * `done`→成功（进越界检测/门把）；`need-decision`→抛 `sourceKind='agent'` 决策；`failed`→限次自愈续接，超限抛决策。
   * 返回：`done`（进门把）/ `decided`（抛决策，park）/ `paused` / `heal`（重跑 executing 续接重做）。
   */
  async function runAgentNode(
    bp: RunBreakpoint,
    node: WorkflowNode,
    a: Active
  ): Promise<'done' | 'decided' | 'paused' | 'heal'> {
    if (node.executor.kind !== 'agent' || !prepareAgent) return 'done'
    const derivedAll = bp.members ?? deriveMembers(bp.request)
    const targetIds = resolveTargetMembers(bp, node)
    const primary = targetIds[0] ?? Object.keys(derivedAll)[0]
    // 握手绝对路径：userData 下按 runId/nodeId 组织，在 worktree 之外（不污染 git、不被误提交）。
    const hsDir = join(handshakeDir, bp.runId)
    try {
      mkdirSync(hsDir, { recursive: true })
    } catch {
      /* 目录已存在/无权，忽略 */
    }
    const handshakePath = join(hsDir, `${node.id}.json`)
    const targetRepos = targetIds
      .map((id) => ({ memberId: id, path: derivedAll[id]?.worktreePath ?? '', primary: id === primary }))
      .filter((r) => r.path)
    const prep = prepareAgent(node, bp, { handshakePath, targetRepos })
    if (!prep) {
      // agent 不可用（未装/无法拼 prompt）→ 技术失败，抛前进式决策
      raiseDecision(bp, buildFailureDecision(node.id, nodeLabel(node), 'agent', 'unavailable', 'agent 执行器不可用'))
      return 'decided'
    }
    const derived = derivedAll
    const memberIds = targetIds
    const primaryId = primary
    const md = derived[primaryId]
    const wt = md && existsSync(md.worktreePath) ? md.worktreePath : cwdOf(bp)

    const nodeRun = ((bp.agentRuns ??= {})[node.id] ??= {})
    nodeRun.prompt = prep.prompt // 观测：记录喂给该 agent 的完整 prompt（随断点持久化、供输出框展示核对）
    const attempts = nodeRun.attempts ?? 0
    // 进入本调用前就已记过基线 = 该节点此前已开始 → 这是崩溃/关软件后的恢复，须**续接**（接盘上会话）而非从头。
    const resumedMidRun = !!(nodeRun.startSha && memberIds.some((id) => nodeRun.startSha![id]))

    // 越界基线：节点起始时记每目标仓 HEAD SHA（一次性，跨自愈重试沿用，不重置——保证撤销撤到节点起点）。
    nodeRun.startSha ??= {}
    for (const id of memberIds) {
      if (nodeRun.startSha[id]) continue
      const mwt = derived[id] && existsSync(derived[id].worktreePath) ? derived[id].worktreePath : bp.request.repoPath
      const sha = makeGitRunner(mwt)(['rev-parse', 'HEAD'])
      if (sha) nodeRun.startSha[id] = sha
    }
    deps.store.save(bp) // 落基线，使拉起后崩溃也能据 startSha 判为「已开始」→ 恢复走续接

    // 一个 agent 跨仓：主目标仓作 cwd，其余目标仓 worktree 作 extraDirs；再加握手目录（让 agent 能写握手到 C 盘）。
    const extraDirs = [
      ...memberIds
        .filter((id) => id !== primaryId)
        .map((id) => derived[id]?.worktreePath)
        .filter((p): p is string => !!p && existsSync(p)),
      hsDir
    ]
    const spec: AgentRunSpec = {
      toolId: prep.toolId,
      cwd: wt,
      extraDirs,
      model: prep.model,
      extraArgs: prep.extraArgs,
      signal: a.abort.signal,
      // 续接用具体 session id；抓到 id 即存断点（供下次 --resume 精确续接、支持暂停A/暂停B/恢复A）
      sessionId: nodeRun.session,
      onSession: (id) => {
        nodeRun.session = id
        deps.store.save(bp)
      },
      onChunk: (stream, chunk) => emit({ kind: 'op-chunk', runId: bp.runId, nodeId: node.id, stream, chunk })
    }

    // 续接（自愈失败详情 / 用户决策答复 / 修复前向回退 / 崩溃恢复）走阶梯；否则全新起
    let launch: AgentLaunch | null
    const answer = nodeRun.pendingAnswer
    nodeRun.pendingAnswer = undefined // 一次性，消费即清
    const forwardFix = nodeRun.forwardFix
    nodeRun.forwardFix = undefined // 一次性，消费即清
    if (nodeRun.lastFailure || answer || forwardFix || resumedMidRun) {
      const delta = buildContinuationDelta({ failure: nodeRun.lastFailure, decisionAnswer: answer, forwardFix })
      // 全新起兜底的 rebuildPrompt：完整任务 + 喂回已记录的执行历史（readable transcript）+ delta。
      const transcript = outputBuffer.read(bp.runId, `node:${node.id}`)
      const historyBlock = transcript.trim()
        ? `\n\n# 你之前的执行记录（供参考，worktree 里已有对应改动，别重复已完成的）\n${transcript.slice(-8000)}`
        : ''
      launch = launchContinuation(runAgent, spec, {
        inject: delta,
        rebuildPrompt: `${prep.prompt}${historyBlock}\n\n${delta}`
      })
    } else {
      launch = runAgent.start({ ...spec, prompt: prep.prompt })
    }
    if (!launch) {
      raiseDecision(bp, buildFailureDecision(node.id, nodeLabel(node), 'agent', 'unavailable', `外壳 ${prep.toolId} 不可用`))
      return 'decided'
    }

    const result = await launch.done
    if (result.killed && a.paused) return 'paused'

    const hs = readHandshake(handshakePath)
    emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: hs.status, detail: hs.note ?? hs.detail ?? '' })

    // {repos} 填充（供下游 fromUpstream；与本卡涉及成员取交）
    if (hs.repos && hs.repos.length) {
      const all = membersOf(bp.request).map((m) => m.memberId)
      ;(bp.upstreamOutputs ??= {})[node.id] = { repos: hs.repos.filter((r) => all.includes(r)) }
    }

    if (hs.status === 'need-decision') {
      raiseDecision(bp, buildAgentDecision(node.id, nodeLabel(node), hs))
      return 'decided'
    }
    if (hs.status === 'failed') {
      nodeRun.lastFailure = hs.detail || '(agent 报告失败，未给详情)'
      if (attempts < MAX_AGENT_HEAL) {
        nodeRun.attempts = attempts + 1
        deps.store.save(bp)
        emit({ kind: 'gate-retry', runId: bp.runId, nodeId: node.id, gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: nodeRun.attempts })
        return 'heal'
      }
      raiseDecision(
        bp,
        buildAgentDecision(node.id, nodeLabel(node), {
          status: 'need-decision',
          decision: { title: `AI 多次未能完成：${nodeRun.lastFailure}`, freeInput: true }
        })
      )
      return 'decided'
    }
    // done：越界后置检测 + 每节点提交（按每个目标仓各自成立；无 git 基线则跳过检测）
    const waivedKey = `${bp.runId}:${node.id}`
    const waived = scopeWaived.has(waivedKey)
    const outputPaths = (node.outputs ?? []).map((o) => o.destination.path).filter((p) => !!p)
    const overreach: string[] = []
    for (const id of memberIds) {
      const startSha = nodeRun.startSha?.[id]
      if (!startSha) continue
      const mwt = derived[id] && existsSync(derived[id].worktreePath) ? derived[id].worktreePath : bp.request.repoPath
      const res = await scopeGuard({
        worktree: mwt,
        read: makeGitRunner(mwt),
        write: makeAsyncGitRunner(mwt),
        startSha,
        writableScope: waived ? [] : node.writableScope ?? [],
        outputPaths,
        message: `klarit: ${nodeLabel(node)}`
      })
      if (res.commitSha) (nodeRun.commitSha ??= {})[id] = res.commitSha
      overreach.push(...res.outOfScope.map((f) => (memberIds.length > 1 ? `[${id}] ${f}` : f)))
    }
    if (overreach.length > 0 && !waived) {
      // 越界：已还原，带详情喂回自愈重做；超限抛决策（含「放宽可写范围」）
      nodeRun.lastFailure = `改动了可写范围外的文件（已还原）：\n${overreach.join('\n')}\n请只在可写范围内改动。`
      if (attempts < MAX_AGENT_HEAL) {
        nodeRun.attempts = attempts + 1
        deps.store.save(bp)
        emit({ kind: 'gate-retry', runId: bp.runId, nodeId: node.id, gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: nodeRun.attempts })
        return 'heal'
      }
      raiseDecision(bp, buildScopeDecision(node.id, nodeLabel(node), overreach))
      return 'decided'
    }
    // 干净（或已豁免）：清豁免与自愈计数
    scopeWaived.delete(waivedKey)
    nodeRun.attempts = 0
    nodeRun.lastFailure = undefined
    return 'done'
  }

  /** trim + 去空行地把 git 输出切成行。 */
  function gitLines(s: string | null): string[] {
    return (s ?? '').split('\n').map((x) => x.trim()).filter((x) => x !== '')
  }

  /**
   * 拉起一个临时 heal / 处置 agent（读写、cwd=卡工作区），复用 adapter/握手/续接：首轮全新起，
   * 有 session/上次失败/待注入答复则走续接阶梯。记 `hr.prompt`（观测）。返回握手 status（或 paused/nolaunch）。
   */
  async function spawnHealAgent(
    bp: RunBreakpoint,
    nodeId: string,
    hr: NonNullable<RunBreakpoint['healRuns']>[string],
    prep: AgentPrep,
    cwd: string,
    hsDir: string,
    hsFile: string,
    a: Active
  ): Promise<{ status: AgentHandshake['status'] | 'nolaunch' | 'paused'; hs?: AgentHandshake }> {
    hr.prompt = prep.prompt // 观测：记录喂给该 heal agent 的完整 prompt
    deps.store.save(bp)
    const spec: AgentRunSpec = {
      toolId: prep.toolId,
      cwd,
      extraDirs: [hsDir],
      model: prep.model,
      extraArgs: prep.extraArgs,
      signal: a.abort.signal,
      sessionId: hr.session,
      onSession: (id) => {
        hr.session = id
        deps.store.save(bp)
      },
      onChunk: (stream, chunk) => emit({ kind: 'op-chunk', runId: bp.runId, nodeId, stream, chunk })
    }
    const answer = hr.pendingAnswer
    hr.pendingAnswer = undefined
    let launch: AgentLaunch | null
    if (hr.session || hr.lastFailure || answer) {
      const delta = buildContinuationDelta({ failure: hr.lastFailure, decisionAnswer: answer })
      launch = launchContinuation(runAgent, spec, { inject: delta, rebuildPrompt: `${prep.prompt}\n\n${delta}` })
    } else {
      launch = runAgent.start({ ...spec, prompt: prep.prompt })
    }
    if (!launch) return { status: 'nolaunch' }
    const result = await launch.done
    if (result.killed && a.paused) return { status: 'paused' }
    const hs = readHandshake(hsFile)
    emit({ kind: 'op-output', runId: bp.runId, nodeId, outcome: `heal:${hs.status}`, detail: hs.note ?? hs.detail ?? '' })
    return { status: hs.status, hs }
  }

  /** heal agent 提问 → sourceKind='agent' 决策落单卡，`source` 标记 `heal:<key>:agent-ask` 供 decide 注入回该 heal。 */
  function raiseHealAgentDecision(bp: RunBreakpoint, node: WorkflowNode, key: string, hs: AgentHandshake): void {
    const dec = buildAgentDecision(node.id, nodeLabel(node), hs)
    dec.source = `heal:${key}:agent-ask`
    raiseDecision(bp, dec)
    deps.store.save(bp)
  }

  /**
   * 合并冲突 heal（在**卡自己分支**上解）：卡工作区里把主线并进卡分支（保留冲突态）→ 拉 heal agent 解冲突
   * → 校验无残留冲突标记 → `scopeGuard` 确定性提交（成合并提交）→ 收敛。限次、逐仓、计数持久化。
   * 返回 `resolved`（已解决，主流程再跑一遍 ensureMerged 即干净快进）/ `unresolved`（超限/不可 heal，回落人工）/
   * `parked`（heal agent 提问或暂停，运行已进入停点）。
   */
  async function healMergeMember(
    bp: RunBreakpoint,
    node: WorkflowNode,
    md: MemberDerived,
    a: Active
  ): Promise<'resolved' | 'unresolved' | 'parked'> {
    const key = `${node.id}:${md.memberId}`
    const hr = ((bp.healRuns ??= {})[key] ??= {})
    const wt = existsSync(md.worktreePath) ? md.worktreePath : md.repoPath
    const wrun = makeAsyncGitRunner(wt)
    const wread = makeGitRunner(wt)
    hr.startSha ??= {}
    if (!hr.startSha[md.memberId]) {
      const s = wread(['rev-parse', 'HEAD'])
      if (s) hr.startSha[md.memberId] = s
    }
    const startSha = hr.startSha[md.memberId] ?? 'HEAD'
    const hsDir = join(handshakeDir, bp.runId)
    try {
      mkdirSync(hsDir, { recursive: true })
    } catch {
      /* 已存在/无权，忽略 */
    }
    const hsFile = join(hsDir, `${node.id}-heal-${md.memberId}.json`)

    while ((hr.attempts ?? 0) < MAX_HEAL) {
      if (a.paused) return 'parked'
      // 清残留在途合并，再以「保留冲突态」把主线并进卡分支（冲突显现在卡这边、主线全程不动）。
      await wrun(['merge', '--abort']).catch(() => {})
      const mr = await mergeBranch(wrun, md.baseBranch, { leaveConflict: true })
      if (mr.outcome === 'noop' || mr.outcome === 'success') {
        hr.attempts = 0
        hr.lastFailure = undefined
        return 'resolved'
      }
      if (mr.outcome !== 'conflict' || !prepareHealAgent) {
        await wrun(['merge', '--abort']).catch(() => {})
        return 'unresolved'
      }
      const conflictFiles = gitLines(wread(['diff', '--name-only', '--diff-filter=U']))
      const prep = prepareHealAgent(bp, {
        kind: 'merge-conflict',
        handshakePath: hsFile,
        repo: { memberId: md.memberId, path: wt },
        branch: md.branch,
        base: md.baseBranch,
        conflictFiles
      })
      if (!prep) {
        await wrun(['merge', '--abort']).catch(() => {})
        return 'unresolved'
      }
      const res = await spawnHealAgent(bp, node.id, hr, prep, wt, hsDir, hsFile, a)
      if (res.status === 'paused') return 'parked'
      if (res.status === 'need-decision') {
        raiseHealAgentDecision(bp, node, key, res.hs!)
        return 'parked'
      }
      // 校验：所有冲突文件都无残留冲突标记 → 引擎暂存已解决文件并确定性提交（MERGE_HEAD 在故成合并提交）。
      const unmergedPaths = Array.from(
        new Set(gitLines(wread(['ls-files', '-u'])).map((l) => l.split('\t').pop()?.trim() ?? '').filter(Boolean))
      )
      const stillMarked = unmergedPaths.some((f) => {
        try {
          const c = readFileSync(join(wt, f), 'utf8')
          return /^<{7}/m.test(c) || /^>{7}/m.test(c) || /^={7}$/m.test(c)
        } catch {
          return false
        }
      })
      if (!stillMarked) {
        if (unmergedPaths.length) await wrun(['add', '--', ...unmergedPaths])
        await scopeGuard({
          worktree: wt,
          read: wread,
          write: wrun,
          startSha,
          writableScope: [],
          outputPaths: [],
          message: `klarit: 解决合并冲突 ${md.branch} → ${md.baseBranch}`
        })
        hr.attempts = 0
        hr.lastFailure = undefined
        deps.store.save(bp)
        return 'resolved'
      }
      // 未解决：记失败 + 增计数（持久化）+ abort 复位，续接重试或超限。
      // 失败原因优先取 agent 握手 detail；否则取 agent 最近输出尾部（能暴露 API 报错/连接失败等真因）。
      const agentTail = outputBuffer.read(bp.runId, `node:${node.id}`).trim().slice(-400)
      hr.lastFailure =
        res.hs?.detail ||
        (agentTail ? `AI 未能解决冲突（可能运行出错）。它的最近输出：\n${agentTail}` : '工作区仍有未解决的冲突标记。')
      hr.attempts = (hr.attempts ?? 0) + 1
      await wrun(['merge', '--abort']).catch(() => {})
      deps.store.save(bp)
      emit({ kind: 'gate-retry', runId: bp.runId, nodeId: node.id, gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: hr.attempts })
    }
    // 超限：确保工作区干净（复位卡分支），回落人工。
    await wrun(['merge', '--abort']).catch(() => {})
    return 'unresolved'
  }

  /**
   * 命令 heal（命令主命令失败 / 命令节点客观门失败）：在节点工作区拉 heal agent 改代码 → 引擎提交 →
   * `verify()` 重跑该命令/门验证。限次、计数持久化。返回 resolved / unresolved（超限回落人工）/ parked。
   * `dispositionInput` 有值时为「决策自由输入」触发的处置（kind=disposition），否则为自动 command-failure heal。
   */
  async function healCommand(
    bp: RunBreakpoint,
    node: WorkflowNode,
    a: Active,
    opts: { command: string; output: string; verify: () => Promise<boolean>; dispositionInput?: string; background?: string }
  ): Promise<'resolved' | 'unresolved' | 'parked'> {
    const key = node.id
    const hr = ((bp.healRuns ??= {})[key] ??= {})
    const wt = cwdOf(bp)
    const wrun = makeAsyncGitRunner(wt)
    const wread = makeGitRunner(wt)
    hr.startSha ??= {}
    if (!hr.startSha['<cmd>']) {
      const s = wread(['rev-parse', 'HEAD'])
      if (s) hr.startSha['<cmd>'] = s
    }
    const startSha = hr.startSha['<cmd>'] ?? 'HEAD'
    const hsDir = join(handshakeDir, bp.runId)
    try {
      mkdirSync(hsDir, { recursive: true })
    } catch {
      /* 忽略 */
    }
    const hsFile = join(hsDir, `${node.id}-heal.json`)
    const memberId = membersOf(bp.request)[0]?.memberId ?? SINGLE_MEMBER
    const branch = bp.request.branch ?? ''
    const base = bp.request.baseBranch ?? ''
    while ((hr.attempts ?? 0) < MAX_HEAL) {
      if (a.paused) return 'parked'
      if (!prepareHealAgent) return 'unresolved'
      const prep = prepareHealAgent(bp, {
        kind: opts.dispositionInput !== undefined ? 'disposition' : 'command-failure',
        handshakePath: hsFile,
        repo: { memberId, path: wt },
        branch,
        base,
        command: opts.command,
        output: opts.output,
        background: opts.background,
        userInput: opts.dispositionInput
      })
      if (!prep) return 'unresolved'
      const res = await spawnHealAgent(bp, node.id, hr, prep, wt, hsDir, hsFile, a)
      if (res.status === 'paused') return 'parked'
      if (res.status === 'need-decision') {
        raiseHealAgentDecision(bp, node, key, res.hs!)
        return 'parked'
      }
      // 引擎确定性提交范围内改动（整树可写）。
      await scopeGuard({ worktree: wt, read: wread, write: wrun, startSha, writableScope: [], outputPaths: [], message: `klarit: 修复 ${nodeLabel(node)}` })
      if (await opts.verify()) {
        hr.attempts = 0
        hr.lastFailure = undefined
        deps.store.save(bp)
        return 'resolved'
      }
      const cmdAgentTail = outputBuffer.read(bp.runId, `node:${node.id}`).trim().slice(-400)
      hr.lastFailure = cmdAgentTail
        ? `AI 修复后命令仍未通过（AI 可能运行出错）。它的最近输出：\n${cmdAgentTail}`
        : `修复后仍未通过：${opts.command}`
      hr.attempts = (hr.attempts ?? 0) + 1
      deps.store.save(bp)
      emit({ kind: 'gate-retry', runId: bp.runId, nodeId: node.id, gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: hr.attempts })
    }
    return 'unresolved'
  }

  /**
   * 决策自由输入 → 新起读写**处置 agent**（无当前 agent 的 engine/command 决策）：一次性拉起，喂「失败背景 +
   * 用户自由输入」，能改就改（引擎提交），不能改就经握手解释并把建议作为新选项交回。返回 `acted`（已处置，
   * 调用方重跑当前节点）/ `parked`（提问或暂停）/ `unavailable`（无 heal 能力）。
   */
  async function runDispositionAgent(
    bp: RunBreakpoint,
    node: WorkflowNode,
    background: string,
    userInput: string,
    a: Active
  ): Promise<'acted' | 'parked' | 'unavailable'> {
    if (!prepareHealAgent) return 'unavailable'
    const key = `disp:${node.id}`
    const hr = ((bp.healRuns ??= {})[key] ??= {})
    const wt = cwdOf(bp)
    const wrun = makeAsyncGitRunner(wt)
    const wread = makeGitRunner(wt)
    hr.startSha ??= {}
    if (!hr.startSha['<disp>']) {
      const s = wread(['rev-parse', 'HEAD'])
      if (s) hr.startSha['<disp>'] = s
    }
    const startSha = hr.startSha['<disp>'] ?? 'HEAD'
    const hsDir = join(handshakeDir, bp.runId)
    try {
      mkdirSync(hsDir, { recursive: true })
    } catch {
      /* 忽略 */
    }
    const hsFile = join(hsDir, `${node.id}-disp.json`)
    const memberId = membersOf(bp.request)[0]?.memberId ?? SINGLE_MEMBER
    const prep = prepareHealAgent(bp, {
      kind: 'disposition',
      handshakePath: hsFile,
      repo: { memberId, path: wt },
      branch: bp.request.branch ?? '',
      base: bp.request.baseBranch ?? '',
      background,
      userInput
    })
    if (!prep) return 'unavailable'
    const res = await spawnHealAgent(bp, node.id, hr, prep, wt, hsDir, hsFile, a)
    if (res.status === 'paused') {
      bp.state = 'paused'
      return 'parked'
    }
    if (res.status === 'need-decision') {
      raiseHealAgentDecision(bp, node, key, res.hs!)
      return 'parked'
    }
    // 处置提交（若有范围内改动）。
    await scopeGuard({ worktree: wt, read: wread, write: wrun, startSha, writableScope: [], outputPaths: [], message: `klarit: 处置 ${nodeLabel(node)}` })
    return 'acted'
  }

  /** 重新抛出某节点的人工评审门决策（回退取消 / 判定无果时退回评审门，不丢门）。 */
  function raiseManualGate(bp: RunBreakpoint, node: WorkflowNode): void {
    const gate = (node.gate ?? [])[bp.phase.kind === 'gate' ? bp.phase.index : 0]
    const actions = (gate?.kind === 'manual' ? gate.actions ?? [] : []).map((act, i) => ({ label: act.label, index: i }))
    raiseDecision(bp, buildManualGateDecision(node.id, nodeLabel(node), actions, resolveNodeOutputs(bp, node)))
    deps.store.save(bp)
  }

  /** 某成员仓两 SHA 间改动文件名（供 deriveLineage）。 */
  function diffNamesFor(bp: RunBreakpoint, memberId: string, from: string, to: string): string[] {
    const derived = bp.members ?? deriveMembers(bp.request)
    const md = derived[memberId]
    const p = md && existsSync(md.worktreePath) ? md.worktreePath : md?.repoPath ?? bp.request.repoPath
    return gitLines(makeGitRunner(p)(['diff', '--name-only', `${from}..${to}`]))
  }

  /**
   * 人工评审门驳回 → 新起**只读回退判定 agent**（内容驱动回退）：读驳回意见 + 产物溯源上下文，提名回退节点
   * （主选 + 备选）写进握手决策；引擎据此抛**回退确认决策**（复用决策面板）。判定 agent **只读**——不跑
   * scopeGuard、不做每节点提交。判定不可用/无果 → 退回评审门。返回 'parked'（运行进入 waiting-decision 或 paused）。
   */
  async function runRollbackJudge(bp: RunBreakpoint, node: WorkflowNode, feedback: string, a: Active): Promise<'parked'> {
    if (!prepareHealAgent) {
      raiseManualGate(bp, node)
      return 'parked'
    }
    const key = `${node.id}:rollback-judge`
    const hr = ((bp.healRuns ??= {})[key] ??= {})
    const wt = cwdOf(bp)
    const hsDir = join(handshakeDir, bp.runId)
    try {
      mkdirSync(hsDir, { recursive: true })
    } catch {
      /* 忽略 */
    }
    const hsFile = join(hsDir, `${node.id}-rollback.json`)
    const memberId = membersOf(bp.request)[0]?.memberId ?? SINGLE_MEMBER
    const lineage = renderLineage(
      deriveLineage(bp, nodesOf(bp), (m, from, to) => diffNamesFor(bp, m, from, to)),
      (id) => nodeLabel(nodesOf(bp).find((n) => n.id === id) ?? node)
    )
    // 续接重判（用户在确认决策里换说法）时把新意见经续接注入；首轮无 session 走全新起（意见已在 prompt 里）。
    if (hr.session) hr.pendingAnswer = feedback
    const prep = prepareHealAgent(bp, {
      kind: 'rollback-judge',
      handshakePath: hsFile,
      repo: { memberId, path: wt },
      branch: bp.request.branch ?? '',
      base: bp.request.baseBranch ?? '',
      userInput: feedback,
      lineage,
      nodeName: nodeLabel(node)
    })
    if (!prep) {
      raiseManualGate(bp, node)
      return 'parked'
    }
    const res = await spawnHealAgent(bp, node.id, hr, prep, wt, hsDir, hsFile, a)
    if (res.status === 'paused') {
      bp.state = 'paused'
      return 'parked'
    }
    // 只读：不跑 scopeGuard、不提交。判定结论在握手 decision 里。
    const candidates = (res.hs?.decision?.options ?? [])
      .filter((o) => nodesOf(bp).some((n) => n.id === o.id)) // 只认真实存在的节点 id
      .map((o) => ({ nodeId: o.id, nodeName: o.label, reason: o.detail, recommended: o.recommended }))
    if (!candidates.length) {
      // 判定无果（未给候选/给的都不是真实节点）→ 退回评审门让用户再拿捏。
      raiseManualGate(bp, node)
      return 'parked'
    }
    raiseDecision(bp, buildRollbackConfirmDecision(node.id, res.hs?.decision?.title, candidates, feedback))
    deps.store.save(bp)
    return 'parked'
  }

  /**
   * 重入目标节点前向修复（内容驱动回退第三步）：**不 git reset、不撤下游代码**。把当前节点拨回目标节点 K，
   * 为 K 及其下游**重置越界/提交基线**（保留会话续接 token，使各节点续接而非从头），给 K 注入「修复前向」上下文，
   * 再从 K 前向重流回评审门复审。
   */
  function reenterFromRollback(bp: RunBreakpoint, gateNode: WorkflowNode, targetId: string, feedback: string, a: Active): Promise<RunBreakpoint> {
    const nodes = nodesOf(bp)
    const kIdx = nodes.findIndex((n) => n.id === targetId)
    if (kIdx < 0) {
      raiseManualGate(bp, gateNode)
      return Promise.resolve(persist(bp))
    }
    // 为 K..N 重置越界/提交基线（保留 session 以续接、保留 prompt 观测），清各自门重试日志。
    for (let i = kIdx; i < nodes.length; i++) {
      const r = bp.agentRuns?.[nodes[i].id]
      if (r) {
        r.startSha = {}
        r.commitSha = undefined
        r.attempts = 0
        r.lastFailure = undefined
        r.pendingAnswer = undefined
        r.forwardFix = undefined
      }
      if (bp.gateLog) for (const gk of Object.keys(bp.gateLog)) if (gk.startsWith(`${nodes[i].id}:`)) delete bp.gateLog[gk]
    }
    const furthest = bp.furthestNodeId ? nodeLabel(nodes.find((n) => n.id === bp.furthestNodeId) ?? nodes[kIdx]) : undefined
    const tr = ((bp.agentRuns ??= {})[targetId] ??= {})
    tr.forwardFix = { furthestNode: furthest, feedback }
    bp.currentNodeId = targetId
    setPhase(bp, nodes[kIdx], { kind: 'executing' })
    return drive(bp, a)
  }

  /** 把某节点声明的产出解析为「名称 + 主目标仓 worktree 绝对路径」（供人工评审打开）；只列磁盘上已存在的。 */
  function resolveNodeOutputs(bp: RunBreakpoint, node: WorkflowNode): Array<{ name: string; path: string }> {
    const derived = bp.members ?? deriveMembers(bp.request)
    const memberIds = resolveTargetMembers(bp, node)
    const primary = derived[memberIds[0] ?? Object.keys(derived)[0]]
    const wt = primary && existsSync(primary.worktreePath) ? primary.worktreePath : cwdOf(bp)
    const out: Array<{ name: string; path: string }> = []
    for (const o of node.outputs ?? []) {
      const rel = o.destination.path
      if (!rel) continue
      const abs = join(wt, rel)
      if (existsSync(abs)) out.push({ name: basename(rel), path: abs })
    }
    return out
  }

  function setPhase(bp: RunBreakpoint, node: WorkflowNode, phase: NodePhase): void {
    bp.phase = phase
    deps.store.save(bp) // 每个阶段边界持久化,使 getRunState 在长命令执行中也反映真实位置
    emit({ kind: 'phase', runId: bp.runId, nodeId: node.id, phase })
  }

  /** 前向推进到更靠后的节点时更新「最远进展节点」；回退到更早节点不更新（保留）。 */
  function updateFurthest(bp: RunBreakpoint, nodes: WorkflowNode[], nodeId: string): void {
    const i = nodes.findIndex((n) => n.id === nodeId)
    const cur = bp.furthestNodeId ? nodes.findIndex((n) => n.id === bp.furthestNodeId) : -1
    if (i > cur) bp.furthestNodeId = nodeId
  }

  /** 推进到下一节点或收尾。 */
  function advanceNode(bp: RunBreakpoint, nodes: WorkflowNode[], idx: number): void {
    emit({ kind: 'node-exit', runId: bp.runId, nodeId: nodes[idx].id })
    const next = nodes[idx + 1]
    if (!next) {
      bp.currentNodeId = null
      bp.state = 'done'
      return
    }
    bp.currentNodeId = next.id
    bp.phase = { kind: 'executing' }
    updateFurthest(bp, nodes, next.id)
    deps.store.save(bp) // 进节点即持久化,使观察方(getRunState)能看到当前节点
    emit({ kind: 'node-enter', runId: bp.runId, nodeId: next.id })
  }

  /** 主驱动循环:从当前 (节点, 阶段) 推进,直到非 running 状态(park)。 */
  async function drive(bp: RunBreakpoint, a: Active): Promise<RunBreakpoint> {
    const nodes = nodesOf(bp)
    if (!nodes.length) {
      bp.state = 'done'
      return persist(bp)
    }
    if (bp.currentNodeId === null) {
      bp.currentNodeId = nodes[0].id
      bp.phase = { kind: 'executing' }
      updateFurthest(bp, nodes, nodes[0].id)
      deps.store.save(bp)
      emit({ kind: 'node-enter', runId: bp.runId, nodeId: nodes[0].id })
    }
    while (bp.state === 'running') {
      if (a.paused) {
        bp.state = 'paused'
        break
      }
      const idx = nodes.findIndex((n) => n.id === bp.currentNodeId)
      if (idx < 0) {
        bp.state = 'done'
        break
      }
      const node = nodes[idx]
      if (bp.phase.kind === 'executing') {
        if (node.executor.kind === 'command') {
          const r = await runCommandNode(bp, node, a)
          const advance = a.advance
          a.advance = undefined
          if (r === 'paused') {
            bp.state = 'paused'
            break
          }
          if (r === 'decided') break
          retries.delete(`${bp.runId}:${node.id}`)
          if (r === 'advance') {
            // 手动推进(中止/转后台):跳过本节点剩余门把,直达 done → 下一节点。
            emit({ kind: 'skip', runId: bp.runId, nodeId: node.id, reason: advance === 'detach' ? '转后台,进入下一节点' : '中止,进入下一节点' })
            setPhase(bp, node, { kind: 'done' })
          } else {
            // r === 'done':自然成功 → 进门把(或直达 done)。
            const gates = node.gate ?? []
            setPhase(bp, node, gates.length ? { kind: 'gate', index: 0 } : { kind: 'done' })
          }
        } else if (node.executor.kind === 'engine') {
          const res = await runEngineOp(bp, node, a)
          if (res.outcome === 'heal-parked') {
            // heal 已抛 agent 决策（waiting-decision）或被暂停：落对应停点，退出驱动循环。
            if (a.paused) bp.state = 'paused'
            break
          }
          if (res.done) {
            retries.delete(`${bp.runId}:${node.id}`)
            const gates = node.gate ?? []
            setPhase(bp, node, gates.length ? { kind: 'gate', index: 0 } : { kind: 'done' })
          } else if (isTransient(res.outcome) && bump(bp.runId, node.id) <= MAX_RETRY) {
            continue
          } else if (isAutoSkippable(opOf(node), res.outcome)) {
            emit({ kind: 'skip', runId: bp.runId, nodeId: node.id, reason: `${res.outcome} 自动跳过:${res.detail}` })
            setPhase(bp, node, { kind: 'done' })
          } else {
            const op = opOf(node)
            const address =
              op === 'push-branch'
                ? makeGitRunner(bp.request.repoPath)(['remote', 'get-url', bp.request.remote ?? 'origin']) ?? undefined
                : undefined
            raiseDecision(bp, buildFailureDecision(node.id, nodeLabel(node), op, res.outcome, res.detail, { address }))
            break
          }
        } else if (node.executor.kind === 'agent' && prepareAgent) {
          const r = await runAgentNode(bp, node, a)
          if (r === 'paused') {
            bp.state = 'paused'
            break
          }
          if (r === 'decided') break
          if (r === 'heal') continue // phase 仍 executing → 重跑（下次走续接）
          // r === 'done'：进门把（或直达 done）
          const gates = node.gate ?? []
          setPhase(bp, node, gates.length ? { kind: 'gate', index: 0 } : { kind: 'done' })
        } else {
          // agent（执行器未注入）/ subworkflow:未落地,跳过。
          emit({ kind: 'skip', runId: bp.runId, nodeId: node.id, reason: `执行器 ${node.executor.kind} 未落地,跳过` })
          setPhase(bp, node, { kind: 'done' })
        }
      } else if (bp.phase.kind === 'gate') {
        const gates = node.gate ?? []
        const k = bp.phase.index
        if (k >= gates.length) {
          setPhase(bp, node, { kind: 'done' })
          continue
        }
        const gate = gates[k]
        if (gate.kind === 'manual') {
          const actions = (gate.actions ?? []).map((act, i) => ({ label: act.label, index: i }))
          raiseDecision(bp, buildManualGateDecision(node.id, nodeLabel(node), actions, resolveNodeOutputs(bp, node)))
          break
        }
        // 客观门:解析命令(inline 裸命令 / ref 规则库条目)后真跑。
        const command = gate.check.kind === 'inline' ? gate.check.command : getObjectiveCheck(gate.check.ref)
        if (!command) {
          emit({ kind: 'skip', runId: bp.runId, nodeId: node.id, reason: '客观检查条目缺失,跳过该检查' })
          setPhase(bp, node, { kind: 'gate', index: k + 1 })
          continue
        }
        const r = await execCmd(bp, node.id, command, a, { timeoutSec: gate.timeoutSec })
        if (r.killed && a.paused && !r.timedOut) {
          bp.state = 'paused'
          break
        }
        const gateKey = `${node.id}:${k}`
        if (r.code === 0 && !r.timedOut) {
          // 通过:清零该门重试历史,进下一道。
          if (bp.gateLog) delete bp.gateLog[gateKey]
          emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: 'success', detail: r.stdout, code: 0 })
          setPhase(bp, node, { kind: 'gate', index: k + 1 })
          continue
        }
        // 未过:按「原因 + 节点类型」分流。reason=检查输出(给用户看为什么没过,不显示退出码)。
        const reason = (r.stderr || r.stdout || '').trim()
        const cause: GateAttempt['cause'] = r.timedOut ? 'timeout' : 'error'
        const isAiNode = node.executor.kind === 'agent' || node.executor.kind === 'subworkflow'
        emit({ kind: 'op-output', runId: bp.runId, nodeId: node.id, outcome: r.timedOut ? 'timeout' : 'gate-failed', detail: reason, code: r.code })
        // 门报错(非零):命令节点先 heal（改代码 → 提交 → 重跑该门验证）；引擎节点无代码可改 → 直接交用户。
        if (cause === 'error' && !isAiNode) {
          if (node.executor.kind === 'command') {
            const healed = await healCommand(bp, node, a, {
              command,
              output: reason,
              verify: async () => {
                const v = await execCmd(bp, node.id, command, a, { timeoutSec: gate.timeoutSec })
                return v.code === 0 && !v.timedOut && !v.killed
              }
            })
            if (healed === 'resolved') {
              if (bp.gateLog) delete bp.gateLog[gateKey]
              setPhase(bp, node, { kind: 'gate', index: k + 1 })
              continue
            }
            if (healed === 'parked') break
          }
          raiseDecision(bp, buildGateDecision(node.id, nodeLabel(node), { reason }))
          break
        }
        // 否则(超时 → 重跑门;agent/subworkflow 报错 → 重跑节点)自动有限次重跑,满 3 升级。
        const rerun: GateAttempt['rerun'] = cause === 'timeout' ? 'gate' : 'node'
        const log = ((bp.gateLog ??= {})[gateKey] ??= [])
        if (log.length < MAX_GATE_RETRY) {
          const attempt: GateAttempt = { cause, rerun, ...(cause === 'error' ? { code: r.code } : {}) }
          log.push(attempt)
          deps.store.save(bp) // 持久化重试计数,使关闭重开后不丢
          emit({ kind: 'gate-retry', runId: bp.runId, nodeId: node.id, gateIndex: k, attempt, count: log.length })
          if (rerun === 'node') {
            // agent 节点门失败:把门原因塞进节点执行态，使重跑走**续接**（注入失败详情）而非从头新拉。
            if (node.executor.kind === 'agent') {
              ((bp.agentRuns ??= {})[node.id] ??= {}).lastFailure = `客观门未通过：\n${reason}`
            }
            setPhase(bp, node, { kind: 'executing' })
          }
          continue
        }
        raiseDecision(bp, buildGateDecision(node.id, nodeLabel(node), { reason, history: log }))
        break
      } else {
        // done
        advanceNode(bp, nodes, idx)
      }
    }
    // 运行抵达终局:同步杀掉其全部后台命令并清记录(不留孤儿,对齐「工作流完成即收尾后台」)。
    if (bp.state === 'done' || bp.state === 'aborted') killBackgroundOf(bp.runId, bp, a)
    return persist(bp)
  }

  /** 注册活运行并后台驱动,立即返回 { runId, settled }。 */
  function launch(bp: RunBreakpoint): Launched {
    bp.state = 'running'
    const a = freshActive(bp.runId) // 保留既有后台命令登记
    ensureBackgroundRunning(bp, a) // 恢复/重开:按记录重启缺失的后台命令
    deps.store.save(bp) // 落初始断点,供 getRunState 立即可见
    const settled = drive(bp, a).finally(() => {
      a.driving = false
    })
    a.settled = settled
    settled.catch(() => {})
    return { runId: bp.runId, settled }
  }

  function raiseDecision(bp: RunBreakpoint, decision: EngineDecision): void {
    bp.pendingDecision = decision
    bp.state = 'waiting-decision'
    emit({ kind: 'decision', runId: bp.runId, decision })
  }

  function bump(runId: string, nodeId: string): number {
    const key = `${runId}:${nodeId}`
    const n = (retries.get(key) ?? 0) + 1
    retries.set(key, n)
    return n
  }

  return {
    start(req) {
      const runId = newRunId()
      // 建分支统一递增避撞(仅卡派生的运行请求 opt-in,见 avoidBranchConflict):start 时一次性解析出一个在
      // 所有涉及仓「分支不存在且 worktree 路径空闲」的名字,全仓共用同一名(见 engine-execution)。**只在此解析
      // 一次**——resume/decide 沿用已烙入的 branch、不重跑撞名检测(deriveMembers 保持纯函数),否则会从运行
      // 自己已建的 worktree 上递增走开、造成孤儿。未 opt-in 的直接运行沿用既有幂等认领语义(不改名)。
      const reqBranch = req.avoidBranchConflict
        ? resolveFreeBranch(req.branch ?? `klarit/${runId.slice(-8)}`, membersOf(req), {
            branchExists: (repoPath, b) =>
              listBranches(repoPath, makeGitRunner(repoPath)).branches.includes(b),
            pathExists: (p) => existsSync(p)
          })
        : req.branch
      const derived = derive({ ...req, branch: reqBranch }, runId)
      const bp: RunBreakpoint = {
        runId,
        request: derived,
        state: 'running',
        currentNodeId: null,
        phase: { kind: 'executing' },
        pendingDecision: null,
        members: deriveMembers(derived)
      }
      return launch(bp)
    },

    resume(runId) {
      const bp = deps.store.load(runId)
      if (!bp) throw new Error(`未知运行:${runId}`)
      if (bp.state === 'done' || bp.state === 'aborted') return { runId, settled: Promise.resolve(bp) }
      bp.request = derive(bp.request, bp.runId)
      bp.members = deriveMembers(bp.request)
      if (bp.pendingDecision) {
        // 仍有待决策:恢复为 waiting-decision,需 decide 才能续。但后台命令仍要按记录重启(暂停时被杀)。
        bp.state = 'waiting-decision'
        const a = ensureActive(runId)
        a.paused = false
        ensureBackgroundRunning(bp, a)
        return { runId, settled: Promise.resolve(persist(bp)) }
      }
      return launch(bp)
    },

    decide(runId, response) {
      const bp = deps.store.load(runId)
      if (!bp) throw new Error(`未知运行:${runId}`)
      if (!bp.pendingDecision || bp.state !== 'waiting-decision') return { runId, settled: Promise.resolve(bp) }
      const decided = bp.pendingDecision // 捕获来源/选项，供 agent 决策路由（清空前）
      bp.pendingDecision = null
      bp.state = 'running'
      bp.request = derive(bp.request, bp.runId)
      bp.members = deriveMembers(bp.request)
      deps.store.save(bp) // 先落「已清待决策的 running 态」,使 getRunState 立即一致(IPC 不 await settled)
      const a = freshActive(runId) // 保留既有后台命令登记
      ensureBackgroundRunning(bp, a) // 关软件后经 decide 续跑:按记录重启缺失的后台命令
      const settled = (async (): Promise<RunBreakpoint> => {
        const nodes = nodesOf(bp)
        const node = nodes.find((n) => n.id === bp.currentNodeId)
        const d = bp.request
        const ctx = makeContext(d.repoPath, d.remote ?? 'origin')
        const optionId = response.optionId

        bp.state = 'running'
        const freeText = response.text?.trim() || ''

        // heal agent 提问的答复 → 经续接注入回**该 heal**（source 标 `heal:<key>:agent-ask`），重跑当前节点。
        if (decided.source.startsWith('heal:') && node) {
          const key = decided.source.slice('heal:'.length).replace(/:agent-ask$/, '')
          const chosen = decided.options.find((o) => o.id === optionId)
          const answer = freeText || chosen?.label || chosen?.labelKey || optionId || ''
          ;((bp.healRuns ??= {})[key] ??= {}).pendingAnswer = answer
          setPhase(bp, node, { kind: 'executing' })
          return drive(bp, a)
        }

        // agent 来源决策（agent 运行时提问 / 自愈超限）→ 把答复经续接注入原 agent 续跑，重跑 executing。
        if (decided.sourceKind === 'agent' && node) {
          const chosen = decided.options.find((o) => o.id === optionId)
          const answer = freeText || chosen?.label || chosen?.labelKey || optionId || ''
          const nr = (bp.agentRuns ??= {})[node.id] ?? ((bp.agentRuns[node.id] = {}) as NonNullable<RunBreakpoint['agentRuns']>[string])
          nr.pendingAnswer = answer
          setPhase(bp, node, { kind: 'executing' })
          return drive(bp, a)
        }

        // push 无远端的填空（远端地址）→ 配置远端后重跑当前节点。
        if (freeText && decided.input?.labelKey === 'engineDecision.inputRemoteAddress') {
          await ctx.run(['remote', 'remove', d.remote ?? 'origin'])
          await ctx.run(['remote', 'add', d.remote ?? 'origin', freeText])
          return drive(bp, a)
        }

        // 人工评审门驳回（写了驳回意见）→ 新起只读回退判定 agent（内容驱动回退）。留空 + 通过走下面的 'pass'。
        if (node && decided.source.endsWith(':manual-gate') && freeText) {
          await runRollbackJudge(bp, node, freeText, a)
          return persist(bp)
        }

        // 回退确认决策：换说法→重判；取消→退回评审门；选目标节点→重入前向修复。
        if (node && decided.source.endsWith(':rollback-confirm')) {
          if (freeText) {
            await runRollbackJudge(bp, node, freeText, a)
            return persist(bp)
          }
          if (!optionId || optionId === 'cancel-rollback') {
            raiseManualGate(bp, node)
            return persist(bp)
          }
          return reenterFromRollback(bp, node, optionId, decided.raw ?? '', a)
        }

        // 其余含自由输入、engine 来源、无当前 agent 的决策 → 新起读写**处置 agent**，处置后重跑当前节点。
        if (freeText && node && decided.sourceKind === 'engine') {
          const background = decided.reason || decided.raw || decided.titleKey || ''
          const r = await runDispositionAgent(bp, node, background, freeText, a)
          if (r === 'parked') return persist(bp)
          setPhase(bp, node, { kind: 'executing' })
          return drive(bp, a)
        }

        // 客观门升级决策(retry/rerun-node/skip)被人工回应 → 重置该门自动重试预算。
        if (node && bp.phase.kind === 'gate' && bp.gateLog) delete bp.gateLog[`${node.id}:${bp.phase.index}`]

        switch (optionId) {
          case 'pass': // 人工评审门通过 → 过当前门
            if (node && bp.phase.kind === 'gate') bp.phase = { kind: 'gate', index: bp.phase.index + 1 }
            return drive(bp, a)
          case 'skip': // 跳过该节点/该门,流程继续
            if (node && bp.phase.kind === 'gate') bp.phase = { kind: 'gate', index: bp.phase.index + 1 }
            else if (node) setPhase(bp, node, { kind: 'done' })
            return drive(bp, a)
          case 'rerun-node': // 客观门升级:重跑整个节点(回到 executing)
            if (node) setPhase(bp, node, { kind: 'executing' })
            return drive(bp, a)
          case 'widen-scope': // 越界升级:本次放宽为整条分支可写 + 重置自愈预算 + 重跑节点
            if (node) {
              scopeWaived.add(`${bp.runId}:${node.id}`)
              if (bp.agentRuns?.[node.id]) bp.agentRuns[node.id].attempts = 0
              setPhase(bp, node, { kind: 'executing' })
            }
            return drive(bp, a)
          case 'force':
            transient.set(bp.runId, { force: true })
            return drive(bp, a)
          case 'pull-rebase':
            transient.set(bp.runId, { pullFirst: true })
            return drive(bp, a)
          case 'recreate':
            if (d.worktreePath) rmSync(d.worktreePath, { recursive: true, force: true })
            return drive(bp, a)
          case 'suffix':
            bp.request = { ...d, worktreePath: nextSuffixed(d.worktreePath!) }
            return drive(bp, a)
          case 'merge-then-delete':
            await ensureMerged(ctx, d.branch!, d.baseBranch!)
            return drive(bp, a)
          case 'retry':
          default:
            return drive(bp, a) // phase 不变,重跑当前阶段
        }
      })().finally(() => {
        a.driving = false
      })
      a.settled = settled
      settled.catch(() => {})
      return { runId, settled }
    },

    async pause(runId) {
      const bp = deps.store.load(runId)
      if (!bp) throw new Error(`未知运行:${runId}`)
      if (bp.state === 'done' || bp.state === 'aborted') return bp
      const a = active.get(runId)
      if (a && a.driving) {
        // 驱动中:暂停=一切静止——杀前台 + 杀后台活进程(保留可重启记录),等 drive 在边界落 paused。
        a.paused = true
        suspendBackground(a)
        a.abort.abort()
        await a.settled.catch(() => {})
        return deps.store.load(runId)!
      }
      // 已 park(waiting-decision 等)或无活运行:杀后台活进程(留记录)+ 直接落 paused(保留 pendingDecision)。
      if (a) {
        a.paused = true
        suspendBackground(a)
      }
      bp.state = 'paused'
      return persist(bp)
    },

    getRunState(runId) {
      return deps.store.load(runId)
    },

    async resumeAll() {
      const pending: Array<Promise<unknown>> = []
      for (const bp of deps.store.list()) {
        if (bp.state === 'running') pending.push(this.resume(bp.runId).settled.catch(() => {}))
      }
      await Promise.all(pending)
    },

    async runGateAction(runId, actionIndex) {
      const bp = deps.store.load(runId)
      if (!bp) throw new Error(`未知运行:${runId}`)
      const nodes = nodesOf(bp)
      const node = nodes.find((n) => n.id === bp.currentNodeId)
      if (!node || bp.phase.kind !== 'gate') return { bgId: '' }
      const gate = (node.gate ?? [])[bp.phase.index]
      if (!gate || gate.kind !== 'manual') return { bgId: '' }
      const action = (gate.actions ?? [])[actionIndex]
      if (!action) return { bgId: '' }
      const a = ensureActive(runId)
      // 动作 bgId **按按钮身份稳定**(节点+索引):启动→中止→再启动复用同一格输出,不攒新窗口。
      const bgId = `bg-action-${node.id}-${actionIndex}`
      // 单例:同一动作已有活进程 → 先停旧再起新(不叠 spawn)。
      for (const proc of a.background.filter((b) => b.bgId === bgId || (b.action?.nodeId === node.id && b.action.index === actionIndex))) {
        proc.kill()
        a.background = a.background.filter((b) => b !== proc)
        emit({ kind: 'background', runId, nodeId: node.id, bgId: proc.bgId, label: proc.label, status: 'stopped' })
      }
      // 复用同一桶:清掉上次(可能是崩溃/中止)的旧输出,让本次从空开始。
      outputBuffer.clear(runId, `bg:${bgId}`)
      // 登记为后台命令(各自 bgId/桶/中止/后台生命周期)。动作是手动旁路进程,**不落持久 background[]**——
      // 故 run 终局/关软件会杀它,但开机恢复不自动拉起(用户手动再触发)。
      let killHandle: () => void = () => {}
      const rec = { bgId, nodeId: node.id, label: action.label, command: action.command, ...(action.timeoutSec ? { timeoutSec: action.timeoutSec } : {}) }
      const runP = runCmd(action.command, {
        cwd: cwdOf(bp),
        onChunk: (stream, chunk) => emit({ kind: 'op-chunk', runId, nodeId: node.id, stream, chunk, bgId }),
        onStart: (h) => {
          killHandle = h.kill
        }
      })
      registerBackground(bp, a, rec, () => killHandle(), runP)
      const proc = a.background.find((b) => b.bgId === bgId)
      if (proc) proc.action = { nodeId: node.id, index: actionIndex }
      return { bgId }
    },

    stopGateAction(runId) {
      const a = active.get(runId)
      if (!a) return
      for (const proc of a.background.filter((b) => b.action)) {
        proc.kill()
        a.background = a.background.filter((b) => b !== proc)
        emit({ kind: 'background', runId, nodeId: proc.nodeId, bgId: proc.bgId, label: proc.label, status: 'stopped' })
      }
    },

    advanceCommand(runId, mode) {
      const a = active.get(runId)
      if (!a) return
      a.advance = mode
      if (mode === 'abort') a.abort.abort() // 杀掉本节点全部在跑命令(execCmd 返回 killed → 推进)
      else for (const resolve of [...a.detachResolvers]) resolve() // 转后台:广播到全部在跑命令
    },

    listBackground(runId) {
      // 以持久记录为准(暂停时活进程已杀但记录仍在,UI 仍应显示)。
      const bp = deps.store.load(runId)
      return (bp?.background ?? []).map(({ bgId, nodeId, label }) => ({ bgId, nodeId, label }))
    },

    stopBackground(runId, bgId) {
      const a = active.get(runId)
      const live = a?.background.find((b) => b.bgId === bgId)
      if (live) {
        live.kill()
        a!.background = a!.background.filter((b) => b.bgId !== bgId)
      }
      const bp = deps.store.load(runId)
      if (bp?.background) {
        const rec = bp.background.find((r) => r.bgId === bgId)
        bp.background = bp.background.filter((r) => r.bgId !== bgId)
        deps.store.save(bp)
        if (rec) emit({ kind: 'background', runId, nodeId: rec.nodeId, bgId, label: rec.label, status: 'stopped' })
      }
    },

    killAllBackground() {
      // app 退出 = 关软件自动暂停:杀活进程但**保留可重启记录**(置 paused 使其 .then 不摘记录),重开按记录恢复。
      for (const a of active.values()) {
        a.paused = true
        suspendBackground(a)
      }
    },

    readOutput: (runId, bucket) => outputBuffer.read(runId, bucket),
    listOutputBuckets: (runId) => outputBuffer.listBuckets(runId)
  }
}

function opOf(node: WorkflowNode): string {
  return node.executor.kind === 'engine' ? node.executor.operation : node.executor.kind
}

function isTransient(outcome: string): boolean {
  return outcome === 'locked'
}
