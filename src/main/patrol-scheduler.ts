/**
 * 定时巡检回路（主进程常驻）：分钟级 tick 唤醒 `evaluate()`，把当前项目每条**启用且到期**的巡检
 * 发起一次。形态照搬 `auto-scheduler.ts`——`evaluate()` 串行化、可重入合并、**永不抛**、依赖全注入；
 * 到期判定是 `shared/patrol.ts` 里的确定性纯函数（不读真实时钟）。触发点（tick / 开机 / 切项目）由 main 接线。
 *
 * **零新执行器**：三类动作全部落到既有接缝——工作流走与自动排程相同的运行启动路径、命令走既有可取消
 * 命令运行器、文档扫描走既有 `document-scan`。本模块只做「到期判定 → 记时 → 派发」。
 *
 * **绝不自作主张**：主动产出的唯一去处是经既有候选提交接缝推**候选需求卡**（止于审阅）。不改代码、
 * 不合并、不落库活卡、不为产出排程。**也没有任何决策收件箱写入口**——`decision-inbox` 是
 * `pendingDecision` 的纯投影，塞独立条目会摧毁其不变量；巡检拉起的工作流若停在人工门上，其运行照
 * 既有决策机制被投影过去，巡检侧零代码。
 *
 * **记时时机是「发起动作时」而非成功时**：否则一条总失败的巡检会在每个 tick 重试成死循环。
 * **槽满跳过不排队**：巡检与自动排程共享同一并发上限（`hasFreeSlot` 由 main 接到 auto-scheduler 的
 * `freeSlots()`），槽满时本次不发起、`lastRunAt` 照常更新，等下个周期——排队会让定时任务堆积成雪崩。
 *
 * **抛决策即中止转候选**：巡检拉起的运行不绑卡，故收件箱（按 `card.activeRunId` 反查界定）永远不投影它——
 * 放它停在待决策上就是**无人可见、无人能答、还永久占住一个并发槽**。所以本回路自己盯着**自己拉起的**运行：
 * 一抛出任何待决策（不分来源），立刻走既有 `abort` 到终局释放槽，再把该情形转成一条候选卡交用户审阅。
 */

import type { CandidateCard, EngineDecision, EngineProgressEvent, Project } from '../shared/types'
import { findingsToCandidates, isDue, type Patrol, type PatrolFinding } from '../shared/patrol'

export interface PatrolSchedulerDeps {
  /** 当前（绑定）项目的全部巡检；默认零条。 */
  listPatrols: () => Patrol[]
  /** 当前绑定项目；未绑定返回 null（回路空转）。 */
  getProject: () => Project | null
  /** 「现在」（毫秒）——注入以便测试不依赖真实时钟。 */
  now: () => number
  /** 自动并发槽是否还有空位（= `auto-scheduler` 的同一上限、同一 `isRunLive` 判定）。 */
  hasFreeSlot: () => boolean
  /** 记一次**发起**（持久化 `lastRunAt`）。 */
  markRun: (patrolId: string, at: number) => void
  /** 跑工作流：复用与自动排程相同的运行启动路径；返回 runId（起不来给 null）。 */
  startWorkflow: (workflowId: string, patrol: Patrol) => string | null
  /** 跑命令：复用既有可取消命令运行器（`command-execution`）。 */
  runCommand: (command: string, signal: AbortSignal) => Promise<unknown>
  /** 文档腐烂扫描：复用既有 `document-scan`，返回本次发现（无发现给空）。 */
  scanDocuments: () => Promise<PatrolFinding[]>
  /** 候选卡类型 id（取项目在册类型，由 main 解析）。 */
  candidateTypeId: () => string
  /** 推候选需求卡：既有候选提交接缝，**止于审阅**。 */
  pushCandidates: (candidates: CandidateCard[]) => void | Promise<void>
  /**
   * 订阅引擎进度事件（= main 既有的主进程观察者接缝，与 `decision-inbox` 同一个）；返回退订函数。
   * 巡检运行不绑卡、不进收件箱，只能靠本回路自己听见「它撞上决策了」。
   */
  onEngineProgress: (handler: (evt: EngineProgressEvent) => void) => () => void
  /** 中止某运行到终局（既有 `engine.abort`），释放其占用的并发槽。 */
  abortRun: (runId: string) => void | Promise<void>
  /**
   * 把「某巡检的运行卡在某决策上」描述成一条发现（人话文案 i18n 归 main，shared/回路不拼语言）。
   * `nodeId` 由决策的 `source`（`<nodeId>:<outcome>`）界定。
   */
  describeStuckRun: (input: {
    patrol: Patrol
    runId: string
    nodeId: string
    decision: EngineDecision
  }) => PatrolFinding
}

export interface PatrolScheduler {
  /**
   * 重新评估全部巡检并发起到期者。串行化、可重入合并、永不抛。
   * 返回前 await 全部在飞动作（含「撞上决策 → 中止转候选」的善后），故调用方可据它确定本轮已落定。
   */
  evaluate: () => Promise<void>
  /** 停止回路：退订引擎事件 + 取消所有在飞命令（中止语义交给既有运行器）。 */
  dispose: () => void
}

export function createPatrolScheduler(deps: PatrolSchedulerDeps): PatrolScheduler {
  let evaluating = false
  let pending = false
  /** 在飞动作（供调用方/测试确定性地等本轮落定）。 */
  const inflight = new Set<Promise<unknown>>()
  /** 在飞命令的取消句柄。 */
  const controllers = new Set<AbortController>()
  /** 本回路拉起且尚未终局的运行：runId → 是哪条巡检拉的（转候选时要载明）。 */
  const launched = new Map<string, Patrol>()

  function track(p: Promise<unknown>): void {
    const wrapped = p.catch(() => undefined) // 动作失败不冒泡：已记时，下个周期再说
    inflight.add(wrapped)
    void wrapped.finally(() => inflight.delete(wrapped))
  }

  /** 文档腐烂扫描 → 发现 → 候选需求卡（唯一去处，止于审阅）。 */
  async function docScan(): Promise<void> {
    const findings = await deps.scanDocuments()
    if (!findings || findings.length === 0) return
    await deps.pushCandidates(findingsToCandidates(findings, deps.candidateTypeId()))
  }

  /**
   * 巡检运行撞上待决策：**先**走既有 `abort` 到终局（释放并发槽，这一步绝不能被产出侧的异常挡住），
   * **再**把该情形转成一条候选卡交用户审阅。中止接缝自己抛也照样转候选——问题必须被看见。
   */
  async function convertStuckRun(patrol: Patrol, runId: string, decision: EngineDecision): Promise<void> {
    try {
      await deps.abortRun(runId)
    } catch {
      // 中止失败也要把情形交出去：咽掉才是真的静默卡住。
    }
    const nodeId = decision.source?.split(':')[0] ?? ''
    const finding = deps.describeStuckRun({ patrol, runId, nodeId, decision })
    await deps.pushCandidates(findingsToCandidates([finding], deps.candidateTypeId()))
  }

  const offProgress = deps.onEngineProgress((evt) => {
    if (evt.kind === 'op-chunk' || evt.kind === 'op-output') return
    const patrol = launched.get(evt.runId)
    if (!patrol) return // 别人的运行（绑卡的那些）自有收件箱管，巡检不插手
    if (evt.kind === 'decision') {
      launched.delete(evt.runId) // 一次性：同一运行的后续事件（含 abort 的终局）不再重复处置
      track(convertStuckRun(patrol, evt.runId, evt.decision))
      return
    }
    // 自行走到终局的运行不必再盯，撤掉表项（不让登记表随巡检次数无限长）。
    if (evt.kind === 'state' && (evt.state === 'done' || evt.state === 'aborted')) launched.delete(evt.runId)
  })

  /** 派发一条巡检的动作（薄适配，三类各自落到既有接缝）。 */
  function dispatch(patrol: Patrol): void {
    const action = patrol.action
    if (action.kind === 'workflow') {
      const runId = deps.startWorkflow(action.workflowId, patrol)
      // 盯住它：这个运行不绑卡，收件箱不会替我们看着它。
      if (runId) launched.set(runId, patrol)
      return
    }
    if (action.kind === 'command') {
      const controller = new AbortController()
      controllers.add(controller)
      track(
        Promise.resolve(deps.runCommand(action.command, controller.signal)).finally(() =>
          controllers.delete(controller)
        )
      )
      return
    }
    track(docScan())
  }

  async function runOnce(): Promise<void> {
    if (!deps.getProject()) return
    const patrols = deps.listPatrols()
    if (patrols.length === 0) return
    const at = deps.now()
    for (const patrol of patrols) {
      try {
        if (!isDue({ trigger: patrol.trigger, lastRunAt: patrol.lastRunAt, enabled: patrol.enabled, now: at })) {
          continue
        }
        // 先记时再派发：发起即算「跑了」，失败也不在本 tick 重试。槽满亦记时（跳过本次、不排队）。
        deps.markRun(patrol.id, at)
        if (!deps.hasFreeSlot()) continue
        dispatch(patrol)
      } catch {
        // 单条巡检出错不拖累同轮其它巡检。
      }
    }
  }

  async function evaluate(): Promise<void> {
    if (evaluating) {
      pending = true
      return
    }
    evaluating = true
    try {
      do {
        pending = false
        try {
          await runOnce()
        } catch {
          // 回路永不因单次评估异常而停摆。
        }
      } while (pending)
    } finally {
      evaluating = false
    }
    // 动作在**guard 之外**落定：长命令不阻塞下一次评估，但调用方仍可 await 到本轮结果。
    await Promise.allSettled([...inflight])
  }

  return {
    evaluate,
    dispose: () => {
      offProgress()
      launched.clear()
      for (const c of controllers) c.abort()
      controllers.clear()
    }
  }
}
